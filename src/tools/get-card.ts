import { z } from 'zod';
import { boardIdField, cardField, defineTool } from './tool.js';
import { getCard } from '../api/cards.js';
import { listActions } from '../api/comments.js';
import { CONTENT_CAVEAT, compactComment, compactTask, renderJson } from '../format.js';

export const getCardTool = defineTool({
  name: 'kanban_get_card',
  title: 'Ler um card',
  description:
    'Um card com descricao integral, checklist (com o id de cada task, necessario para ' +
    'kanban_update_task) e labels. Comentarios so com `includeComments: true`, porque vem ' +
    'de uma segunda chamada — o card em si nao os traz.',
  schema: {
    card: cardField,
    boardId: boardIdField,
    includeComments: z.boolean().default(false),
    commentLimit: z.number().int().min(1).max(100).default(20),
  },
  async handler(args, ctx) {
    const resolved = await ctx.resolveCard(args.card, args.boardId);
    const { item, tasks } = await getCard(ctx.client, resolved.id);
    const index = await ctx.index(args.boardId);

    const ordered = [...tasks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const out: Record<string, unknown> = {
      id: item.id,
      name: item.name,
      list: index.listNameOf(item.listId),
      listId: item.listId,
      labels: index.labelsOf(item.id),
      dueDate: item.dueDate ?? undefined,
      isDueDateCompleted: item.isDueDateCompleted ?? undefined,
      description: item.description ?? '',
      tasks: ordered.map(compactTask),
      progresso: ordered.length
        ? `${ordered.filter((t) => t.isCompleted).length}/${ordered.length}`
        : undefined,
    };

    if (args.includeComments) {
      const { items, users } = await listActions(ctx.client, item.id);
      const comments = items.filter((a) => a.type === 'commentCard');
      out.comentarios = comments.slice(0, args.commentLimit).map((a) => compactComment(a, users));
      out.totalComentarios = comments.length;
    }

    out.nota = CONTENT_CAVEAT;
    return renderJson(out);
  },
});
