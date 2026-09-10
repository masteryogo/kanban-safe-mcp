import { z } from 'zod';
import { boardIdField, defineTool } from './tool.js';
import { CONTENT_CAVEAT, compactCard, renderJson } from '../format.js';

export const getBoardTool = defineTool({
  name: 'kanban_get_board',
  title: 'Ler o board',
  description:
    'Panorama do board: listas com contagem de cards, e uma pagina de cards em formato ' +
    'compacto. O servidor ignora filtro em query string, entao todo recorte e feito aqui. ' +
    'Use `list`/`label` para filtrar e `limit`/`offset` para paginar; `includeDescription` ' +
    'so quando precisar mesmo do texto, porque infla a saida.',
  schema: {
    boardId: boardIdField,
    list: z.string().optional().describe('Filtra por lista (id ou nome).'),
    label: z.string().optional().describe('Filtra por label (id ou nome).'),
    limit: z.number().int().min(1).max(200).default(50).describe('Cards por pagina.'),
    offset: z.number().int().min(0).default(0),
    includeDescription: z.boolean().default(false),
    refresh: z.boolean().default(false).describe('Ignora o cache de ~30s e relê do servidor.'),
  },
  async handler(args, ctx) {
    const index = await ctx.index(args.boardId, { refresh: args.refresh });
    const board = index.board;

    const wantedList = args.list ? await ctx.resolveList(args.list, args.boardId) : undefined;
    const wantedLabel = args.label ? await ctx.resolveLabel(args.label, args.boardId) : undefined;

    let cards = board.cards;
    if (wantedList) cards = cards.filter((c) => c.listId === wantedList.id);
    if (wantedLabel) {
      const nome = wantedLabel.name ?? wantedLabel.id;
      cards = cards.filter((c) => index.labelsOf(c.id).includes(nome));
    }
    cards = [...cards].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    const page = cards.slice(args.offset, args.offset + args.limit);
    return renderJson({
      board: { id: board.item.id, name: board.item.name },
      listas: board.lists
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((l) => ({
          id: l.id,
          name: l.name,
          cards: board.cards.filter((c) => c.listId === l.id).length,
        })),
      labels: board.labels.map((l) => l.name),
      filtro: {
        list: wantedList?.name,
        label: wantedLabel?.name,
      },
      totalFiltrado: cards.length,
      mostrando: `${page.length ? args.offset + 1 : 0}-${args.offset + page.length} de ${cards.length}`,
      cards: page.map((c) =>
        compactCard(index, c, { includeDescription: args.includeDescription }),
      ),
      nota: CONTENT_CAVEAT,
    });
  },
});
