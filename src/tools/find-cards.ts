import { z } from 'zod';
import { boardIdField, defineTool } from './tool.js';
import { CONTENT_CAVEAT, compactCard, renderJson } from '../format.js';
import { extractCode } from '../resolve.js';

export const findCards = defineTool({
  name: 'kanban_find_cards',
  title: 'Procurar cards',
  description:
    'Procura cards por codigo, inicio do nome ou texto solto no nome e na descricao. ' +
    'Roda sobre o cache do board, sem custo de rede. Devolve os candidatos em ordem de ' +
    'aderencia — use quando nao souber o id ou quando uma referencia der ambiguidade.',
  schema: {
    query: z.string().min(1).describe('Codigo, prefixo do nome ou texto.'),
    boardId: boardIdField,
    member: z
      .string()
      .optional()
      .describe('Restringe aos cards atribuidos a esta pessoa (id, e-mail, username ou nome).'),
    limit: z.number().int().min(1).max(100).default(20),
    includeDescription: z.boolean().default(false),
    searchDescription: z
      .boolean()
      .default(true)
      .describe('Tambem procura o texto na descricao dos cards.'),
  },
  async handler(args, ctx) {
    const index = await ctx.index(args.boardId);
    const q = args.query.trim().toLowerCase();
    const wantedMember = args.member ? await ctx.resolveUser(args.member, args.boardId) : undefined;

    // Filtra por id, nao por nome: duas pessoas podem exibir o mesmo nome.
    const universe = wantedMember
      ? index.board.cards.filter((c) => index.memberIdsOf(c.id).includes(wantedMember.id))
      : index.board.cards;

    const scored = universe
      .map((card) => {
        const name = (card.name ?? '').toLowerCase();
        const code = extractCode(card.name)?.toLowerCase();
        const description = args.searchDescription
          ? String(card.description ?? '').toLowerCase()
          : '';
        let score = 0;
        if (card.id === args.query.trim()) score = 100;
        else if (code === q) score = 90;
        else if (name === q) score = 80;
        else if (code?.startsWith(q)) score = 70;
        else if (name.startsWith(q)) score = 60;
        else if (name.includes(q)) score = 40;
        else if (description.includes(q)) score = 20;
        return { card, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || (a.card.position ?? 0) - (b.card.position ?? 0));

    return renderJson({
      query: args.query,
      membro: wantedMember
        ? (wantedMember.name ?? wantedMember.username ?? wantedMember.id)
        : undefined,
      encontrados: scored.length,
      cards: scored
        .slice(0, args.limit)
        .map((entry) => compactCard(index, entry.card, { includeDescription: args.includeDescription })),
      nota: CONTENT_CAVEAT,
    });
  },
});
