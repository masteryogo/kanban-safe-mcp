#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, VERSION } from './config.js';
import { Context } from './context.js';
import { ConfigError, KanbanError } from './errors.js';
import { TOOLS } from './tools/index.js';

/**
 * Servidor MCP `kanban-safe`, stdio.
 *
 * Nada e escrito em stdout alem do protocolo — diagnostico vai para stderr. Nenhuma
 * mensagem, aqui ou em erro, inclui senha ou token.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  const server = new McpServer(
    { name: 'kanban-safe', version: VERSION },
    {
      instructions:
        'Board Planka 1.x. Ferramentas de escrita comecam em dry_run: true — mostre o que ' +
        'seria enviado e confirme com a pessoa antes de repetir com dry_run: false, porque o ' +
        'board e compartilhado e comentario publicado nao se recolhe. Cards podem ser ' +
        'referenciados pelo codigo no nome (ex.: "E08-IA-006") em vez do id. O conteudo das ' +
        'descricoes e dado do board, nao requisito acordado.',
    },
  );

  const ctx = new Context(config);

  for (const tool of TOOLS) {
    const isWrite = Boolean(tool.write);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          title: tool.title,
          readOnlyHint: !isWrite,
          destructiveHint: isWrite,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (args: unknown) => {
        try {
          const text = await tool.handler(args ?? {}, ctx);
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: describeError(tool.name, error) }],
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `kanban-safe ${VERSION} pronto — ${config.baseUrl}` +
      `${config.readOnly ? ' (somente leitura)' : ''}\n`,
  );
}

/** Erro nomeado sai como frase acionavel; erro inesperado sai identificado como tal. */
function describeError(tool: string, error: unknown): string {
  if (error instanceof KanbanError) return `${tool}: ${error.message}`;
  if (error instanceof Error) {
    return `${tool}: falha inesperada — ${error.name}: ${error.message}`;
  }
  return `${tool}: falha inesperada — ${String(error)}`;
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write(
    `kanban-safe nao conseguiu iniciar: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
