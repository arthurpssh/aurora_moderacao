const path = require('path');
const config = require('../config/aurora');
const { personaDoEmail } = require('../services/personaService');

const VIEWS = path.join(__dirname, '../views');
// originalUrl (não path): dentro de routers montados o path perde o prefixo
const isApi = (req) => req.originalUrl.startsWith('/api/');

/**
 * Autenticação: o ingress da plataforma (auth-url do values.yml) autentica o usuário e injeta o e-mail em
 * X-Auth-Request-Email. É esse e-mail que define a persona (nome, ids e conversa): nunca vem do navegador.
 * DEV_USER_EMAIL só vale no desenvolvimento local.
 */
function requireUser(req, res, next) {
  const email = String(req.get('x-auth-request-email') || config.devUserEmail() || '').trim().toLowerCase();
  if (!email) {
    if (isApi(req)) return res.status(403).json({ message: 'Não foi possível identificar o usuário.' });
    return res.status(403).sendFile(path.join(VIEWS, '403.html'));
  }
  req.user = personaDoEmail(email);
  return next();
}

module.exports = { requireUser };
