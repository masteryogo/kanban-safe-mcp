import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { updateCard } from '../api/cards.js';
import { previewWrite } from '../context.js';
import { compactCard, renderJson } from '../format.js';
import { endPosition } from '../position.js';

export const moveCardTool = defineTool({
  name: 'kanban_move_card',
  title: 'Mover card de lista',
  description:
    'Move um card para outra lista. Mover e trocar `listId` e `position` no mesmo PATCH; ' +
    'sem `position`, o card entra no fim da lista de destino.',
  write: true,
  schema: {
    card: cardField,
    list: z.string().describe('Lista de destino: id ou nome, ex.: "In progress".'),
    position: z.number().optional().describe('Omitido, vai para o fim da lista de destino.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_move_card');
    const board = await ctx.board(args.boardId);
    const current = await ctx.resolveCard(args.card, args.boardId);
    const target = await ctx.resolveList(args.list, args.boardId);

    const destino = board.cards.filter((c) => c.listId === target.id);
    const body: Record<string, unknown> = {
      listId: target.id,
      position: args.position ?? endPosition(destino),
    };

    const path = `/api/cards/${current.id}`;
    const origem = board.lists.find((l) => l.id === current.listId);
    if (args.dry_run) {
      return previewWrite([
        {
          method: 'PATCH',
          path,
          body,
          current: { name: current.name, list: origem?.name, listId: current.listId },
          note: `"${target.name}" tem hoje ${destino.length} cards`,
        },
      ]);
    }

    const updated = await updateCard(ctx.client, current.id, body);
    ctx.invalidate(ctx.boardId(args.boardId));
    const index = await ctx.index(args.boardId, { refresh: true });
    return renderJson({
      movido: compactCard(index, updated),
      de: origem?.name,
      para: target.name,
      rota: `PATCH ${path}`,
    });
  },
});
