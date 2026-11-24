import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEdits, snapshot } from './workspace.mjs';

// For conflicting edits, only replay a single, unchanged, unique source line.
// Build on the target tree so unrelated concurrent changes are retained.
export function replayLine(base, head, target) {
  const run = (args, options = {}) =>
    execFileSync('git', args, { encoding: 'utf8', timeout: 30000, ...options });
  const paths = run(['diff', '--no-renames', '--name-only', '-z', base, head])
    .split('\0')
    .filter(Boolean);
  if (paths.length !== 1) throw new Error('여러 파일 변경');
  const [path] = paths;
  const from = snapshot(base, base);
  const to = snapshot(target, target);
  const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const original = lines(from.read(path));
  const edited = lines(snapshot(head, head).read(path));
  const latest = lines(to.read(path));
  if (original.length !== edited.length) throw new Error('줄 추가 또는 삭제');
  const changed = original.flatMap((line, index) =>
    line === edited[index] ? [] : [index],
  );
  if (changed.length !== 1) throw new Error('여러 줄 수정');
  const [index] = changed;
  const before = original[index];
  if (
    !before.trim() ||
    latest[index] !== before ||
    [original, edited, latest].some((list) => list.join('').includes('\uFFFD'))
  )
    throw new Error('원문 위치 또는 인코딩 변경');
  const edits = [{ path, before, after: edited[index] }];
  resolveEdits(edits, from);
  const [change] = resolveEdits(edits, to);
  const hasConflictMarker = lines(change.text).some((line, index) => {
    const text = line.replace(/\r?\n$/, '');
    // Markdown underlines and empty table cells can be identical to bare separators.
    if (
      path.endsWith('.md') &&
      /^(?:={7}|\|{7})$/.test(text) &&
      line === latest[index]
    )
      return false;
    return /^(?:<{7}|={7}|>{7}|\|{7})(?: |$)/.test(text);
  });
  if (hasConflictMarker) throw new Error('충돌 표식이 남아 있습니다.');
  const dir = mkdtempSync(join(tmpdir(), 'agentopia-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
    const blob = run(['hash-object', '-w', '--stdin'], {
      input: change.text,
    }).trim();
    run(['read-tree', target], { env });
    run(['update-index', '--cacheinfo', '100644', blob, path], { env });
    return run(['write-tree'], { env }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
