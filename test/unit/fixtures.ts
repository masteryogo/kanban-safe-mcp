/**
 * Board de teste no formato exato do servidor 1.x: tasks penduradas no
 * card, sem `taskLists`, sem `card.type`, ids como string de 19 digitos.
 */
export const BOARD_ID = '1849792702397285816';

export const LISTS = [
  { id: '1849792798606230970', position: 65535, name: 'Backlog', boardId: BOARD_ID },
  { id: '1849792870605653435', position: 131070, name: 'ToDo', boardId: BOARD_ID },
  { id: '1849792949903164860', position: 196605, name: 'In progress', boardId: BOARD_ID },
];

export const LABELS = [
  { id: '1850000000000000001', name: 'ia', color: 'berry-red', boardId: BOARD_ID },
  { id: '1850000000000000002', name: 'certificacao', color: 'navy-blue', boardId: BOARD_ID },
];

export const CARDS = [
  {
    id: '1851000000000000001',
    name: 'E08-IA-006 Pipeline de rPPG',
    description: 'RF: 12\nTR: 4',
    position: 65536,
    boardId: BOARD_ID,
    listId: LISTS[1]!.id,
    dueDate: null,
    isDueDateCompleted: null,
  },
  {
    id: '1851000000000000002',
    name: 'E03-APP-005 Tela de consulta',
    description: 'texto gerado por IA',
    position: 131072,
    boardId: BOARD_ID,
    listId: LISTS[0]!.id,
    dueDate: null,
    isDueDateCompleted: null,
  },
  {
    id: '1851000000000000003',
    name: 'E03-APP-006 Tela de receita',
    description: '',
    position: 196608,
    boardId: BOARD_ID,
    listId: LISTS[0]!.id,
    dueDate: null,
    isDueDateCompleted: null,
  },
];

export const TASKS = [
  {
    id: '1852000000000000001',
    name: 'definir ROI',
    isCompleted: true,
    position: 65536,
    cardId: CARDS[0]!.id,
  },
  {
    id: '1852000000000000002',
    name: 'avaliar em video real',
    isCompleted: false,
    position: 131072,
    cardId: CARDS[0]!.id,
  },
];

export const CARD_LABELS = [
  { id: '1853000000000000001', cardId: CARDS[0]!.id, labelId: LABELS[0]!.id },
];

export const USERS = [
  { id: '1', name: 'Agente', username: 'agente', email: 'agente@exemplo.com' },
  { id: '2', name: 'Melchisedek Lima', username: 'melchisedek', email: 'melk@exemplo.com' },
  // Mesmo primeiro nome do usuario 2: garante que referencia ambigua falhe
  // listando os candidatos, em vez de escolher sozinha (invariante 7).
  { id: '3', name: 'Melchisedek Souza', username: 'melsouza', email: 'souza@exemplo.com' },
  // Conta de servico como o servidor realmente devolve: `username` e `email`
  // vem NULL, nao ausentes. O tipo declara `?: string` e mente (invariante 3).
  { id: '4', name: 'Robo Integrador', username: null, email: null },
];

/**
 * CARDS[0] fica DE FORA de proposito: e o card que os testes de recorte usam, e
 * um campo a mais ali empurraria a saida para o formato multilinha, quebrando
 * assercoes que nada tem a ver com membro.
 */
export const CARD_MEMBERSHIPS = [
  { id: '1855000000000000001', cardId: CARDS[1]!.id, userId: USERS[1]!.id },
  // Associacao orfa: a pessoa saiu do board e o vinculo ficou para tras.
  // Nao pode derrubar a leitura (invariante 3).
  { id: '1855000000000000002', cardId: CARDS[1]!.id, userId: '999' },
  { id: '1855000000000000003', cardId: CARDS[2]!.id, userId: USERS[0]!.id },
];

export function boardPayload() {
  return {
    item: { id: BOARD_ID, name: 'telemedicina', projectId: '1849792488093517238' },
    included: {
      users: USERS,
      boardMemberships: [],
      labels: LABELS,
      lists: LISTS,
      cards: CARDS,
      cardMemberships: CARD_MEMBERSHIPS,
      cardLabels: CARD_LABELS,
      tasks: TASKS,
      attachments: [],
      projects: [{ id: '1849792488093517238', name: 'telemedicina' }],
    },
  };
}

export function cardPayload(cardId: string, tasks = TASKS) {
  const card = CARDS.find((c) => c.id === cardId);
  return {
    item: card ?? CARDS[0],
    included: {
      cardMemberships: CARD_MEMBERSHIPS.filter((m) => m.cardId === cardId),
      cardLabels: CARD_LABELS.filter((l) => l.cardId === cardId),
      tasks: tasks.filter((t) => t.cardId === cardId),
      attachments: [],
    },
  };
}
