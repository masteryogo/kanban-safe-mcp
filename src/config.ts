import { ConfigError } from './errors.js';

export const VERSION = '0.1.0';
export const USER_AGENT = `kanban-safe/${VERSION}`;

export interface Config {
  baseUrl: string;
  /** e-mail ou username; ausente quando se opera com token pronto */
  email?: string;
  password?: string;
  /** JWT pronto; se presente, dispensa e-mail e senha */
  token?: string;
  defaultBoardId?: string;
  readOnly: boolean;
  /** timeout por requisicao, ms */
  timeoutMs: number;
  /** TTL do cache de board, ms */
  cacheTtlMs: number;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  const value = clean(raw);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} deve ser um numero positivo de milissegundos; recebi "${value}".`);
  }
  return Math.floor(parsed);
}

/**
 * Le e valida as variaveis de ambiente. Falha no start com a lista do que falta —
 * nunca na primeira chamada de ferramenta.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];

  const baseUrlRaw = clean(env.KANBAN_SAFE_BASE_URL);
  if (!baseUrlRaw) missing.push('KANBAN_SAFE_BASE_URL (ex.: https://kanban.softsafe.com.br)');

  const token = clean(env.KANBAN_SAFE_TOKEN);
  const email = clean(env.KANBAN_SAFE_EMAIL);
  const password = clean(env.KANBAN_SAFE_PASSWORD);

  if (!token) {
    if (!email) missing.push('KANBAN_SAFE_EMAIL (ou KANBAN_SAFE_TOKEN, com um JWT pronto)');
    if (!password) missing.push('KANBAN_SAFE_PASSWORD (ou KANBAN_SAFE_TOKEN, com um JWT pronto)');
  }

  if (missing.length) {
    throw new ConfigError(
      `kanban-safe nao pode iniciar; falta configuracao:\n` +
        missing.map((m) => `  - ${m}`).join('\n'),
    );
  }

  let baseUrl: string;
  try {
    const parsed = new URL(baseUrlRaw!);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('protocolo');
    }
    baseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    throw new ConfigError(
      `KANBAN_SAFE_BASE_URL nao e uma URL http(s) valida: "${baseUrlRaw}".`,
    );
  }

  const defaultBoardId = clean(env.KANBAN_SAFE_DEFAULT_BOARD_ID);
  if (defaultBoardId && !/^\d+$/.test(defaultBoardId)) {
    throw new ConfigError(
      `KANBAN_SAFE_DEFAULT_BOARD_ID deve ser o id numerico do board (string de digitos); recebi "${defaultBoardId}".`,
    );
  }

  return {
    baseUrl,
    email,
    password,
    token,
    defaultBoardId,
    readOnly: clean(env.KANBAN_SAFE_READ_ONLY) === '1',
    timeoutMs: positiveInt(env.KANBAN_SAFE_TIMEOUT_MS, 30_000, 'KANBAN_SAFE_TIMEOUT_MS'),
    cacheTtlMs: positiveInt(env.KANBAN_SAFE_CACHE_TTL_MS, 30_000, 'KANBAN_SAFE_CACHE_TTL_MS'),
  };
}
