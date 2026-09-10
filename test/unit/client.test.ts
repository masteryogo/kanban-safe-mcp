import { describe, expect, it } from 'vitest';
import { KanbanClient } from '../../src/client.js';
import {
  AuthError,
  HttpError,
  NetworkError,
  ResourceNotFoundError,
  RouteNotFoundError,
  ValidationError,
} from '../../src/errors.js';
import { USER_AGENT } from '../../src/config.js';
import { HTML_BODY, fakeFetch, json, makeConfig, makeJwt } from './helpers.js';

const FAR_FUTURE = makeJwt(Math.floor(Date.now() / 1000) + 365 * 86_400);

function clientWith(replies: Parameters<typeof fakeFetch>[0], configOverrides = {}) {
  const fake = fakeFetch(replies);
  const client = new KanbanClient(makeConfig({ token: FAR_FUTURE, ...configOverrides }), {
    fetch: fake.fetch,
    sleep: async () => {},
    now: () => Date.now(),
  });
  return { client, fake };
}

describe('guarda de content-type (invariante 1)', () => {
  it('200 com HTML vira erro de rota inexistente, nao SyntaxError', async () => {
    const { client } = clientWith([{ status: 200, body: HTML_BODY, contentType: 'text/html' }]);
    const error = await client.get('/api/cards/1/tasks').catch((e) => e);
    expect(error).toBeInstanceOf(RouteNotFoundError);
    expect(error.message).toContain('rota nao existe nesta versao da API');
    expect(error.message).toContain('GET /api/cards/1/tasks');
    expect(error).not.toBeInstanceOf(SyntaxError);
  });

  it('corpo que comeca com "<" e barrado mesmo com content-type json', async () => {
    const { client } = clientWith([
      { status: 200, body: HTML_BODY, contentType: 'application/json' },
    ]);
    await expect(client.get('/api/nope')).rejects.toBeInstanceOf(RouteNotFoundError);
  });

  it('404 JSON E_NOT_FOUND e um erro distinto de rota inexistente', async () => {
    const { client } = clientWith([
      { status: 404, body: json({ code: 'E_NOT_FOUND', message: 'Card not found' }) },
    ]);
    const error = await client.get('/api/cards/999').catch((e) => e);
    expect(error).toBeInstanceOf(ResourceNotFoundError);
    expect(error).not.toBeInstanceOf(RouteNotFoundError);
    expect(error.message).toContain('Card not found');
    expect(error.message).toContain('A rota existe');
  });
});

describe('token e reautenticacao', () => {
  it('401 reautentica e repete uma unica vez', async () => {
    const { client, fake } = clientWith([
      { status: 401, body: json({ message: 'nope' }) },
      { status: 200, body: json({ item: FAR_FUTURE }) },
      { status: 200, body: json({ item: { id: '1' } }) },
    ]);
    const result = await client.get('/api/cards/1');
    expect(result.item.id).toBe('1');
    expect(fake.calls.map((c) => c.url)).toEqual([
      'https://kanban.example/api/cards/1',
      'https://kanban.example/api/access-tokens',
      'https://kanban.example/api/cards/1',
    ]);
  });

  it('401 de novo depois de reautenticar vira AuthError, sem terceira tentativa', async () => {
    const { client, fake } = clientWith([
      { status: 401, body: json({}) },
      { status: 200, body: json({ item: FAR_FUTURE }) },
      { status: 401, body: json({}) },
    ]);
    await expect(client.get('/api/cards/1')).rejects.toBeInstanceOf(AuthError);
    expect(fake.calls).toHaveLength(3);
  });

  it('JWT com exp no passado reautentica antes de chamar', async () => {
    const expired = makeJwt(Math.floor(Date.now() / 1000) - 10);
    const { client, fake } = clientWith(
      [
        { status: 200, body: json({ item: FAR_FUTURE }) },
        { status: 200, body: json({ item: { id: '1' } }) },
      ],
      { token: expired },
    );
    await client.get('/api/cards/1');
    expect(fake.calls[0]!.url).toBe('https://kanban.example/api/access-tokens');
    expect(fake.calls[1]!.headers.Authorization).toBe(`Bearer ${FAR_FUTURE}`);
  });

  it('token valido nao dispara login', async () => {
    const { client, fake } = clientWith([{ status: 200, body: json({ item: { id: '1' } }) }]);
    await client.get('/api/cards/1');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.headers.Authorization).toBe(`Bearer ${FAR_FUTURE}`);
  });

  it('token fixo (sem senha em disco) explica que nao da para renovar', async () => {
    const { client } = clientWith([{ status: 401, body: json({}) }], {
      email: undefined,
      password: undefined,
    });
    const error = await client.get('/api/cards/1').catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.message).toContain('KANBAN_SAFE_TOKEN');
  });

  it('nenhuma mensagem de erro carrega a senha', async () => {
    const { client } = clientWith([{ status: 401, body: json({}) }], { token: undefined });
    const error = await client.get('/api/cards/1').catch((e) => e);
    expect(error.message).not.toContain('segredo-que-nunca-aparece-em-log');
  });
});

describe('traducao de erro do servidor', () => {
  it('E_MISSING_OR_INVALID_PARAMS com dois problems cita os dois campos', async () => {
    const { client } = clientWith([
      {
        status: 400,
        body: json({
          code: 'E_MISSING_OR_INVALID_PARAMS',
          problems: [
            '"name" is required, but it was not defined.',
            '"position" is required, but it was not defined.',
          ],
        }),
      },
    ]);
    const error = await client.post('/api/cards/1/tasks', {}).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('"name" is required');
    expect(error.message).toContain('"position" is required');
    expect(error.message).toContain('POST /api/cards/1/tasks');
  });

  it('403 menciona o User-Agent enviado', async () => {
    const { client } = clientWith([{ status: 403, body: json({}) }]);
    const error = await client.get('/api/projects').catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.message).toContain(USER_AGENT);
  });

  it('status inesperado vira HttpError com o corpo resumido', async () => {
    const { client } = clientWith([{ status: 418, body: json({ oi: 1 }) }]);
    await expect(client.get('/api/projects')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('retry', () => {
  it('5xx tenta 3 vezes com backoff crescente', async () => {
    const waits: number[] = [];
    const fake = fakeFetch([{ status: 502, body: json({ code: 'E_SERVER' }) }]);
    const client = new KanbanClient(makeConfig({ token: FAR_FUTURE }), {
      fetch: fake.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
      now: () => Date.now(),
    });
    await expect(client.get('/api/projects')).rejects.toBeInstanceOf(HttpError);
    expect(fake.calls).toHaveLength(3);
    expect(waits).toEqual([250, 500]);
  });

  it('400 nao e repetido', async () => {
    const { client, fake } = clientWith([{ status: 400, body: json({ problems: ['x'] }) }]);
    await expect(client.post('/api/lists/1/cards', {})).rejects.toBeInstanceOf(ValidationError);
    expect(fake.calls).toHaveLength(1);
  });

  it('falha de rede tenta 3 vezes e vira NetworkError', async () => {
    const { client, fake } = clientWith([{ throws: new Error('ECONNRESET') }]);
    const error = await client.get('/api/projects').catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toContain('ECONNRESET');
    expect(fake.calls).toHaveLength(3);
  });

  it('noRetry (comentario) nao repete nem em 5xx — nao duplica publicacao', async () => {
    const { client, fake } = clientWith([{ status: 503, body: json({}) }]);
    await expect(
      client.post('/api/cards/1/comment-actions', { text: 'oi' }, { noRetry: true }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('headers e flavor', () => {
  it('sempre manda User-Agent — o servidor barra UA desconhecido com 403', async () => {
    const { client, fake } = clientWith([{ status: 200, body: json({ item: {} }) }]);
    await client.get('/api/users/me');
    expect(fake.calls[0]!.headers['User-Agent']).toBe(USER_AGENT);
  });

  it('detecta 1.x quando included traz tasks e nao taskLists', async () => {
    const { client } = clientWith([
      { status: 200, body: json({ item: { id: '1' }, included: { tasks: [], cardLabels: [] } }) },
    ]);
    await client.get('/api/cards/1');
    expect(client.flavor).toBe('v1');
  });

  it('detecta 2.0 quando included traz taskLists', async () => {
    const { client } = clientWith([
      { status: 200, body: json({ item: { id: '1' }, included: { taskLists: [], tasks: [] } }) },
    ]);
    await client.get('/api/cards/1');
    expect(client.flavor).toBe('v2');
  });

  it('resposta com campo desconhecido a mais passa; sem campo opcional tambem', async () => {
    const { client } = clientWith([
      { status: 200, body: json({ item: { id: '1', campoNovoDoServidor: 42 } }) },
    ]);
    const result = await client.get('/api/cards/1');
    expect(result.item.campoNovoDoServidor).toBe(42);
    expect(result.item.name).toBeUndefined();
  });

  it('204 sem corpo (DELETE) nao estoura no parse', async () => {
    const { client } = clientWith([{ status: 204, body: '', contentType: '' }]);
    await expect(client.delete('/api/tasks/1')).resolves.toBeUndefined();
  });
});
