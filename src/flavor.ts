/**
 * Deteccao de versao da API por observacao, nao por configuracao (invariante 2).
 *
 * Regra: se algum `included` de resposta traz `taskLists`, o servidor e 2.0; se traz
 * `tasks` sem `taskLists`, e 1.x. Enquanto nenhuma resposta tiver chegado, o flavor e
 * `unknown` e as rotas da 1.x sao usadas como caminho principal — que e o servidor real
 * de hoje. A decisao e tomada uma vez e nao volta atras.
 */
export type ApiFlavor = 'v1' | 'v2' | 'unknown';

export class FlavorDetector {
  private value: ApiFlavor = 'unknown';

  get flavor(): ApiFlavor {
    return this.value;
  }

  /** Rotas da 1.x sao o caminho principal ate que uma resposta prove 2.0. */
  get isV2(): boolean {
    return this.value === 'v2';
  }

  /** Alimenta o detector com o corpo de qualquer resposta ja parseada. */
  observe(payload: unknown): void {
    if (this.value !== 'unknown') return;
    const included = (payload as { included?: unknown } | null)?.included;
    if (!included || typeof included !== 'object') return;
    const keys = included as Record<string, unknown>;
    if ('taskLists' in keys) {
      this.value = 'v2';
    } else if ('tasks' in keys) {
      this.value = 'v1';
    }
  }

  describe(): string {
    switch (this.value) {
      case 'v2':
        return 'Planka 2.x (a resposta trouxe included.taskLists)';
      case 'v1':
        return 'Planka 1.x (a resposta trouxe included.tasks, sem taskLists)';
      default:
        return 'ainda nao observada; usando as rotas da 1.x como caminho principal';
    }
  }
}
