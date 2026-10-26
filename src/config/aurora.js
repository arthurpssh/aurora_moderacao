// Configuração lida das variáveis de ambiente (funções, para os testes poderem alterá-las)
const num = (v, padrao) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : padrao);

module.exports = {
  spreadsheetId: () => process.env.AURORA_SPREADSHEET_ID || '',
  webhookUrl: () => process.env.ASTROFLOW_WEBHOOK_URL || '',
  outboxSheet: () => process.env.AURORA_OUTBOX_SHEET || 'Saída_Prod',
  pollMs: () => num(process.env.AURORA_OUTBOX_POLL_MS, 2500),
  devUserEmail: () => process.env.DEV_USER_EMAIL || '',

  // Limites de uso
  maxTextLength: 20000, // um caso completo (reclamação, respostas e réplicas) cabe com folga
  maxMessagesPerMinute: 12, // por usuário
  webhookTimeoutMs: 20000,
  bufferPerSpace: 200, // mensagens da Aurora guardadas por usuário
  bufferMaxAgeMs: 6 * 60 * 60 * 1000,
};
