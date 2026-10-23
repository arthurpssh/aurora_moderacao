const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { Outbox } = require('../src/services/outboxService');
const { createAstroflowClient } = require('../src/services/astroflowClient');
const { createRateLimiter } = require('../src/services/rateLimiter');
const { personaDoEmail } = require('../src/services/personaService');

// Sobe o app numa porta livre com Astroflow e planilha falsos
async function subir({ fetchImpl, max = 100, linhas } = {}) {
  process.env.ASTROFLOW_WEBHOOK_URL = 'http://astroflow.invalid/webhook';
  delete process.env.DEV_USER_EMAIL;
  const enviados = [];
  const fetchFalso = fetchImpl || (async (url, opts) => { enviados.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; });
  const sheet = linhas || [['space', 'mensagem', 'ts']];
  const outbox = new Outbox({ reader: { async readFrom(i) { return sheet.slice(i - 1); } } });
  await outbox.tick();
  const app = createApp({
    astroflow: createAstroflowClient({ fetchImpl: fetchFalso }),
    outbox,
    limiter: createRateLimiter({ max }),
  });
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const chamar = (caminho, { email, method = 'GET', body, headers = {} } = {}) => fetch(base + caminho, {
    method,
    headers: { ...(email ? { 'x-auth-request-email': email } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  return { chamar, enviados, sheet, outbox, fechar: () => server.close() };
}

test('health não exige autenticação', async () => {
  const s = await subir();
  const r = await s.chamar('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'ok' });
  s.fechar();
});

test('sem e-mail do ingress: 403 (api em JSON, página em HTML)', async () => {
  const s = await subir();
  const api = await s.chamar('/api/me');
  assert.equal(api.status, 403);
  assert.match((await api.json()).message, /identificar/);
  const pagina = await s.chamar('/');
  assert.equal(pagina.status, 403);
  assert.match(await pagina.text(), /Acesso não identificado/);
  s.fechar();
});

test('com e-mail: /api/me e a página', async () => {
  const s = await subir();
  const me = await (await s.chamar('/api/me', { email: 'arthur.santos@hotmart.com' })).json();
  assert.deepEqual(me, { email: 'arthur.santos@hotmart.com', nome: 'Arthur Santos', primeiroNome: 'Arthur' });
  const pagina = await s.chamar('/', { email: 'arthur.santos@hotmart.com' });
  assert.equal(pagina.status, 200);
  s.fechar();
});

test('enviar: o Astroflow recebe o evento do Chat com a persona de quem está logado', async () => {
  const s = await subir();
  const r = await s.chamar('/api/messages', { email: 'Maria.Silva@hotmart.com', method: 'POST', body: { text: 'oi Aurora' } });
  assert.equal(r.status, 202);
  assert.equal(s.enviados.length, 1);
  const ev = s.enviados[0].body;
  const p = personaDoEmail('maria.silva@hotmart.com');
  assert.equal(ev.message.argumentText, 'oi Aurora');
  assert.equal(ev.message.sender.name, p.userId);
  assert.equal(ev.message.sender.displayName, 'Maria Silva');
  assert.equal(ev.message.space.name, p.space);
  assert.equal(s.enviados[0].url, 'http://astroflow.invalid/webhook');
  s.fechar();
});

test('o navegador não consegue falar como outra pessoa (campos de identidade no corpo são ignorados)', async () => {
  const s = await subir();
  await s.chamar('/api/messages', {
    email: 'maria.silva@hotmart.com', method: 'POST',
    body: { text: 'oi', email: 'outra@hotmart.com', space: 'spaces/OUTRO', userId: 'users/1', sender: { name: 'users/2' } },
  });
  const ev = s.enviados[0].body;
  const p = personaDoEmail('maria.silva@hotmart.com');
  assert.equal(ev.message.space.name, p.space);
  assert.equal(ev.message.sender.name, p.userId);
  s.fechar();
});

test('validações do envio', async () => {
  const s = await subir();
  const e = 'a@hotmart.com';
  assert.equal((await s.chamar('/api/messages', { email: e, method: 'POST', body: { text: '   ' } })).status, 400);
  assert.equal((await s.chamar('/api/messages', { email: e, method: 'POST', body: {} })).status, 400);
  assert.equal((await s.chamar('/api/messages', { email: e, method: 'POST', body: { text: 'x'.repeat(20001) } })).status, 413);
  assert.equal((await s.chamar('/api/messages', { email: e, method: 'POST', body: '{ruim', headers: {} })).status, 400);
  assert.equal(s.enviados.length, 0);
  s.fechar();
});

test('POST que não é JSON é recusado (protege contra envio por outro site)', async () => {
  const s = await subir();
  const r = await s.chamar('/api/messages', { email: 'a@hotmart.com', method: 'POST', body: 'text=oi', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 415);
  assert.equal(s.enviados.length, 0);
  s.fechar();
});

test('limite de mensagens por minuto, por usuário', async () => {
  const s = await subir({ max: 2 });
  const enviar = (email) => s.chamar('/api/messages', { email, method: 'POST', body: { text: 'oi' } });
  assert.equal((await enviar('a@hotmart.com')).status, 202);
  assert.equal((await enviar('a@hotmart.com')).status, 202);
  const terceira = await enviar('a@hotmart.com');
  assert.equal(terceira.status, 429);
  assert.equal((await enviar('b@hotmart.com')).status, 202); // outro usuário não é afetado
  s.fechar();
});

test('falha do Astroflow vira 502 sem vazar a URL do webhook', async () => {
  const s1 = await subir({ fetchImpl: async () => { throw new Error('connect ECONNREFUSED http://astroflow.invalid/webhook'); } });
  const r1 = await s1.chamar('/api/messages', { email: 'a@hotmart.com', method: 'POST', body: { text: 'oi' } });
  assert.equal(r1.status, 502);
  assert.doesNotMatch((await r1.json()).message, /astroflow\.invalid/);
  s1.fechar();
  const s2 = await subir({ fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'erro interno' }) });
  const r2 = await s2.chamar('/api/messages', { email: 'a@hotmart.com', method: 'POST', body: { text: 'oi' } });
  assert.equal(r2.status, 502);
  s2.fechar();
});

test('sem webhook configurado: 503', async () => {
  const s = await subir();
  delete process.env.ASTROFLOW_WEBHOOK_URL;
  const r = await s.chamar('/api/messages', { email: 'a@hotmart.com', method: 'POST', body: { text: 'oi' } });
  assert.equal(r.status, 503);
  s.fechar();
});

test('ler: cada pessoa recebe só as respostas do próprio space, com cursor', async () => {
  const s = await subir();
  const a = personaDoEmail('ana@hotmart.com');
  const b = personaDoEmail('bia@hotmart.com');
  s.sheet.push([a.space, 'para a Ana', ''], [b.space, 'para a Bia', '']);
  await s.outbox.tick();
  const ra = await (await s.chamar('/api/messages', { email: 'ana@hotmart.com' })).json();
  const rb = await (await s.chamar('/api/messages', { email: 'bia@hotmart.com' })).json();
  assert.deepEqual(ra.itens.map((i) => i.mensagem), ['para a Ana']);
  assert.deepEqual(rb.itens.map((i) => i.mensagem), ['para a Bia']);
  const de = await (await s.chamar(`/api/messages?after=${ra.seq}&boot=${ra.boot}`, { email: 'ana@hotmart.com' })).json();
  assert.deepEqual(de.itens, []);
  s.sheet.push([a.space, 'segunda', '']);
  await s.outbox.tick();
  const depois = await (await s.chamar(`/api/messages?after=${ra.seq}&boot=${ra.boot}`, { email: 'ana@hotmart.com' })).json();
  assert.deepEqual(depois.itens.map((i) => i.mensagem), ['segunda']);
  s.fechar();
});

test('rota inexistente em /api: 404 em JSON', async () => {
  const s = await subir();
  const r = await s.chamar('/api/nao-existe', { email: 'a@hotmart.com' });
  assert.equal(r.status, 404);
  assert.match((await r.json()).message, /não encontrada/);
  s.fechar();
});
