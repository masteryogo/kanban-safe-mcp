import { POSITION_STEP } from './types.js';

/**
 * `position` e float e o passo usado pela interface e 65536.
 * Inserir no meio significa media entre vizinhos; no fim, ultimo + passo.
 */
export function endPosition(existing: Array<{ position?: number }>): number {
  const positions = existing
    .map((item) => item.position)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  if (!positions.length) return POSITION_STEP;
  return Math.max(...positions) + POSITION_STEP;
}

/** `count` posicoes consecutivas no fim da lista. */
export function appendPositions(
  existing: Array<{ position?: number }>,
  count: number,
): number[] {
  const start = endPosition(existing);
  return Array.from({ length: count }, (_, i) => start + i * POSITION_STEP);
}
