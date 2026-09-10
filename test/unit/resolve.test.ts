import { describe, expect, it } from 'vitest';
import {
  extractCode,
  looksLikeId,
  resolveCard,
  resolveLabel,
  resolveList,
} from '../../src/resolve.js';
import { AmbiguousReferenceError, UnresolvedReferenceError } from '../../src/errors.js';
import { getBoard } from '../../src/api/boards.js';
import { KanbanClient } from '../../src/client.js';
import { boardPayload, CARDS, BOARD_ID } from './fixtures.js';
import { fakeFetch, json, makeConfig, makeJwt } from './helpers.js';

const board = await (async () => {
  const fake = fakeFetch([{ status: 200, body: json(boardPayload()) }]);
  const client = new KanbanClient(
    makeConfig({ token: makeJwt(Math.floor(Date.now() / 1000) + 86_400 * 365) }),
    { fetch: fake.fetch, sleep: async () => {}, now: () => Date.now() },
  );
  return getBoard(client, BOARD_ID);
})();

describe('extractCode', () => {
  it('extrai o codigo do inicio do nome do card', () => {
    expect(extractCode('E08-IA-006 Pipeline de rPPG')).toBe('E08-IA-006');
    expect(extractCode('E03-APP-005 Tela de consulta')).toBe('E03-APP-005');
  });

  it('devolve undefined quando o nome nao tem codigo', () => {
    expect(extractCode('Revisar contrato')).toBeUndefined();
    expect(extractCode(undefined)).toBeUndefined();
  });
});

describe('looksLikeId', () => {
  it('reconhece snowflake e recusa codigo', () => {
    expect(looksLikeId('1851000000000000001')).toBe(true);
    expect(looksLikeId('E08-IA-006')).toBe(false);
  });
});

describe('resolveCard', () => {
  it('resolve por id exato', () => {
    expect(resolveCard(board, CARDS[0]!.id).id).toBe(CARDS[0]!.id);
  });

  it('resolve por codigo, sem diferenciar caixa', () => {
    expect(resolveCard(board, 'e08-ia-006').id).toBe(CARDS[0]!.id);
  });

  it('resolve por prefixo do nome', () => {
    expect(resolveCard(board, 'E03-APP-005 Tela').id).toBe(CARDS[1]!.id);
  });

  it('codigo ambiguo falha listando os candidatos, sem escolher', () => {
    const error = (() => {
      try {
        resolveCard(board, 'E03-APP');
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(AmbiguousReferenceError);
    const message = (error as Error).message;
    expect(message).toContain('casa com 2 cards');
    expect(message).toContain(CARDS[1]!.id);
    expect(message).toContain(CARDS[2]!.id);
  });

  it('referencia sem correspondencia aponta o caminho', () => {
    const error = (() => {
      try {
        resolveCard(board, 'Z99-NADA-001');
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(UnresolvedReferenceError);
    expect((error as Error).message).toContain('kanban_find_cards');
  });
});

describe('resolveList e resolveLabel', () => {
  it('resolvem por nome e listam as opcoes quando nao acham', () => {
    expect(resolveList(board, 'ToDo').id).toBe(board.lists[1]!.id);
    expect(resolveLabel(board, 'ia').id).toBe(board.labels[0]!.id);
    expect(() => resolveList(board, 'Inexistente')).toThrow(/Backlog, ToDo, In progress/);
  });

  it('nome exato ganha de nome que apenas contem o texto', () => {
    // "In progress" contem "progress"; "ToDo" e exato para "todo".
    expect(resolveList(board, 'todo').name).toBe('ToDo');
  });
});
