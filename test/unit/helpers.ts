import type { Config } from '../../src/config.js';

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'https://kanban.example',
    email: 'agente@example.com',
    password: 'segredo-que-nunca-aparece-em-log',
    defaultBoardId: '1849792702397285816',
    readOnly: false,
    timeoutMs: 30_000,
    cacheTtlMs: 30_000,
    ...overrides,
  };
}

/** JWT sem assinatura valida — so o `exp` importa para o cliente. */
export function makeJwt(expEpochSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expEpochSeconds, iat: 0 })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Reply {
  status?: number;
  body?: string;
  contentType?: string;
  /** Lanca em vez de responder — simula falha de rede. */
  throws?: Error;
}

export interface FakeFetch {
  fetch: typeof globalThis.fetch;
  calls: Call[];
}

/** `fetch` dublado que devolve as respostas na ordem dada; a ultima se repete. */
export function fakeFetch(replies: Reply[]): FakeFetch {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (input: any, init: any = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const reply = replies[Math.min(index, replies.length - 1)] ?? {};
    index++;
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    // O construtor de Response recusa corpo em 204/205/304.
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : (reply.body ?? ''), {
      status,
      headers: { 'content-type': reply.contentType ?? 'application/json; charset=utf-8' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

export const HTML_BODY = '<!doctype html><html lang="en"><body>frontend</body></html>';

export function json(value: unknown): string {
  return JSON.stringify(value);
}

/** `fetch` dublado que responde por rota, para fluxos com varias chamadas. */
export function routerFetch(handler: (call: Call) => Reply): FakeFetch {
  const calls: Call[] = [];
  const fetchImpl = (async (input: any, init: any = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const reply = handler(call);
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : (reply.body ?? ''), {
      status,
      headers: { 'content-type': reply.contentType ?? 'application/json; charset=utf-8' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

/** Caminho da chamada, sem o host. */
export function pathOf(call: Call): string {
  return new URL(call.url).pathname;
}
