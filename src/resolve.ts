import { AmbiguousReferenceError, UnresolvedReferenceError } from './errors.js';
import type { BoardPayload, Card, Label, List, Task } from './types.js';

/**
 * Resolucao por codigo ou nome (invariante 7).
 *
 * O board usa codigos no nome do card (`E08-IA-006`). Toda ferramenta aceita id ou
 * referencia textual; havendo ambiguidade, o erro lista os candidatos e **nao** escolhe.
 */

/** Snowflake: string de digitos. Nunca converter para number. */
export function looksLikeId(value: string): boolean {
  return /^\d{10,25}$/.test(value.trim());
}

const CODE_PATTERN = /\b([A-Z]{1,4}\d{1,3}(?:-[A-Z0-9]{1,8})+)\b/;

/** Extrai o codigo do nome do card, quando houver (`E08-IA-006 Titulo` -> `E08-IA-006`). */
export function extractCode(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return CODE_PATTERN.exec(name.toUpperCase())?.[1];
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface Candidate<T> {
  item: T;
  id: string;
  name: string;
  code?: string;
}

function resolveOne<T>(
  kind: string,
  query: string,
  candidates: Candidate<T>[],
  hint?: string,
): T {
  const raw = query.trim();
  const q = norm(raw);
  const tiers: Array<(c: Candidate<T>) => boolean> = [
    (c) => c.id === raw,
    (c) => c.code !== undefined && norm(c.code) === q,
    (c) => norm(c.name) === q,
    (c) => c.code !== undefined && norm(c.code).startsWith(q),
    (c) => norm(c.name).startsWith(q),
    (c) => norm(c.name).includes(q),
  ];
  for (const test of tiers) {
    const hits = candidates.filter(test);
    if (hits.length === 1) return hits[0]!.item;
    if (hits.length > 1) {
      throw new AmbiguousReferenceError(
        kind,
        raw,
        hits.map((c) => ({ id: c.id, name: c.name })),
      );
    }
  }
  throw new UnresolvedReferenceError(kind, raw, hint);
}

export function resolveCard(board: BoardPayload, query: string): Card {
  return resolveOne(
    'card',
    query,
    board.cards.map((item) => ({
      item,
      id: item.id,
      name: item.name ?? '',
      code: extractCode(item.name),
    })),
    'use kanban_find_cards para procurar por texto.',
  );
}

export function resolveList(board: BoardPayload, query: string): List {
  return resolveOne(
    'lista',
    query,
    board.lists.map((item) => ({ item, id: item.id, name: item.name ?? '' })),
    `listas deste board: ${board.lists.map((l) => l.name).join(', ')}`,
  );
}

export function resolveLabel(board: BoardPayload, query: string): Label {
  return resolveOne(
    'label',
    query,
    board.labels.map((item) => ({ item, id: item.id, name: item.name ?? '' })),
    `labels deste board: ${board.labels.map((l) => l.name).join(', ')}`,
  );
}

/** Resolve uma task pelo nome dentro do card ao qual ela pertence. */
export function resolveTaskIn(tasks: Task[], query: string): Task {
  return resolveOne(
    'task',
    query,
    tasks.map((item) => ({ item, id: item.id, name: item.name ?? '' })),
    'use kanban_get_card para ver o checklist com os ids.',
  );
}
