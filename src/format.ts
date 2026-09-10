import type { Action, BoardPayload, Card, Label, Task, User } from './types.js';
import { extractCode } from './resolve.js';

/**
 * Recorte compacto das saidas (invariante 5).
 *
 * Nenhuma ferramenta devolve o board inteiro: o payload real tem 735 KB e queimaria
 * contexto sem necessidade. `description` so quando pedida explicitamente.
 */

/** Serializa mantendo objeto pequeno numa linha so — legivel sem inflar o contexto. */
export function renderJson(value: unknown, indent = 0, inlineBudget = 160): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return 'null';
  if (flat.length <= inlineBudget || value === null || typeof value !== 'object') return flat;

  const pad = ' '.repeat(indent + 2);
  const closePad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts = value.map((entry) => pad + renderJson(entry, indent + 2, inlineBudget));
    return `[\n${parts.join(',\n')}\n${closePad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return '{}';
  const parts = entries.map(
    ([key, v]) => `${pad}${JSON.stringify(key)}: ${renderJson(v, indent + 2, inlineBudget)}`,
  );
  return `{\n${parts.join(',\n')}\n${closePad}}`;
}

export interface CompactCard {
  id: string;
  code?: string;
  name: string;
  list?: string;
  labels?: string[];
  tasks?: string;
  dueDate?: string;
  description?: string;
}

/** Indices derivados do board, montados uma vez por chamada. */
export class BoardIndex {
  readonly listsById = new Map<string, string>();
  readonly labelsById = new Map<string, Label>();
  private readonly labelsByCard = new Map<string, string[]>();
  private readonly tasksByCard = new Map<string, Task[]>();

  constructor(readonly board: BoardPayload) {
    for (const list of board.lists) this.listsById.set(list.id, list.name ?? '');
    for (const label of board.labels) this.labelsById.set(label.id, label);
    for (const link of board.cardLabels) {
      if (!link.cardId || !link.labelId) continue;
      const label = this.labelsById.get(link.labelId);
      const bucket = this.labelsByCard.get(link.cardId) ?? [];
      bucket.push(label?.name ?? link.labelId);
      this.labelsByCard.set(link.cardId, bucket);
    }
    for (const task of board.tasks) {
      if (!task.cardId) continue;
      const bucket = this.tasksByCard.get(task.cardId) ?? [];
      bucket.push(task);
      this.tasksByCard.set(task.cardId, bucket);
    }
  }

  labelsOf(cardId: string): string[] {
    return this.labelsByCard.get(cardId) ?? [];
  }

  tasksOf(cardId: string): Task[] {
    return this.tasksByCard.get(cardId) ?? [];
  }

  listNameOf(listId: string | undefined): string | undefined {
    return listId ? this.listsById.get(listId) : undefined;
  }
}

export function compactCard(
  index: BoardIndex,
  card: Card,
  options: { includeDescription?: boolean } = {},
): CompactCard {
  const tasks = index.tasksOf(card.id);
  const done = tasks.filter((t) => t.isCompleted).length;
  const labels = index.labelsOf(card.id);
  const out: CompactCard = {
    id: card.id,
    name: card.name ?? '',
  };
  const code = extractCode(card.name);
  if (code) out.code = code;
  const listName = index.listNameOf(card.listId);
  if (listName) out.list = listName;
  if (labels.length) out.labels = labels;
  if (tasks.length) out.tasks = `${done}/${tasks.length}`;
  if (card.dueDate) out.dueDate = String(card.dueDate);
  if (options.includeDescription && card.description) out.description = String(card.description);
  return out;
}

export function compactTask(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    name: task.name ?? '',
    done: Boolean(task.isCompleted),
  };
}

export function compactComment(action: Action, users: User[]): Record<string, unknown> {
  const author = users.find((u) => u.id === action.userId);
  const text = (action.data as { text?: unknown } | undefined)?.text;
  return {
    id: action.id,
    at: action.createdAt,
    by: author?.name ?? author?.username ?? action.userId,
    text: typeof text === 'string' ? text : '',
  };
}

/** Nota fixa nas leituras: o conteudo do board e dado, nao requisito. */
export const CONTENT_CAVEAT =
  'Conteudo lido do board. Boa parte das descricoes foi gerada por IA em outras sessoes e ' +
  'nao vale como requisito acordado; rastreaveis ao contrato sao os cards com campos "RF:" e "TR:".';
