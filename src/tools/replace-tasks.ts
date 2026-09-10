import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { getCard } from '../api/cards.js';
import { createTask, deleteTask } from '../api/tasks.js';
import { addComment } from '../api/comments.js';
import { previewWrite } from '../context.js';
import { compactTask, renderJson } from '../format.js';
import { appendPositions } from '../position.js';
import { KanbanError } from '../errors.js';
import type { Task } from '../types.js';

/**
 * Reescrita de checklist: criar antes de apagar (invariante 10).
 * Apagar primeiro ja deixou um card sem checklist e sem como recuperar.
 */
export const replaceTasks = defineTool({
  name: 'kanban_replace_tasks',
  title: 'Trocar o checklist inteiro',
  description:
    'Substitui o checklist de um card. Cria as tasks novas primeiro, confere que existem ' +
    'no servidor e so entao apaga as antigas — se a criacao falhar no meio, nenhuma task ' +
    'antiga e removida. Devolve o texto integral do que foi removido, para dar para ' +
    'guardar no historico; com `keepBackup` esse texto vai como comentario no proprio card.',
  write: true,
  schema: {
    card: cardField,
    tasks: z.array(z.string().min(1)).min(1).describe('O checklist novo, na ordem desejada.'),
    keepBackup: z
      .boolean()
      .default(false)
      .describe('Publica o checklist antigo como comentario no card antes de apagar.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_replace_tasks');
    const card = await ctx.resolveCard(args.card, args.boardId);
    const atual = await getCard(ctx.client, card.id);
    const antigas = [...atual.tasks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    const positions = appendPositions(antigas, args.tasks.length);
    const bodies: Array<{ name: string; position: number }> = args.tasks.map((name: string, i: number) => ({
      name,
      position: positions[i]!,
    }));
    const backup = formatBackup(card.name, antigas);

    if (args.dry_run) {
      return previewWrite([
        ...bodies.map((body) => ({
          method: 'POST',
          path: `/api/cards/${card.id}/tasks`,
          body,
        })),
        ...(args.keepBackup
          ? [
              {
                method: 'POST',
                path: `/api/cards/${card.id}/comment-actions`,
                body: { text: backup },
                note: 'backup do checklist antigo, publicado antes de apagar',
              },
            ]
          : []),
        ...antigas.map((task) => ({
          method: 'DELETE',
          path: `/api/tasks/${task.id}`,
          note: `apagar "${task.name}" — so depois das criacoes confirmadas`,
        })),
        {
          method: '--',
          path: 'estado atual',
          current: { card: card.name, checklist: antigas.map(compactTask) },
        },
      ]);
    }

    // 1. criar
    const criadas: Task[] = [];
    try {
      for (const body of bodies) {
        criadas.push(await createTask(ctx.client, card.id, body));
      }
    } catch (cause) {
      ctx.invalidate(ctx.boardId(args.boardId));
      throw new KanbanError(
        `a criacao do checklist novo falhou depois de ${criadas.length} de ${bodies.length} ` +
          `tasks. Nenhuma task antiga foi apagada — o card esta com o checklist antigo mais ` +
          `as tasks novas ja criadas (${criadas.map((t) => t.name).join(', ') || 'nenhuma'}). ` +
          `Causa: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    // 2. conferir que existem no servidor antes de apagar qualquer coisa
    const depoisDeCriar = await getCard(ctx.client, card.id);
    const idsNoServidor = new Set(depoisDeCriar.tasks.map((t) => t.id));
    const faltando = criadas.filter((t) => !idsNoServidor.has(t.id));
    if (faltando.length) {
      ctx.invalidate(ctx.boardId(args.boardId));
      throw new KanbanError(
        `o servidor aceitou as criacoes mas ${faltando.length} task(s) nao aparecem na ` +
          `releitura do card: ${faltando.map((t) => t.name).join(', ')}. ` +
          `Nada foi apagado — confira o card antes de repetir.`,
      );
    }

    // 3. backup opcional e so entao apagar
    if (args.keepBackup && antigas.length) {
      await addComment(ctx.client, card.id, backup);
    }
    const removidas: Task[] = [];
    const falhasAoApagar: string[] = [];
    for (const task of antigas) {
      try {
        await deleteTask(ctx.client, task.id);
        removidas.push(task);
      } catch (cause) {
        falhasAoApagar.push(
          `${task.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }

    ctx.invalidate(ctx.boardId(args.boardId));
    return renderJson({
      card: card.name,
      checklistNovo: criadas.map(compactTask),
      removidas: removidas.map((t) => ({ name: t.name, done: Boolean(t.isCompleted) })),
      falhasAoApagar: falhasAoApagar.length ? falhasAoApagar : undefined,
      backup,
      backupComentado: args.keepBackup && antigas.length > 0,
    });
  },
});

function formatBackup(cardName: string | undefined, tasks: Task[]): string {
  if (!tasks.length) return `Checklist anterior de "${cardName ?? ''}": vazio.`;
  const linhas = tasks.map((t) => `- [${t.isCompleted ? 'x' : ' '}] ${t.name ?? ''}`);
  return `Checklist anterior de "${cardName ?? ''}", substituido em ${new Date().toISOString()}:\n${linhas.join('\n')}`;
}
