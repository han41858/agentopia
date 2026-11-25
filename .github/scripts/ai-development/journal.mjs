import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const root = 'https://github.com/han41858/agentopia';
const divider = '\n\n**진행 기록**\n';
const marker = /\n*<!-- agentopia-ai-state:([A-Za-z0-9+/=]+) -->$/;
const labels = {
  developing: '개발 중',
  reviewing: '리뷰 중',
  revising: '수정 중',
  recovering: '재개 중',
  ready: 'CI 대기',
  failed: '실패',
  needs_human: '사람 확인 필요',
  merged: '완료',
};

function plain(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// History stays in the visible Markdown; the trailing checkpoint retains its original schema.
export function progressBody({
  body = '',
  state,
  event,
  eventState = state,
  at = new Date().toISOString(),
  previousAt,
}) {
  const match = marker.exec(body);
  const previous =
    match && JSON.parse(Buffer.from(match[1], 'base64').toString());
  const visible = match ? body.slice(0, match.index) : '';
  const offset = visible.indexOf(divider);
  let history = offset < 0 ? '' : visible.slice(offset + divider.length);
  function append(record, entry, time) {
    const run = `${root}/actions/runs/${record.runId}/attempts/${record.attempt || 1}`;
    const sections = history ? history.split(/\n\n(?=### \d+차 실행 · )/) : [];
    let index = sections.findIndex((section) =>
      section.split('\n', 1)[0].endsWith(`[Actions](${run})`),
    );
    if (index < 0) {
      index = sections.length;
      sections.push(`### ${index + 1}차 실행 · [Actions](${run})`);
    }
    if (entry) {
      const key = createHash('sha256')
        .update(String(entry.key))
        .digest('hex')
        .slice(0, 24);
      const id = `<!-- event:${key} -->`;
      if (!sections[index].includes(id)) {
        const links = [];
        if (record.pullNumber)
          links.push(
            `[PR #${record.pullNumber}](${root}/pull/${record.pullNumber})`,
          );
        if (entry.reviewId && record.pullNumber)
          links.push(
            `[리뷰](${root}/pull/${record.pullNumber}#issuecomment-${Number(entry.reviewId)})`,
          );
        if (entry.ci)
          links.push(
            `[CI](${root}/actions/runs/${Number(entry.ci.id)}/attempts/${Number(entry.ci.run_attempt)})`,
          );
        sections[index] +=
          `\n- ${time} · ${plain(entry.text)} ${links.join(' · ')} ${id}`;
      }
    }
    history = sections.join('\n\n');
    return index + 1;
  }
  if (previous && offset < 0)
    append(
      previous,
      { key: previous.reason, text: previous.reason || visible },
      previousAt || at,
    );
  append(eventState, event, at);
  const ordinal = append(state, null, at);
  const target = state.pullNumber
    ? ` · [PR #${state.pullNumber}](${root}/pull/${state.pullNumber})`
    : '';
  const header = `**${ordinal}차 실행 · ${labels[state.status] || '실행 준비'}**${target}\n\n${plain(state.reason)}`;
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64');
  return `${header}${divider}${history}\n\n<!-- agentopia-ai-state:${encoded} -->`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.stdout.write(progressBody(JSON.parse(readFileSync(0, 'utf8'))));
