import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  formatChanges,
  resolveEdits,
  snapshot as gitSnapshot,
} from './workspace.mjs';

const source = 'export const value = 1;\n';
const snapshot = {
  files: new Map([
    ['src/value.ts', '100644'],
    ['src/symlink.ts', '120000'],
  ]),
  read: () => source,
};

test('applies exact edits and supports new text files', () => {
  const changes = resolveEdits(
    [
      { path: 'src/value.ts', before: 'value = 1', after: 'value = 2' },
      { path: 'docs/new.md', before: null, after: '# New\n' },
    ],
    snapshot,
  );
  assert.deepEqual(changes, [
    { path: 'src/value.ts', text: 'export const value = 2;\n' },
    { path: 'docs/new.md', text: '# New\n' },
  ]);
});

test('rejects edits to workflows, credentials, symlinks and escaped paths', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    'src/.env.json',
    'src/symlink.ts',
    'src/../package.json',
  ]) {
    assert.throws(() =>
      resolveEdits([{ path, before: null, after: 'example' }], snapshot),
    );
  }
});

test('rejects stale edits and file/directory collisions', () => {
  assert.throws(() =>
    resolveEdits(
      [{ path: 'src/value.ts', before: 'obsolete', after: 'new' }],
      snapshot,
    ),
  );
  assert.throws(() =>
    resolveEdits(
      [
        { path: 'docs/new.md', before: null, after: 'a' },
        { path: 'docs/new.md/child.md', before: null, after: 'b' },
      ],
      snapshot,
    ),
  );
});

test('blocks JSON configuration and limits API changes to existing file contents', () => {
  const api = 'api/github.ts';
  const work = {
    ...snapshot,
    files: new Map([[api, '100644']]),
  };
  for (const path of [
    'server/package.json',
    'src/tsconfig.build.json',
    'api/new.ts',
  ]) {
    assert.throws(() =>
      resolveEdits([{ path, before: null, after: source }], work),
    );
  }
  assert.throws(() =>
    resolveEdits([{ path: api, before: source, after: null }], work),
  );
  assert.equal(
    resolveEdits([{ path: api, before: '1', after: '2' }], work)[0].text,
    'export const value = 2;\n',
  );
});

test('updates existing UI specs without granting access to fixtures or configuration', () => {
  const path = 'e2e/dialogs.spec.ts';
  const work = { ...snapshot, files: new Map([[path, '100644']]) };
  const edit = { path, before: 'value = 1', after: 'value = 2' };
  assert.equal(resolveEdits([edit], work)[0].path, path);
  for (const denied of [
    { ...edit, path: 'e2e/fixtures.ts' },
    { ...edit, path: 'playwright.config.ts' },
    { ...edit, path: 'e2e/new.spec.ts', before: null },
    { ...edit, before: source, after: null },
  ]) {
    assert.throws(() => resolveEdits([denied], work));
  }
});

test('UI checks require an actual spec page independently in development and review', () => {
  const work = gitSnapshot('HEAD', 'HEAD');
  const review = gitSnapshot('HEAD', 'HEAD');
  const paths = ['src/detail-dialogs.tsx'];
  assert.equal(work.missingUiSpec(['docs/development.md']), '');
  work.inspect('list_files', { query: 'dialogs', offset: 0 });
  work.inspect('read_file', { path: 'e2e/dialogs.spec.ts', line: 100000 });
  assert.match(work.missingUiSpec(paths), /e2e\//);
  work.inspect('read_file', { path: 'e2e/dialogs.spec.ts', line: 80 });
  assert.equal(work.missingUiSpec(paths), '');
  assert.match(review.missingUiSpec(paths), /e2e\//);
  const changed = [...paths, 'e2e/dialogs.spec.ts', 'e2e/kingdom.spec.ts'];
  assert.equal(work.missingUiSpec(changed), 'e2e/kingdom.spec.ts');
  work.inspect('read_file', { path: 'e2e/kingdom.spec.ts', line: 1 });
  assert.equal(work.missingUiSpec(changed), '');
  assert.match(review.missingUiSpec(changed), /e2e\//);
});

test('formats proposals before publication and drops format-only no-ops', async () => {
  const path = 'src/value.ts';
  assert.deepEqual(
    await formatChanges([{ path, text: 'export const value=1' }], snapshot),
    [],
  );
  assert.deepEqual(
    await formatChanges(
      [
        { path, text: 'export const value=2' },
        { path: 'e2e/example.spec.ts', text: "test(  '예시',()=>{} )" },
      ],
      snapshot,
    ),
    [
      { path, text: 'export const value = 2;\n' },
      { path: 'e2e/example.spec.ts', text: "test('예시', () => {});\n" },
    ],
  );
  assert.deepEqual(await formatChanges([{ path, text: null }], snapshot), [
    { path, text: null },
  ]);
});

test('syntax failures report file and parser position without disclosing source', async () => {
  for (const [path, text] of [
    ['src/value.ts', 'const privateValue = ;'],
    ['src/map.css', '.map{color:red'],
  ]) {
    await assert.rejects(formatChanges([{ path, text }], snapshot), (error) => {
      assert.ok(error.diagnostic.startsWith(path + ':1:'));
      assert.ok(!error.diagnostic.includes(text));
      return true;
    });
  }
});

test('literal lookup locates UI text without counting as a full UI spec read', (t) => {
  const previous = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'agentopia-lookup-'));
  t.after(() => {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  mkdirSync('e2e');
  const path = 'e2e/example.spec.ts';
  writeFileSync(
    path,
    '// Example UI assertion\nexpect(title).toHaveText("예시 제목");\n',
  );
  execFileSync('git', ['init', '--quiet']);
  writeFileSync(
    'e2e/github.ts',
    '// shared readiness helper\n' +
      ('x'.repeat(100) + '\n').repeat(150) +
      '// final line',
  );
  writeFileSync('e2e/fixtures.ts', 'export const title = "Expected title";');
  execFileSync('git', ['add', path, 'e2e/github.ts', 'e2e/fixtures.ts']);
  const tree = execFileSync('git', ['write-tree'], { encoding: 'utf8' }).trim();
  const work = gitSnapshot(tree, tree);
  assert.equal(
    work.inspect('find_in_file', { path, text: '예시 제목' }),
    '2: expect(title).toHaveText("예시 제목");',
  );
  assert.match(
    work.inspect('read_file', { path: 'e2e/github.ts', line: 1 }),
    /shared readiness helper/,
  );
  const tail = work.inspect('read_file', { path: 'e2e/github.ts', line: -1 });
  assert.ok(tail.length <= 5500);
  assert.match(tail, /152: \/\/ final line$/);
  assert.doesNotMatch(tail, /shared readiness helper|다음 줄/);
  assert.throws(
    () =>
      resolveEdits(
        [{ path: 'e2e/github.ts', before: 'shared', after: 'changed' }],
        work,
      ),
    /허용 범위/,
  );
  assert.match(
    work.inspect('read_file', { path: 'e2e/fixtures.ts', line: 1 }),
    /Expected title/,
  );
  assert.match(work.missingUiSpec([path]), /e2e\//);
  assert.match(
    work.inspect('find_in_file', {
      path: '.github/workflows/ci.yml',
      text: 'jobs',
    }),
    /허용된 소스 및 문서 범위를 벗어난 경로/,
  );
});

test('development and review can inspect recovery producers without editing them', () => {
  const work = gitSnapshot('HEAD', 'HEAD');
  for (const [path, text] of [
    ['.github/scripts/ai-development/run.mjs', 'recovery.ciReviewHead'],
    ['.github/scripts/ai-completion.py', 'def current_ci('],
    ['.github/scripts/issue_journal.py', 'def checkpoint('],
  ]) {
    const hits = work.inspect('find_in_file', { path, text });
    assert.ok(hits.includes(text));
    const line = Number.parseInt(hits, 10);
    assert.ok(work.inspect('read_file', { path, line }).includes(text));
    assert.throws(
      () => resolveEdits([{ path, before: text, after: 'changed' }], work),
      /허용 범위/,
    );
  }
  assert.match(
    work.inspect('read_file', {
      path: '.github/scripts/ai-development/config.mjs',
      line: 1,
    }),
    /허용된 소스 및 문서 범위를 벗어난 경로/,
  );
});
