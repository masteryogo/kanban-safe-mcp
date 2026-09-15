import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { addCardMember, removeCardMember } from '../api/members.js';
import { previewWrite } from '../context.js';
import { renderJson } from '../format.js';

export const setMembers = defineTool({
  name: 'kanban_set_members',
  title: 'Vincular e desvincular pessoas de um card',
  description:
    'Atribui e desatribui pessoas de um card. Aceita id, e-mail, username ou nome; a ' +
    'pessoa ja tem de ser membro do board (adicionar alguem ao board esta fora do ' +
    'escopo, e referencia que nao resolve falha listando os candidatos). Pessoa ja ' +
    'atribuida em `add` e ausente em `remove` sao ignoradas, sem erro.',
  write: true,
  schema: {
    card: cardField,
    add: z
      .array(z.string())
      .optional()
      .describe('Pessoas a atribuir: id, e-mail, username ou nome.'),
    remove: z
      .array(z.string())
      .optional()
      .describe('Pessoas a desatribuir: id, e-mail, username ou nome.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_set_members');
    const index = await ctx.index(args.boardId);
    const current = await ctx.resolveCard(args.card, args.boardId);
    // Compara por id, e nao por nome: dois homonimos no board tornariam a
    // comparacao por nome silenciosamente errada, e o board ja tem um caso desses.
    const atuais = index.memberIdsOf(current.id);

    const toAdd = [];
    for (const ref of args.add ?? []) {
      const user = await ctx.resolveUser(ref, args.boardId);
      if (!atuais.includes(user.id)) toAdd.push(user);
    }
    const toRemove = [];
    for (const ref of args.remove ?? []) {
      const user = await ctx.resolveUser(ref, args.boardId);
      if (atuais.includes(user.id)) toRemove.push(user);
    }

    if (!toAdd.length && !toRemove.length) {
      return renderJson({
        card: current.name,
        membros: index.membersOf(current.id),
        resultado: 'nada a fazer: o card ja esta com exatamente essas pessoas.',
      });
    }

    if (args.dry_run) {
      return previewWrite([
        ...toAdd.map((user) => ({
          method: 'POST',
          path: `/api/cards/${current.id}/memberships`,
          body: { userId: user.id },
          note: `atribuir "${user.name ?? user.username ?? user.id}"`,
        })),
        ...toRemove.map((user) => ({
          method: 'DELETE',
          path: `/api/cards/${current.id}/memberships?userId=${encodeURIComponent(user.id)}`,
          note: `desatribuir "${user.name ?? user.username ?? user.id}"`,
        })),
        {
          method: '--',
          path: 'estado atual',
          current: { card: current.name, membros: index.membersOf(current.id) },
        },
      ]);
    }

    const feitos: string[] = [];
    for (const user of toAdd) {
      await addCardMember(ctx.client, current.id, user.id);
      feitos.push(`+ ${user.name ?? user.username ?? user.id}`);
    }
    for (const user of toRemove) {
      await removeCardMember(ctx.client, current.id, user.id);
      feitos.push(`- ${user.name ?? user.username ?? user.id}`);
    }
    ctx.invalidate(ctx.boardId(args.boardId));
    const depois = (await ctx.index(args.boardId, { refresh: true })).membersOf(current.id);
    return renderJson({ card: current.name, aplicado: feitos, membros: depois });
  },
});
