import { z } from 'zod';
import { boardIdField, cardField, defineTool } from './tool.js';
import { listActions } from '../api/comments.js';
import { compactComment, renderJson } from '../format.js';

export const getComments = defineTool({
  name: 'kanban_get_comments',
  title: 'Ler comentarios de um card',
  description:
    'Comentarios de um card, do historico de acoes (`type: commentCard`). O card em si nao ' +
    'traz comentario. Nao se sabe se a rota pagina — se `total` bater no limite do servidor, ' +
    'trate a lista como possivelmente truncada.',
  schema: {
    card: cardField,
    boardId: boardIdField,
    limit: z.number().int().min(1).max(100).default(20),
    includeOtherActions: z
      .boolean()
      .default(false)
      .describe('Inclui tambem acoes que nao sao comentario (mover card, etc.).'),
  },
  async handler(args, ctx) {
    const resolved = await ctx.resolveCard(args.card, args.boardId);
    const { items, users } = await listActions(ctx.client, resolved.id);
    const comments = items.filter((a) => a.type === 'commentCard');

    return renderJson({
      card: { id: resolved.id, name: resolved.name },
      totalComentarios: comments.length,
      comentarios: comments.slice(0, args.limit).map((a) => compactComment(a, users)),
      outrasAcoes: args.includeOtherActions
        ? items
            .filter((a) => a.type !== 'commentCard')
            .slice(0, args.limit)
            .map((a) => ({ id: a.id, type: a.type, at: a.createdAt }))
        : undefined,
    });
  },
});
