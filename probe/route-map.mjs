#!/usr/bin/env node
/**
 * Reproduz a medicao da API deste servidor, que originou o mapa de rotas do README.
 *
 * Uso:
 *   KANBAN_SAFE_BASE_URL=... KANBAN_SAFE_EMAIL=... KANBAN_SAFE_PASSWORD=... node probe/route-map.mjs
 *   (ou KANBAN_SAFE_TOKEN=... em vez de e-mail/senha)
 *
 * Só faz leitura e escritas deliberadamente invalidas (corpo vazio ou valor fora do
 * whitelist), que o servidor rejeita com 400 sem gravar nada. A unica excecao sao os
 * PATCH de corpo vazio, que retornam 200 e mexem apenas em `updatedAt`.
 *
 * Nao imprime senha nem token.
 */
import process from 'node:process';

const base = (process.env.KANBAN_SAFE_BASE_URL || '').replace(/\/$/, '');
if (!base) {
  console.error('falta KANBAN_SAFE_BASE_URL');
  process.exit(1);
}
const UA = 'kanban-safe-probe/0.1';

async function call(method, path, { token, body } = {}) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t0 = Date.now();
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json') && !text.startsWith('<');
  return {
    status: res.status,
    json: isJson ? JSON.parse(text) : null,
    html: !isJson,
    ms: Date.now() - t0,
    bytes: text.length,
  };
}

function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return depth > 1
      ? `array[${value.length}]`
      : `array[${value.length}]${value.length ? ' of ' + shape(value[0], depth + 1) : ''}`;
  }
  if (typeof value === 'object') {
    if (depth > 1) return '{...}';
    return '{' + Object.keys(value).join(', ') + '}';
  }
  return typeof value;
}

async function getToken() {
  if (process.env.KANBAN_SAFE_TOKEN) return process.env.KANBAN_SAFE_TOKEN;
  const res = await call('POST', '/api/access-tokens', {
    body: {
      emailOrUsername: process.env.KANBAN_SAFE_EMAIL,
      password: process.env.KANBAN_SAFE_PASSWORD,
    },
  });
  if (res.status !== 200) throw new Error(`login falhou: ${res.status}`);
  return res.json.item;
}

const token = await getToken();
const [, payload] = token.split('.');
const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
const days = Math.round((claims.exp - claims.iat) / 86400);
console.log(`token: valido por ${days} dias (exp ${new Date(claims.exp * 1000).toISOString()})`);

const projects = await call('GET', '/api/projects', { token });
const project = projects.json.items[0];
const board = projects.json.included.boards[0];
console.log(`projeto ${project.id} (${project.name}) / board ${board.id} (${board.name})`);

const boardRes = await call('GET', `/api/boards/${board.id}`, { token });
console.log(`GET /api/boards/:id -> ${boardRes.status}, ${boardRes.ms}ms, ${(boardRes.bytes / 1024).toFixed(0)}KB`);
for (const [key, value] of Object.entries(boardRes.json.included)) {
  console.log(`  included.${key}: ${shape(value)}`);
}

const incl = boardRes.json.included;
const list = incl.lists[0];
const label = incl.labels[0];
const card = incl.cards.find((c) => incl.tasks.some((t) => t.cardId === c.id)) || incl.cards[0];
console.log(`\ncard de teste: ${card.id} (${card.name.slice(0, 60)})`);

// GET: rota inexistente devolve HTML com 200
console.log('\n-- GET (html=true significa rota inexistente disfarcada de 200) --');
for (const path of [
  `/api/cards/${card.id}`,
  `/api/cards/${card.id}/actions`,
  `/api/cards/${card.id}/tasks`,
  `/api/cards/${card.id}/task-lists`,
  `/api/boards/${board.id}/lists`,
  '/api/nope',
]) {
  const r = await call('GET', path, { token });
  console.log(`GET ${path} -> ${r.status} html=${r.html}`);
}

// POST com corpo vazio: 400 = rota existe e valida; 404 = rota ausente
console.log('\n-- POST corpo vazio (400 = rota existe / 404 = rota ausente) --');
for (const path of [
  `/api/cards/${card.id}/tasks`,
  `/api/cards/${card.id}/task-lists`,
  `/api/cards/${card.id}/comment-actions`,
  `/api/cards/${card.id}/comments`,
  `/api/cards/${card.id}/labels`,
  `/api/cards/${card.id}/card-labels`,
  `/api/cards/${card.id}/memberships`,
  `/api/cards/${card.id}/duplicate`,
  `/api/lists/${list.id}/cards`,
  `/api/boards/${board.id}/lists`,
  `/api/boards/${board.id}/labels`,
  `/api/projects/${project.id}/boards`,
]) {
  const r = await call('POST', path, { token, body: {} });
  const problems = r.json?.problems ? ' :: ' + r.json.problems.join(' ') : '';
  console.log(`POST ${path} -> ${r.status} ${r.json?.code || ''}${problems}`);
}

// whitelist de cor de label, extraido da mensagem de erro
const badColor = await call('POST', `/api/boards/${board.id}/labels`, {
  token,
  body: { name: 'probe', position: 1, color: 'not-a-color' },
});
const whitelist = badColor.json?.problems?.[0]?.match(/whitelist \(([^)]+)\)/)?.[1];
console.log('\ncores aceitas:', whitelist ? whitelist.split(', ').length + ' -> ' + whitelist : 'nao extraido');

// campo desconhecido em PATCH e descartado em silencio
const patched = await call('PATCH', `/api/cards/${card.id}`, { token, body: { type: 'project' } });
console.log(`\nPATCH card com {type} -> ${patched.status}; 'type' na resposta: ${'type' in (patched.json?.item || {})}`);
