import {
  githubDebugEnabled,
  githubDebugSnapshot,
  measureRefresh,
} from '../server/github-debug.ts';
import { maxCacheBytes } from '../server/refresh-cache.ts';
import { credentialScope } from '../server/github-query.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { githubResponse } from '../server/github.ts';

async function readTicket(request: IncomingMessage & { body?: unknown }) {
  if (request.headers['x-agentopia-cache'] !== '1') return undefined;
  if (request.method === 'GET') return '';
  if (request.method !== 'POST' || !request.headers.authorization)
    return undefined;
  if (Number(request.headers['content-length']) > maxCacheBytes)
    throw new Error('size');
  if (request.body !== undefined) {
    const value = Buffer.isBuffer(request.body)
      ? request.body.toString('utf8')
      : request.body;
    if (typeof value !== 'string' || Buffer.byteLength(value) > maxCacheBytes)
      throw new Error('body');
    return value;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxCacheBytes) throw new Error('size');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? '/', 'http://agentopia.local');
  let ticket;
  try {
    ticket = await readTicket(request);
  } catch {
    response.writeHead(413, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(
      JSON.stringify({
        error: '갱신 캐시가 너무 크거나 형식이 잘못되었습니다.',
      }),
    );
    return;
  }
  const load = () =>
    githubResponse(url, request.method, request.headers.authorization, ticket);
  const debug = githubDebugEnabled();
  const measured =
    debug && url.searchParams.get('measure') === 'refresh'
      ? await measureRefresh(load)
      : undefined;
  const result = measured?.result ?? (await load());
  const snapshot = debug
    ? {
        ...githubDebugSnapshot(credentialScope(request.headers.authorization)),
        refresh: measured && (result.status === 200 ? measured.usage : {}),
      }
    : undefined;
  response.writeHead(result.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    ...(snapshot
      ? { 'X-Agentopia-GitHub-Usage': JSON.stringify(snapshot) }
      : {}),
  });
  response.end(result.body);
}
