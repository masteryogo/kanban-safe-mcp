/**
 * Testes de contrato contra o servidor real.
 *
 * Rodam so com KANBAN_SAFE_E2E=1. A leitura e inofensiva. O ciclo de escrita e o unico
 * jeito de exercitar as rotas de DELETE e por isso exige um segundo
 * consentimento explicito: KANBAN_SAFE_E2E_WRITE_LIST com o nome da lista descartavel
 * combinada com o dono do board. O card criado e apagado no fim, com ou sem falha.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KanbanClient } from '../../src/client.js';
import { loadConfig } from '../../src/config.js';
import { Context } from '../../src/context.js';
import { getBoard, getMe, listProjects } from '../../src/api/boards.js';
import { createCard, deleteCard, getCard, updateCard } from '../../src/api/cards.js';
import { addComment, listActions } from '../../src/api/comments.js';
import { createTask, deleteTask, updateTask } from '../../src/api/tasks.js';
import { addCardLabel, removeCardLabel } from '../../src/api/labels.js';
import { RouteNotFoundError } from '../../src/errors.js';
import { endPosition } from '../../src/position.js';

const enabled = process.env.KANBAN_SAFE_E2E === '1';
const writeList = process.env.KANBAN_SAFE_E2E_WRITE_LIST?.trim();

const suite = enabled ? describe : describe.skip;

suite('contrato: leitura', () => {
  const config = enabled ? loadConfig() : null;
  const client = config ? new KanbanClient(config) : null;

  it('GET /api/users/me devolve o usuario autenticado', async () => {
    const me = await getMe(client!);
    expect(me.id).toMatch(/^\d+$/);
    expect(typeof me.email).toBe('string');
  });

  it('GET /api/projects devolve items e boards em included', async () => {
    const { projects, boards } = await listProjects(client!);
    expect(projects.length).toBeGreaterThan(0);
    expect(boards.length).toBeGreaterThan(0);
  });

  it('GET /api/boards/:id devolve lists, cards e tasks — e nenhum taskLists', async () => {
    const board = await getBoard(client!, config!.defaultBoardId!);
    expect(board.lists.length).toBeGreaterThan(0);
    expect(board.cards.length).toBeGreaterThan(0);
    // Confirma a 1.x: task pendura no card, sem taskListId.
    for (const task of board.tasks.slice(0, 20)) {
      expect(task.cardId).toBeTruthy();
      expect(task).not.toHaveProperty('taskListId');
    }
    expect(client!.flavor).toBe('v1');
  });

  it('GET /api/cards/:id nao traz comentario; /actions traz', async () => {
    const board = await getBoard(client!, config!.defaultBoardId!);
    const card = board.cards[0]!;
    const detail = await getCard(client!, card.id);
    expect(detail.item.id).toBe(card.id);
    expect(detail.item).not.toHaveProperty('type'); // campo da 2.0
    const actions = await listActions(client!, card.id);
    expect(Array.isArray(actions.items)).toBe(true);
  });

  it('rota inexistente (200 com HTML) vira RouteNotFoundError, nao SyntaxError', async () => {
    await expect(client!.get('/api/cards/1/task-lists')).rejects.toBeInstanceOf(
      RouteNotFoundError,
    );
    await expect(client!.get('/api/nope')).rejects.toBeInstanceOf(RouteNotFoundError);
  });

  it('id inexistente numa rota que existe devolve 404 JSON, nao HTML', async () => {
    const error = await client!.get('/api/cards/1000000000000000000').catch((e) => e);
    expect(error).not.toBeInstanceOf(RouteNotFoundError);
    expect(error.message).toContain('recurso nao encontrado');
  });
});

const writeSuite = enabled && writeList ? describe : describe.skip;

writeSuite('contrato: ciclo de escrita num card descartavel', () => {
  const config = enabled ? loadConfig() : null;
  let ctx: Context;
  let cardId: string | undefined;

  beforeAll(() => {
    ctx = new Context(config!);
  });

  afterAll(async () => {
    // O card descartavel nao sobrevive ao teste, mesmo se algo falhar no meio.
    if (cardId) {
      await deleteCard(ctx.client, cardId).catch(() => {});
    }
  });

  it('cria, altera, comenta, roda o checklist inteiro e apaga', async () => {
    const board = await ctx.board();
    const list = board.lists.find((l) => l.name === writeList);
    expect(list, `lista "${writeList}" nao existe neste board`).toBeTruthy();

    const marca = `kanban-safe e2e ${new Date().toISOString()}`;
    const card = await createCard(ctx.client, list!.id, {
      name: marca,
      description: 'card descartavel criado pelo teste de contrato; sera apagado no fim',
      position: endPosition(board.cards.filter((c) => c.listId === list!.id)),
    });
    cardId = card.id;
    expect(card.name).toBe(marca);

    // PATCH conferido contra o pedido
    const renamed = await updateCard(ctx.client, card.id, { name: `${marca} (alterado)` });
    expect(renamed.name).toBe(`${marca} (alterado)`);

    // comentario: rota 1.x, append-only
    const comment = await addComment(ctx.client, card.id, 'comentario do teste de contrato');
    expect(comment.id).toMatch(/^\d+$/);
    const actions = await listActions(ctx.client, card.id);
    expect(actions.items.some((a) => a.id === comment.id && a.type === 'commentCard')).toBe(true);

    // task pendura no card, com position obrigatoria
    const task = await createTask(ctx.client, card.id, { name: 'task do teste', position: 65536 });
    expect(task.cardId).toBe(card.id);
    const done = await updateTask(ctx.client, task.id, { isCompleted: true });
    expect(done.isCompleted).toBe(true);

    // label: vincular e desvincular — exercita DELETE /api/cards/:id/labels/:labelId
    const label = board.labels[0];
    if (label) {
      await addCardLabel(ctx.client, card.id, label.id);
      const comLabel = await getCard(ctx.client, card.id);
      expect(comLabel.cardLabels.some((l) => l.labelId === label.id)).toBe(true);
      await removeCardLabel(ctx.client, card.id, label.id);
      const semLabel = await getCard(ctx.client, card.id);
      expect(semLabel.cardLabels.some((l) => l.labelId === label.id)).toBe(false);
    }

    // DELETE /api/tasks/:id
    await deleteTask(ctx.client, task.id);
    const semTask = await getCard(ctx.client, card.id);
    expect(semTask.tasks.some((t) => t.id === task.id)).toBe(false);

    // DELETE /api/cards/:id
    await deleteCard(ctx.client, card.id);
    cardId = undefined;
    const error = await getCard(ctx.client, card.id).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RouteNotFoundError);
  }, 120_000);
});
