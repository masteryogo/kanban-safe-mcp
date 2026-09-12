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

/**
 * `PATCH /api/comment-actions/:id` — edita o texto de um comentario ja publicado.
 *
 * **O servidor ACEITA esta rota.** Medido em 12/09/2026 contra o servidor real: 200 com
 * `application/json` e o `item` atualizado, `updatedAt` novo. A afirmacao anterior de que
 * este servidor era append-only em comentario era suposicao e nao medicao — o Planka 1.x
 * edita comentario proprio pela propria interface, e a API expoe isso.
 *
 * Quem pode editar e o AUTOR. Editar comentario alheio o servidor recusa, e a mensagem
 * dele e repassada como vem (invariante 11).
 *
 * `noRetry` por consistencia com o POST: o board e compartilhado e a escrita e de texto
 * longo. PATCH e idempotente por natureza, entao aqui o risco e menor que no POST — mas
 * nao ha ganho em repetir automaticamente.
 */
export async function updateComment(
  client: KanbanClient,
  commentId: string,
  text: string,
): Promise<Action> {
  const payload = await client.patch(
    `/api/comment-actions/${commentId}`,
    { text },
    { noRetry: true },
  );
  return requireItem<Action>(payload, 'comentario');
}
