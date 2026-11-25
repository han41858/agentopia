import { setTimeout as wait } from 'node:timers/promises';
import { CorrectableEditError } from './workspace.mjs';
import { agents, config } from './config.mjs';

// Only messages composed here from fixed labels may be published to the issue.
class ModelError extends Error {
  constructor(message) {
    super(message);
    this.diagnostic = message;
  }
}

const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: 'string' };
const integer = { type: 'integer' };
const nullableText = { anyOf: [string, { type: 'null' }] };

export const developmentSchema = object({
  status: { type: 'string', enum: ['completed', 'in_progress', 'needs_human'] },
  title: string,
  summary: string,
  edits: {
    type: 'array',
    items: object({ path: string, before: nullableText, after: nullableText }),
  },
});

export const reviewSchema = object({
  status: {
    type: 'string',
    enum: ['pass', 'changes_requested', 'needs_human'],
  },
  summary: string,
  findings: {
    type: 'array',
    items: object({
      path: string,
      line: integer,
      defect: string,
      impact: string,
      evidence: string,
      fix: string,
    }),
  },
});

const tools = {
  list_files: {
    description:
      '대소문자를 구분하지 않고 검색어가 포함된 Git 추적 경로를 찾습니다. 첫 페이지는 offset을 0으로 지정하세요.',
    input: object({ query: string, offset: integer }),
  },
  find_in_file: {
    description:
      'Git이 추적하는 텍스트 파일에서 UI 라벨이나 심벌을 입력한 문자열 그대로 찾습니다. read_file로 해당 위치를 읽을 수 있도록 일치하는 줄 번호를 반환합니다.',
    input: object({ path: string, text: string }),
  },
  read_file: {
    description:
      'Git이 추적하는 UTF-8 텍스트를 줄 번호와 함께 읽습니다. line에 시작 줄을 지정하세요. 다음 페이지는 결과의 ‘다음 줄’을, 파일 끝은 -1을 사용하세요.',
    input: object({ path: string, line: integer }),
  },
  read_diff: {
    description:
      '원래 기준 커밋부터 현재 HEAD까지의 전체 PR diff를 줄 단위로 나누어 읽습니다.',
    input: object({ line: integer }),
  },
};

function validate(value, schema, label) {
  if (schema.anyOf) {
    if (value === null || typeof value === 'string') return;
  } else if (
    schema.type === 'object' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    if (
      Object.keys(value).length === schema.required.length &&
      schema.required.every((key) => Object.hasOwn(value, key))
    ) {
      for (const [key, child] of Object.entries(schema.properties))
        validate(value[key], child, `${label}.${key}`);
      return;
    }
  } else if (schema.type === 'array' && Array.isArray(value)) {
    for (const item of value) validate(item, schema.items, label);
    return;
  } else if (schema.type === 'integer' && Number.isSafeInteger(value)) {
    return;
  } else if (
    schema.type === 'string' &&
    typeof value === 'string' &&
    (!schema.enum || schema.enum.includes(value))
  ) {
    return;
  }
  throw new ModelError(`AI 결과의 JSON 형식이 올바르지 않습니다 (${label}).`);
}

// Provider text can contain request data. Store only fixed diagnostic labels.
function providerReason(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/thinking|redacted_thinking|signature/i.test(message))
    return '추론 블록 또는 서명';
  if (/credit balance|billing|insufficient.quota/i.test(message))
    return '결제 또는 사용량';
  if (
    /context.length|max(?:imum)? context|prompt is too long|too many input tokens/i.test(
      message,
    )
  )
    return '입력 길이 한도';
  if (/tool_use|tool_result|function_call|tool call/i.test(message))
    return '도구 호출 형식';
  if (
    /json.schema|output_config|response_format|structured output/i.test(message)
  )
    return '구조화 응답 형식';
  if (/max_tokens|max_output_tokens/i.test(message)) return '출력 토큰 설정';
  if (
    /model/i.test(message) &&
    /not found|not supported|access|invalid/i.test(message)
  )
    return '모델 설정 또는 접근 권한';
  switch (error?.type ?? error?.code) {
    case 'authentication_error':
    case 'permission_error':
      return '인증 또는 접근 권한';
    case 'rate_limit_error':
    case 'overloaded_error':
    case 'server_error':
    case 'api_error':
      return 'API 한도 또는 공급자 장애';
    case 'invalid_request_error':
      return '잘못된 요청';
    default:
      return '세부 분류 없음';
  }
}

function providerField(error) {
  if (typeof error?.message !== 'string') return '';
  // Match only recognized request fields and bounded decimal indexes.
  const field = error.message.match(
    /^(messages\.\d{1,3}\.content\.\d{1,3}(?:\.(?:text|thinking|signature|input|tool_use_id|type))?|system|model|max_tokens|output_config)(?=\s*:)/,
  )?.[1];
  return field ? `, 필드 ${field}` : '';
}

function streamError(reason) {
  return Object.assign(new Error(reason), { streamReason: reason });
}

function claudeAssistantContent(blocks) {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'text': {
        const { text, citations } = block;
        return text.trim()
          ? [{ type: 'text', text, ...(citations?.length && { citations }) }]
          : [];
      }
      case 'tool_use': {
        const { id, name, input } = block;
        return [{ type: 'tool_use', id, name, input }];
      }
      // Claude validates the signature of thinking blocks on continuation.
      case 'thinking':
      case 'redacted_thinking':
        return [block];
      default:
        throw new ModelError(
          'Claude 도구 호출에 지원하지 않는 응답 블록이 있습니다.',
        );
    }
  });
}

// A standalone progress note carries no request for a human decision.
function isCheckpoint(summary) {
  return (
    typeof summary === 'string' &&
    /^[\s(]*(?:(?:work\s+in\s+|in[\s_]+)?progress|(?:중간\s*)?(?:확인|점검)\s*(?:단계|중(?:입니다)?))[)\s.!…]*$/iu.test(
      summary,
    )
  );
}

export function validateReview(value) {
  validate(value, reviewSchema, 'review');
  if (!value.summary.trim()) throw new ModelError('리뷰 요약이 비어 있습니다.');
  if (value.summary.length > 900)
    throw new ModelError(`리뷰 요약 길이 초과 (${value.summary.length}/900).`);
  if (value.findings.length > 6)
    throw new ModelError(`리뷰 지적 개수 초과 (${value.findings.length}/6).`);
  if (value.status === 'pass' && value.findings.length)
    throw new ModelError(
      'pass에 지적 사항이 있습니다. 지적을 보존하고 판정을 확인하세요.',
    );
  if (value.status === 'changes_requested' && !value.findings.length)
    throw new ModelError(
      'changes_requested에는 근거가 있는 지적 사항이 필요합니다.',
    );
  for (const [index, { line, ...fields }] of value.findings.entries()) {
    if (line < 1)
      throw new ModelError(
        `리뷰 지적 ${index + 1}의 line은 1 이상이어야 합니다.`,
      );
    for (const [name, field] of Object.entries(fields)) {
      if (!field.trim())
        throw new ModelError(
          `리뷰 지적 ${index + 1}의 ${name}이 비어 있습니다.`,
        );
      if (field.length > 350)
        throw new ModelError(
          `리뷰 지적 ${index + 1}의 ${name} 길이 초과 (${field.length}/350).`,
        );
    }
  }
  return value;
}

const developmentSummaryLimit = 1200;

function titleProblem(title) {
  if (title.length > 100) return `제목 길이 초과 (${title.length}/100).`;
  if (/[\r\n<>@\u202a-\u202e]/.test(title))
    return '제목에 줄바꿈 또는 허용되지 않는 문자가 있습니다.';
  if (!/^\p{Extended_Pictographic}/u.test(title))
    return '제목 첫 글자에 실제 GitMoji 이모지가 필요합니다.';
  if (!/^\p{Extended_Pictographic}.*? [^\n:]+: .*[가-힣]/u.test(title))
    return '제목을 “🎨 화면: 팝업 수정”처럼 영역과 한국어 요약으로 작성하세요.';
}

export function validateDevelopment(
  value,
  maxEdits = config.limits.edits,
  issueTitle,
) {
  validate(value, developmentSchema, 'development');
  if (!value.summary.trim())
    throw new ModelError('개발 결과의 요약이 비어 있습니다.');
  if (value.summary.length > developmentSummaryLimit)
    throw new ModelError(
      `개발 요약 길이 초과 (${value.summary.length}/${developmentSummaryLimit}).`,
    );
  if (value.edits.length > maxEdits)
    throw new ModelError(
      `개발 편집 개수 초과 (${value.edits.length}/${maxEdits}).`,
    );
  if (value.status === 'completed') {
    const problem = titleProblem(value.title);
    if (problem) {
      if (typeof issueTitle === 'string' && !titleProblem(issueTitle))
        return { ...value, title: issueTitle };
      throw new ModelError(`개발 결과: ${problem}`);
    }
  }
  return value;
}

// Yields the JSON payload of each server-sent event; `touch` runs whenever bytes arrive.
// Reads race the abort signal so a silent stream ends even if the body ignores the signal.
async function* serverEvents(body, touch, signal) {
  const reader = body.getReader();
  const aborted = new Promise((_, reject) => {
    const fail = () => reject(new Error('aborted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  aborted.catch(() => {});
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) return;
      touch();
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop();
      for (const block of blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        yield JSON.parse(data);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// The terminal event of a Responses stream carries the same object a non-streaming call returns.
async function readCodexStream(events) {
  for await (const event of events) {
    if (event.type === 'error')
      throw streamError(
        `공급자 오류 이벤트: ${providerReason(event.error ?? event)}`,
      );
    if (
      ['response.completed', 'response.incomplete', 'response.failed'].includes(
        event.type,
      )
    )
      return event.response;
  }
  throw streamError('완료 이벤트 없이 스트림 종료');
}

// Rebuilds the Message a non-streaming call returns from its incremental events.
async function readClaudeStream(events) {
  let message;
  const partialInputs = new Map();
  for await (const event of events) {
    if (event.type === 'error')
      throw streamError(`공급자 오류 이벤트: ${providerReason(event.error)}`);
    if (event.type === 'message_start') {
      message = { ...event.message, content: [] };
    } else if (!message) {
      continue;
    } else if (event.type === 'content_block_start') {
      message.content[event.index] = { ...event.content_block };
      if (event.content_block.type === 'tool_use')
        partialInputs.set(event.index, '');
    } else if (event.type === 'content_block_delta') {
      const block = message.content[event.index];
      const { delta } = event;
      if (delta.type === 'text_delta') block.text += delta.text;
      else if (delta.type === 'citations_delta')
        block.citations = [...(block.citations ?? []), delta.citation];
      else if (delta.type === 'input_json_delta')
        partialInputs.set(
          event.index,
          partialInputs.get(event.index) + delta.partial_json,
        );
      else if (delta.type === 'thinking_delta')
        block.thinking += delta.thinking;
      else if (delta.type === 'signature_delta')
        block.signature = (block.signature ?? '') + delta.signature;
    } else if (event.type === 'content_block_stop') {
      if (partialInputs.has(event.index)) {
        const json = partialInputs.get(event.index);
        if (json) message.content[event.index].input = JSON.parse(json);
      }
    } else if (event.type === 'message_delta') {
      Object.assign(message, event.delta);
      message.usage = { ...message.usage, ...event.usage };
    } else if (event.type === 'message_stop') {
      return message;
    }
  }
  throw streamError('완료 이벤트 없이 스트림 종료');
}

export function createModels({
  keys,
  modelNames,
  limits = config.limits,
  request = fetch,
  sleep = wait,
  log = console.log,
}) {
  function verify() {
    if (!keys.codex || !keys.claude)
      throw new ModelError(
        'OPENAI_API_KEY와 ANTHROPIC_API_KEY Actions Secrets를 모두 설정한 뒤 수동 재개하세요.',
      );
  }

  async function call(agent, body, mode, turn) {
    const isCodex = agent === 'codex';
    const name = agents[agent].name;
    const endpoint = isCodex
      ? 'https://api.openai.com/v1/responses'
      : 'https://api.anthropic.com/v1/messages';
    const headers = {
      'content-type': 'application/json',
      ...(isCodex
        ? { authorization: `Bearer ${keys[agent]}` }
        : { 'x-api-key': keys[agent], 'anthropic-version': '2023-06-01' }),
    };
    // The provider may already have processed a request with an unknown transport outcome.
    const stage = `${mode === 'review' ? '리뷰' : '개발'} 요청 ${turn}회차`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const idle = new AbortController();
      let timer;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(), limits.idleTimeout);
      };
      let response;
      let rejectionReason;
      const timeout = AbortSignal.timeout(limits.requestTimeout);
      try {
        touch();
        const signal = AbortSignal.any([idle.signal, timeout]);
        response = await request(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, stream: true }),
          signal,
        });
        if (response.ok) {
          if (
            !response.headers.get('content-type')?.includes('text/event-stream')
          )
            return await response.json();
          const events = serverEvents(response.body, touch, signal);
          return await (isCodex
            ? readCodexStream(events)
            : readClaudeStream(events));
        }
        const payload = await response.json().catch(() => null);
        rejectionReason =
          providerReason(payload?.error) + providerField(payload?.error);
      } catch (error) {
        const reason = timeout.aborted
          ? '요청 시간 초과'
          : idle.signal.aborted
            ? '응답 대기 시간 초과'
            : (error?.streamReason ??
              (response
                ? '응답 본문 수신 또는 해석 실패'
                : 'HTTP 응답 수신 실패'));
        throw new ModelError(
          `${name} API 응답을 확인할 수 없습니다. (${stage}, ${reason})`,
        );
      } finally {
        clearTimeout(timer);
      }
      const id = response.headers.get(isCodex ? 'x-request-id' : 'request-id');
      const requestId =
        id && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? `, request_id=${id}` : '';
      const status = response.status;
      const retryAfter = response.headers.get('retry-after');
      if (!attempt && (status === 429 || status === 503 || status === 529)) {
        const seconds = retryAfter === null ? 2 : Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 10) {
          await sleep(seconds * 1000);
          continue;
        }
      }
      throw Object.assign(
        new Error(
          `${name} API HTTP ${status}. (${stage}, ${rejectionReason}${requestId})`,
        ),
        {
          diagnostic: `${name} API HTTP ${status} (${stage}, ${rejectionReason}${requestId})`,
          requestRejected: [400, 401, 403, 404, 422, 429].includes(status),
        },
      );
    }
  }

  return {
    verify,
    async run({
      agent,
      mode,
      instructions,
      context,
      inspect,
      issueTitle,
      prepareChanges,
      needsUiSpec,
    }) {
      const schema = mode === 'development' ? developmentSchema : reviewSchema;
      const verifyResult =
        mode === 'development'
          ? (value) => validateDevelopment(value, limits.edits, issueTitle)
          : validateReview;
      const input = [{ role: 'user', content: context }];
      const isCodex = agent === 'codex';
      const model = modelNames[agent];
      const turnLimit =
        mode === 'review' ? (limits.reviewTurns ?? limits.turns) : limits.turns;
      const reviewFormat =
        '한국어 요약은 400자 미만으로 작성하세요. findings는 최대 6건이며 각 문자열은 250자 미만, 줄 번호는 양의 정수여야 합니다. pass이면 findings가 비어 있어야 하고 changes_requested이면 한 건 이상이어야 합니다. 검토할 때 읽기 도구를 사용하세요. 진행 상황만으로 최종 판정을 내리지 마세요. needs_human이면 구체적인 장애 사유와 필요한 결정 또는 부족한 정보를 명시하세요.';
      const developmentFormat = `비어 있지 않은 한국어 요약과 정확한 편집안을 반환하세요. 요약은 UTF-16 코드 단위로 최대 ${developmentSummaryLimit}개, 편집은 최대 ${limits.edits}건입니다. 제목은 GitMoji를 포함한 한국어 한 줄로 작성하고 UTF-16 코드 단위 100개 이내로 제한하세요. 개발이 끝나지 않았으면 in_progress를 사용하세요. 부분 편집안은 게시되지 않습니다. 중간 확인에는 읽기 도구를 사용하세요. 사용자의 결정이나 정보가 필요한 경우에만 needs_human을 사용하세요. 허용 범위 안에 전체 변경을 안전하게 담을 수 없으면 구체적인 사유와 빈 edits를 포함해 needs_human을 반환하세요.`;
      const taskInstructions =
        instructions +
        '\n' +
        (mode === 'review' ? reviewFormat : developmentFormat) +
        '\n긴 파일은 find_in_file로 관련 위치를 찾은 뒤 필요한 부분만 read_file로 읽으세요. 끝부분이 필요하면 line=-1로 바로 확인하세요. 허용된 파일의 미확인 구간은 사용자에게 붙여 달라고 요청하기 전에 직접 조회하세요.';
      let correction;
      let promptedForSpec = false;
      let reviewCanPass = true;
      const missingBlocker =
        '자동화가 사람 확인을 요청했지만 구체적인 중단 사유를 제공하지 않았습니다.';
      const unexplainedStop = {
        status: 'needs_human',
        ...(mode === 'review' ? { findings: [] } : { title: '', edits: [] }),
        summary: missingBlocker,
      };
      let toolCalls = 0;
      for (let turn = 1; turn <= turnLimit; turn++) {
        const started = performance.now();
        const finalTurn =
          turn === turnLimit || (Boolean(correction) && correction !== 'edits');
        // Reserve the last review request for repairing an invalid verdict.
        const remainingReads = Math.min(
          limits.toolCallsPerTurn,
          limits.toolCallsTotal - toolCalls,
        );
        const requireResult =
          remainingReads === 0 || finalTurn || turn === turnLimit - 1;
        const turnInstructions = requireResult
          ? `${taskInstructions}
이제 지정된 형식으로 최종 결과를 반환하세요. 근거가 부족하면 구체적인 장애 사유와 함께 needs_human을 반환하세요.`
          : `${taskInstructions}
이번 요청을 포함해 남은 API 요청은 ${turnLimit - turn + 1}회입니다. 이번 요청에서 읽기 도구는 ${remainingReads}회 사용할 수 있습니다. 근거가 충분해지면 지정된 형식으로 최종 결과를 반환하세요.`;
        function readTool(index, name, args) {
          if (requireResult)
            throw new ModelError(
              '최종 결과 요청 중 탐색 호출이 반환되었습니다.',
            );
          if (index >= remainingReads)
            return '이번 요청의 읽기 한도에 도달해 실행하지 않았습니다. 이미 반환된 근거를 사용하거나, 남은 한도가 있으면 다음 요청에서 이 읽기를 우선하세요.';
          toolCalls++;
          return invokeTool(inspect, name, isCodex ? parseJSON(args) : args);
        }
        const data = await call(
          agent,
          isCodex
            ? {
                model,
                instructions: turnInstructions,
                input,
                store: false,
                include: ['reasoning.encrypted_content'],
                max_output_tokens: limits.outputTokens,
                reasoning: { effort: limits.codexEffort },
                text: {
                  format: {
                    type: 'json_schema',
                    name: mode,
                    schema,
                    strict: true,
                  },
                },
                ...(requireResult ? { tool_choice: 'none' } : {}),
                tools: Object.entries(tools).map(
                  ([name, { description, input }]) => ({
                    type: 'function',
                    name,
                    description,
                    parameters: input,
                    strict: true,
                  }),
                ),
              }
            : {
                model,
                system: taskInstructions,
                messages: input,
                max_tokens: limits.outputTokens,
                output_config: { format: { type: 'json_schema', schema } },
                ...(requireResult ? { tool_choice: { type: 'none' } } : {}),
                tools: Object.entries(tools).map(
                  ([name, { description, input }]) => ({
                    name,
                    description,
                    input_schema: input,
                    strict: true,
                  }),
                ),
              },
          mode,
          turn,
        ).catch((error) => {
          log(
            JSON.stringify({
              agent,
              mode,
              model,
              turn,
              ok: false,
              diagnostic: error.diagnostic,
              elapsedMs: Math.round(performance.now() - started),
            }),
          );
          if (correction === 'blocker') return null;
          throw error;
        });
        if (
          correction === 'blocker' &&
          (!data ||
            (isCodex
              ? data.status !== 'completed' ||
                data.output?.some(({ type }) => type === 'function_call')
              : data.stop_reason !== 'end_turn') ||
            data.incomplete_details?.reason === 'max_output_tokens')
        )
          return unexplainedStop;
        const usage = Object.fromEntries(
          Object.entries(data.usage ?? {}).filter(
            ([, count]) => typeof count === 'number',
          ),
        );
        log(
          JSON.stringify({
            agent,
            mode,
            model,
            turn,
            usage,
            elapsedMs: Math.round(performance.now() - started),
          }),
        );
        if (
          data.incomplete_details?.reason === 'max_output_tokens' ||
          data.stop_reason === 'max_tokens'
        )
          throw Object.assign(
            new ModelError(
              `${agents[agent].name} 응답이 출력 토큰 한도에 도달했습니다.`,
            ),
            { outputLimitReached: true },
          );
        let text;
        const output = (isCodex ? data.output : data.content) ?? [];
        if (isCodex) {
          if (data.status !== 'completed')
            throw new ModelError('Codex 응답이 완료되지 않았습니다.');
          const calls = output.filter(({ type }) => type === 'function_call');
          if (calls.length) {
            if (correction && correction !== 'edits')
              throw new ModelError('결과 교정 중 도구 호출이 반환되었습니다.');
            input.push(
              ...output,
              ...calls.map(({ name, arguments: args, call_id }, index) => ({
                type: 'function_call_output',
                call_id,
                output: readTool(index, name, args),
              })),
            );
            continue;
          }
          text = output
            .flatMap(({ content }) => content ?? [])
            .filter(({ type }) => type === 'output_text')
            .map(({ text }) => text)
            .join('');
        } else {
          if (data.stop_reason === 'tool_use') {
            if (correction && correction !== 'edits')
              throw new ModelError('결과 교정 중 도구 호출이 반환되었습니다.');
            const calls = output.filter(({ type }) => type === 'tool_use');
            if (!calls.length)
              throw new ModelError(
                'Claude 도구 호출 응답에 실행할 도구가 없습니다.',
              );
            const results = calls.map(({ name, input: args, id }, index) => ({
              type: 'tool_result',
              tool_use_id: id,
              content: readTool(index, name, args) || '일치하는 줄이 없습니다.',
            }));
            input.push(
              { role: 'assistant', content: claudeAssistantContent(output) },
              { role: 'user', content: results },
            );
            continue;
          }
          if (data.stop_reason !== 'end_turn')
            throw new ModelError('Claude 응답이 완료되지 않았습니다.');
          text = output
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('');
        }
        let result;
        try {
          result = parseJSON(text);
          if (correction === 'blocker' && result?.status !== 'needs_human')
            return unexplainedStop;
          if (mode === 'development' && result?.status === 'in_progress') {
            validateDevelopment(result, limits.edits, issueTitle);
            if (finalTurn || correction)
              return {
                status: 'needs_human',
                title: '',
                summary: '개발 호출 한도 내에 최종 변경을 확인하지 못했습니다.',
                edits: [],
              };
            input.push(
              ...(isCodex
                ? output
                : [
                    {
                      role: 'assistant',
                      content: claudeAssistantContent(output),
                    },
                  ]),
              {
                role: 'user',
                content:
                  '같은 대화에서 개발을 이어가세요. 검증을 마친 최종 편집안 전체가 준비되어야 게시할 수 있습니다.',
              },
            );
            continue;
          }
          if (
            result?.status === 'needs_human' &&
            (typeof result.summary !== 'string' ||
              isCheckpoint(result.summary) ||
              !/[\p{L}\p{N}]/u.test(result.summary))
          ) {
            if (finalTurn) return unexplainedStop;
            correction = 'blocker';
            throw new ModelError(missingBlocker);
          }
          if (mode === 'review' && result?.status === 'pass' && !reviewCanPass)
            throw new ModelError(
              '교정 과정에서 기존 수정 요청이나 지적을 승인으로 변경할 수 없습니다.',
            );
          const verified = verifyResult(result);
          if (
            ['completed', 'pass'].includes(verified.status) &&
            needsUiSpec?.(verified.edits?.map(({ path }) => path))
          ) {
            const message =
              '관련 UI 테스트 본문을 확인하지 않아 개발 완료 또는 리뷰 승인을 기록할 수 없습니다.';
            if (promptedForSpec || requireResult || correction) {
              return {
                status: 'needs_human',
                summary: message,
                ...(mode === 'review'
                  ? { findings: [] }
                  : { title: '', edits: [] }),
              };
            }
            promptedForSpec = true;
            input.push(
              ...(isCodex
                ? output
                : [
                    {
                      role: 'assistant',
                      content: claudeAssistantContent(output),
                    },
                  ]),
              {
                role: 'user',
                content:
                  '수정한 e2e/*.spec.ts 각각과 영향을 받는 UI의 테스트 파일을 read_file로 읽으세요. 요소 선택자와 검증문을 변경된 역할·접근성 이름·조작과 대조한 뒤 전체 변경안 또는 리뷰 판정을 반환하세요. 검증이 이전 동작을 기대하거나 필요한 검증이 빠졌으면 수정을 요청하세요.',
              },
            );
            continue;
          }
          if (
            mode === 'development' &&
            verified.status === 'completed' &&
            prepareChanges
          )
            return {
              ...verified,
              changes: await prepareChanges(verified.edits),
            };
          return verified;
        } catch (error) {
          if (
            correction === 'blocker' &&
            finalTurn &&
            error instanceof ModelError
          )
            return unexplainedStop;
          if (
            (mode !== 'review' &&
              correction !== 'blocker' &&
              result?.status !== 'completed') ||
            finalTurn ||
            correction === 'edits' ||
            !(
              error instanceof ModelError ||
              error instanceof CorrectableEditError
            )
          )
            throw error;
          if (
            mode === 'review' &&
            (result?.status === 'changes_requested' ||
              result?.status === 'needs_human' ||
              (Array.isArray(result?.findings) && result.findings.length))
          )
            reviewCanPass = false;
          correction ??= error instanceof CorrectableEditError ? 'edits' : mode;
          const responseItems = isCodex
            ? output
            : [{ role: 'assistant', content: claudeAssistantContent(output) }];
          input.push(...responseItems, {
            role: 'user',
            content:
              correction === 'blocker'
                ? 'needs_human 판정을 유지하세요. 이미 수집한 근거를 바탕으로 구체적인 장애 사유와 사용자가 제공해야 할 정보를 한국어로 설명하세요.'
                : correction === 'edits'
                  ? `편집안을 적용하지 못했습니다. 오류 내용은 다음과 같습니다. ${error.message}. 필요하면 해당 소스를 읽고 같은 HEAD를 기준으로 교정한 변경안 전체를 반환하세요. 변경안의 편집은 앞에서부터 순서대로 적용됩니다. 요청된 변경은 모두 보존하고, 진행할 수 없으면 이유를 설명하세요. ${developmentFormat}`
                  : correction === 'development'
                    ? `같은 근거를 사용해 개발 결과 JSON을 교정하고 요청된 동작 전체를 보존하세요. 한도에 맞추기 위해 필요한 편집을 빼지 마세요. 검증 오류: ${error.message}. ${developmentFormat}`
                    : `같은 근거와 판정을 유지해 리뷰 결과 JSON을 교정하세요. 실질적인 지적 사항을 보존하세요. pass가 지적 사항과 모순되면 근거를 담아 changes_requested를 반환하고, 모순을 해소할 수 없으면 needs_human을 반환하세요. 지적 사항을 지어내지 마세요. 검증 오류: ${error.message}. ${reviewFormat}`,
          });
        }
      }
      throw new ModelError(
        'AI의 저장소 탐색 최대 횟수에 도달했습니다. Issue 범위를 좁힌 뒤 수동 재개하세요.',
      );
    },
  };
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError('AI가 유효한 JSON을 반환하지 않았습니다.');
  }
}

function invokeTool(inspect, name, input) {
  if (!Object.hasOwn(tools, name)) return 'Unknown tool.';
  try {
    validate(input, tools[name].input, 'tool');
    return inspect(name, input);
  } catch {
    return '인수가 올바르지 않거나 요청한 자료를 읽을 수 없습니다.';
  }
}
