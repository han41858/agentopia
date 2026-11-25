import type { Heritage } from '../server/heritage.ts';
import { publishGitHubUsage } from './github-usage.tsx';
import type {
  GitHubDebugSnapshot,
  RefreshConsumption,
} from '../server/github-debug.ts';

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimited = false,
  ) {
    super(message);
  }
}

export async function request<T>(
  params: URLSearchParams,
  token: string,
  signal: AbortSignal,
  onUsage?: (usage?: RefreshConsumption) => void,
  ticket?: string,
): Promise<T> {
  const response = await fetch(`/api/github?${params}`, {
    signal,
    method: ticket ? 'POST' : 'GET',
    body: ticket || undefined,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ticket !== undefined ? { 'X-Agentopia-Cache': '1' } : {}),
    },
  });
  const header = response.headers.get('X-Agentopia-GitHub-Usage');
  let snapshot: GitHubDebugSnapshot | undefined;
  if (header) {
    try {
      snapshot = JSON.parse(header) as GitHubDebugSnapshot;
    } catch {
      // Invalid diagnostics should not interrupt repository updates.
    }
  }
  if (!signal.aborted) {
    publishGitHubUsage(token, snapshot);
    onUsage?.(snapshot?.refresh);
  }
  const body = await response.json();
  if (!response.ok)
    throw new RequestError(
      body.error ?? 'GitHub 동기화에 실패했습니다.',
      response.status,
      body.rateLimited === true,
    );
  return body as T;
}

export function requestHeritage(
  slug: string,
  token: string,
  signal: AbortSignal,
) {
  return request<Heritage>(
    new URLSearchParams({ repo: slug, heritage: '1' }),
    token,
    signal,
  );
}
