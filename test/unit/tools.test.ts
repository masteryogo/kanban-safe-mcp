import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { KanbanClient } from '../../src/client.js';
import { Context } from '../../src/context.js';
import { ReadOnlyError, WriteVerificationError } from '../../src/errors.js';
import { TOOLS } from '../../src/tools/index.js';
import type { ToolDef } from '../../src/tools/tool.js';
import { BOARD_ID, CARDS, TASKS, USERS, boardPayload, cardPayload } from './fixtures.js';
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
  it('sao 15, todas com prefixo kanban_ e nome unico', () => {
    expect(TOOLS).toHaveLength(15);
    expect(TOOLS.every((t) => t.name.startsWith('kanban_'))).toBe(true);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(15);
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
  if ('commentId' in def.schema) args.commentId = '1860000000000000001';
  return args;
}

describe('dry_run (invariante 8)', () => {
  const writeCases: Array<[string, Record<string, unknown>]> = [
    ['kanban_create_card', { list: 'ToDo', name: 'E08-IA-009 Novo' }],
    ['kanban_update_card', { card: 'E08-IA-006', name: 'outro nome' }],
    ['kanban_move_card', { card: 'E08-IA-006', list: 'In progress' }],
    ['kanban_add_comment', { card: 'E08-IA-006', text: 'oi' }],
    ['kanban_update_comment', { commentId: '1860000000000000001', text: 'corrigido' }],
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

  it('comentario avisa que da para corrigir, mas nao apagar', async () => {
    // Antes este teste travava a palavra "append-only". Medido em 12/09/2026 contra o
    // servidor real: `PATCH /api/comment-actions/:id` responde 200 e altera o texto —
    // a afirmacao era suposicao. Remocao, essa sim, o servidor nao expoe.
    const { ctx } = setup(readOnlyServer);
    const output = await run('kanban_add_comment', { card: 'E08-IA-006', text: 'oi' }, ctx);
    expect(output).toContain('kanban_update_comment');
    expect(output).toContain('NAO pode ser apagado');
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

describe('editar comentario', () => {
  const COMMENT_ID = '1860000000000000009';
  const cardActions = (text: string) => ({
    items: [
      {
        id: COMMENT_ID,
        type: 'commentCard',
        userId: '2',
        createdAt: '2026-09-12T17:00:00.000Z',
        data: { text },
      },
    ],
    included: { users: USERS },
  });

  function server(patchReply?: (body: unknown) => Reply) {
    return (call: Call): Reply => {
      const path = pathOf(call);
      if (call.method === 'GET' && path === `/api/boards/${BOARD_ID}`) {
        return { body: json(boardPayload()) };
      }
      if (call.method === 'GET' && /^\/api\/cards\/\d+\/actions$/.test(path)) {
        return { body: json(cardActions('texto antigo')) };
      }
      if (call.method === 'PATCH' && path === `/api/comment-actions/${COMMENT_ID}`) {
        if (patchReply) return patchReply(call.body);
        const enviado = (call.body as { text?: string })?.text ?? '';
        return {
          body: json({
            item: { id: COMMENT_ID, updatedAt: '2026-09-12T18:00:00.000Z', data: { text: enviado } },
          }),
        };
      }
      throw new Error(`chamada inesperada: ${call.method} ${path}`);
    };
  }

  it('dry_run mostra o texto ATUAL, porque ele se perde ao editar', async () => {
    const { ctx, fake } = setup(server());
    const out = await run(
      'kanban_update_comment',
      { commentId: COMMENT_ID, card: 'E08-IA-006', text: '## novo' },
      ctx,
    );
    expect(out).toContain('DRY RUN');
    expect(out).toContain('texto antigo');
    expect(out).toContain(`PATCH /api/comment-actions/${COMMENT_ID}`);
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('sem `card`, o dry_run avisa que nao consegue mostrar o texto atual', async () => {
    const { ctx } = setup(server());
    const out = await run('kanban_update_comment', { commentId: COMMENT_ID, text: 'x' }, ctx);
    expect(out).toContain('DRY RUN');
    expect(out).toMatch(/passe .card./);
  });

  it('id que nao existe no card falha nomeando onde procurar', async () => {
    const { ctx } = setup(server());
    await expect(
      run(
        'kanban_update_comment',
        { commentId: '1860000000000000099', card: 'E08-IA-006', text: 'x' },
        ctx,
      ),
    ).rejects.toThrow(/kanban_get_comments/);
  });

  it('com dry_run false edita e confirma que o texto voltou igual', async () => {
    const { ctx, fake } = setup(server());
    const out = await run(
      'kanban_update_comment',
      { commentId: COMMENT_ID, text: '## titulo\n\ncorpo', dry_run: false },
      ctx,
    );
    expect(out).toMatch(/"confere":\s*true/);
    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect((patch?.body as { text?: string })?.text).toBe('## titulo\n\ncorpo');
  });

  it('servidor que devolve texto diferente do enviado levanta alerta', async () => {
    // write-then-verify (invariante 9): campo descartado em silencio tem que aparecer.
    const { ctx } = setup(
      server(() => ({
        body: json({
          item: { id: COMMENT_ID, updatedAt: '2026-09-12T18:00:00.000Z', data: { text: 'truncado' } },
        }),
      })),
    );
    const out = await run(
      'kanban_update_comment',
      { commentId: COMMENT_ID, text: 'texto completo que o servidor cortou', dry_run: false },
      ctx,
    );
    expect(out).toMatch(/"confere":\s*false/);
    expect(out).toContain('alerta');
  });
});

describe('membros do card', () => {
  it('get_board mostra members em quem tem e omite em quem nao tem', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run('kanban_get_board', {}, ctx);
    // CARDS[1] tem a Melchisedek Lima; CARDS[0] (E08-IA-006) nao tem membro.
    expect(output).toContain('Melchisedek Lima');
    const linhaSemMembro = output
      .split('\n')
      .find((line) => line.includes('E08-IA-006') && line.includes('"id"'));
    expect(linhaSemMembro).toBeDefined();
    expect(linhaSemMembro).not.toContain('members');
  });

  it('get_board filtra por member por username, e-mail e nome completo', async () => {
    const { ctx } = setup(readOnlyServer);
    for (const ref of ['melchisedek', 'melk@exemplo.com', 'Melchisedek Lima']) {
      const output = await run('kanban_get_board', { member: ref }, ctx);
      expect(output, `referencia ${ref}`).toContain('E03-APP-005');
      expect(output, `referencia ${ref}`).not.toContain('E08-IA-006');
      expect(output, `referencia ${ref}`).toContain('"totalFiltrado": 1');
    }
  });

  it('referencia ambigua de pessoa falha sem escolher sozinha', async () => {
    const { ctx } = setup(readOnlyServer);
    // "Mel" e prefixo de dois usernames do board: melchisedek e melsouza.
    await expect(run('kanban_get_board', { member: 'Mel' }, ctx)).rejects.toThrow(
      /Melchisedek Souza|ambig/i,
    );
  });

  it('username exato ganha de prefixo que casaria com mais de uma pessoa', async () => {
    const { ctx } = setup(readOnlyServer);
    // "melchisedek" e prefixo do nome da Souza, mas e o username EXATO da Lima:
    // o tier de igualdade resolve antes de chegar no de prefixo.
    const output = await run('kanban_get_board', { member: 'melchisedek' }, ctx);
    expect(output).toMatch(/"member":\s*"Melchisedek Lima"/);
    expect(output).not.toContain('Melchisedek Souza');
  });

  it('pessoa inexistente falha nomeando quem existe no board', async () => {
    const { ctx } = setup(readOnlyServer);
    await expect(run('kanban_get_board', { member: 'ninguem' }, ctx)).rejects.toThrow(
      /melchisedek/i,
    );
  });

  it('vinculo orfo vira o proprio userId, sem derrubar a leitura', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run('kanban_get_board', { member: 'melchisedek' }, ctx);
    // CARDS[1] tem tambem o vinculo orfo userId 999, sem usuario correspondente.
    expect(output).toContain('999');
  });

  it('find_cards restringe a busca aos cards da pessoa', async () => {
    const { ctx } = setup(readOnlyServer);
    const semFiltro = await run('kanban_find_cards', { query: 'Tela' }, ctx);
    expect(semFiltro).toContain('E03-APP-005');
    expect(semFiltro).toContain('E03-APP-006');

    const comFiltro = await run('kanban_find_cards', { query: 'Tela', member: 'melchisedek' }, ctx);
    expect(comFiltro).toContain('E03-APP-005');
    expect(comFiltro).not.toContain('E03-APP-006');
  });

  it('get_card lista os membros vindos do proprio card', async () => {
    const { ctx } = setup(readOnlyServer);
    const output = await run('kanban_get_card', { card: 'E03-APP-005' }, ctx);
    expect(output).toContain('membros');
    expect(output).toContain('Melchisedek Lima');
  });

  it('usuario com username null no board nao derruba a resolucao', async () => {
    const { ctx } = setup(readOnlyServer);
    // Regressao: `username: null` passava pela guarda `!== undefined` e
    // estourava TypeError ao chamar .trim() na varredura de candidatos.
    const output = await run('kanban_get_board', { member: 'melchisedek' }, ctx);
    expect(output).toContain('E03-APP-005');
  });

  it('pessoa com username null ainda resolve pelo nome', async () => {
    const { ctx } = setup(readOnlyServer);
    await expect(run('kanban_get_board', { member: 'Robo Integrador' }, ctx)).resolves.toContain(
      '"totalFiltrado": 0',
    );
  });

  it('board sem cardMemberships no payload nao quebra', async () => {
    const { ctx } = setup((call) => {
      const path = pathOf(call);
      if (call.method === 'GET' && path === `/api/boards/${BOARD_ID}`) {
        const payload = boardPayload() as unknown as { included: Record<string, unknown> };
        delete payload.included.cardMemberships;
        return { body: json(payload) };
      }
      throw new Error(`chamada inesperada: ${call.method} ${path}`);
    });
    const output = await run('kanban_get_board', {}, ctx);
    expect(output).toContain('E08-IA-006');
    expect(output).not.toContain('members');
  });
});
