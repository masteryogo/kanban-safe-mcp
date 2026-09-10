import type { KanbanClient } from '../client.js';
import { includedArray, requireItem, type Action, type User } from '../types.js';

export interface ActionsPayload {
  items: Action[];
  users: User[];
}

/** Comentario vive em `/actions`, com `type === "commentCard"` e texto em `data.text`. */
export async function listActions(client: KanbanClient, cardId: string): Promise<ActionsPayload> {
  const payload = await client.get(`/api/cards/${cardId}/actions`);
  const items = (payload as { items?: unknown })?.items;
  return {
    items: Array.isArray(items) ? (items as Action[]) : [],
    users: includedArray<User>(payload, 'users'),
  };
}

/**
 * `POST /api/cards/:id/comment-actions` — a rota 2.0 `/comments` devolve 404 aqui.
 * `noRetry`: repetir por timeout publicaria o comentario duas vezes num board
 * compartilhado (invariante 11).
 */
export async function addComment(
  client: KanbanClient,
  cardId: string,
  text: string,
): Promise<Action> {
  const payload = await client.post(
    `/api/cards/${cardId}/comment-actions`,
    { text },
    { noRetry: true },
  );
  return requireItem<Action>(payload, 'comentario');
}
