// Limite simples por chave em janela deslizante (em memória; 1 réplica)
function createRateLimiter({ max, windowMs = 60000, agora = Date.now }) {
  const marcas = new Map();
  return {
    // true = pode seguir (e registra); false = excedeu
    tentar(chave) {
      const t = agora();
      const recentes = (marcas.get(chave) || []).filter((x) => t - x < windowMs);
      if (recentes.length >= max) {
        marcas.set(chave, recentes);
        return false;
      }
      recentes.push(t);
      marcas.set(chave, recentes);
      return true;
    },
  };
}

module.exports = { createRateLimiter };
