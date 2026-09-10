import { describe, expect, it } from 'vitest';
import { assertWrite, diffWrite } from '../../src/verify.js';
import { WriteVerificationError } from '../../src/errors.js';

describe('write-then-verify (invariante 9)', () => {
  it('campo descartado em silencio pelo servidor vira divergencia', () => {
    // PATCH /api/cards/:id com {"type":"project"} volta 200 sem 'type'.
    const divergences = diffWrite({ type: 'project' }, { id: '1', name: 'card' });
    expect(divergences).toHaveLength(1);
    expect(divergences[0]).toContain('"type" nao aparece no item devolvido');
  });

  it('valor gravado diferente do pedido vira divergencia com os dois lados', () => {
    const divergences = diffWrite({ name: 'novo' }, { name: 'antigo' });
    expect(divergences[0]).toContain('pedi "novo"');
    expect(divergences[0]).toContain('gravou "antigo"');
  });

  it('campo extra na resposta nao e divergencia', () => {
    expect(diffWrite({ name: 'x' }, { name: 'x', campoNovoDoServidor: 1 })).toEqual([]);
  });

  it('descricao vazia gravada como null passa', () => {
    expect(diffWrite({ description: '' }, { description: null })).toEqual([]);
  });

  it('mesma data em formato diferente passa', () => {
    expect(
      diffWrite({ dueDate: '2026-10-01T12:00:00Z' }, { dueDate: '2026-10-01T12:00:00.000Z' }),
    ).toEqual([]);
  });

  it('campos ignorados (position) nao sao conferidos', () => {
    expect(diffWrite({ position: 65536 }, { position: 70000 }, ['position'])).toEqual([]);
  });

  it('resposta sem item nenhum e divergencia', () => {
    expect(diffWrite({ name: 'x' }, undefined)[0]).toContain('nao devolveu o item');
  });

  it('assertWrite lanca com a explicacao do descarte silencioso', () => {
    const error = (() => {
      try {
        assertWrite('PATCH', '/api/cards/1', { type: 'project' }, { id: '1' });
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(WriteVerificationError);
    expect((error as Error).message).toContain('descarta campo desconhecido em silencio');
  });
});
