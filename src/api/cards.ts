import type { KanbanClient } from '../client.js';
import { assertWrite } from '../verify.js';
import {
  includedArray,
  requireItem,
  type Attachment,
  type Card,
  type CardLabel,
  type CardMembership,
  type Task,
} from '../types.js';

export interface CardPayload {
  item: Card;
  tasks: Task[];
  cardLabels: CardLabel[];
  cardMemberships: CardMembership[];
  attachments: Attachment[];
}

/** `GET /api/cards/:id` — nao traz comentario nenhum; use `actions`. */
export async function getCard(client: KanbanClient, cardId: string): Promise<CardPayload> {
  const payload = await client.get(`/api/cards/${cardId}`);
  return {
    item: requireItem<Card>(payload, 'card'),
    tasks: includedArray<Task>(payload, 'tasks'),
    cardLabels: includedArray<CardLabel>(payload, 'cardLabels'),
    cardMemberships: includedArray<CardMembership>(payload, 'cardMemberships'),
    attachments: includedArray<Attachment>(payload, 'attachments'),
  };
}

export async function createCard(
  client: KanbanClient,
  listId: string,
  body: Record<string, unknown>,
): Promise<Card> {
  const path = `/api/lists/${listId}/cards`;
  const payload = await client.post(path, body);
  const item = requireItem<Card>(payload, 'card');
  assertWrite('POST', path, body, item, ['position']);
  return item;
}

export async function updateCard(
  client: KanbanClient,
  cardId: string,
  body: Record<string, unknown>,
): Promise<Card> {
  const path = `/api/cards/${cardId}`;
  const payload = await client.patch(path, body);
  const item = requireItem<Card>(payload, 'card');
  assertWrite('PATCH', path, body, item, ['position']);
  return item;
}

export async function deleteCard(client: KanbanClient, cardId: string): Promise<void> {
  await client.delete(`/api/cards/${cardId}`);
}
