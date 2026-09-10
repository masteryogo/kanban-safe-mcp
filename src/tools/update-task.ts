import { z } from 'zod';
import { boardIdField, defineTool, dryRunField } from './tool.js';
import { updateTask } from '../api/tasks.js';
import { previewWrite } from '../context.js';
import { compactTask, renderJson } from '../format.js';
import { ValidationError } from '../errors.js';

export const updateTaskTool = defineTool({
  name: 'kanban_update_task',
  title: 'Alterar ou marcar uma task',
  description:
    'Renomeia uma task ou marca/desmarca como concluida. Informe `taskId` (visto em ' +
    'kanban_get_card) ou entao `card` + `task`, com o nome da task dentro daquele card.',
  write: true,
  schema: {
    taskId: z.string().optional().describe('Id da task. Alternativa a `card` + `task`.'),
    card: z.string().optional().describe('Card onde esta a task, se nao souber o taskId.'),
    task: z.string().optional().describe('Nome (ou inicio do nome) da task dentro do card.'),
    name: z.string().min(1).optional().describe('Novo nome da task.'),
    isCompleted: z.boolean().optional(),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_update_task');
    const { task, card } = await ctx.resolveTask(args, args.boardId);

    const body: Record<string, unknown> = {};
    if (args.name !== undefined) body.name = args.name;
    if (args.isCompleted !== undefined) body.isCompleted = args.isCompleted;
    if (Object.keys(body).length === 0) {
      throw new ValidationError('PATCH', `/api/tasks/${task.id}`, [
        'nenhum campo para alterar: informe name ou isCompleted.',
      ]);
    }

    const path = `/api/tasks/${task.id}`;
    if (args.dry_run) {
      return previewWrite([
        { method: 'PATCH', path, body, current: { card: card?.name, task: compactTask(task) } },
      ]);
    }

    const updated = await updateTask(ctx.client, task.id, body);
    ctx.invalidate(ctx.boardId(args.boardId));
    return renderJson({
      card: card?.name,
      task: compactTask(updated),
      camposConfirmados: Object.keys(body),
      rota: `PATCH ${path}`,
    });
  },
});
