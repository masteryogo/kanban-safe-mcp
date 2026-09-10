import type { KanbanClient } from '../client.js';
import { assertWrite } from '../verify.js';
import { requireItem, type Task } from '../types.js';

/**
 * Na 1.x a task pendura direto no card: `POST /api/cards/:id/tasks`, e `position` e
 * obrigatorio. A rota 2.0 (`/api/task-lists/:id/tasks`) nao existe aqui.
 */
export async function createTask(
  client: KanbanClient,
  cardId: string,
  body: { name: string; position: number },
): Promise<Task> {
  const path = `/api/cards/${cardId}/tasks`;
  const payload = await client.post(path, body);
  const item = requireItem<Task>(payload, 'task');
  assertWrite('POST', path, body, item, ['position']);
  return item;
}

export async function updateTask(
  client: KanbanClient,
  taskId: string,
  body: Record<string, unknown>,
): Promise<Task> {
  const path = `/api/tasks/${taskId}`;
  const payload = await client.patch(path, body);
  const item = requireItem<Task>(payload, 'task');
  assertWrite('PATCH', path, body, item, ['position']);
  return item;
}

export async function deleteTask(client: KanbanClient, taskId: string): Promise<void> {
  await client.delete(`/api/tasks/${taskId}`);
}
