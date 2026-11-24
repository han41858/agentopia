import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEdits, snapshot as gitSnapshot } from './workspace.mjs';

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
  assert.equal(work.needsUiSpec(['docs/development.md']), false);
  work.inspect('list_files', { query: 'dialogs', offset: 0 });
  work.inspect('read_file', { path: 'e2e/dialogs.spec.ts', line: 100000 });
  assert.equal(work.needsUiSpec(paths), true);
  work.inspect('read_file', { path: 'e2e/dialogs.spec.ts', line: 80 });
  assert.equal(work.needsUiSpec(paths), false);
  assert.equal(review.needsUiSpec(paths), true);
});
