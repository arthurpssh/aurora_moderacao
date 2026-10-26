const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { prepararChave, normalizarChave, diagnosticarChave, ERRO_CHAVE } = require('../src/config/googleClient');
const { classificarErro } = require('../src/services/outboxService');

// Chave de TESTE gerada na hora (nada real)
const { privateKey: PEM } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const CORPO = PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
const H = '-----BEGIN PRIVATE KEY-----';
const F = '-----END PRIVATE KEY-----';
const der = (pem) => crypto.createPrivateKey(pem).export({ type: 'pkcs8', format: 'der' }).toString('hex');
const DER_ORIGINAL = der(PEM);

function logFalso() {
  const msgs = [];
  return { msgs, warn: (...a) => msgs.push(['warn', a.join(' ')]), error: (...a) => msgs.push(['error', a.join(' ')]) };
}

test('chave válida (quebras reais, \\n literal, CRLF): usa o valor ORIGINAL, sem normalizar nem logar', () => {
  const validas = {
    'quebras reais': PEM,
    '\\n literal': PEM.trim().replace(/\n/g, '\\n'),
    CRLF: PEM.replace(/\n/g, '\r\n'),
  };
  for (const [nome, valor] of Object.entries(validas)) {
    const log = logFalso();
    const r = prepararChave(valor, log);
    assert.equal(r, valor.replace(/\\n/g, '\n'), nome + ': o resultado deve ser exatamente o valor original com \\n convertido');
    assert.equal(der(r), DER_ORIGINAL, nome);
    assert.deepEqual(log.msgs, [], nome + ': não deve logar nada');
  }
});

test('chave deformada: a versão normalizada é a MESMA chave e há um aviso no log', () => {
  const deformadas = {
    'quebras viraram espaços': PEM.trim().replace(/\n/g, ' '),
    'aspas externas + \\n': '"' + PEM.trim().replace(/\n/g, '\\n') + '"',
    'aspas simples + quebras reais': "'" + PEM.trim() + "'",
    'tudo numa linha, sem espaço': H + CORPO + F,
    '\\n duplo escapado': PEM.trim().replace(/\n/g, '\\\\n'),
    'linhas coladas sem separador': PEM.trim().replace(/\n/g, ''),
    'só o corpo base64': CORPO,
    'brancos e linha em branco nas pontas': '\n  ' + PEM + '  \n',
    'espaços e aspas e \\r\\n literais': '"' + PEM.trim().replace(/\n/g, '\\r\\n') + '"',
  };
  for (const [nome, valor] of Object.entries(deformadas)) {
    const log = logFalso();
    const r = prepararChave(valor, log);
    assert.equal(der(r), DER_ORIGINAL, nome + ': deve ser a mesma chave');
    assert.ok(r.startsWith(H + '\n') && r.endsWith(F + '\n'), nome + ': deve ser um PEM bem formado');
    assert.equal(log.msgs.length, 1, nome);
    assert.equal(log.msgs[0][0], 'warn', nome);
  }
});

test('chave realmente inválida: erro claro, sem consertar nada', () => {
  const invalidas = {
    'truncada': H + '\n' + CORPO.slice(0, 400).match(/.{1,64}/g).join('\n') + '\n' + F + '\n',
    'e-mail da service account no lugar': 'conta-de-servico@projeto.iam.gserviceaccount.com',
    'texto qualquer': 'não é uma chave',
    'só o cabeçalho': H,
  };
  for (const [nome, valor] of Object.entries(invalidas)) {
    const log = logFalso();
    assert.throws(() => prepararChave(valor, log), new RegExp(ERRO_CHAVE), nome);
    assert.equal(log.msgs.length, 1, nome);
    assert.equal(log.msgs[0][0], 'error', nome);
  }
});

test('nenhum log contém material da chave (varre pedaços de 16 caracteres do corpo)', () => {
  const casos = [PEM.trim().replace(/\n/g, ' '), '"' + PEM.trim().replace(/\n/g, '\\n') + '"', H + CORPO.slice(0, 300) + F, CORPO];
  const todos = [];
  for (const valor of casos) {
    const log = logFalso();
    try { prepararChave(valor, log); } catch (e) { todos.push(e.message); }
    log.msgs.forEach((m) => todos.push(m[1]));
  }
  const texto = todos.join('\n');
  for (let i = 0; i + 16 <= CORPO.length; i += 40) {
    assert.ok(!texto.includes(CORPO.slice(i, i + 16)), 'um pedaço da chave apareceu no log (posição ' + i + ')');
  }
});

test('diagnóstico descreve o formato com contagens e sim/não', () => {
  const d = diagnosticarChave('"' + PEM.trim().replace(/\n/g, '\\n') + '"');
  assert.equal(d.comecaComBegin, false);
  assert.equal(d.aspasNasPontas, true);
  assert.equal(d.quebrasReais, 0);
  assert.ok(d.barraNLiteral > 10);
  assert.equal(d.tipoCabecalho, 'PRIVATE KEY');
  const ok = diagnosticarChave(PEM);
  assert.equal(ok.comecaComBegin, true);
  assert.equal(ok.terminaComEnd, true);
  assert.equal(ok.temCR, false);
  assert.equal(ok.brancosNasPontas, true); // o PEM termina em \n
  for (const v of Object.values(ok)) assert.ok(['number', 'boolean'].includes(typeof v) || v === null || typeof v === 'string');
});

test('normalizarChave devolve vazio quando não há corpo suficiente', () => {
  assert.equal(normalizarChave(''), '');
  assert.equal(normalizarChave('abc'), '');
  assert.equal(normalizarChave(H + F), '');
});

test('o erro da chave inválida aparece como causa própria na tela', () => {
  assert.equal(classificarErro(new Error(ERRO_CHAVE)), 'chave_invalida');
  assert.equal(classificarErro(new Error('error:1E08010C:DECODER routines::unsupported')), 'chave_invalida');
});
