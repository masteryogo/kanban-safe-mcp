import type { Config } from './config.js';
import { USER_AGENT } from './config.js';
import { FlavorDetector } from './flavor.js';
import {
  AuthError,
  HttpError,
  NetworkError,
  ResourceNotFoundError,
  RouteNotFoundError,
  ValidationError,
} from './errors.js';

export interface RequestOptions {
  body?: unknown;
  /**
   * Desliga o retry desta chamada. Obrigatorio no POST de comentario: repetir por
   * timeout duplicaria a publicacao num board compartilhado (invariante 11).
   */
  noRetry?: boolean;
  /** Nao anexa Authorization — usado pelo proprio login. */
  anonymous?: boolean;
}

export interface ClientDeps {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Renova o token quando faltar menos que isto para o `exp` do JWT. */
const TOKEN_SKEW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 250;

/** Decodifica o payload de um JWT sem validar assinatura — so precisamos do `exp`. */
export function decodeJwtExpiryMs(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { exp?: unknown };
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return undefined;
    return claims.exp * 1000;
  } catch {
    return undefined;
  }
}

interface RawResponse {
  status: number;
  contentType: string;
  text: string;
}

export class KanbanClient {
  readonly detector = new FlavorDetector();
  private token?: string;
  private tokenExpiresAtMs?: number;
  /** Token veio do ambiente e nao ha senha em disco: nao da para reautenticar. */
  private readonly tokenIsFixed: boolean;
  private authInFlight?: Promise<string>;
  private readonly deps: ClientDeps;

  constructor(
    private readonly config: Config,
    deps: Partial<ClientDeps> = {},
  ) {
    this.deps = {
      fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: deps.now ?? (() => Date.now()),
    };
    if (config.token) {
      this.token = config.token;
      this.tokenExpiresAtMs = decodeJwtExpiryMs(config.token);
    }
    this.tokenIsFixed = Boolean(config.token) && !(config.email && config.password);
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get flavor() {
    return this.detector.flavor;
  }

  get(path: string, options: RequestOptions = {}) {
    return this.request('GET', path, options);
  }
  post(path: string, body: unknown, options: RequestOptions = {}) {
    return this.request('POST', path, { ...options, body });
  }
  patch(path: string, body: unknown, options: RequestOptions = {}) {
    return this.request('PATCH', path, { ...options, body });
  }
  delete(path: string, options: RequestOptions = {}) {
    return this.request('DELETE', path, options);
  }

  /**
   * Uma requisicao completa: token valido, guarda de HTML, traducao de erro,
   * retry so em rede/5xx e reautenticacao unica em 401.
   */
  async request(method: string, path: string, options: RequestOptions = {}): Promise<any> {
    const token = options.anonymous ? undefined : await this.ensureToken();
    const raw = await this.send(method, path, token, options);

    if (raw.status === 401 && !options.anonymous) {
      if (this.tokenIsFixed) {
        throw new AuthError(
          `${method} ${path} devolveu 401. O token veio de KANBAN_SAFE_TOKEN e nao ha ` +
            `e-mail/senha para reautenticar — gere um token novo e atualize a variavel.`,
        );
      }
      // Retry unico: limpa o token, reautentica e repete uma vez so.
      this.clearToken();
      const fresh = await this.ensureToken();
      const retry = await this.send(method, path, fresh, options);
      if (retry.status === 401) {
        throw new AuthError(
          `${method} ${path} devolveu 401 mesmo depois de reautenticar. ` +
            `Verifique KANBAN_SAFE_EMAIL e KANBAN_SAFE_PASSWORD.`,
        );
      }
      return this.interpret(method, path, retry);
    }

    return this.interpret(method, path, raw);
  }

  /** Login. Nunca inclui a senha em mensagem de erro. */
  private async authenticate(): Promise<string> {
    if (!this.config.email || !this.config.password) {
      throw new AuthError(
        'nao ha credenciais para autenticar: defina KANBAN_SAFE_EMAIL e KANBAN_SAFE_PASSWORD, ' +
          'ou KANBAN_SAFE_TOKEN com um JWT valido.',
      );
    }
    const raw = await this.send('POST', '/api/access-tokens', undefined, {
      body: {
        emailOrUsername: this.config.email,
        password: this.config.password,
      },
      anonymous: true,
    });
    if (raw.status === 400 || raw.status === 401) {
      throw new AuthError(
        `login recusado pelo servidor (HTTP ${raw.status}) para "${this.config.email}". ` +
          `Confira KANBAN_SAFE_EMAIL e KANBAN_SAFE_PASSWORD.`,
      );
    }
    const payload = this.interpret('POST', '/api/access-tokens', raw);
    const token = payload?.item;
    if (typeof token !== 'string' || !token) {
      throw new AuthError(
        'o servidor aceitou o login mas nao devolveu um token em `item`. ' +
          'A rota /api/access-tokens pode ter mudado de formato.',
      );
    }
    this.token = token;
    this.tokenExpiresAtMs = decodeJwtExpiryMs(token);
    return token;
  }

  private clearToken(): void {
    this.token = undefined;
    this.tokenExpiresAtMs = undefined;
  }

  /** Renova pelo `exp` do proprio JWT, nao por um TTL adivinhado. */
  private async ensureToken(): Promise<string> {
    const valid =
      this.token &&
      (this.tokenExpiresAtMs === undefined ||
        this.tokenExpiresAtMs - this.deps.now() > TOKEN_SKEW_MS);
    if (valid) return this.token!;
    if (this.token && this.tokenIsFixed) {
      // Expirado e sem como renovar: deixa a chamada seguir e falhar com 401 explicado.
      return this.token;
    }
    // Uma unica autenticacao em voo, mesmo com chamadas concorrentes.
    if (!this.authInFlight) {
      this.authInFlight = this.authenticate().finally(() => {
        this.authInFlight = undefined;
      });
    }
    return this.authInFlight;
  }

  /** Envia com timeout e retry; devolve a resposta crua, sem interpretar status. */
  private async send(
    method: string,
    path: string,
    token: string | undefined,
    options: RequestOptions,
  ): Promise<RawResponse> {
    const url = this.config.baseUrl + path;
    const headers: Record<string, string> = {
      // O servidor responde 403 a User-Agent que nao reconhece.
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const maxAttempts = options.noRetry ? 1 : MAX_ATTEMPTS;
    let lastCause: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const res = await this.deps.fetch(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        const text = await res.text();
        const raw: RawResponse = {
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          text,
        };
        // 5xx e transitorio; 4xx nunca se repete.
        if (res.status >= 500 && attempt < maxAttempts) {
          await this.deps.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        return raw;
      } catch (cause) {
        lastCause = cause;
        if (attempt >= maxAttempts) break;
        await this.deps.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new NetworkError(method, path, maxAttempts, lastCause);
  }

  /**
   * Traduz status + corpo em dado ou erro nomeado.
   * A guarda de HTML vem antes de qualquer JSON.parse (invariante 1).
   */
  private interpret(method: string, path: string, raw: RawResponse): any {
    const body = raw.text ?? '';
    const looksHtml = raw.contentType.includes('text/html') || body.trimStart().startsWith('<');
    if (looksHtml) {
      throw new RouteNotFoundError(method, path, raw.status);
    }

    let json: any = undefined;
    if (body.trim()) {
      if (!raw.contentType.includes('json')) {
        throw new HttpError(
          method,
          path,
          raw.status,
          `resposta com content-type "${raw.contentType || 'ausente'}", que nao e JSON: ${body.slice(0, 200)}`,
        );
      }
      try {
        json = JSON.parse(body);
      } catch {
        throw new HttpError(
          method,
          path,
          raw.status,
          `corpo anunciado como JSON mas ilegivel: ${body.slice(0, 200)}`,
        );
      }
    }

    if (raw.status >= 200 && raw.status < 300) {
      this.detector.observe(json);
      return json;
    }

    const code = typeof json?.code === 'string' ? json.code : undefined;
    const problems: string[] = Array.isArray(json?.problems)
      ? json.problems.map((p: unknown) => String(p))
      : [];

    if (raw.status === 404) {
      throw new ResourceNotFoundError(
        method,
        path,
        typeof json?.message === 'string' ? json.message : undefined,
      );
    }
    if (raw.status === 400) {
      throw new ValidationError(method, path, problems.length ? problems : code ? [code] : []);
    }
    if (raw.status === 401) {
      throw new AuthError(`${method} ${path} devolveu 401 (nao autenticado).`);
    }
    if (raw.status === 403) {
      throw new AuthError(
        `${method} ${path} devolveu 403. Ou a conta nao tem permissao neste recurso, ou o ` +
          `servidor barrou o User-Agent — este cliente envia "${USER_AGENT}".`,
      );
    }
    throw new HttpError(method, path, raw.status, body);
  }
}
