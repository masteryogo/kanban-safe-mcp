# kanban-safe

Servidor MCP de uso interno da **MedSafe Brasil**, para o board Planka **1.x** hospedado
em `kanban.softsafe.com.br`, escrito contra a API que este servidor realmente expõe.
Não é para publicação nem distribuição externa. Substitui o `@gogogadgetbytes/planka-mcp`, que foi
escrito para a API 2.0 e falha aqui de formas que o cliente não percebe: rota da 2.0 que
não existe, e validação da resposta com schema fechado que derruba chamadas que o
servidor atendeu com 200.

Todo fato de API registrado abaixo foi medido contra o servidor real em 2026-09-09.
[`probe/route-map.mjs`](probe/route-map.mjs) reproduz a medição a qualquer momento — é a
forma de reconferir isto tudo se o servidor mudar.

## Os 11 invariantes

Cada um responde a uma falha observada, e todos têm teste. O código cita estes números.

1. **Guarda de content-type.** Antes de qualquer `JSON.parse`, checar que o corpo é JSON e
   não começa com `<`. Rota inexistente neste servidor devolve **200 com o HTML do
   frontend**, então `response.ok` é `true` e um cliente ingênuo estoura com
   `SyntaxError: Unexpected token '<'`.
2. **Escrever contra a 1.x, com detecção de versão por observação.** As rotas da 1.x são o
   caminho principal. A versão é decidida uma vez por processo olhando a resposta: se algum
   `included` traz `taskLists`, é 2.0; se traz `tasks`, é 1.x.
3. **Não validar resposta com schema fechado.** `zod` só na **entrada** das ferramentas. Da
   resposta, leitura defensiva campo a campo. Campo novo ou faltante do servidor não pode
   derrubar uma chamada que retornou 200.
4. **Token pelo `exp` do JWT.** Decodificar o payload e renovar quando faltar menos de 5
   minutos, em vez de adivinhar um TTL. Retry único em 401. Aceita token pronto por
   variável de ambiente, para operar sem senha em disco.
5. **Saída compacta por padrão.** Nenhuma ferramenta devolve o board inteiro. `description`
   só quando pedida. Todo filtro é do lado do cliente, porque o servidor ignora query
   string.
6. **Cache curto do board.** Uma leitura custa ~700 ms e ~735 KB. Cache de ~30 s em memória,
   invalidado após qualquer escrita. É ele que torna baratas a resolução por código e a
   busca.
7. **Resolver card por código, não só por id.** `card: "E08-IA-006"` resolve pelo código no
   nome. Referência ambígua **falha listando os candidatos** — a ferramenta nunca escolhe
   sozinha.
8. **`dry_run` em toda ferramenta de escrita**, e é o padrão. Devolve a rota, o corpo e o
   estado atual do que seria sobrescrito, sem chamar o servidor. O board é compartilhado
   com colegas e comentário publicado não se recolhe.
9. **write-then-verify.** Depois de `POST`/`PATCH`, comparar o item devolvido com o que se
   pediu e reportar divergência como erro. É a única defesa contra o descarte silencioso
   de campo desconhecido.
10. **Reescrita de checklist é criar-antes-de-apagar.** `kanban_replace_tasks` cria as novas
    tasks, confere na releitura que existem no servidor e só então apaga as antigas; e
    devolve o texto integral do que removeu.
11. **Erro legível e acionável.** `problems[]` do servidor traduzido para uma frase com
    método, rota, campo e o que fazer. Timeout de 30 s; retry com backoff (3 tentativas)
    só em erro de rede e 5xx — nunca em 4xx, e nunca no `POST` de comentário, para não
    duplicar publicação.

Header fixo em todas as requisições: `User-Agent: kanban-safe/<versão>`. O servidor
responde **403 a User-Agent que não reconhece** (o `urllib` do Python levou 403 nas mesmas
chamadas que `curl` e o `fetch` do Node atenderam com 200). Não mandar UA vazio.

## Instalação

Requer **Node 20 ou mais novo** (desenvolvido e verificado no 22.23.2). O `fetch` é nativo,
então não há cliente HTTP para instalar.

O pacote é privado e **não está em registry nenhum**: `npm install kanban-safe` não existe
e não vai existir. Para instalar em outra máquina, leve o diretório do projeto — sem
`node_modules/` nem `dist/`, que são regenerados — e rode, dentro dele:

```bash
git clone https://github.com/masteryogo/kanban-safe-mcp.git
cd kanban-safe-mcp
npm install       # baixa as dependencias para ./node_modules
npm run build     # compila src/ em dist/index.js, que e o que o Claude Code executa
npm test          # 65 testes unitarios, com fetch dublado; nenhuma chamada de rede
```

`npm install` sem argumento **não instala o `kanban-safe`** — o `kanban-safe` é o próprio
diretório. Ele lê o `package.json` dali e baixa as dependências dele:

| Pacote | Onde | Para quê |
|---|---|---|
| `@modelcontextprotocol/sdk` | runtime | protocolo MCP e transporte stdio |
| `zod` | runtime | schema de entrada das ferramentas |
| `typescript` | dev | compila `src/` em `dist/` |
| `@types/node` | dev | tipos dos módulos `node:*` |
| `vitest` | dev | os testes |

Cinco diretas, 124 pacotes contando as transitivas (~86 MB em `node_modules`), e só as
duas primeiras existem em runtime. Depois do `build`, o servidor roda com
`node dist/index.js` e as variáveis da seção seguinte.

## Configuração

| Variável | Obrigatória | Função |
|---|---|---|
| `KANBAN_SAFE_BASE_URL` | sim | `https://kanban.softsafe.com.br` |
| `KANBAN_SAFE_EMAIL` | sim, sem token | e-mail ou username |
| `KANBAN_SAFE_PASSWORD` | sim, sem token | senha |
| `KANBAN_SAFE_TOKEN` | não | JWT pronto; dispensa e-mail e senha |
| `KANBAN_SAFE_DEFAULT_BOARD_ID` | não | torna `boardId` opcional nas chamadas |
| `KANBAN_SAFE_READ_ONLY` | não | `1` desabilita todas as ferramentas de escrita |
| `KANBAN_SAFE_TIMEOUT_MS` | não | padrão 30000 |
| `KANBAN_SAFE_CACHE_TTL_MS` | não | padrão 30000 |
| `KANBAN_SAFE_E2E` | não | `1` habilita os testes de contrato |
| `KANBAN_SAFE_E2E_WRITE_LIST` | não | nome da lista descartável do ciclo de escrita |

Faltando variável obrigatória, o servidor falha **no start**, nomeando o que falta.
Senha e token nunca aparecem em log nem em mensagem de erro.

O JWT deste servidor vale 365 dias, e o cliente renova pelo `exp` do próprio token. Para
não guardar senha em arquivo de configuração, gere um token e use `KANBAN_SAFE_TOKEN`.
`GET /api/config` **não** informa a versão do Planka — daí a detecção por observação.

**Não há credencial nenhuma neste repositório, e é só isso que protege o board.** Não
existe trava, verificação de licença ou token embutido no código: o que impede um clone de
acessar o board é a *ausência* de segredo, não um controle. O JWT vive em `~/.claude.json`,
fora do projeto, e o `.gitignore` exclui `.env*`. Quem clonar recebe o código e acesso
nenhum — para usar, precisa de uma credencial própria emitida pelo servidor. O que mantém
isso verdadeiro é ninguém commitar credencial, e não o repositório recusar.

## Registro no Claude Code

```powershell
claude mcp add kanban-safe -s user `
  -e KANBAN_SAFE_BASE_URL=https://kanban.softsafe.com.br `
  -e KANBAN_SAFE_TOKEN=<jwt> `
  -e KANBAN_SAFE_DEFAULT_BOARD_ID=1849792702397285816 `
  -- node C:/Users/joaop/Documents/kanban-safe/dist/index.js

claude mcp list            # confere que subiu e responde
```

## Ferramentas

**Leitura**

| Ferramenta | Para quê |
|---|---|
| `kanban_whoami` | diagnóstico: usuário, board, versão da API detectada |
| `kanban_get_board` | listas com contagem + página de cards compactos, com filtro |
| `kanban_find_cards` | procura por código, prefixo ou texto, sobre o cache |
| `kanban_get_card` | um card com descrição, checklist (com ids) e labels |
| `kanban_get_comments` | comentários, que vêm de `/actions`, não do card |

**Escrita de card** — todas com `dry_run`

| Ferramenta | Rota 1.x |
|---|---|
| `kanban_create_card` | `POST /api/lists/:id/cards` |
| `kanban_update_card` | `PATCH /api/cards/:id` |
| `kanban_move_card` | `PATCH /api/cards/:id` (troca `listId` + `position`) |
| `kanban_add_comment` | `POST /api/cards/:id/comment-actions` |
| `kanban_set_labels` | `POST`/`DELETE /api/cards/:id/labels` |

**Checklist** — todas com `dry_run`

| Ferramenta | Rota 1.x |
|---|---|
| `kanban_add_tasks` | `POST /api/cards/:id/tasks` (`position` calculada) |
| `kanban_update_task` | `PATCH /api/tasks/:id` |
| `kanban_replace_tasks` | cria → confere → apaga |
| `kanban_delete_task` | `DELETE /api/tasks/:id` |

Fora do escopo por ora: anexos, criação de board/lista/label, gestão de membros. As rotas
estão no mapa abaixo se precisarem entrar depois; ficam de fora porque não aparecem no uso
do dia a dia e cada ferramenta cobra contexto em toda sessão.

## Mapa da API 1.x verificado

**Autenticação.** `POST /api/access-tokens` com `{emailOrUsername, password}` devolve
`{item: "<jwt>"}`. `GET /api/users/me` devolve o usuário. Nas demais,
`Authorization: Bearer <jwt>`.

**Leitura**

| Rota | Devolve |
|---|---|
| `GET /api/projects` | `items[]` + `included{users, projectManagers, boards, boardMemberships}` |
| `GET /api/boards/:id` | `item` + `included{users, boardMemberships, labels, lists, cards, cardMemberships, cardLabels, tasks, attachments, projects}` |
| `GET /api/cards/:id` | `item` + `included{cardMemberships, cardLabels, tasks, attachments}` — **sem comentários** |
| `GET /api/cards/:id/actions` | `items[]` + `included{users}` — é aqui que estão os comentários |
| `GET /api/notifications` | `items[]` + `included{users, cards, actions}` |

**Escrita**

| Método | Rota | Obrigatórios | Observação |
|---|---|---|---|
| POST | `/api/lists/:listId/cards` | `name` | `position` e `description` opcionais |
| PATCH | `/api/cards/:id` | — | `name`, `description`, `listId`, `position`, `dueDate`, `isDueDateCompleted` |
| POST | `/api/cards/:id/tasks` | `name`, `position` | `position` é obrigatório aqui |
| PATCH | `/api/tasks/:id` | — | `name`, `isCompleted` |
| POST | `/api/cards/:id/comment-actions` | `text` | comentário, append-only |
| POST | `/api/cards/:id/labels` | `labelId` | vincula label existente ao card |
| POST | `/api/cards/:id/memberships` | `userId` | atribui pessoa |
| POST | `/api/cards/:id/duplicate` | `position` | duplica card |
| POST | `/api/boards/:id/labels` | `name`, `color`, `position` | `color` no whitelist abaixo |
| POST | `/api/boards/:id/lists` | `name`, `position` | cria lista |
| POST | `/api/projects/:id/boards` | `name`, `position` | cria board |
| PATCH | `/api/lists/:id` | — | `name`, `position` |
| PATCH | `/api/labels/:id` | — | `name`, `color`, `position` |
| DELETE | `/api/cards/:id`, `/api/tasks/:id`, `/api/cards/:id/labels/:labelId` | — | exercitadas pelo teste de contrato de escrita |

**Rotas que não existem neste servidor** — todas são da 2.0 e devolvem 404:
`POST /api/cards/:id/comments` · `POST /api/cards/:id/card-labels` ·
`POST /api/cards/:id/task-lists` · `POST /api/task-lists/:id/tasks` ·
`PATCH /api/comment-actions/:id` · `PATCH /api/actions/:id`.
As duas últimas são o motivo de comentário ser tratado como **append-only**.

**Formatos.** Ids são strings numéricas de 19 dígitos (snowflake) — nunca tratar como
number, estouram o inteiro seguro do JavaScript. O card **não** tem `type` e a task **não**
tem `taskListId`: a task pendura direto no card. Comentário é uma action de
`type: "commentCard"` com o texto em `data.text`.

**`position`** é float e o passo da interface é 65536; inserir no meio significa média
entre vizinhos.

**Whitelist de cor de label deste servidor (25).** `modern-green` e `piggy-red` existem na
2.0 e **não** aqui — o servidor rejeita com 400. A lista vive em
[`src/api/labels.ts`](src/api/labels.ts).

## Testes

```powershell
npm test                       # unitários, sem rede

# contrato, contra o servidor real — só leitura
$env:KANBAN_SAFE_E2E="1"; npm run test:contract

# ciclo de escrita: exige uma lista descartável combinada com o dono do board.
# Cria um card, exercita PATCH/comentário/task/label/DELETE e apaga o card no fim.
$env:KANBAN_SAFE_E2E_WRITE_LIST="Done"; npm run test:contract
```

O ciclo de escrita é o único jeito de exercitar as rotas de `DELETE`, e por isso exige o
segundo consentimento explícito. Rodou em 2026-09-09 na lista `Done`: as três rotas de
`DELETE` existem e funcionam, e o board voltou ao estado anterior.

## Estrutura

```
src/
  index.ts       servidor MCP (stdio) e registro das ferramentas
  config.ts      variáveis de ambiente, validadas no start
  client.ts      HTTP: auth pelo exp do JWT, guarda de HTML, retry, erro legível
  flavor.ts      detecção 1.x vs 2.0 por observação
  cache.ts       cache de board com TTL e invalidação
  resolve.ts     código de card / nome de lista / nome de label -> id
  verify.ts      write-then-verify
  format.ts      recorte compacto das saídas
  position.ts    aritmética de position (passo 65536)
  api/           uma função por rota, sem lógica de MCP
  tools/         uma ferramenta por arquivo: schema zod de entrada + formatação
test/
  unit/          client, guarda de HTML, resolve, verify, dry_run, replace_tasks
  contract/      contra o servidor real, só com KANBAN_SAFE_E2E=1
probe/
  route-map.mjs  reproduz a medição da API contra o servidor real
```

Dependências de runtime: `@modelcontextprotocol/sdk` e `zod`. `fetch` é nativo no Node 22.

## Nota sobre o conteúdo do board

Boa parte das descrições dos cards foi gerada por IA em outras sessões e **não vale como
requisito acordado**. Os cards rastreáveis ao contrato são os que trazem `RF:` e `TR:` na
descrição. As ferramentas de leitura repetem esse aviso na saída: o que elas devolvem é
dado do board, não requisito.
