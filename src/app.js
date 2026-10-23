// src/app.js
const express = require('express');
const path = require('path');

const config = require('./config/aurora');
const { requireUser } = require('./middlewares/auth');
const errorHandler = require('./middlewares/errorHandler');
const { createApiRouter } = require('./routes/apiRoutes');
const { createRateLimiter } = require('./services/rateLimiter');

/** As dependências entram por parâmetro para os testes poderem trocá-las por falsas. */
function createApp({ astroflow, outbox, limiter = createRateLimiter({ max: config.maxMessagesPerMinute }) }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '200kb' })); // um caso completo tem poucas dezenas de KB

  // Health check: instantâneo, sem autenticação e sem tocar no Sheets/Astroflow (NUNCA remover)
  app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

  // A partir daqui: usuário autenticado pelo ingress (X-Auth-Request-Email)
  app.use(requireUser);

  // Arquivos estáticos (CSS, JS). index/redirect desligados: a página é servida pela rota "/".
  app.use(express.static(path.join(__dirname, '../public'), { index: false, redirect: false }));

  app.use('/api', createApiRouter({ astroflow, outbox, limiter }));
  app.use('/api', (req, res) => res.status(404).json({ message: 'Rota não encontrada.' }));

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
