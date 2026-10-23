const test = require('node:test');
const assert = require('node:assert/strict');
const { Outbox } = require('../src/services/outboxService');

// Planilha falsa: linhas[0] é a linha 1 (cabeçalho). readFrom devolve a partir da linha pedida (1-based).
function planilha(inicial) {
  const linhas = inicial.slice();
  return {
    linhas,
    reads: 0,
    async readFrom(inicio) { this.reads++; return linhas.slice(inicio - 1).map((l) => l.slice()); },
    add(...novas) { novas.forEach((n) => linhas.push(n)); },
    apagarAntigas(qtd) { linhas.splice(1, qtd); }, // como o limparSaidaTeste do Apps Script
  };
}
const CAB = ['space', 'mensagem', 'ts'];
const nomes = (o, space, depois = 0, boot) => o.ler(space, depois, boot ?? o.boot).itens.map((i) => i.mensagem);

test('só entram mensagens novas (o que já existia fica de fora)', async () => {
  const p = planilha([CAB, ['spaces/A', 'velha', '']]);
  const o = new Outbox({ reader: p });
  await o.tick(); // init
  assert.deepEqual(nomes(o, 'spaces/A'), []);
  p.add(['spaces/A', 'nova 1', ''], ['spaces/B', 'para B', ''], ['spaces/A', 'nova 2', '2026-10-23']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['nova 1', 'nova 2']);
  assert.deepEqual(nomes(o, 'spaces/B'), ['para B']);
  await o.tick(); // nada novo: não repete
  assert.deepEqual(nomes(o, 'spaces/A'), ['nova 1', 'nova 2']);
});

test('cada space só vê as próprias mensagens e o cursor "depois de" funciona', async () => {
  const p = planilha([CAB]);
  const o = new Outbox({ reader: p });
  await o.tick();
  p.add(['spaces/A', 'a1', ''], ['spaces/B', 'b1', '']);
  await o.tick();
  const primeira = o.ler('spaces/A', 0, o.boot);
  assert.equal(primeira.itens.length, 1);
  p.add(['spaces/A', 'a2', '']);
  await o.tick();
  const seg = o.ler('spaces/A', primeira.seq, o.boot);
  assert.deepEqual(seg.itens.map((i) => i.mensagem), ['a2']);
  assert.deepEqual(o.ler('spaces/C', 0, o.boot).itens, []);
});

test('boot diferente (servidor reiniciou): o cliente recomeça do zero, sem pular nada', async () => {
  const p = planilha([CAB]);
  const o = new Outbox({ reader: p });
  await o.tick();
  p.add(['spaces/A', 'a1', '']);
  await o.tick();
  const r = o.ler('spaces/A', 999, 'boot-antigo');
  assert.deepEqual(r.itens.map((i) => i.mensagem), ['a1']);
});

test('linhas vazias, sem space ou sem mensagem são ignoradas, mas contam na posição', async () => {
  const p = planilha([CAB]);
  const o = new Outbox({ reader: p });
  await o.tick();
  p.add([], ['', 'sem space', ''], ['spaces/A', '   ', ''], ['spaces/A', 'ok', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['ok']);
  p.add(['spaces/A', 'ok 2', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['ok', 'ok 2']);
});

test('limpeza diária (linhas antigas apagadas) não perde nem repete mensagens', async () => {
  const antigas = Array.from({ length: 6 }, (_, i) => ['spaces/A', 'antiga ' + i, '']);
  const p = planilha([CAB, ...antigas]);
  const o = new Outbox({ reader: p });
  await o.tick();
  p.add(['spaces/A', 'antes da limpeza', '']);
  await o.tick();
  p.apagarAntigas(5); // sobram: cabeçalho, antiga 5 e a "antes da limpeza"
  p.add(['spaces/A', 'depois da limpeza', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['antes da limpeza', 'depois da limpeza']);
  p.add(['spaces/A', 'seguinte', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['antes da limpeza', 'depois da limpeza', 'seguinte']);
});

test('limpeza que apaga até a âncora: reposiciona no fim sem repetir o que já foi entregue', async () => {
  const p = planilha([CAB, ['spaces/A', 'x', ''], ['spaces/A', 'y', '']]);
  const o = new Outbox({ reader: p });
  await o.tick();
  p.add(['spaces/A', 'z', '']);
  await o.tick();
  p.linhas.splice(1, p.linhas.length - 1); // só sobra o cabeçalho (âncora sumiu)
  const avisos = [];
  const w = console.warn; console.warn = (m) => avisos.push(m);
  try { await o.tick(); } finally { console.warn = w; }
  assert.equal(avisos.length, 1);
  assert.deepEqual(nomes(o, 'spaces/A'), ['z']);
  p.add(['spaces/A', 'nova', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['z', 'nova']);
});

test('aba totalmente vazia no início: o que chegar depois do cabeçalho entra', async () => {
  const p = planilha([]);
  const o = new Outbox({ reader: p });
  await o.tick();
  await o.tick();
  p.add(CAB, ['spaces/A', 'primeira', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['primeira']);
});

test('buffer por space é limitado e mensagens muito antigas saem', async () => {
  let agora = 1_000_000;
  const p = planilha([CAB]);
  const o = new Outbox({ reader: p, agora: () => agora });
  await o.tick();
  p.add(['spaces/A', 'velha', '']);
  await o.tick();
  agora += 7 * 60 * 60 * 1000; // passou das 6 h
  p.add(['spaces/A', 'recente', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['recente']);
  const muitas = Array.from({ length: 250 }, (_, i) => ['spaces/B', 'm' + i, '']);
  p.add(...muitas);
  await o.tick();
  const b = o.ler('spaces/B', 0, o.boot).itens;
  assert.equal(b.length, 200);
  assert.equal(b[199].mensagem, 'm249');
});

test('classifica o erro de leitura sem vazar detalhes', () => {
  const { classificarErro } = require('../src/services/outboxService');
  assert.equal(classificarErro(new Error('GOOGLE_CLIENT_EMAIL environment variable is required')), 'configuracao');
  assert.equal(classificarErro(Object.assign(new Error('The caller does not have permission'), { code: 403 })), 'sem_acesso');
  assert.equal(classificarErro(Object.assign(new Error('Unable to parse range: X!A1:C'), { code: 400 })), 'aba_ou_planilha_nao_encontrada');
  assert.equal(classificarErro(new Error('socket hang up')), 'indisponivel');
});

test('a saúde da leitura aparece em ler(): falha vira ok=false com a causa; sucesso volta a ok=true', async () => {
  let quebrado = true;
  const falha = Object.assign(new Error('The caller does not have permission'), { code: 403 });
  const o = new Outbox({ reader: { async readFrom() { if (quebrado) throw falha; return [CAB]; } } });
  const logErro = console.error; const logInfo = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    o.start();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(o.ler('spaces/A', 0, o.boot).leitura, { ok: false, causa: 'sem_acesso' });
    o.stop();
    quebrado = false;
    const o2 = new Outbox({ reader: { async readFrom() { return [CAB]; } } });
    o2.start();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(o2.ler('spaces/A', 0, o2.boot).leitura, { ok: true, causa: '' });
    o2.stop();
  } finally { console.error = logErro; console.log = logInfo; o.stop(); }
});

test('erro de leitura propaga no tick (o laço start trata) e não corrompe a posição', async () => {
  const p = planilha([CAB]);
  const o = new Outbox({ reader: p });
  await o.tick();
  const lerOriginal = p.readFrom;
  p.readFrom = async () => { throw new Error('quota'); };
  await assert.rejects(() => o.tick(), /quota/);
  p.readFrom = lerOriginal;
  p.add(['spaces/A', 'depois do erro', '']);
  await o.tick();
  assert.deepEqual(nomes(o, 'spaces/A'), ['depois do erro']);
});
