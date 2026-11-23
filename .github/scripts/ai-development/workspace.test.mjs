import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEdits } from './workspace.mjs';

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
