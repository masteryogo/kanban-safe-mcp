import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { updateCard } from '../api/cards.js';
import { previewWrite } from '../context.js';
import { compactCard, renderJson } from '../format.js';
import { ValidationError } from '../errors.js';

export const updateCardTool = defineTool({
  name: 'kanban_update_card',
  title: 'Alterar card',
  description:
    'Altera titulo, descricao ou prazo de um card. So os campos informados sao enviados. ' +
    'O item devolvido e conferido contra o pedido: campo que o servidor descarta em silencio ' +
    'vira erro, nao sucesso. Para trocar de lista use kanban_move_card.',
  write: true,
  schema: {
    card: cardField,
    name: z.string().min(1).optional(),
    description: z.string().optional().describe('String vazia limpa a descricao.'),
    dueDate: z
      .string()
      .optional()
      .describe('Data ISO 8601, ex.: "2026-10-01T12:00:00.000Z". String vazia remove o prazo.'),
    isDueDateCompleted: z.boolean().optional(),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_update_card');
    const current = await ctx.resolveCard(args.card, args.boardId);

    const body: Record<string, unknown> = {};
    if (args.name !== undefined) body.name = args.name;
    if (args.description !== undefined) body.description = args.description;
    if (args.dueDate !== undefined) body.dueDate = args.dueDate === '' ? null : args.dueDate;
    if (args.isDueDateCompleted !== undefined) body.isDueDateCompleted = args.isDueDateCompleted;

    if (Object.keys(body).length === 0) {
      throw new ValidationError('PATCH', `/api/cards/${current.id}`, [
        'nenhum campo para alterar: informe name, description, dueDate ou isDueDateCompleted.',
      ]);
    }

    const path = `/api/cards/${current.id}`;
    if (args.dry_run) {
      const before: Record<string, unknown> = {};
      for (const key of Object.keys(body)) before[key] = (current as Record<string, unknown>)[key];
      return previewWrite([
        { method: 'PATCH', path, body, current: { name: current.name, ...before } },
      ]);
    }

    const updated = await updateCard(ctx.client, current.id, body);
    ctx.invalidate(ctx.boardId(args.boardId));
    const index = await ctx.index(args.boardId, { refresh: true });
    return renderJson({
      alterado: compactCard(index, updated, { includeDescription: true }),
      camposConfirmados: Object.keys(body),
      rota: `PATCH ${path}`,
    });
  },
});
