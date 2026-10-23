const crypto = require('crypto');

/**
 * A "persona" é a pessoa que está acessando: tudo é derivado do e-mail que o ingress autenticou.
 * O navegador nunca escolhe quem ele é, então ninguém consegue falar como outra pessoa.
 *
 * Os ids são determinísticos (mesmo e-mail, mesmos ids), no formato do Google Chat. Assim a chave da
 * conversa no Astroflow (space|autor_id) é sempre a mesma para a mesma pessoa, e o histórico dela
 * continua de onde parou.
 */

function tituloCase(palavra) {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase();
}

// "arthur.santos@hotmart.com" -> "Arthur Santos"
function nomeDoEmail(email) {
  const local = String(email).split('@')[0];
  const partes = local
    .split(/[._\-+]+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  return partes.length ? partes.map(tituloCase).join(' ') : 'Analista';
}

function personaDoEmail(emailBruto) {
  const email = String(emailBruto || '').trim().toLowerCase();
  if (!email) throw new Error('E-mail vazio.');
  const hash = crypto.createHash('sha256').update(email).digest('hex');
  const numerico = (BigInt('0x' + hash) % 10n ** 21n).toString().padStart(21, '0');
  const nome = nomeDoEmail(email);
  return {
    email,
    nome,
    primeiroNome: nome.split(' ')[0],
    userId: 'users/' + numerico,
    space: 'spaces/WEB' + hash.slice(0, 8),
  };
}

/**
 * Evento no formato do webhook do Google Chat (as mesmas chaves que o gatilho do Astroflow recebe).
 * O adaptador do fluxo lê message.name, message.argumentText, message.sender.* e message.space.name.
 */
function montarEventoChat(persona, texto, msgId, agora = new Date()) {
  const iso = agora.toISOString();
  const thread = persona.space + '/threads/' + msgId.split('/').pop().split('.')[0];
  const remetente = { name: persona.userId, displayName: persona.nome, type: 'HUMAN', email: persona.email };
  const space = { name: persona.space, type: 'DM', singleUserBotDm: true, spaceType: 'DIRECT_MESSAGE', spaceHistoryState: 'HISTORY_ON' };
  return {
    type: 'MESSAGE',
    eventTime: iso,
    message: {
      name: msgId,
      sender: remetente,
      createTime: iso,
      text: texto,
      argumentText: texto,
      formattedText: texto,
      thread: { name: thread },
      space,
    },
    user: remetente,
    space,
  };
}

function novoMsgId(persona) {
  return persona.space + '/messages/WEB' + crypto.randomBytes(5).toString('hex') + '.' + Date.now();
}

module.exports = { personaDoEmail, montarEventoChat, novoMsgId, nomeDoEmail };
