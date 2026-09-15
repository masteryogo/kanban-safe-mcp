import type { KanbanClient } from '../client.js';
import { requireItem, type CardMembership } from '../types.js';

/**
 * Vinculo pessoa <-> card.
 *
 * A rota do DELETE **nao** segue a forma do label, e isso nao e detalhe: em
 * `/api/cards/:id/labels/:labelId` o alvo vai no caminho, e aqui o `userId` fica
 * fora dele. Nas rotas da 1.x:
 *
 *     POST   /api/cards/:cardId/memberships   -> `card-memberships/create`
 *     DELETE /api/cards/:cardId/memberships   -> `card-memberships/delete`
 *
 * Os dois controladores declaram `cardId` e `userId` como entradas obrigatorias,
 * e devolvem `{ item }` com o vinculo criado ou removido. Como o cliente daqui
 * nao manda corpo em DELETE — e cliente HTTP que manda corpo em DELETE e fonte
 * de surpresa —, o `userId` vai na query string, que e de onde o Sails le
 * parametro que nao esta no caminho.
 */
export async function addCardMember(
  client: KanbanClient,
  cardId: string,
  userId: string,
): Promise<CardMembership> {
  const payload = await client.post(`/api/cards/${cardId}/memberships`, { userId });
  return requireItem<CardMembership>(payload, 'vinculo card-pessoa');
}

export async function removeCardMember(
  client: KanbanClient,
  cardId: string,
  userId: string,
): Promise<void> {
  await client.delete(
    `/api/cards/${cardId}/memberships?userId=${encodeURIComponent(userId)}`,
  );
}
