import type { KanbanClient } from '../client.js';
import { requireItem, type CardLabel } from '../types.js';

/** Cores aceitas por este servidor: 25, verificado contra o servidor. */
export const LABEL_COLORS = [
  'berry-red', 'pumpkin-orange', 'lagoon-blue', 'pink-tulip', 'light-mud',
  'orange-peel', 'bright-moss', 'antique-blue', 'dark-granite', 'lagune-blue',
  'sunny-grass', 'morning-sky', 'light-orange', 'midnight-blue', 'tank-green',
  'gun-metal', 'wet-moss', 'red-burgundy', 'light-concrete', 'apricot-red',
  'desert-sand', 'navy-blue', 'egg-yellow', 'coral-green', 'light-cocoa',
] as const;

/** `POST /api/cards/:id/labels` — a rota 2.0 `/card-labels` devolve 404 aqui. */
export async function addCardLabel(
  client: KanbanClient,
  cardId: string,
  labelId: string,
): Promise<CardLabel> {
  const payload = await client.post(`/api/cards/${cardId}/labels`, { labelId });
  return requireItem<CardLabel>(payload, 'vinculo card-label');
}

export async function removeCardLabel(
  client: KanbanClient,
  cardId: string,
  labelId: string,
): Promise<void> {
  await client.delete(`/api/cards/${cardId}/labels/${labelId}`);
}
