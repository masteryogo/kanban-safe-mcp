import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { KanbanClient } from '../../src/client.js';
import { Context } from '../../src/context.js';
import { ReadOnlyError, WriteVerificationError } from '../../src/errors.js';
import { TOOLS } from '../../src/tools/index.js';
import type { ToolDef } from '../../src/tools/tool.js';
import { BOARD_ID, CARDS, TASKS, boardPayload, cardPayload } from './fixtures.js';
import { type Call, type Reply, json, makeConfig, makeJwt, pathOf, routerFetch } from './helpers.js';

const TOKEN = makeJwt(Math.floor(Date.now() / 1000) + 365 * 86_400);

function tool(name: string): ToolDef {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`ferramenta ${name} nao registrada`);
  return found;
}

/** Aplica os defaults do schema, como o SDK faz antes de chamar o handler. */
function parseArgs(def: ToolDef, args: Record<string, unknown>): Record<string, unknown> {
  return z.object(def.schema).parse(args) as Record<string, unknown>;
}

function setup(handler: (call: Call) => Reply, configOverrides = {}) {
  const fake = routerFetch(handler);
  const config = makeConfig({ token: TOKEN, ...configOverrides });
  const client = new KanbanClient(config, {
    fetch: fake.fetch,
    sleep: async () => {},
    now: () => Date.now(),
  });
  return { ctx: new Context(config, client), fake };
}

/** Servidor de mentira que so sabe ler o board e os cards. */
function readOnlyServer(call: Call): Reply {
  const path = pathOf(call);
  if (call.method === 'GET' && path === `/api/boards/${BOARD_ID}`) {
    return { body: json(boardPayload()) };
  }
  if (call.method === 'GET' && /^\/api\/cards\/\d+$/.test(path)) {
    return { body: json(cardPayload(path.split('/').pop()!)) };
  }
  throw new Error(`chamada inesperada: ${call.method} ${path}`);
}

async function run(name: string, args: Record<string, unknown>, ctx: Context): Promise<string> {
  const def = tool(name);
  return def.handler(parseArgs(def, args), ctx);
}

describe('registro das ferramentas', () => {
  it('sao 14, todas com prefixo kanban_ e nome unico', () => {
    expect(TOOLS).toHaveLength(14);
    expect(TOOLS.every((t) => t.name.startsWith('kanban_'))).toBe(true);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(14);
  });

  it('toda ferramenta de escrita tem dry_run com padrao true', () => {
    for (const def of TOOLS.filter((t) => t.write)) {
      const parsed = z.object(def.schema).partial().parse({}) as { dry_run?: boolean };
      expect(def.schema.dry_run, `${def.name} sem dry_run`).toBeDefined();
      expect(parseArgs(def, minimalArgs(def)).dry_run, `${def.name}`).toBe(true);
      expect(parsed).toBeDefined();
    }
  });
});

function minimalArgs(def: ToolDef): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if ('card' in def.schema) args.card = CARDS[0]!.id;
  if ('list' in def.schema && def.name !== 'kanban_get_board') args.list = 'ToDo';
  if ('name' in def.schema && def.name === 'kanban_create_card') args.name = 'x';
  if ('text' in def.schema) args.text = 'x';
  if ('tasks' in def.schema) args.tasks = ['x'];
  return args;
}

describe('dry_run (invariante 8)', () => {
  const writeCases: Array<[string, Record<string, unknown>]> = [
    ['kanban_create_card', { list: 'ToDo', name: 'E08-IA-009 Novo' }],
    ['kanban_update_card', { card: 'E08-IA-006', name: 'outro nome' }],
    ['kanban_move_card', { card: 'E08-IA-006', list: 'In progress' }],
    ['kanban_add_comment', { card: 'E08-IA-006', text: 'oi' }],
    ['kanban_set_labels', { card: 'E03-APP-005', add: ['ia'] }],
    ['kanban_add_tasks', { card: 'E08-IA-006', tasks: ['nova task'] }],
    ['kanban_update_task', { taskId: TASKS[0]!.id, isCompleted: false }],
    ['kanban_delete_task', { taskId: TASKS[0]!.id }],
    ['kanban_replace_tasks', { card: 'E08-IA-006', tasks: ['a', 'b'] }],
  ];

  it.each(writeCases)('%s nao faz nenhuma escrita de rede', async (name, args) => {
    const { ctx, fake } = setup(readOnlyServer);
    const output = await run(name, args, ctx);
    expect(output).toContain('DRY RUN');
    expect(output).toContain('Repita com dry_run: false');
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('mostra a rota e o corpo exatos que seriam enviados', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run(
      'kanban_add_tasks',
      { card: 'E08-IA-006', tasks: ['avaliar em video real 2'] },
      ctx,
    );
    expect(output).toContain(`POST /api/cards/${CARDS[0]!.id}/tasks`);
    expect(output).toContain('"name":"avaliar em video real 2"');
    // position calculada: ultima existente (131072) + 65536
    expect(output).toContain('"position":196608');
  });

  it('mostra o estado atual do que seria sobrescrito', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run(
      'kanban_update_card',
      { card: 'E08-IA-006', name: 'nome novo' },
      ctx,
    );
    expect(output).toContain('estado atual');
    expect(output).toContain('E08-IA-006 Pipeline de rPPG');
  });

  it('comentario avisa que e append-only', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run('kanban_add_comment', { card: 'E08-IA-006', text: 'oi' }, ctx);
    expect(output).toContain('append-only');
  });
});

describe('KANBAN_SAFE_READ_ONLY', () => {
  it('barra a escrita antes de qualquer chamada de rede', async () => {
    const { ctx, fake } = setup(readOnlyServer, { readOnly: true });
    await expect(
      run('kanban_add_comment', { card: 'E08-IA-006', text: 'oi', dry_run: false }, ctx),
    ).rejects.toBeInstanceOf(ReadOnlyError);
    expect(fake.calls).toHaveLength(0);
  });

  it('nao afeta leitura', async () => {
    const { ctx } = setup(readOnlyServer, { readOnly: true });
    await expect(run('kanban_get_board', {}, ctx)).resolves.toContain('telemedicina');
  });
});

describe('kanban_replace_tasks (invariante 10)', () => {
  it('POST que falha no meio nao apaga nenhuma task antiga', async () => {
    const criadas: string[] = [];
    const { ctx, fake } = setup((call) => {
      const path = pathOf(call);
      if (call.method === 'POST' && path === `/api/cards/${CARDS[0]!.id}/tasks`) {
        const body = call.body as { name: string; position: number };
        if (criadas.length >= 1) {
          return { status: 400, body: json({ problems: ['servidor recusou a segunda'] }) };
        }
        criadas.push(body.name);
        return { body: json({ item: { id: '1852000000000000009', ...body, cardId: CARDS[0]!.id } }) };
      }
      return readOnlyServer(call);
    });

    const error = await run(
      'kanban_replace_tasks',
      { card: 'E08-IA-006', tasks: ['nova A', 'nova B'], dry_run: false },
      ctx,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Nenhuma task antiga foi apagada');
    expect(error.message).toContain('1 de 2');
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('cria, confere na releitura e so entao apaga — nessa ordem', async () => {
    const novas: Array<{ id: string; name: string; position: number; cardId: string }> = [];
    let nextId = 1852000000000000100n;
    const { ctx, fake } = setup((call) => {
      const path = pathOf(call);
      if (call.method === 'POST' && path === `/api/cards/${CARDS[0]!.id}/tasks`) {
        const body = call.body as { name: string; position: number };
        const item = { id: String(nextId++), ...body, cardId: CARDS[0]!.id, isCompleted: false };
        novas.push(item);
        return { body: json({ item }) };
      }
      if (call.method === 'DELETE' && /^\/api\/tasks\/\d+$/.test(path)) {
        return { status: 204 };
      }
      if (call.method === 'GET' && path === `/api/cards/${CARDS[0]!.id}`) {
        return { body: json(cardPayload(CARDS[0]!.id, [...TASKS, ...novas] as any)) };
      }
      return readOnlyServer(call);
    });

    const output = await run(
      'kanban_replace_tasks',
      { card: 'E08-IA-006', tasks: ['nova A', 'nova B'], dry_run: false },
      ctx,
    );

    const ordem = fake.calls.map((c) => `${c.method} ${pathOf(c)}`);
    const ultimoPost = ordem.lastIndexOf(`POST /api/cards/${CARDS[0]!.id}/tasks`);
    const primeiroDelete = ordem.findIndex((entry) => entry.startsWith('DELETE'));
    expect(primeiroDelete).toBeGreaterThan(ultimoPost);
    // A releitura de conferencia acontece entre a ultima criacao e a primeira remocao.
    expect(
      ordem
        .slice(ultimoPost + 1, primeiroDelete)
        .includes(`GET /api/cards/${CARDS[0]!.id}`),
    ).toBe(true);

    expect(output).toContain('nova A');
    // Devolve o texto integral do que foi removido, para caber num comentario.
    expect(output).toContain('- [x] definir ROI');
    expect(output).toContain('- [ ] avaliar em video real');
    // As duas antigas foram apagadas, e so elas.
    const apagadas = fake.calls.filter((c) => c.method === 'DELETE').map((c) => pathOf(c));
    expect(apagadas).toEqual([`/api/tasks/${TASKS[0]!.id}`, `/api/tasks/${TASKS[1]!.id}`]);
  });

  it('task criada que nao aparece na releitura aborta antes de apagar', async () => {
    const { ctx, fake } = setup((call) => {
      const path = pathOf(call);
      if (call.method === 'POST' && path === `/api/cards/${CARDS[0]!.id}/tasks`) {
        const body = call.body as { name: string; position: number };
        return { body: json({ item: { id: '1852000000000000999', ...body, cardId: CARDS[0]!.id } }) };
      }
      return readOnlyServer(call); // a releitura devolve so as tasks antigas
    });

    const error = await run(
      'kanban_replace_tasks',
      { card: 'E08-IA-006', tasks: ['fantasma'], dry_run: false },
      ctx,
    ).catch((e) => e);

    expect(error.message).toContain('nao aparecem na releitura');
    expect(error.message).toContain('Nada foi apagado');
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('escrita conferida contra o pedido', () => {
  it('campo descartado pelo servidor vira erro, nao sucesso', async () => {
    const { ctx } = setup((call) => {
      const path = pathOf(call);
      if (call.method === 'PATCH' && path === `/api/cards/${CARDS[0]!.id}`) {
        // O servidor responde 200 mas ignora o campo.
        return { body: json({ item: { ...CARDS[0], name: 'E08-IA-006 Pipeline de rPPG' } }) };
      }
      return readOnlyServer(call);
    });

    await expect(
      run('kanban_update_card', { card: 'E08-IA-006', name: 'nome novo', dry_run: false }, ctx),
    ).rejects.toBeInstanceOf(WriteVerificationError);
  });

  it('escrita que pega de verdade devolve os campos confirmados', async () => {
    const { ctx } = setup((call) => {
      const path = pathOf(call);
      if (call.method === 'PATCH' && path === `/api/cards/${CARDS[0]!.id}`) {
        return { body: json({ item: { ...CARDS[0], ...(call.body as object) } }) };
      }
      return readOnlyServer(call);
    });

    const output = await run(
      'kanban_update_card',
      { card: 'E08-IA-006', name: 'nome novo', dry_run: false },
      ctx,
    );
    expect(output).toContain('camposConfirmados');
    expect(output).toContain('nome novo');
  });
});

describe('leitura compacta (invariante 5)', () => {
  it('get_board nao devolve descricao por padrao', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run('kanban_get_board', {}, ctx);
    expect(output).not.toContain('texto gerado por IA');
    expect(output).toContain('"tasks":"1/2"');
    expect(output).toContain('E08-IA-006');
  });

  it('get_board filtra por lista sem pedir nada a mais ao servidor', async () => {
    const { ctx, fake } = setup(readOnlyServer);
    const output = await run('kanban_get_board', { list: 'Backlog' }, ctx);
    expect(output).toContain('E03-APP-005');
    expect(output).not.toContain('E08-IA-006 Pipeline');
    expect(fake.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });

  it('o cache poupa a segunda leitura do board', async () => {
    const { ctx, fake } = setup(readOnlyServer);
    await run('kanban_get_board', {}, ctx);
    await run('kanban_find_cards', { query: 'E03' }, ctx);
    expect(fake.calls.filter((c) => pathOf(c) === `/api/boards/${BOARD_ID}`)).toHaveLength(1);
  });

  it('escrita invalida o cache do board', async () => {
    const { ctx, fake } = setup((call) => {
      const path = pathOf(call);
      if (call.method === 'PATCH' && path === `/api/cards/${CARDS[0]!.id}`) {
        return { body: json({ item: { ...CARDS[0], ...(call.body as object) } }) };
      }
      return readOnlyServer(call);
    });
    await run('kanban_get_board', {}, ctx);
    await run('kanban_update_card', { card: 'E08-IA-006', name: 'x', dry_run: false }, ctx);
    expect(
      fake.calls.filter((c) => pathOf(c) === `/api/boards/${BOARD_ID}`).length,
    ).toBeGreaterThan(1);
  });

  it('find_cards acha por texto na descricao e ordena por aderencia', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run('kanban_find_cards', { query: 'RF: 12' }, ctx);
    expect(output).toContain('E08-IA-006');
  });
});
