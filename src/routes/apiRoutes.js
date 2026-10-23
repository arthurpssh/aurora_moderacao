const express = require('express');
const config = require('../config/aurora');
const { HttpError } = require('../utils/errors');
const { montarEventoChat, novoMsgId } = require('../services/personaService');

/**
 * Rotas do usuário autenticado. A persona vem de req.user (e-mail do ingress); nenhum parâmetro do
 * navegador escolhe quem fala ou de quem são as respostas.
 */
function createApiRouter({ astroflow, outbox, limiter }) {
  const router = express.Router();

  router.get('/me', (req, res) => {
    const { email, nome, primeiroNome } = req.user;
    res.json({ email, nome, primeiroNome });
  });

  // Envia uma mensagem do usuário para a Aurora (aceita só JSON: o preflight do CORS barra POST de outros sites)
  router.post('/messages', async (req, res) => {
    if (!req.is('application/json')) throw new HttpError(415, 'Envie o corpo como JSON.');
    const texto = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!texto.trim()) throw new HttpError(400, 'Escreva uma mensagem.');
    if (texto.length > config.maxTextLength) {
      throw new HttpError(413, `A mensagem passa de ${config.maxTextLength} caracteres.`);
    }
    if (!limiter.tentar(req.user.email)) {
      throw new HttpError(429, 'Muitas mensagens em pouco tempo. Aguarde alguns segundos.');
    }
    const msgId = novoMsgId(req.user);
    console.log(`[send] ${req.user.space} ${msgId} (${texto.length} caracteres)`);
    await astroflow.send(montarEventoChat(req.user, texto, msgId));
    res.status(202).json({ ok: true, msgId });
  });

  // Mensagens novas da Aurora para este usuário (polling do navegador)
  router.get('/messages', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(outbox.ler(req.user.space, req.query.after, String(req.query.boot || '')));
  });

  return router;
}

module.exports = { createApiRouter };
