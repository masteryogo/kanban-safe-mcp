import { z } from 'zod';
import { boardIdField, defineTool, dryRunField } from './tool.js';
import { deleteTask } from '../api/tasks.js';
import { previewWrite } from '../context.js';
import { compactTask, renderJson } from '../format.js';

export const deleteTaskTool = defineTool({
  name: 'kanban_delete_task',
  title: 'Apagar uma task',
  description:
    'Remove uma task do checklist. Informe `taskId` (visto em kanban_get_card) ou entao ' +
    '`card` + `task`. O dry_run mostra o texto da task que seria apagada — nao ha desfazer.',
  write: true,
  schema: {
    taskId: z.string().optional().describe('Id da task. Alternativa a `card` + `task`.'),
    card: z.string().optional().describe('Card onde esta a task, se nao souber o taskId.'),
    task: z.string().optional().describe('Nome (ou inicio do nome) da task dentro do card.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_delete_task');
    const { task, card } = await ctx.resolveTask(args, args.boardId);
    const path = `/api/tasks/${task.id}`;

    if (args.dry_run) {
      return previewWrite([
        {
          method: 'DELETE',
          path,
          current: { card: card?.name, task: compactTask(task) },
          note: 'apagar task nao tem desfazer; guarde o texto se precisar do historico',
        },
      ]);
    }

    await deleteTask(ctx.client, task.id);
    ctx.invalidate(ctx.boardId(args.boardId));
    return renderJson({
      apagada: compactTask(task),
      card: card?.name,
      rota: `DELETE ${path}`,
    });
  },
});
