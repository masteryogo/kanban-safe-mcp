import type { KanbanClient } from '../client.js';
import {
  includedArray,
  requireItem,
  type Attachment,
  type Board,
  type BoardPayload,
  type Card,
  type CardLabel,
  type CardMembership,
  type Label,
  type List,
  type Project,
  type Task,
  type User,
} from '../types.js';

/**
 * `GET /api/boards/:id` — ~700 ms e ~735 KB no board real. Chamar sempre pelo cache
 * (invariante 6); o servidor ignora `?limit` e `?exclude` (§3.6).
 */
export async function getBoard(client: KanbanClient, boardId: string): Promise<BoardPayload> {
  const payload = await client.get(`/api/boards/${boardId}`);
  return {
    item: requireItem<Board>(payload, 'board'),
    lists: includedArray<List>(payload, 'lists'),
    cards: includedArray<Card>(payload, 'cards'),
    labels: includedArray<Label>(payload, 'labels'),
    cardLabels: includedArray<CardLabel>(payload, 'cardLabels'),
    cardMemberships: includedArray<CardMembership>(payload, 'cardMemberships'),
    tasks: includedArray<Task>(payload, 'tasks'),
    attachments: includedArray<Attachment>(payload, 'attachments'),
    users: includedArray<User>(payload, 'users'),
    projects: includedArray<Project>(payload, 'projects'),
  };
}

export interface ProjectsPayload {
  projects: Project[];
  boards: Board[];
}

export async function listProjects(client: KanbanClient): Promise<ProjectsPayload> {
  const payload = await client.get('/api/projects');
  const items = (payload as { items?: unknown })?.items;
  return {
    projects: Array.isArray(items) ? (items as Project[]) : [],
    boards: includedArray<Board>(payload, 'boards'),
  };
}

export async function getMe(client: KanbanClient): Promise<User> {
  const payload = await client.get('/api/users/me');
  return requireItem<User>(payload, 'usuario');
}
