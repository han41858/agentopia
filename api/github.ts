import {
  githubDebugEnabled,
  githubDebugSnapshot,
  measureRefresh,
} from '../server/github-debug.ts';
import { credentialScope } from '../server/github-query.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { githubResponse } from '../server/github.ts';

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? '/', 'http://agentopia.local');
  const load = () =>
    githubResponse(url, request.method, request.headers.authorization);
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
