import { AsyncLocalStorage } from 'node:async_hooks';

export type CoreUsage = {
  limit?: number;
  used?: number;
  remaining?: number;
  reset?: number;
};

export type RefreshConsumption = { consumed?: number; limit?: number };
export type GitHubDebugSnapshot = {
  refresh?: RefreshConsumption;
  core?: CoreUsage;
};
type Measurement = { consumed: number; uncertain: boolean; limit?: number };

const scopes = new Map<string, CoreUsage>();
const refresh = new AsyncLocalStorage<Measurement>();

export function githubDebugEnabled() {
  return process.env.AGENTOPIA_GITHUB_DEBUG !== '0';
}

export async function measureRefresh<T>(load: () => Promise<T>) {
  const measurement = {
    consumed: 0,
    uncertain: false,
    limit: undefined,
  } as Measurement;
  const result = await refresh.run(measurement, load);
  return {
    result,
    usage: {
      consumed: measurement.uncertain ? undefined : measurement.consumed,
      limit: measurement.limit,
    } satisfies RefreshConsumption,
  };
}

export function recordRefreshResponse(
  response: Response | undefined,
  authenticated: boolean,
) {
  const usage = refresh.getStore();
  if (!usage) return;
  const resource = response?.headers.get('x-ratelimit-resource');
  if (resource && resource !== 'core') return;
  if (response?.status === 304 && authenticated) return;
  if (!response?.ok || resource !== 'core') {
    usage.uncertain = true;
    return;
  }

  // A successful REST Core request uses one request from the primary quota.
  // Quota header deltas may include other clients and are never attributed here.
  usage.consumed++;
  const limit = count(response.headers, 'limit');
  if (limit !== undefined) {
    if (usage.limit !== undefined && usage.limit !== limit)
      usage.uncertain = true;
    usage.limit = limit;
  }
}

function count(headers: Headers, key: string) {
  const raw = headers.get(`x-ratelimit-${key}`);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function recordCoreUsage(scope: string, headers: Headers) {
  if (!githubDebugEnabled() || headers.get('x-ratelimit-resource') !== 'core')
    return;
  const core: CoreUsage = {
    limit: count(headers, 'limit'),
    used: count(headers, 'used'),
    remaining: count(headers, 'remaining'),
    reset: count(headers, 'reset'),
  };
  if (Object.values(core).every((value) => value === undefined)) return;
  const previous = scopes.get(scope);
  if (previous?.reset !== undefined) {
    if (core.reset === undefined && previous.reset * 1000 > Date.now()) return;
    if (core.reset !== undefined && core.reset < previous.reset) return;
    if (
      core.reset === previous.reset &&
      core.used !== undefined &&
      previous.used !== undefined &&
      core.used < previous.used
    )
      return;
  }
  if (scopes.size >= 128 && !previous) {
    const oldest = scopes.keys().next().value;
    if (oldest !== undefined) scopes.delete(oldest);
  }
  scopes.delete(scope);
  scopes.set(scope, core);
}

export function githubDebugSnapshot(scope: string): GitHubDebugSnapshot {
  const core = scopes.get(scope);
  return {
    core:
      core?.reset !== undefined && core.reset * 1000 <= Date.now()
        ? undefined
        : core,
  };
}
