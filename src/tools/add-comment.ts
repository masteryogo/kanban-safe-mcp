import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { addComment } from '../api/comments.js';
import { previewWrite } from '../context.js';
import { renderJson } from '../format.js';

export const addCommentTool = defineTool({
  name: 'kanban_add_comment',
  title: 'Comentar num card',
  description:
    'Publica um comentario, em markdown. O board e compartilhado com outras pessoas e ' +
    'comentario publicado nao se recolhe — mostre o texto com dry_run e confirme antes ' +
    'de enviar. Para CORRIGIR um ja publicado use kanban_update_comment, em vez de ' +
    'publicar uma segunda versao do mesmo recado. Remocao, essa sim, o servidor nao ' +
    'expoe. A chamada nunca e repetida automaticamente, para nao duplicar publicacao.',
  write: true,
  schema: {
    card: cardField,
    text: z.string().min(1).describe('Texto do comentario, em markdown.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_add_comment');
    const current = await ctx.resolveCard(args.card, args.boardId);
    const path = `/api/cards/${current.id}/comment-actions`;

    if (args.dry_run) {
      return previewWrite([
        {
          method: 'POST',
          path,
          body: { text: args.text },
          current: { card: current.name },
          note:
            'depois de publicado o comentario pode ser corrigido com kanban_update_comment, ' +
            'mas NAO pode ser apagado — o servidor nao expoe remocao',
        },
      ]);
    }

    const action = await addComment(ctx.client, current.id, args.text);
    return renderJson({
      publicado: { id: action.id, at: action.createdAt, card: current.name },
      rota: `POST ${path}`,
    });
  },
});
