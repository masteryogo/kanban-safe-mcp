import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { addCardLabel, removeCardLabel } from '../api/labels.js';
import { previewWrite } from '../context.js';
import { renderJson } from '../format.js';

export const setLabels = defineTool({
  name: 'kanban_set_labels',
  title: 'Vincular e desvincular labels',
  description:
    'Adiciona e remove labels de um card. Aceita nome ou id de label; o label ja tem de ' +
    'existir no board (criar label esta fora do escopo). Labels ja presentes em `add` e ' +
    'ausentes em `remove` sao ignorados, sem erro.',
  write: true,
  schema: {
    card: cardField,
    add: z.array(z.string()).optional().describe('Labels a vincular: nome ou id.'),
    remove: z.array(z.string()).optional().describe('Labels a desvincular: nome ou id.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_set_labels');
    const index = await ctx.index(args.boardId);
    const current = await ctx.resolveCard(args.card, args.boardId);
    const atuais = index.labelsOf(current.id);

    const toAdd = [];
    for (const ref of args.add ?? []) {
      const label = await ctx.resolveLabel(ref, args.boardId);
      if (!atuais.includes(label.name ?? label.id)) toAdd.push(label);
    }
    const toRemove = [];
    for (const ref of args.remove ?? []) {
      const label = await ctx.resolveLabel(ref, args.boardId);
      if (atuais.includes(label.name ?? label.id)) toRemove.push(label);
    }

    if (!toAdd.length && !toRemove.length) {
      return renderJson({
        card: current.name,
        labels: atuais,
        resultado: 'nada a fazer: o card ja esta com exatamente esses labels.',
      });
    }

    if (args.dry_run) {
      return previewWrite([
        ...toAdd.map((label) => ({
          method: 'POST',
          path: `/api/cards/${current.id}/labels`,
          body: { labelId: label.id },
          note: `vincular "${label.name}"`,
        })),
        ...toRemove.map((label) => ({
          method: 'DELETE',
          path: `/api/cards/${current.id}/labels/${label.id}`,
          note: `desvincular "${label.name}"`,
        })),
        { method: '--', path: 'estado atual', current: { card: current.name, labels: atuais } },
      ]);
    }

    const feitos: string[] = [];
    for (const label of toAdd) {
      await addCardLabel(ctx.client, current.id, label.id);
      feitos.push(`+ ${label.name}`);
    }
    for (const label of toRemove) {
      await removeCardLabel(ctx.client, current.id, label.id);
      feitos.push(`- ${label.name}`);
    }
    ctx.invalidate(ctx.boardId(args.boardId));
    const depois = (await ctx.index(args.boardId, { refresh: true })).labelsOf(current.id);
    return renderJson({ card: current.name, aplicado: feitos, labels: depois });
  },
});
