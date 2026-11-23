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
  ) {
    super(message);
  }
}

export async function request<T>(
  params: URLSearchParams,
  token: string,
  signal: AbortSignal,
  onUsage?: (usage?: RefreshConsumption) => void,
): Promise<T> {
  const response = await fetch(`/api/github?${params}`, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
