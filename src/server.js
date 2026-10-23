// src/server.js
require('dotenv').config(); // Carrega as variáveis do arquivo .env (apenas desenvolvimento local)
const { createApp } = require('./app');
const { Outbox } = require('./services/outboxService');
const { createAstroflowClient } = require('./services/astroflowClient');

// O Magic Deploy (e outros PaaS) injeta a porta na variável process.env.PORT
const PORT = process.env.PORT || 3001;

const config = require('./config/aurora');
// Confere (sem mostrar valores) o que está configurado: ajuda a achar secret faltando nos logs do deploy
console.log('[config]', JSON.stringify({
  google_client_email: !!process.env.GOOGLE_CLIENT_EMAIL,
  google_private_key: !!process.env.GOOGLE_PRIVATE_KEY,
  planilha: !!config.spreadsheetId(),
  webhook: !!config.webhookUrl(),
  aba_saida: config.outboxSheet(),
  intervalo_ms: config.pollMs(),
}));

const outbox = new Outbox();
outbox.start(); // leitor único da aba de saída; falhas de leitura só vão para o log e ele tenta de novo

const app = createApp({ astroflow: createAstroflowClient(), outbox });

// '0.0.0.0' garante que o app aceite conexões externas no container
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
