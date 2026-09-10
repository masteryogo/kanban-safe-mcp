import type { KanbanClient } from './client.js';
import { getBoard } from './api/boards.js';
import type { BoardPayload } from './types.js';

/**
 * Cache curto do board (invariante 6).
 *
 * Uma leitura custa ~700 ms e ~735 KB, e e ela que torna baratas a resolucao por codigo
 * e a busca. TTL curto e invalidacao explicita apos qualquer escrita no board.
 */
interface Entry {
  payload: BoardPayload;
  fetchedAtMs: number;
}

export class BoardCache {
  private entries = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<BoardPayload>>();

  constructor(
    private readonly client: KanbanClient,
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(boardId: string, options: { refresh?: boolean } = {}): Promise<BoardPayload> {
    if (!options.refresh) {
      const entry = this.entries.get(boardId);
      if (entry && this.now() - entry.fetchedAtMs < this.ttlMs) return entry.payload;
    }
    // Chamadas concorrentes ao mesmo board compartilham uma unica requisicao.
    const pending = this.inFlight.get(boardId);
    if (pending && !options.refresh) return pending;

    const request = getBoard(this.client, boardId)
      .then((payload) => {
        this.entries.set(boardId, { payload, fetchedAtMs: this.now() });
        return payload;
      })
      .finally(() => {
        this.inFlight.delete(boardId);
      });
    this.inFlight.set(boardId, request);
    return request;
  }

  /** Chamar depois de toda escrita: o board em cache passou a estar desatualizado. */
  invalidate(boardId?: string): void {
    if (boardId) this.entries.delete(boardId);
    else this.entries.clear();
  }

  /** Idade do cache em ms, ou undefined se nao houver entrada. */
  ageMs(boardId: string): number | undefined {
    const entry = this.entries.get(boardId);
    return entry ? this.now() - entry.fetchedAtMs : undefined;
  }
}
