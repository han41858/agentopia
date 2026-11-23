import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('creates and reuses an issue draft, then stops publication on ai:stop', async (t) => {
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
  const base = git(remote, 'rev-parse', 'HEAD');
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
        body: 'Update README.',
        state: 'open',
        labels: [
          { name: 'ai:develop' },
          ...(blocked ? [{ name: 'ai:stop' }] : []),
        ],
      });
    if (path === '/git/ref/heads/dev')
      return Response.json({ object: { sha: base } });
    if (path === '/git/ref/heads/' + branch)
      return head
        ? Response.json({ object: { sha: head } })
        : Response.json({}, { status: 404 });
    if (path === '/git/refs' && options.method === 'POST') {
      head = body.sha;
      git(remote, 'branch', branch, head);
      return Response.json({}, { status: 201 });
    }
    if (path === '/pulls') {
      if (options.method === 'GET')
        return Response.json(
          pr && searchParams.get('state') === 'open' ? [pr] : [],
        );
      assert.equal(options.headers.authorization, 'Bearer mock-publisher');
      assert.equal(body.draft, true);
      assert.equal(body.base, 'dev');
      assert.equal(body.head, branch);
      assert.equal(pr, undefined);
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
      return Response.json({ id: 23 });
    }
    if (path === '/issues/15/comments' || path === '/issues/comments/15') {
      const state = JSON.parse(
        Buffer.from(body.body.match(/agentopia-ai-state:([^ ]+)/)[1], 'base64'),
      );
      assert.equal(state.issue, 15);
      states.push(state.status);
      return Response.json({ id: 15 });
    }
    throw new Error('Unexpected request ' + path);
  });

  const runner = new URL('./run.mjs', import.meta.url);
  await import(runner + '?first');
  await import(runner + '?resume');
  blocked = true;
  await import(runner + '?stop');
  assert.equal(developmentCalls, 1);
  assert.equal(commits, 1);
  assert.equal(reviews, 2);
  assert.deepEqual(states, [
    'developing',
    'reviewing',
    'ready',
    'reviewing',
    'ready',
    'needs_human',
  ]);
});
