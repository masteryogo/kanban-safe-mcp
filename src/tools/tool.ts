import { z } from 'zod';
import type { Context } from '../context.js';

/**
 * Definicao de uma ferramenta. `zod` so aqui, na **entrada** — a resposta do servidor
 * nunca passa por schema fechado (invariante 3).
 */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  schema: z.ZodRawShape;
  /** Ferramenta de escrita: barrada por KANBAN_SAFE_READ_ONLY. */
  write?: boolean;
  handler: (args: any, ctx: Context) => Promise<string>;
}

export function defineTool(def: ToolDef): ToolDef {
  return def;
}

/** Campos reaproveitados por varias ferramentas. */
export const boardIdField = z
  .string()
  .optional()
  .describe('Id do board. Omitido, usa KANBAN_SAFE_DEFAULT_BOARD_ID.');

export const cardField = z
  .string()
  .describe(
    'Id do card (19 digitos) ou o codigo/inicio do nome, ex.: "E08-IA-006". ' +
      'Referencia ambigua falha listando os candidatos, sem escolher.',
  );

export const dryRunField = z
  .boolean()
  .default(true)
  .describe(
    'Caminho recomendado: com true (padrao) devolve a rota e o corpo que seriam enviados, ' +
      'e o estado atual do que seria sobrescrito, sem chamar o servidor. O board e ' +
      'compartilhado — mostre o texto antes de publicar.',
  );
