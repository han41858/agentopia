import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

for (const scenario of [
  'duplicate',
  'completion-dispatch',
  'before',
  'resume-before-pr',
  'interrupted-review-record',
  'after',
  'during-review',
  'restart-limit',
  'update-limit',
  'manual-head',
  'interrupted-review',
  'interrupted-commit',
  'merge-conflict',
  'adjacent-line',
  'edited-issue',
  'edited-pr',
])
  test(`issue recovery: ${scenario}`, async (t) => {
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
          ? '# Test\nConcurrent addition\n'
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
    Object.assign(process.env, {
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

    const branch = 'ai/issue-15-codex';
    const prefix = '/repos/' + repository;
    const states = [];
    let issueBody = 'Update README.';
    let interrupted = false;
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
      reviews = 0,
      blocked = false;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const { hostname, pathname, searchParams } = new URL(url);
      const body = options.body && JSON.parse(options.body);
      if (hostname === 'api.openai.com') {
        developmentCalls++;
        if (
          (scenario === 'before' && developmentCalls === 1) ||
          scenario === 'restart-limit'
        )
          advance();
        if (scenario === 'before' && developmentCalls === 2)
          assert.match(body.instructions, /Updated base 1/);
        const edits = commits
          ? []
          : [{ path: 'README.md', before: 'Test', after: 'Updated' }];
        return Response.json({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    status: 'completed',
                    title: '📝 문서: 예제 수정',
                    summary: '문서를 수정했습니다.',
                    edits,
                  }),
                },
              ],
            },
          ],
        });
      }
      if (hostname === 'api.anthropic.com') {
        reviewCalls++;
        if (scenario === 'interrupted-review') throw Error('connection lost');
        if (
          (scenario === 'during-review' && reviewCalls === 1) ||
          scenario === 'update-limit'
        )
          advance();
        return Response.json({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'pass',
                summary: '수정 사항을 확인했습니다.',
                findings: [],
              }),
            },
          ],
        });
      }
      assert.equal(hostname, 'api.github.com');
      if (pathname === '/graphql') {
        assert.equal(options.headers.authorization, 'Bearer mock-publisher');
        const input = body.variables.input;
        assert.equal(input.expectedHeadOid, head);
        assert.equal(input.branch.branchName, branch);
        assert.equal(
          Buffer.from(
            input.fileChanges.additions[0].contents,
            'base64',
          ).toString(),
          '# Updated\n',
        );
        git(remote, 'switch', branch);
        writeFileSync(join(remote, 'README.md'), '# Updated\n');
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
      if (path === '/issues/15')
        return Response.json({
          title: 'Test issue',
          body: issueBody,
          state: 'open',
          labels: [
            { name: 'ai:develop' },
            ...(blocked ? [{ name: 'ai:stop' }] : []),
          ],
        });
      if (path === '/git/ref/heads/dev')
        return Response.json({ object: { sha: base } });
      if (path === '/git/ref/heads/' + branch) {
        if (head) head = git(remote, 'rev-parse', branch);
        if (pr) pr.head.sha = head;
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
            pr && searchParams.get('state') === 'open' ? [pr] : [],
          );
        assert.equal(options.headers.authorization, 'Bearer mock-publisher');
        assert.equal(body.draft, true);
        assert.equal(body.base, 'dev');
        assert.equal(body.head, branch);
        assert.equal(pr, undefined);
        creations++;
        pr = {
          number: 23,
          draft: true,
          body: body.body,
          head: { ref: branch, sha: head, repo: { full_name: repository } },
          base: { ref: 'dev' },
        };
        return Response.json(pr);
      }
      if (path === '/issues/23/comments') {
        if (options.method === 'GET') return Response.json([]);
        assert.match(body.body, /Generated by Claude/);
        reviews++;
        if (scenario === 'interrupted-review-record')
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
        last = body.body;
        const state = JSON.parse(
          Buffer.from(
            body.body.match(/agentopia-ai-state:([^ ]+)/)[1],
            'base64',
          ),
        );
        assert.equal(state.issue, 15);
        states.push(state.status);
        return Response.json({ id: 15 });
      }
      throw new Error('Unexpected request ' + path);
    });

    const runner = new URL('./run.mjs?case=' + scenario, import.meta.url);
    const uncertain = scenario.startsWith('interrupted');
    if (uncertain || scenario === 'resume-before-pr')
      await assert.rejects(import(runner + '?first'));
    else await import(runner + '?first');
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
      return;
    }
    if (scenario === 'completion-dispatch') {
      const original = saved();
      advance();
      process.env.GITHUB_RUN_ID = '2';
      writeFileSync(
        event,
        JSON.stringify({
          repository: { full_name: repository },
          sender: { login: 'github-actions[bot]' },
          inputs: { issue: '15', recovery_run: String(original.runId) },
        }),
      );
      await import(runner + '?from-completion');
      assert.equal(saved().recovery.updates, 1);
      assert.equal(saved().base, base);
      assert.notEqual(saved().head, original.head);
      assert.equal(saved().reviews[0].head, saved().head);
      assert.equal(saved().status, 'ready');
      await import(runner + '?same-dispatch-again');
      assert.equal(reviews, 2);
      assert.equal(developmentCalls, 1);
      assert.equal(commits, 1);
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
    assert.equal(developmentCalls, scenario === 'before' ? 2 : 1);
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
        '# Updated\nConcurrent addition',
      );
    }
    blocked = true;
    await import(runner + '?stop');
    assert.equal(states.at(-1), 'needs_human');
  });
