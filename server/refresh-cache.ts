import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { QueryResponse } from './github-query.ts';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const maxCacheBytes = 256 * 1024;
const maxDecoded = 1024 * 1024;
const lifetime = 2 * 60 * 60_000;
type Entries = Record<string, QueryResponse>;
type Session = {
  previous: Entries;
  next: Entries;
  pending: Map<string, Promise<QueryResponse>>;
  denied?: Error;
};
export const refreshCache = new AsyncLocalStorage<Session>();

// Only server-generated report paths may exchange bodies with the tab.
export function reportCachePath(url: URL, repo: string) {
  const prefix = '/repos/' + repo;
  if (
    url.origin !== 'https://api.github.com' ||
    !url.pathname.startsWith(prefix + '/')
  )
    return;
  const path = url.pathname.slice(prefix.length) + url.search;
  if (
    /^\/(issues|pulls)\?per_page=50&state=all&sort=updated&direction=desc$/.test(
      path,
    ) ||
    path === '/actions/runs?per_page=100' ||
    path === '/issues/comments?per_page=100&sort=updated&direction=desc' ||
    path === '/pulls?per_page=50&state=open&sort=updated&direction=desc' ||
    /^\/issues\/[1-9]\d*(?:\/sub_issues\?per_page=100)?$/.test(path)
  )
    return path;
}

export async function withRefreshCache<T>(
  repo: string,
  token: string,
  ticket: string,
  load: () => Promise<T>,
) {
  const secret = process.env.AGENTOPIA_REFRESH_CACHE_KEY;
  if (!secret || Buffer.byteLength(secret) < 32)
    return { result: await load() };
  const sign = (payload: string) =>
    createHmac('sha256', secret)
      .update(JSON.stringify(['v1', repo, token, payload]))
      .digest();
  let previous: Entries = {};
  if (ticket && ticket.length <= maxCacheBytes) {
    const [signature, payload] = ticket.split('.');
    if (signature?.length === 43 && payload) {
      const received = Buffer.from(signature, 'base64url');
      if (received.length === 32 && timingSafeEqual(received, sign(payload))) {
        const raw = await decompress(Buffer.from(payload, 'base64url'), {
          maxOutputLength: maxDecoded,
        });
        const saved = JSON.parse(raw.toString());
        if (Date.now() - saved.at < lifetime) previous = saved.entries;
      }
    }
  }
  const session: Session = { previous, next: {}, pending: new Map() };
  const result = await refreshCache.run(session, load);
  if (session.denied) throw session.denied;
  const raw = JSON.stringify({ at: Date.now(), entries: session.next });
  if (Buffer.byteLength(raw) > maxDecoded || !Object.keys(session.next).length)
    return { result };
  const payload = (await compress(raw)).toString('base64url');
  if (payload.length + 44 > maxCacheBytes) return { result };
  return {
    result,
    refreshTicket: sign(payload).toString('base64url') + '.' + payload,
  };
}
