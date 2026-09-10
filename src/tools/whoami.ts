import { defineTool } from './tool.js';
import { getMe, listProjects } from '../api/boards.js';
import { renderJson } from '../format.js';

export const whoami = defineTool({
  name: 'kanban_whoami',
  title: 'Diagnostico da conexao',
  description:
    'Confere a conexao com o servidor: usuario autenticado, projetos e boards visiveis, ' +
    'board padrao, modo somente-leitura e a versao da API detectada por observacao. ' +
    'Use quando qualquer outra ferramenta falhar, para separar problema de credencial ' +
    'de problema de rota.',
  schema: {},
  async handler(_args, ctx) {
    const me = await getMe(ctx.client);
    const { projects, boards } = await listProjects(ctx.client);

    // /users/me e /projects nao trazem `included.tasks`, entao nao decidem a versao.
    // Uma leitura do board decide — e fica no cache para as chamadas seguintes.
    let boardLido: string | undefined;
    if (ctx.config.defaultBoardId || boards[0]) {
      const alvo = ctx.config.defaultBoardId ?? boards[0]!.id;
      try {
        const board = await ctx.board(alvo);
        boardLido = `${board.item.name} — ${board.lists.length} listas, ${board.cards.length} cards, ${board.tasks.length} tasks`;
      } catch (error) {
        boardLido = `falhou ao ler o board ${alvo}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    return renderJson({
      servidor: ctx.client.baseUrl,
      usuario: { id: me.id, name: me.name, username: me.username, email: me.email },
      apiDetectada: ctx.client.detector.describe(),
      boardPadrao: ctx.config.defaultBoardId ?? '(nenhum; passe boardId nas chamadas)',
      boardLido,
      somenteLeitura: ctx.config.readOnly,
      projetos: projects.map((p) => ({ id: p.id, name: p.name })),
      boards: boards.map((b) => ({ id: b.id, name: b.name, projectId: b.projectId })),
    });
  },
});
