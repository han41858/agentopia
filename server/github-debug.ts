export type CoreUsage = {
  limit?: number;
  used?: number;
  remaining?: number;
  reset?: number;
};

export type GitHubDebugSnapshot = {
  requestsPerSecond: number;
  core?: CoreUsage;
};

type ScopeUsage = {
  buckets: Map<number, number>;
  core?: CoreUsage;
};

const windowSeconds = 60;
const scopes = new Map<string, ScopeUsage>();

export function githubDebugEnabled() {
  return process.env.AGENTOPIA_GITHUB_DEBUG !== '0';
}

function prune(buckets: Map<number, number>, second: number) {
  for (const bucket of buckets.keys())
    if (bucket <= second - windowSeconds) buckets.delete(bucket);
}

function scopeUsage(scope: string) {
  const previous = scopes.get(scope);
  if (scopes.size >= 128 && !previous) {
    const oldest = scopes.keys().next().value;
    if (oldest !== undefined) scopes.delete(oldest);
  }
  const usage = previous ?? { buckets: new Map<number, number>() };
  scopes.delete(scope);
  scopes.set(scope, usage);
  return usage;
}

export function recordGitHubRequest(scope: string) {
  if (!githubDebugEnabled()) return;
  const usage = scopeUsage(scope);
  const second = Math.floor(Date.now() / 1000);
  prune(usage.buckets, second);
  usage.buckets.set(second, (usage.buckets.get(second) ?? 0) + 1);
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
  const usage = scopeUsage(scope);
  const previous = usage.core;
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
  usage.core = core;
}

export function githubDebugSnapshot(scope: string): GitHubDebugSnapshot {
  const usage = scopes.get(scope);
  const second = Math.floor(Date.now() / 1000);
  const core = usage?.core;
  const buckets = usage?.buckets;
  if (buckets) prune(buckets, second);
  const requests = [...(buckets?.values() ?? [])].reduce(
    (sum, amount) => sum + amount,
    0,
  );
  return {
    requestsPerSecond: requests / windowSeconds,
    core: core?.reset !== undefined && core.reset <= second ? undefined : core,
  };
}
