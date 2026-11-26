import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const recoveryCases = {
  development: [
    'duplicate',
    'output-recovery',
    'timeout-recovery',
    'timeout-stop',
    'output-exhausted',
    'development-human',
    'issue-title-fallback',
    'stale-edit',
    'repeated-stale-edit',
    'blocked-edit',
    'first-guard',
    'initial-stop',
    'merged-resume',
  ],
  publication: [
    'journal-before-write',
    'journal-after-write',
    'pr-service-before',
    'pr-service-after',
    'review-service-before',
    'review-service-after',
    'review-service-delayed',
    'review-service-late-visible',
    'review-service-drift',
    'legacy-rejection',
    'journal-unavailable',
    'journal-conflicting',
    'interrupted-development',
    'resume-before-pr',
    'interrupted-review-record',
    'interrupted-visible-review',
    'interrupted-review',
    'interrupted-commit',
    'interrupted-created-pr',
    'interrupted-before-commit',
    'interrupted-before-pr',
  ],
  'review and CI': [
    'review-revision',
    'review-revision-delayed-pr',
    'review-limit',
    'review-no-change',
    'review-human',
    'claude-label',
    'completion-dispatch',
    'blocked-ci',
    'blocked-ci-drift',
    'ci-repair',
    'ci-format-repair',
    'post-ci-review',
    'post-ci-limit',
    'during-review',
  ],
  'base and branch recovery': [
    'before',
    'after',
    'restart-limit',
    'update-limit',
    'manual-head',
    'upstream-head',
    'upstream-extra',
    'merge-conflict',
    'adjacent-line',
    'edited-issue',
    'edited-pr',
  ],
};

for (const [group, cases] of Object.entries(recoveryCases)) {
  for (const testCase of cases) registerRecoveryCase(group, testCase);
}

function registerRecoveryCase(group, testCase) {
  test(`issue recovery: ${group}: ${testCase}`, async (t) => {
    const originalTimeout = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
      originalTimeout(callback, delay === 30_000 ? 0 : delay, ...args),
    );
    const delayedPull = testCase === 'review-revision-delayed-pr';
    const scenario = delayedPull ? 'review-revision' : testCase;
    const root = mkdtempSync(join(tmpdir(), 'agentopia-smoke-'));
    const cwd = process.cwd();
    t.after(() => {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    });
    const remote = join(root, 'remote');
    const client = join(root, 'client');
    const git = (cwd, ...args) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Mock',
          GIT_AUTHOR_EMAIL: 'mock@example.org',
          GIT_COMMITTER_NAME: 'Mock',
          GIT_COMMITTER_EMAIL: 'mock@example.org',
        },
      }).trim();
    mkdirSync(remote);
    git(remote, 'init', '-b', 'dev');
    writeFileSync(join(remote, 'README.md'), '# Test\n');
    writeFileSync(join(remote, 'AGENTS.md'), '# Instructions\n');
    git(remote, 'add', '.');
    git(remote, 'commit', '-m', 'Base');
    let base = git(remote, 'rev-parse', 'HEAD');
    let advances = 0;
    let staleRead = false;
    function advance() {
      git(remote, 'switch', 'dev');
      advances++;
      writeFileSync(
        join(
          remote,
          ['merge-conflict', 'adjacent-line'].includes(scenario)
            ? 'README.md'
            : 'AGENTS.md',
        ),
        scenario === 'adjacent-line'
          ? '# Test\nConcurrent addition\n=======\n'
          : 'Updated base ' + advances,
      );
      git(remote, 'add', '.');
      git(remote, 'commit', '-m', 'Concurrent work');
      base = git(remote, 'rev-parse', 'HEAD');
    }
    git(root, 'clone', remote, client);
    process.chdir(client);

    const event = join(root, 'event.json');
    const repository = 'han41858/agentopia';
    writeFileSync(
      event,
      JSON.stringify({
        repository: { full_name: repository },
        sender: { login: 'tester' },
      }),
    );
    const stepOutput = join(root, 'step-output');
    writeFileSync(stepOutput, '');
    Object.assign(process.env, {
      GITHUB_OUTPUT: stepOutput,
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: repository,
      GITHUB_REF: 'refs/heads/dev',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_RUN_ID: '1',
      GITHUB_RUN_ATTEMPT: '1',
      AI_ISSUE: '15',
      GH_TOKEN: 'mock-actions',
      AI_AUTOMATION_TOKEN: 'mock-publisher',
      OPENAI_API_KEY: 'mock',
      ANTHROPIC_API_KEY: 'mock',
      AI_CODEX_MODEL: 'mock',
      AI_CLAUDE_MODEL: 'mock',
    });

    const claudeDeveloper = scenario === 'claude-label';
    const branch = claudeDeveloper ? 'ai/issue-15-claude' : 'ai/issue-15-codex';
    if (claudeDeveloper) {
      process.env.GITHUB_EVENT_NAME = 'issues';
      writeFileSync(
        event,
        JSON.stringify({
          repository: { full_name: repository },
          sender: { login: 'tester' },
          action: 'labeled',
          label: { name: 'ai:develop:claude' },
          issue: { number: 15 },
        }),
      );
    }
    const prefix = '/repos/' + repository;
    const states = [];
    let issueBody = 'Update README.';
    let interrupted = false;
    let resumed = false;
    let last,
      reviewCalls = 0,
      creations = 0;
    const saved = () =>
      JSON.parse(
        Buffer.from(last.match(/agentopia-ai-state:([^ ]+)/)[1], 'base64'),
      );
    let head,
      pr,
      developmentCalls = 0,
      commits = 0,
      postedReview,
      reviews = 0,
      blocked = scenario === 'initial-stop';
    if (scenario.startsWith('timeout-')) {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      t.mock.method(AbortSignal, 'timeout', (ms) =>
        ms === 180_000 && developmentCalls === 0
          ? AbortSignal.abort(new DOMException('timed out', 'TimeoutError'))
          : timeout(ms),
      );
    }
    let journalPosts = 0;
    let prPosts = 0;
    let reviewPosts = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const { hostname, pathname, searchParams } = new URL(url);
      const body = options.body && JSON.parse(options.body);
      const openai = hostname === 'api.openai.com';
      const anthropic = hostname === 'api.anthropic.com';
      function modelResponse(result) {
        const text = JSON.stringify(result);
        return Response.json(
          openai
            ? {
                status: 'completed',
                output: [{ content: [{ type: 'output_text', text }] }],
              }
            : { stop_reason: 'end_turn', content: [{ type: 'text', text }] },
        );
      }
      if (claudeDeveloper ? anthropic : openai) {
        developmentCalls++;
        if (scenario.startsWith('timeout-') && developmentCalls === 1) {
          blocked = scenario === 'timeout-stop';
          options.signal.throwIfAborted();
          assert.fail('expected provider timeout');
        }
        if (
          scenario === 'output-exhausted' ||
          (scenario === 'output-recovery' && developmentCalls === 1)
        )
          return Response.json({
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          });

        if (scenario === 'development-human') {
          const context = JSON.parse(body.input[0].content);
          if (!resumed) {
            assert.equal(context.developmentNote, undefined);
            return modelResponse({
              status: 'needs_human',
              title: '',
              edits: [],
              summary: '테스트 위치를 확인해 주세요.',
            });
          }
          assert.equal(
            context.previousDevelopmentBlocker,
            '테스트 위치를 확인해 주세요.',
          );
          assert.equal(context.developmentNote, '관련 테스트 위치');
        }
        if (scenario === 'interrupted-development' && !resumed)
          throw Error('connection lost');
        if (
          (scenario === 'before' && developmentCalls === 1) ||
          (scenario === 'restart-limit' && !resumed)
        )
          advance();
        if (scenario === 'before' && developmentCalls === 2)
          assert.match(body.instructions, /Updated base 1/);
        const edits = commits
          ? []
          : [{ path: 'README.md', before: 'Test', after: 'Updated' }];
        if (
          commits &&
          [
            'legacy-rejection',
            'review-limit',
            'review-revision',
            'review-no-change',
            'blocked-ci-drift',
          ].includes(scenario)
        ) {
          assert.match(JSON.parse(body.input[0].content).priorReview, /결함/);
          assert.equal(saved().recovery.reviewRevisions, commits);
          if (scenario !== 'review-no-change')
            edits.push({
              path: 'README.md',
              before: commits === 1 ? 'Updated' : 'Revision1',
              after: 'Revision' + commits,
            });
        }
        if (commits && scenario === 'ci-repair') {
          assert.match(JSON.parse(body.input[0].content).failedCI, /locator/);
          assert.equal(saved().recovery.ciRepairs, 1);
          edits.push({
            path: 'README.md',
            before: 'Updated',
            after: 'Revision1',
          });
        }
        if (commits && scenario.startsWith('post-ci-')) {
          const context = JSON.parse(body.input[0].content);
          if (commits === 3) assert.match(context.failedCI, /locator/);
          else assert.match(context.priorReview, /결함/);
          edits.push({
            path: 'README.md',
            before: commits === 1 ? 'Updated' : 'Revision' + (commits - 1),
            after: 'Revision' + commits,
          });
        }
        if (scenario === 'blocked-edit')
          edits[0].path = '.github/workflows/ci.yml';
        if (
          (scenario === 'stale-edit' && developmentCalls === 1) ||
          scenario === 'repeated-stale-edit'
        )
          edits[0].before = 'absent source';
        if (scenario.includes('stale-edit') && developmentCalls === 2) {
          assert.match(body.input.at(-1).content, /README.md.*원문/);
          assert.equal(commits, 0);
          assert.equal(creations, 0);
        }
        return modelResponse({
          status: 'completed',
          title:
            scenario === 'issue-title-fallback'
              ? ':art: 팝업 수정'
              : '📝 문서: 예제 수정',
          summary: '문서를 수정했습니다.',
          edits,
        });
      }
      if (claudeDeveloper ? openai : anthropic) {
        reviewCalls++;
        if (scenario.startsWith('post-ci-')) {
          const context = JSON.parse(body.messages[0].content);
          assert.equal(context.reviewHead, head);
          assert.equal(context.failedCI, undefined);
        }
        if (scenario === 'interrupted-review' && !resumed)
          throw Error('connection lost');
        if (
          (scenario === 'during-review' && reviewCalls === 1) ||
          (scenario === 'update-limit' && !resumed)
        )
          advance();
        if (scenario === 'review-human' && resumed)
          assert.equal(
            JSON.parse(body.messages[0].content).reproductionNote,
            '모바일 재현 조건',
          );
        if (scenario === 'review-human' && resumed)
          assert.match(
            JSON.parse(body.messages[0].content).unresolvedReview,
            /기준을 확인/,
          );
        if (scenario === 'review-human' && !resumed)
          return modelResponse({
            status: 'needs_human',
            summary: '기준을 확인해 주세요.',
            findings: [],
          });
        if (
          (scenario.startsWith('post-ci-') &&
            (reviewCalls <= 2 ||
              reviewCalls === 4 ||
              (reviewCalls === 5 && scenario === 'post-ci-limit'))) ||
          (scenario === 'blocked-ci-drift' && reviewCalls === 2) ||
          scenario === 'review-limit' ||
          (reviewCalls === 1 &&
            [
              'legacy-rejection',
              'review-revision',
              'review-no-change',
            ].includes(scenario))
        )
          return modelResponse({
            status: 'changes_requested',
            summary: '수정 요청',
            findings: [
              {
                path: 'README.md',
                line: 1,
                defect: '결함',
                impact: '표시 오류',
                evidence: '본문',
                fix: '수정',
              },
            ],
          });
        return modelResponse({
          status: 'pass',
          summary: '수정 사항을 확인했습니다.',
          findings: [],
        });
      }
      assert.equal(hostname, 'api.github.com');
      if (pathname === '/graphql') {
        assert.equal(options.headers.authorization, 'Bearer mock-publisher');
        if (scenario === 'interrupted-before-commit' && !resumed)
          throw Error('not accepted');
        const input = body.variables.input;
        if (scenario === 'issue-title-fallback')
          assert.equal(
            input.message.headline,
            '🎨 이슈 팝업: 제목 옆에 활동량 표시하고 파티 목록 정리',
          );
        assert.equal(input.expectedHeadOid, head);
        assert.equal(input.branch.branchName, branch);
        const published = Buffer.from(
          input.fileChanges.additions[0].contents,
          'base64',
        ).toString();
        const legacyFormat = scenario === 'ci-format-repair';
        assert.equal(
          published,
          commits && !legacyFormat
            ? '# Revision' + commits + '\n'
            : '# Updated\n',
        );
        git(remote, 'switch', branch);
        // Simulate a previously published, reviewed HEAD from before pre-publication formatting.
        writeFileSync(
          join(remote, 'README.md'),
          legacyFormat && !commits ? '# Updated' : published,
        );
        git(remote, 'add', 'README.md');
        git(
          remote,
          'commit',
          '-m',
          input.message.headline,
          '-m',
          input.message.body,
        );
        head = git(remote, 'rev-parse', 'HEAD');
        commits++;
        git(remote, 'switch', 'dev');
        if (['after', 'merge-conflict', 'adjacent-line'].includes(scenario))
          advance();
        if (scenario === 'interrupted-commit') throw Error('lost response');
        return Response.json({
          data: { createCommitOnBranch: { commit: { oid: head } } },
        });
      }
      assert.ok(pathname.startsWith(prefix));
      const path = pathname.slice(prefix.length);
      if (path === '/collaborators/tester/permission')
        return Response.json({ permission: 'write' });
      if (path === '/issues/15' && scenario === 'first-guard' && !resumed)
        throw Error('initial network failure');
      if (path === '/issues/15')
        return Response.json({
          title:
            scenario === 'issue-title-fallback'
              ? '🎨 이슈 팝업: 제목 옆에 활동량 표시하고 파티 목록 정리'
              : 'Test issue',
          body: issueBody,
          state: 'open',
          labels: [
            { name: claudeDeveloper ? 'ai:develop:claude' : 'ai:develop' },
            ...(blocked ? [{ name: 'ai:stop' }] : []),
          ],
        });
      if (path === '/git/ref/heads/dev')
        return Response.json({ object: { sha: base } });
      if (path === '/git/ref/heads/' + branch) {
        if (head) head = git(remote, 'rev-parse', branch);
        if (pr) pr.head.sha = head;
        if (scenario === 'review-revision' && commits === 2 && !staleRead) {
          staleRead = true;
          const previousHead = git(remote, 'rev-parse', branch + '^');
          if (delayedPull) pr.head.sha = previousHead;
          else return Response.json({ object: { sha: previousHead } });
        }
        return head
          ? Response.json({ object: { sha: head } })
          : Response.json({}, { status: 404 });
      }
      if (path === '/git/refs' && options.method === 'POST') {
        head = body.sha;
        git(remote, 'branch', branch, head);
        return Response.json({}, { status: 201 });
      }
      if (path === '/pulls') {
        if (
          scenario === 'resume-before-pr' &&
          commits &&
          !pr &&
          !interrupted &&
          last &&
          saved().recovery.draft
        ) {
          interrupted = true;
          advance();
          throw Error('network down before PR');
        }
        if (options.method === 'GET')
          return Response.json(
            pr &&
              searchParams.get('state') === (pr.merged_at ? 'closed' : 'open')
              ? [pr]
              : [],
          );
        assert.equal(options.headers.authorization, 'Bearer mock-publisher');
        if (scenario === 'issue-title-fallback')
          assert.equal(
            body.title,
            '🎨 이슈 팝업: 제목 옆에 활동량 표시하고 파티 목록 정리',
          );
        assert.equal(body.draft, true);
        assert.equal(body.base, 'dev');
        assert.equal(body.head, branch);
        assert.equal(pr, undefined);
        if (scenario === 'interrupted-before-pr' && !resumed)
          throw Error('not accepted');
        prPosts++;
        if (scenario === 'pr-service-before' && prPosts === 1)
          return Response.json({}, { status: 500 });
        creations++;
        pr = {
          number: 23,
          title: body.title,
          draft: true,
          body: body.body,
          head: { ref: branch, sha: head, repo: { full_name: repository } },
          base: { ref: 'dev', repo: { full_name: repository } },
        };
        if (scenario === 'interrupted-created-pr' && !resumed)
          throw Error('lost response');
        if (scenario === 'pr-service-after' && prPosts === 1)
          return Response.json({}, { status: 500 });
        return Response.json(pr);
      }
      if (path === '/issues/23/comments') {
        if (
          scenario === 'review-service-late-visible' &&
          options.method === 'GET' &&
          postedReview &&
          saved().recovery.reviewPublication?.delayedRetryReserved
        )
          return Response.json([
            {
              id: 23,
              user: { login: 'github-actions[bot]' },
              body: postedReview,
            },
          ]);
        if (
          options.method === 'GET' &&
          ['interrupted-visible-review', 'review-service-after'].includes(
            scenario,
          ) &&
          postedReview
        )
          return Response.json([
            { user: { login: 'github-actions[bot]' }, body: postedReview },
          ]);
        if (options.method === 'GET')
          return Response.json(
            scenario === 'review-human' && reviews
              ? [
                  {
                    user: { login: 'github-actions[bot]' },
                    body: `Claude 리뷰 · ${head}\n\n기준을 확인해 주세요.\n\nGenerated by Claude`,
                  },
                ]
              : [],
          );
        assert.match(
          body.body,
          claudeDeveloper ? /Generated by Codex/ : /Generated by Claude/,
        );
        reviewPosts++;
        if (scenario === 'review-service-late-visible') {
          if (reviewPosts === 2) {
            postedReview = body.body;
            reviews++;
          }
          return Response.json({}, { status: 502 });
        }
        if (
          ['review-service-delayed', 'review-service-drift'].includes(
            scenario,
          ) &&
          reviewPosts <= 2
        )
          return Response.json({}, { status: 503 });
        if (scenario === 'legacy-rejection' && !resumed)
          return Response.json({}, { status: 500 });
        if (scenario === 'review-service-before' && reviewPosts === 1)
          return Response.json({}, { status: 500 });
        reviews++;
        postedReview = body.body;
        if (scenario === 'review-service-after' && reviewPosts === 1)
          return Response.json({}, { status: 502 });
        if (
          ['interrupted-review-record', 'interrupted-visible-review'].includes(
            scenario,
          )
        )
          throw Error('lost acknowledgement');
        return Response.json({ id: 23 });
      }
      if (path === '/issues/15/comments' && options.method === 'GET')
        return Response.json(
          last
            ? [{ id: 15, user: { login: 'github-actions[bot]' }, body: last }]
            : [],
        );
      if (path === '/issues/15/comments' || path === '/issues/comments/15') {
        const firstPost = options.method === 'POST' && ++journalPosts === 1;
        if (firstPost && scenario === 'journal-conflicting') {
          last = '다른 갱신\n' + body.body;
          return Response.json({}, { status: 503 });
        }
        if (
          scenario === 'journal-unavailable' ||
          (firstPost && scenario === 'journal-before-write')
        )
          return Response.json({}, { status: 500 });
        last = body.body;
        if (firstPost && scenario === 'journal-after-write')
          return Response.json({}, { status: 500 });
        const state = JSON.parse(
          Buffer.from(
            body.body.match(/agentopia-ai-state:([^ ]+)/)[1],
            'base64',
          ),
        );
        assert.equal(state.issue, 15);
        if (
          scenario === 'review-service-drift' &&
          !advances &&
          state.recovery?.reviewPublication?.delayedRetryReserved
        )
          advance();
        states.push(state.status);
        return Response.json({ id: 15 });
      }
      throw new Error('Unexpected request ' + path);
    });

    const runner = new URL('./run.mjs?case=' + testCase, import.meta.url);
    if (['journal-unavailable', 'journal-conflicting'].includes(scenario)) {
      await assert.rejects(
        import(runner + '?first'),
        /진행 댓글을 안전하게 저장/,
      );
      assert.equal(journalPosts, scenario === 'journal-unavailable' ? 2 : 1);
      assert.equal(developmentCalls, 0);
      assert.equal(commits, 0);
      if (scenario === 'journal-conflicting')
        assert.ok(last.startsWith('다른 갱신'));
      return;
    }
    if (scenario === 'legacy-rejection') {
      await assert.rejects(import(runner + '?first'));
      const old = saved();
      assert.equal(
        old.recovery.reviewPublication.result.status,
        'changes_requested',
      );
      delete old.recovery.reviewPublication.body;
      delete old.recovery.reviewPublication.retryable;
      last = last.replace(
        /agentopia-ai-state:[^ ]+/,
        'agentopia-ai-state:' +
          Buffer.from(JSON.stringify(old)).toString('base64'),
      );
      writeFileSync(
        event,
        JSON.stringify({
          repository: { full_name: repository },
          sender: { login: 'tester' },
          inputs: { development_note: 'CI에서 확인한 결함' },
        }),
      );
      process.env.GITHUB_RUN_ID = '2';
      resumed = true;
      await import(runner + '?manual');
      assert.equal(saved().status, 'ready');
      assert.equal(commits, 2);
      assert.equal(reviewCalls, 2);
      assert.equal(saved().reviews[0].head, head);
      return;
    }
    if (scenario === 'output-exhausted') {
      await assert.rejects(import(runner + '?exhausted'));
      assert.equal(saved().recovery.modelRecoveries, 2);
      assert.equal(developmentCalls, 3);
      assert.equal(commits, 0);
      return;
    }
    if (scenario === 'repeated-stale-edit' || scenario === 'blocked-edit') {
      await assert.rejects(import(runner + '?first'));
      assert.equal(saved().status, 'failed');
      assert.match(
        saved().reason,
        scenario === 'blocked-edit' ? /허용 범위/ : /1번째 편집.*원문/,
      );
      assert.equal(developmentCalls, scenario === 'blocked-edit' ? 1 : 2);
      assert.equal(commits, 0);
      assert.equal(creations, 0);
      return;
    }
    const uncertain = scenario.startsWith('interrupted');
    if (
      uncertain ||
      scenario === 'first-guard' ||
      scenario === 'resume-before-pr'
    )
      await assert.rejects(import(runner + '?first'));
    else await import(runner + '?first');
    if (scenario.startsWith('review-service-')) {
      assert.equal(saved().status, 'ready');
      assert.equal(reviews, 1);
      assert.equal(reviewCalls, scenario === 'review-service-drift' ? 2 : 1);
      assert.equal(saved().reviews[0].head, head);
      assert.equal(
        reviewPosts,
        {
          'review-service-before': 2,
          'review-service-after': 1,
          'review-service-delayed': 3,
          'review-service-late-visible': 2,
          'review-service-drift': 3,
        }[scenario],
      );
      return;
    }
    if (scenario.startsWith('pr-service-')) {
      assert.equal(saved().status, 'ready');
      assert.equal(prPosts, scenario === 'pr-service-after' ? 1 : 2);
      assert.equal(developmentCalls, 1);
      assert.equal(creations, 1);
      return;
    }
    if (scenario.startsWith('journal-')) {
      assert.equal(saved().status, 'ready');
      assert.equal(journalPosts, scenario === 'journal-after-write' ? 1 : 2);
      assert.equal(developmentCalls, 1);
      assert.equal(commits, 1);
      return;
    }
    if (scenario === 'timeout-stop') {
      assert.equal(saved().status, 'needs_human');
      assert.equal(saved().failureCode, 'stop_requested');
      assert.equal(developmentCalls, 1);
      assert.equal(commits, 0);
      return;
    }
    if (scenario === 'development-human') {
      assert.equal(saved().status, 'needs_human');
      writeFileSync(
        event,
        JSON.stringify({
          repository: { full_name: repository },
          sender: { login: 'tester' },
          inputs: { development_note: '관련 테스트 위치' },
        }),
      );
      await manualResume();
      return;
    }
    if (scenario.startsWith('review-')) {
      const ready = scenario === 'review-revision';
      if (ready) assert.equal(staleRead, true);
      assert.equal(saved().status, ready ? 'ready' : 'needs_human');
      assert.equal(
        readFileSync(stepOutput, 'utf8'),
        ready ? 'ready=true\n' : '',
      );
      assert.equal(saved().reviews[0].head, head);
      assert.equal(creations, 1);
      assert.equal(commits, ready ? 2 : scenario === 'review-limit' ? 3 : 1);
      assert.equal(reviewCalls, commits);
      assert.equal(
        developmentCalls,
        commits + Number(scenario === 'review-no-change'),
      );
      if (scenario === 'review-limit')
        assert.match(saved().reason, /수정 한도/);
      if (scenario === 'review-no-change')
        assert.match(saved().reason, /적용할 변경/);
      const calls = developmentCalls + reviewCalls;
      await import(runner + '?duplicate');
      assert.equal(developmentCalls + reviewCalls, calls);
      if (scenario === 'review-human') {
        writeFileSync(
          event,
          JSON.stringify({
            repository: { full_name: repository },
            sender: { login: 'tester' },
            inputs: { review_note: '모바일 재현 조건' },
          }),
        );
        await manualResume();
        assert.equal(developmentCalls, 1);
        assert.equal(reviewCalls, 2);
      }
      return;
    }
    async function manualResume() {
      process.env.GITHUB_RUN_ID = '2';
      resumed = true;
      await import(runner + '?manual');
      assert.equal(saved().status, 'ready');
      assert.equal(commits, 1);
      assert.equal(creations, 1);
    }
    if (
      [
        'initial-stop',
        'first-guard',
        'interrupted-development',
        'interrupted-review',
      ].includes(scenario)
    ) {
      if (scenario.startsWith('interrupted')) {
        assert.equal(saved().status, 'failed');
        assert.equal(saved().recovery.pending, undefined);
        const calls = developmentCalls + reviewCalls;
        await import(runner + '?duplicate');
        assert.equal(developmentCalls + reviewCalls, calls);
      }
      blocked = false;
      await manualResume();
      return;
    }
    if (
      ['restart-limit', 'update-limit', 'merge-conflict'].includes(scenario)
    ) {
      assert.equal(saved().status, 'needs_human');
      if (scenario === 'restart-limit') {
        assert.equal(saved().recovery.restarts, 1);
        assert.equal(commits, 0);
      } else
        assert.equal(
          saved().recovery.updates,
          scenario === 'merge-conflict' ? 1 : 2,
        );
      if (scenario !== 'merge-conflict') await manualResume();
      return;
    }
    if (
      ['ci-repair', 'ci-format-repair'].includes(scenario) ||
      scenario.startsWith('post-ci-')
    ) {
      const formatOnly = scenario === 'ci-format-repair';
      const original = saved();
      const dispatch = (run) =>
        writeFileSync(
          event,
          JSON.stringify({
            repository: { full_name: repository },
            sender: { login: 'github-actions[bot]' },
            inputs: {
              issue: '15',
              recovery_run: String(run),
              ci_attempt: '53/2',
              ci_feedback: formatOnly
                ? 'npm run format:check'
                : 'e2e/dialogs.spec.ts:94 locator failed',
            },
          }),
        );
      process.env.GITHUB_RUN_ID = '2';
      dispatch(original.runId);
      await import(runner + '?repair');
      if (scenario.startsWith('post-ci-')) {
        assert.equal(
          saved().status,
          scenario === 'post-ci-limit' ? 'needs_human' : 'ready',
        );
        assert.equal(saved().recovery.reviewRevisions, 2);
        assert.equal(saved().recovery.ciReviewHead, undefined);
        await import(runner + '?duplicate-recovery');
        assert.equal(developmentCalls, 5);
        assert.equal(reviewCalls, 5);
        return;
      }
      assert.equal(saved().status, 'ready');
      assert.notEqual(saved().head, original.head);
      assert.deepEqual(saved().recovery.ciRepair, {
        sourceHead: original.head,
        ciAttempt: '53/2',
        runId: 2,
        attempt: 1,
        limit: 1,
      });
      assert.equal(saved().reviews[0].head, saved().head);
      await import(runner + '?duplicate-repair');
      dispatch(saved().runId);
      process.env.GITHUB_RUN_ID = '3';
      await import(runner + '?second-failure');
      assert.equal(saved().status, 'needs_human');
      assert.equal(reviewCalls, 2);
      assert.equal(developmentCalls, formatOnly ? 1 : 2);
      if (formatOnly) {
        assert.equal(saved().recovery.formatRepair, true);
        assert.equal(saved().recovery.ciRepairs, undefined);
      }
      assert.equal(creations, 1);
      return;
    }
    if (
      ['completion-dispatch', 'blocked-ci', 'blocked-ci-drift'].includes(
        scenario,
      )
    ) {
      const original = saved();
      process.env.GITHUB_RUN_ID = '2';
      writeFileSync(
        event,
        JSON.stringify({
          repository: { full_name: repository },
          sender: { login: 'github-actions[bot]' },
          inputs: {
            issue: '15',
            recovery_run: String(original.runId),
            ci_blocker: scenario.startsWith('blocked-ci')
              ? '실패한 자동화 검사 (CI 링크)'
              : undefined,
          },
        }),
      );
      if (scenario === 'blocked-ci') {
        const calls = { reviewCalls, developmentCalls, commits };
        await import(runner + '?blocked');
        assert.equal(saved().status, 'needs_human');
        assert.equal(saved().reason, '실패한 자동화 검사 (CI 링크)');
        await import(runner + '?duplicate');
        assert.deepEqual({ reviewCalls, developmentCalls, commits }, calls);
        return;
      }
      if (scenario !== 'blocked-ci-drift') {
        await import(runner + '?no-drift');
        assert.deepEqual(saved(), original);
      }
      advance();
      await import(runner + '?from-completion');
      assert.equal(saved().recovery.updates, 1);
      assert.equal(saved().base, base);
      assert.notEqual(saved().head, original.head);
      assert.equal(saved().reviews[0].head, saved().head);
      assert.equal(saved().status, 'ready');
      await import(runner + '?same-dispatch-again');
      const revised = scenario === 'blocked-ci-drift';
      assert.equal(reviews, revised ? 3 : 2);
      assert.equal(developmentCalls, revised ? 2 : 1);
      assert.equal(commits, revised ? 2 : 1);
      return;
    }
    if (scenario === 'merged-resume') {
      pr.merged_at = '2026-11-25T00:00:00Z';
      pr.merge_commit_sha = 'b'.repeat(40);
      await manualResume();
      assert.match(saved().reason, /머지/);
      assert.equal(developmentCalls, 1);
      assert.equal(reviewCalls, 1);
      return;
    }
    if (
      ['interrupted-before-commit', 'interrupted-before-pr'].includes(scenario)
    ) {
      await manualResume();
      assert.equal(
        developmentCalls,
        scenario === 'interrupted-before-commit' ? 2 : 1,
      );
      assert.equal(reviewCalls, 1);
      return;
    }
    if (['interrupted-created-pr', 'interrupted-commit'].includes(scenario)) {
      await manualResume();
      assert.equal(developmentCalls, 1);
      assert.equal(reviewCalls, 1);
      return;
    }
    if (scenario === 'interrupted-visible-review') {
      await manualResume();
      assert.equal(reviewCalls, 1);
      assert.equal(reviews, 1);
      return;
    }
    if (['interrupted-review-record', 'interrupted-commit'].includes(scenario))
      process.env.GITHUB_RUN_ID = '2';
    if (scenario.startsWith('upstream-')) {
      const reviewed = saved().head;
      advance();
      git(remote, 'switch', branch);
      git(remote, 'merge', '--no-edit', 'dev');
      if (scenario === 'upstream-extra') {
        writeFileSync(join(remote, 'extra'), 'manual');
        git(remote, 'add', 'extra');
        git(remote, 'commit', '-m', 'manual addition');
      }
      git(remote, 'switch', 'dev');
      await import(runner + '?changed');
      assert.equal(saved().status, 'needs_human');
      process.env.GITHUB_RUN_ID = '2';
      await import(runner + '?manual');
      if (scenario === 'upstream-extra') {
        assert.equal(saved().status, 'needs_human');
        assert.equal(saved().recovery.head, reviewed);
        assert.equal(reviews, 1);
      } else {
        assert.equal(saved().status, 'ready');
        assert.notEqual(saved().head, reviewed);
        assert.equal(saved().reviews[0].head, head);
        assert.equal(reviews, 2);
      }
      return;
    }
    if (scenario === 'manual-head') {
      git(remote, 'switch', branch);
      git(remote, 'commit', '--allow-empty', '-m', 'human change');
      git(remote, 'switch', 'dev');
    }
    if (scenario === 'edited-issue') issueBody = 'New requirements';
    if (scenario === 'edited-pr') pr.title = 'Changed manually';
    const prior = { reviewCalls, developmentCalls, commits, creations };
    if (scenario === 'resume-before-pr') {
      assert.equal(developmentCalls, 1);
      assert.equal(creations, 0);
      assert.equal(commits, 1);
      assert.equal(saved().recovery.pending, undefined);
      await import(runner + '?after-published');
      assert.equal(saved().status, 'ready');
      assert.equal(saved().recovery.updates, 1);
      assert.equal(creations, 1);
      assert.equal(reviews, 1);
      assert.equal(developmentCalls, 1);
      return;
    }
    await import(runner + '?resume');
    assert.deepEqual(
      { reviewCalls, developmentCalls, commits, creations },
      prior,
    );
    if (
      uncertain ||
      ['manual-head', 'edited-issue', 'edited-pr'].includes(scenario)
    ) {
      assert.equal(saved().status, 'needs_human');
      return;
    }
    assert.equal(saved().status, 'ready');
    assert.equal(saved().head, git(remote, 'rev-parse', branch));
    assert.equal(saved().base, base);
    assert.equal(saved().reviews[0].head, saved().head);
    assert.equal(
      developmentCalls,
      ['before', 'stale-edit', 'output-recovery', 'timeout-recovery'].includes(
        scenario,
      )
        ? 2
        : 1,
    );
    assert.equal(commits, 1);
    assert.equal(creations, 1);
    assert.equal(reviews, 1);
    assert.equal(reviewCalls, scenario === 'during-review' ? 2 : 1);
    assert.equal(
      saved().recovery.updates,
      ['after', 'adjacent-line', 'during-review'].includes(scenario) ? 1 : 0,
    );
    assert.equal(saved().recovery.restarts, scenario === 'before' ? 1 : 0);
    if (scenario === 'adjacent-line') {
      assert.equal(saved().recovery.conflicts, 1);
      assert.equal(
        git(remote, 'show', branch + ':README.md'),
        '# Updated\nConcurrent addition\n=======',
      );
    }
    blocked = true;
    await import(runner + '?stop');
    assert.equal(states.at(-1), 'needs_human');
    assert.equal(saved().failureCode, 'stop_requested');
    assert.equal(saved().schemaVersion, 1);
  });
}
