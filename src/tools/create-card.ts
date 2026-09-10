import { z } from 'zod';
import { boardIdField, defineTool, dryRunField } from './tool.js';
import { createCard } from '../api/cards.js';
import { previewWrite } from '../context.js';
import { compactCard, renderJson } from '../format.js';
import { endPosition } from '../position.js';

export const createCardTool = defineTool({
  name: 'kanban_create_card',
  title: 'Criar card',
  description:
    'Cria um card numa lista. `list` aceita id ou nome da lista. Sem `position`, entra no ' +
    'fim da lista. Comece com dry_run para conferir o texto — o board e compartilhado.',
  write: true,
  schema: {
    list: z.string().describe('Lista de destino: id ou nome, ex.: "ToDo".'),
    name: z.string().min(1).describe('Titulo do card. Inclua o codigo, ex.: "E08-IA-007 ...".'),
    description: z.string().optional(),
    position: z.number().optional().describe('Omitido, vai para o fim da lista.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_create_card');
    const board = await ctx.board(args.boardId);
    const list = await ctx.resolveList(args.list, args.boardId);

    const body: Record<string, unknown> = { name: args.name };
    body.position =
      args.position ?? endPosition(board.cards.filter((c) => c.listId === list.id));
    if (args.description !== undefined) body.description = args.description;

    const path = `/api/lists/${list.id}/cards`;
    if (args.dry_run) {
      return previewWrite([
        {
          method: 'POST',
          path,
          body,
          note: `lista "${list.name}" tem hoje ${board.cards.filter((c) => c.listId === list.id).length} cards`,
        },
      ]);
    }

    const created = await createCard(ctx.client, list.id, body);
    ctx.invalidate(ctx.boardId(args.boardId));
    const index = await ctx.index(args.boardId, { refresh: true });
    return renderJson({
      criado: compactCard(index, created, { includeDescription: true }),
      rota: `POST ${path}`,
    });
  },
});
