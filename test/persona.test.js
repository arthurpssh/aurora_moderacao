const test = require('node:test');
const assert = require('node:assert/strict');
const { personaDoEmail, montarEventoChat, novoMsgId, nomeDoEmail } = require('../src/services/personaService');

test('nome vem do e-mail', () => {
  assert.equal(nomeDoEmail('arthur.santos@hotmart.com'), 'Arthur Santos');
  assert.equal(nomeDoEmail('renata_lima+ra@hotmart.com'), 'Renata Lima Ra');
  assert.equal(nomeDoEmail('123@x.com'), 'Analista');
  assert.equal(nomeDoEmail('joão.d@x.com'), 'João D');
});

test('persona é determinística e diferente por e-mail', () => {
  const a1 = personaDoEmail('Arthur.Santos@hotmart.com ');
  const a2 = personaDoEmail('arthur.santos@hotmart.com');
  const b = personaDoEmail('maria.silva@hotmart.com');
  assert.deepEqual(a1, a2);
  assert.notEqual(a1.userId, b.userId);
  assert.notEqual(a1.space, b.space);
  assert.match(a1.userId, /^users\/\d{21}$/);
  assert.match(a1.space, /^spaces\/WEB[0-9a-f]{8}$/);
  assert.equal(a1.primeiroNome, 'Arthur');
  assert.throws(() => personaDoEmail('  '));
});

test('evento tem o formato do webhook do Chat que o adaptador lê', () => {
  const p = personaDoEmail('arthur.santos@hotmart.com');
  const id = novoMsgId(p);
  assert.match(id, new RegExp('^' + p.space.replace('/', '\\/') + '/messages/WEB[0-9a-f]{10}\\.\\d+$'));
  const ev = montarEventoChat(p, 'oi *Aurora*', id, new Date('2026-10-23T12:00:00Z'));
  assert.equal(ev.type, 'MESSAGE');
  assert.equal(ev.message.name, id);
  assert.equal(ev.message.argumentText, 'oi *Aurora*');
  assert.equal(ev.message.sender.name, p.userId);
  assert.equal(ev.message.sender.displayName, 'Arthur Santos');
  assert.equal(ev.message.sender.type, 'HUMAN');
  assert.equal(ev.message.space.name, p.space);
  assert.ok(ev.message.thread.name.startsWith(p.space + '/threads/'));
  assert.equal(ev.space.name, p.space);
  assert.equal(ev.message.createTime, '2026-10-23T12:00:00.000Z');
});

test('ids de mensagem não se repetem', () => {
  const p = personaDoEmail('a@x.com');
  assert.notEqual(novoMsgId(p), novoMsgId(p));
});
