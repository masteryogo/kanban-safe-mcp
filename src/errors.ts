/**
 * Erros do kanban-safe.
 *
 * Cada classe corresponde a uma falha que o servidor real produz de um jeito
 * diferente do que o status HTTP sugere. A mensagem e escrita para ser lida pelo
 * modelo ou pela pessoa: metodo, rota, campo e o que fazer.
 */

export class KanbanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Rota inexistente disfarcada de 200: o servidor devolve o HTML do frontend.
 * E a falha mais perigosa, porque `response.ok` e true.
 */
export class RouteNotFoundError extends KanbanError {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
  ) {
    super(
      `rota nao existe nesta versao da API (o servidor devolveu o HTML do frontend com status ${status}): ${method} ${path}`,
    );
  }
}

/** Recurso inexistente: JSON 404 com `code: E_NOT_FOUND`. Distinto de rota ausente. */
export class ResourceNotFoundError extends KanbanError {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly serverMessage?: string,
  ) {
    super(
      `recurso nao encontrado: ${method} ${path}${serverMessage ? ` — ${serverMessage}` : ''}. ` +
        `A rota existe; o id e que nao corresponde a nenhum registro.`,
    );
  }
}

/** 400 `E_MISSING_OR_INVALID_PARAMS` — traduz `problems[]` para uma frase unica. */
export class ValidationError extends KanbanError {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly problems: string[],
  ) {
    const detail = problems.length ? problems.join(' ') : 'o servidor nao detalhou o problema.';
    super(`${method} ${path} rejeitado pelo servidor (400): ${detail}`);
  }
}

/** 401/403 apos a reautenticacao unica ja ter sido tentada. */
export class AuthError extends KanbanError {
  constructor(message: string) {
    super(message);
  }
}

/** Qualquer outro status inesperado, ja com o corpo resumido. */
export class HttpError extends KanbanError {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} falhou com HTTP ${status}: ${body.slice(0, 400)}`);
  }
}

/** Rede indisponivel ou timeout, ja depois de esgotadas as tentativas. */
export class NetworkError extends KanbanError {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly attempts: number,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${method} ${path} nao completou apos ${attempts} tentativa(s): ${reason}`);
  }
}

/**
 * O item devolvido pelo servidor nao bate com o que se pediu.
 * Unica defesa contra o descarte silencioso de campo desconhecido.
 */
export class WriteVerificationError extends KanbanError {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly divergences: string[],
  ) {
    super(
      `${method} ${path} retornou 200 mas o item devolvido nao reflete o que foi pedido: ` +
        `${divergences.join('; ')}. O servidor descarta campo desconhecido em silencio — ` +
        `confira o nome do campo antes de repetir.`,
    );
  }
}

/** Codigo/nome que casa com mais de um card, lista ou label. Nunca escolher sozinho. */
export class AmbiguousReferenceError extends KanbanError {
  constructor(
    readonly kind: string,
    readonly query: string,
    readonly candidates: Array<{ id: string; name: string }>,
  ) {
    // Lista longa nao ajuda o modelo a decidir e queima contexto; mostra as primeiras.
    const MAX = 15;
    const shown = candidates.slice(0, MAX);
    const list = shown.map((c) => `  ${c.id}  ${c.name}`).join('\n');
    const rest =
      candidates.length > MAX
        ? `\n  ... e mais ${candidates.length - MAX}. Refine a referencia ou use kanban_find_cards.`
        : '';
    super(
      `"${query}" casa com ${candidates.length} ${kind}s. Escolha um id e repita:\n${list}${rest}`,
    );
  }
}

/** Nada casou com a referencia dada. */
export class UnresolvedReferenceError extends KanbanError {
  constructor(
    readonly kind: string,
    readonly query: string,
    readonly hint?: string,
  ) {
    super(`nenhum ${kind} corresponde a "${query}"${hint ? `. ${hint}` : ''}`);
  }
}

/** Escrita tentada com KANBAN_SAFE_READ_ONLY=1. */
export class ReadOnlyError extends KanbanError {
  constructor(readonly tool: string) {
    super(
      `${tool} e uma ferramenta de escrita e o servidor esta em modo somente leitura ` +
        `(KANBAN_SAFE_READ_ONLY=1). Remova a variavel para permitir escrita.`,
    );
  }
}

/** Erro de configuracao detectado no start, nao na primeira chamada. */
export class ConfigError extends KanbanError {}
