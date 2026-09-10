/**
 * write-then-verify (invariante 9).
 *
 * O servidor aceita `PATCH` com campo desconhecido, responde 200 e descarta o campo em
 * silencio (§3.7). A unica defesa e comparar o item devolvido com o que foi pedido.
 */
import { WriteVerificationError } from './errors.js';

function sameDate(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

function equivalent(requested: unknown, returned: unknown): boolean {
  if (requested === returned) return true;
  // O servidor guarda descricao vazia como null.
  if ((requested === '' || requested === null) && (returned === '' || returned === null)) return true;
  if (typeof requested === 'number' && typeof returned === 'number') {
    return Math.abs(requested - returned) < 1e-6;
  }
  if (sameDate(requested, returned)) return true;
  return false;
}

/** Lista as divergencias entre o corpo enviado e o item devolvido. */
export function diffWrite(
  sent: Record<string, unknown>,
  returned: Record<string, unknown> | undefined,
  ignore: string[] = [],
): string[] {
  if (!returned) return ['o servidor nao devolveu o item alterado'];
  const divergences: string[] = [];
  for (const [key, wanted] of Object.entries(sent)) {
    if (ignore.includes(key)) continue;
    if (!(key in returned)) {
      divergences.push(
        `"${key}" nao aparece no item devolvido — o servidor provavelmente descartou o campo`,
      );
      continue;
    }
    const got = returned[key];
    if (!equivalent(wanted, got)) {
      divergences.push(`"${key}": pedi ${JSON.stringify(wanted)}, o servidor gravou ${JSON.stringify(got)}`);
    }
  }
  return divergences;
}

/** Lanca se o item devolvido nao refletir o pedido. */
export function assertWrite(
  method: string,
  path: string,
  sent: Record<string, unknown>,
  returned: Record<string, unknown> | undefined,
  ignore: string[] = [],
): void {
  const divergences = diffWrite(sent, returned, ignore);
  if (divergences.length) {
    throw new WriteVerificationError(method, path, divergences);
  }
}
