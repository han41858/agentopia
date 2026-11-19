import type { IncomingMessage, ServerResponse } from 'node:http';
import { githubResponse } from '../server/github.ts';

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? '/', 'http://agentopia.local');
  const result = await githubResponse(
    url,
    request.method,
    request.headers.authorization,
  );
  response.writeHead(result.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(result.body);
}
