import { z } from 'zod';
import { boardIdField, cardField, defineTool, dryRunField } from './tool.js';
import { listActions, updateComment } from '../api/comments.js';
import { previewWrite } from '../context.js';
import { renderJson } from '../format.js';
import { UnresolvedReferenceError } from '../errors.js';

export const updateCommentTool = defineTool({
  name: 'kanban_update_comment',
  title: 'Editar um comentario',
  description:
    'Reescreve o texto de um comentario ja publicado. Serve para corrigir erro ou ' +
    'reformatar em markdown sem poluir o card com uma segunda versao do mesmo recado. ' +
    'So o AUTOR edita o proprio comentario. O texto antigo NAO fica guardado em lugar ' +
    'nenhum: depois de editar, some — por isso o dry_run mostra o que esta la hoje.',
  write: true,
  schema: {
    commentId: z
      .string()
      .min(1)
      .describe('Id do comentario, como vem em kanban_get_comments.'),
    text: z.string().min(1).describe('Novo texto integral, em markdown. Substitui o anterior.'),
    card: cardField.optional().describe('Card do comentario — so para conferir no dry_run.'),
    boardId: boardIdField,
    dry_run: dryRunField,
  },
  async handler(args, ctx) {
    ctx.assertWritable('kanban_update_comment');

    // O texto atual so e alcancavel pelo card: nao ha GET /api/comment-actions/:id neste
    // servidor. Sem o card informado, o dry_run mostra a rota mas nao o estado atual.
    let atual: string | undefined;
    let cardName: string | undefined;
    if (args.card) {
      const card = await ctx.resolveCard(args.card, args.boardId);
      cardName = card.name;
      const { items } = await listActions(ctx.client, card.id);
      const alvo = items.find((a) => a.id === args.commentId.trim());
      if (!alvo) {
        throw new UnresolvedReferenceError(
          'comentario',
          args.commentId,
          `nenhum comentario com esse id no card "${card.name}"; confira com kanban_get_comments.`,
        );
      }
      atual = String((alvo.data as { text?: unknown } | undefined)?.text ?? '');
    }

    const path = `/api/comment-actions/${args.commentId.trim()}`;

    if (args.dry_run) {
      return previewWrite([
        {
          method: 'PATCH',
          path,
          body: { text: args.text },
          current:
            atual === undefined
              ? { nota: 'passe `card` para ver o texto atual antes de sobrescrever' }
              : { card: cardName, textoAtual: atual },
          note: 'o texto atual sera PERDIDO — o servidor nao guarda versao anterior',
        },
      ]);
    }

    const action = await updateComment(ctx.client, args.commentId.trim(), args.text);

    // write-then-verify (invariante 9): o servidor pode descartar campo desconhecido em
    // silencio, entao conferimos que o texto que voltou e o que mandamos.
    const gravado = String((action.data as { text?: unknown } | undefined)?.text ?? '');
    const confere = gravado === args.text;

    return renderJson({
      editado: { id: action.id, at: action.updatedAt, card: cardName },
      rota: `PATCH ${path}`,
      confere,
      ...(confere
        ? {}
        : {
            alerta:
              'o texto devolvido pelo servidor difere do enviado — confira com kanban_get_comments',
            tamanhoEnviado: args.text.length,
            tamanhoGravado: gravado.length,
          }),
    });
  },
});
