/**
 * Formatos observados no servidor real.
 *
 * Sao tipos *abertos* de propósito: `zod` so valida a entrada das ferramentas, nunca a
 * resposta (invariante 3). Todo campo e opcional e o `[key: string]: unknown`
 * garante que um campo novo do servidor nao derrube uma chamada que retornou 200.
 *
 * Ids sao strings numericas de 19 digitos (snowflake) — nunca converter para number.
 */

export interface Unknown {
  [key: string]: unknown;
}

export interface Card extends Unknown {
  id: string;
  name?: string;
  description?: string | null;
  position?: number;
  boardId?: string;
  listId?: string;
  dueDate?: string | null;
  isDueDateCompleted?: boolean | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface Task extends Unknown {
  id: string;
  name?: string;
  isCompleted?: boolean;
  position?: number;
  /** 1.x: a task pendura direto no card, sem taskListId. */
  cardId?: string;
}

export interface List extends Unknown {
  id: string;
  name?: string;
  position?: number;
  boardId?: string;
}

export interface Label extends Unknown {
  id: string;
  name?: string;
  color?: string;
  position?: number;
  boardId?: string;
}

export interface CardLabel extends Unknown {
  id: string;
  cardId?: string;
  labelId?: string;
}

export interface Action extends Unknown {
  id: string;
  /** comentario e `commentCard`, com o texto em `data.text`. */
  type?: string;
  data?: Unknown;
  cardId?: string;
  userId?: string;
  createdAt?: string;
}

export interface Attachment extends Unknown {
  id: string;
  name?: string;
  cardId?: string;
}

export interface Board extends Unknown {
  id: string;
  name?: string;
  projectId?: string;
  position?: number;
}

export interface Project extends Unknown {
  id: string;
  name?: string;
}

export interface User extends Unknown {
  id: string;
  email?: string;
  name?: string;
  username?: string;
  isAdmin?: boolean;
}

/** `GET /api/boards/:id` — item + included. */
export interface BoardPayload {
  item: Board;
  lists: List[];
  cards: Card[];
  labels: Label[];
  cardLabels: CardLabel[];
  tasks: Task[];
  attachments: Attachment[];
  users: User[];
  projects: Project[];
}

/** Passo de posicao usado pela interface do Planka. */
export const POSITION_STEP = 65536;

/** Le um array de dentro de `included`, tolerando ausencia e tipo inesperado. */
export function includedArray<T>(payload: unknown, key: string): T[] {
  const included = (payload as { included?: unknown } | null)?.included;
  const value = (included as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Le `item` de uma resposta, exigindo que tenha id. */
export function requireItem<T extends { id: string }>(payload: unknown, what: string): T {
  const item = (payload as { item?: unknown } | null)?.item;
  if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') {
    throw new Error(`o servidor respondeu 200 mas sem um ${what} em \`item\`.`);
  }
  return item as T;
}
