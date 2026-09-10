import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { createTask } from '../api/tasks.js';
import { previewWrite } from '../context.js';
import { compactTask, renderJson } from '../format.js';
import { appendPositions } from '../position.js';

export const addTasks = defineTool({
  name: 'kanban_add_tasks',
  title: 'Adicionar tasks ao checklist',
  description:
    'Acrescenta tasks ao checklist de um card, no fim. Neste servidor a task pendura ' +
    'direto no card (nao ha task-list) e `position` e obrigatoria — ela e calculada aqui. ' +
    'Para trocar o checklist inteiro use kanban_replace_tasks.',
  write: true,
  schema: {
    card: cardField,
    tasks: z.array(z.string().min(1)).min(1).describe('Nomes das tasks, na ordem desejada.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_add_tasks');
    const board = await ctx.board(args.boardId);
    const card = await ctx.resolveCard(args.card, args.boardId);
    const existentes = board.tasks.filter((t) => t.cardId === card.id);
    const positions = appendPositions(existentes, args.tasks.length);
    const path = `/api/cards/${card.id}/tasks`;

    const bodies: Array<{ name: string; position: number }> = args.tasks.map((name: string, i: number) => ({
      name,
      position: positions[i]!,
    }));

    if (args.dry_run) {
      return previewWrite([
        ...bodies.map((body) => ({ method: 'POST', path, body })),
        {
          method: '--',
          path: 'estado atual',
          current: { card: card.name, checklist: existentes.map(compactTask) },
        },
      ]);
    }

    const criadas = [];
    for (const body of bodies) {
      criadas.push(await createTask(ctx.client, card.id, body));
    }
    ctx.invalidate(ctx.boardId(args.boardId));
    return renderJson({
      card: card.name,
      criadas: criadas.map(compactTask),
      totalNoChecklist: existentes.length + criadas.length,
      rota: `POST ${path}`,
    });
  },
});
