import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const maxCommentLength = 65_536;
const omission =
  '이전 기록 일부 생략 · 자세한 내용은 Actions 실행을 확인하세요.\n\n';
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
  closed_unplanned: '종료',
  superseded: '요구사항 변경으로 종료',
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
  repository,
  body = '',
  state,
  event,
  eventState = state,
  at = new Date().toISOString(),
  previousAt,
}) {
  const root = `https://github.com/${repository}`;
  const match = marker.exec(body);
  const previous =
    match && JSON.parse(Buffer.from(match[1], 'base64').toString());
  const visible = match ? body.slice(0, match.index) : '';
  const offset = visible.indexOf(divider);
  let history = offset < 0 ? '' : visible.slice(offset + divider.length);
  let shortened = history.startsWith(omission);
  if (shortened) history = history.slice(omission.length);
  const sections = history ? history.split(/\n\n(?=### \d+차 실행 · )/) : [];
  const firstOrdinal = Number(/^### (\d+)차/.exec(history)?.[1] ?? 1);
  function append(record, entry, time) {
    const run = `${root}/actions/runs/${record.runId}/attempts/${record.attempt || 1}`;
    let index = sections.findIndex((section) =>
      section.split('\n', 1)[0].endsWith(`[Actions](${run})`),
    );
    if (index < 0) {
      // An evicted run must not reappear as a new attempt on late delivery.
      if (
        firstOrdinal > 1 &&
        (record.runId !== state.runId || record.attempt !== state.attempt)
      )
        return;
      index = sections.length;
      sections.push(`### ${firstOrdinal + index}차 실행 · [Actions](${run})`);
    }
    if (entry && !sections[index].includes('<!-- history-full -->')) {
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
        if (/^[a-f0-9]{40}$/.test(record.head ?? ''))
          links.push(
            `[\`${record.head.slice(0, 7)}\`](${root}/commit/${record.head})`,
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
    return firstOrdinal + index;
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
  const footer = `\n\n<!-- agentopia-ai-state:${encoded} -->`;
  const budget =
    maxCommentLength - header.length - divider.length - footer.length;
  history = sections.join('\n\n');
  while (
    sections.length > 1 &&
    history.length + (shortened ? omission.length : 0) > budget
  ) {
    sections.shift();
    history = sections.join('\n\n');
    shortened = true;
  }
  if (history.length + (shortened ? omission.length : 0) > budget) {
    shortened = true;
    // A long single run keeps its newest details and the older event IDs for deduplication.
    let excess = history.length + omission.length - budget;
    history = history.replace(
      /^- .*? (<!-- event:[a-f0-9]+ -->)$/gm,
      (line, id) => {
        if (excess <= 0) return line;
        excess -= line.length - id.length;
        return id;
      },
    );
  }
  if (shortened && history.length + omission.length > budget) {
    // Even deduplication keys can fill a comment; keep the run link and checkpoint writable.
    history = sections[0].split('\n', 1)[0] + '\n<!-- history-full -->';
  }
  return `${header}${divider}${shortened ? omission : ''}${history}${footer}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.stdout.write(progressBody(JSON.parse(readFileSync(0, 'utf8'))));
