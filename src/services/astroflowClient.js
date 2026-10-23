const config = require('../config/aurora');
const { HttpError } = require('../utils/errors');

/**
 * Envia o evento para o gatilho POST do fluxo da Aurora no Astroflow (assíncrono: a resposta HTTP só
 * confirma o recebimento; as mensagens da Aurora chegam pela aba de saída da planilha).
 * Os detalhes da falha vão só para o log do servidor (a URL do webhook é secret).
 */
function createAstroflowClient({ fetchImpl = fetch } = {}) {
  return {
    async send(evento) {
      const url = config.webhookUrl();
      if (!url) {
        console.error('[astroflow] ASTROFLOW_WEBHOOK_URL não configurada');
        throw new HttpError(503, 'A Aurora está indisponível no momento.');
      }
      let resp;
      try {
        resp = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(evento),
          signal: AbortSignal.timeout(config.webhookTimeoutMs),
        });
      } catch (error) {
        console.error('[astroflow] falha ao chamar o webhook:', error.message);
        throw new HttpError(502, 'Não consegui falar com a Aurora. Tente novamente em instantes.');
      }
      if (!resp.ok) {
        const corpo = await resp.text().catch(() => '');
        console.error(`[astroflow] webhook respondeu HTTP ${resp.status}: ${corpo.slice(0, 300)}`);
        throw new HttpError(502, 'A Aurora não aceitou a mensagem. Tente novamente em instantes.');
      }
    },
  };
}

module.exports = { createAstroflowClient };
