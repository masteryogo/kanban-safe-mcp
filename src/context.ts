import { BoardCache } from './cache.js';
import { KanbanClient } from './client.js';
import type { Config } from './config.js';
import { ConfigError, ReadOnlyError, UnresolvedReferenceError } from './errors.js';
import { BoardIndex, renderJson } from './format.js';
import {
  looksLikeId,
  resolveCard,
  resolveLabel,
  resolveList,
  resolveTaskIn,
  resolveUser,
} from './resolve.js';
import { getCard } from './api/cards.js';
import type { BoardPayload, Card, Label, List, Task, User } from './types.js';

/**
 * Estado compartilhado pelas ferramentas: cliente HTTP, cache de board e as
 * resolucoes de referencia. Nenhuma ferramenta fala com o servidor por fora daqui.
 */
export class Context {
  readonly client: KanbanClient;
  readonly cache: BoardCache;

  constructor(
    readonly config: Config,
    client?: KanbanClient,
  ) {
    this.client = client ?? new KanbanClient(config);
    this.cache = new BoardCache(this.client, config.cacheTtlMs);
  }

  /** `boardId` explicito, senao KANBAN_SAFE_DEFAULT_BOARD_ID. */
  boardId(explicit?: string): string {
    const id = explicit?.trim() || this.config.defaultBoardId;
    if (!id) {
      throw new ConfigError(
        'nao sei em qual board operar: passe `boardId` na chamada ou defina ' +
          'KANBAN_SAFE_DEFAULT_BOARD_ID.',
      );
    }
    return id;
  }

  board(explicit?: string, options: { refresh?: boolean } = {}): Promise<BoardPayload> {
    return this.cache.get(this.boardId(explicit), options);
  }

  async index(explicit?: string, options: { refresh?: boolean } = {}): Promise<BoardIndex> {
    return new BoardIndex(await this.board(explicit, options));
  }

  /**
   * Aceita id ou codigo/prefixo de nome. Id que nao esta no board e buscado direto,
   * para nao exigir que o card pertenca ao board padrao.
   */
  async resolveCard(ref: string, boardId?: string): Promise<Card> {
    const board = await this.board(boardId);
    if (looksLikeId(ref)) {
      const known = board.cards.find((c) => c.id === ref.trim());
      if (known) return known;
      return (await getCard(this.client, ref.trim())).item;
    }
    return resolveCard(board, ref);
  }

  async resolveList(ref: string, boardId?: string): Promise<List> {
    return resolveList(await this.board(boardId), ref);
  }

  async resolveLabel(ref: string, boardId?: string): Promise<Label> {
    return resolveLabel(await this.board(boardId), ref);
  }

  /** Pessoa do board por id, e-mail, username ou nome. */
  async resolveUser(ref: string, boardId?: string): Promise<User> {
    return resolveUser(await this.board(boardId), ref);
  }

  /**
   * Task por id, ou por nome dentro de um card. Nao ha `GET /api/tasks/:id` neste
   * servidor: a task so aparece dentro do board ou do card, entao a busca e no cache.
   */
  async resolveTask(
    ref: { taskId?: string; card?: string; task?: string },
    boardId?: string,
  ): Promise<{ task: Task; card?: Card }> {
    const board = await this.board(boardId);
    if (ref.taskId) {
      const id = ref.taskId.trim();
      let task = board.tasks.find((t) => t.id === id);
      if (!task) {
        // Pode ser uma task criada depois da ultima leitura: rele o board uma vez.
        const fresh = await this.board(boardId, { refresh: true });
        task = fresh.tasks.find((t) => t.id === id);
      }
      if (!task) {
        throw new UnresolvedReferenceError(
          'task',
          id,
          'nenhuma task com esse id neste board; confira com kanban_get_card.',
        );
      }
      return { task, card: board.cards.find((c) => c.id === task!.cardId) };
    }
    if (!ref.card || !ref.task) {
      throw new ConfigError('informe `taskId`, ou entao `card` e `task` (o nome da task).');
    }
    const card = await this.resolveCard(ref.card, boardId);
    const tasks = board.tasks.filter((t) => t.cardId === card.id);
    return { task: resolveTaskIn(tasks, ref.task), card };
  }

  /** Barreira de KANBAN_SAFE_READ_ONLY, checada antes de qualquer escrita. */
  assertWritable(tool: string): void {
    if (this.config.readOnly) throw new ReadOnlyError(tool);
  }

  /** Toda escrita deixa o board em cache desatualizado. */
  invalidate(boardId?: string): void {
    this.cache.invalidate(boardId ? boardId : undefined);
  }
}

/**
 * Texto de `dry_run` (invariante 8): rota, corpo e o estado atual do que
 * seria sobrescrito, sem tocar no servidor.
 */
export function previewWrite(steps: Array<{
  method: string;
  path: string;
  body?: unknown;
  current?: unknown;
  note?: string;
}>): string {
  const lines = ['DRY RUN — nada foi enviado ao servidor.', ''];
  steps.forEach((step, i) => {
    lines.push(`${steps.length > 1 ? `${i + 1}. ` : ''}${step.method} ${step.path}`);
    if (step.body !== undefined) lines.push(`   corpo: ${renderJson(step.body, 3)}`);
    if (step.current !== undefined) lines.push(`   estado atual: ${renderJson(step.current, 3)}`);
    if (step.note) lines.push(`   nota: ${step.note}`);
    lines.push('');
  });
  lines.push('Repita com dry_run: false para executar.');
  return lines.join('\n');
}
