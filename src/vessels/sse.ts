import type { ServerResponse } from 'node:http';

export const SSE_KEEPALIVE_MS = 15_000;

export function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseComment(text: string): string {
  return `: ${text}\n\n`;
}

export function writeSse(response: ServerResponse, chunk: string): boolean {
  return response.write(chunk);
}
