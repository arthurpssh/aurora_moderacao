const crypto = require('crypto');
const config = require('../config/aurora');
const { getSheetsClient } = require('../config/googleClient');

/**
 * Leitor da aba de saída (colunas space, mensagem, ts), onde o Astroflow acrescenta as mensagens da Aurora.
 * UM único leitor compartilhado por todos os usuários (a cota de leitura do Sheets é pequena); os navegadores
 * consultam o buffer em memória deste servidor.
 *
 * Posição: guardamos o número da última linha lida (a "âncora") e uma assinatura do conteúdo dela. Cada
 * leitura começa nessa mesma linha. Se ela mudou de lugar (a limpeza diária do Apps Script apaga as linhas
 * antigas e desloca o resto), ressincronizamos procurando a assinatura. Assim não perdemos nem repetimos mensagens.
 */

const assinatura = (linha) => `${String((linha && linha[0]) ?? '').trim()}\u0001${String((linha && linha[1]) ?? '')}`;
const quoteSheet = (nome) => `'${String(nome).replace(/'/g, "''")}'`;

/** Leitor real: devolve as linhas da aba a partir da linha `inicio` (1-based), sem as vazias do fim. */
function createSheetsReader({ getClient = getSheetsClient } = {}) {
  return {
    async readFrom(inicio) {
      const sheets = await getClient();
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId(),
        range: `${quoteSheet(config.outboxSheet())}!A${inicio}:C`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      return resp.data.values || [];
    },
  };
}

/** Causa em uma palavra (o navegador mostra um aviso genérico; o detalhe fica só no log do servidor). */
function classificarErro(error) {
  const msg = String((error && error.message) || '');
  if (/environment variable is required/i.test(msg)) return 'configuracao';
  if (/GOOGLE_PRIVATE_KEY inválida|DECODER routines/i.test(msg)) return 'chave_invalida';
  if (error && (error.code === 403 || /permission|caller does not have/i.test(msg))) return 'sem_acesso';
  if (error && (error.code === 404 || /Unable to parse range|not found/i.test(msg))) return 'aba_ou_planilha_nao_encontrada';
  return 'indisponivel';
}

class Outbox {
  constructor({ reader = createSheetsReader(), agora = Date.now } = {}) {
    this.reader = reader;
    this.agora = agora;
    this.boot = crypto.randomBytes(6).toString('hex'); // muda a cada reinício do servidor
    this.seq = 0;
    this.buffer = new Map(); // space -> [{ seq, mensagem, ts, recebidoEm }]
    this.cursor = 1; // linha (1-based) da âncora
    this.ancora = null; // assinatura da linha-âncora (null = aba vazia)
    this.pronto = false;
    this.timer = null;
    this.ultimoErro = '';
    this.saude = { ok: null, causa: '' }; // estado da leitura da planilha, mostrado ao navegador (sem detalhes internos)
  }

  /** Posiciona a âncora na última linha existente: só mensagens novas daqui em diante entram. */
  async init() {
    const todas = await this.reader.readFrom(1);
    this.cursor = Math.max(todas.length, 1);
    this.ancora = todas.length ? assinatura(todas[todas.length - 1]) : null;
    this.pronto = true;
  }

  ingerir(linha) {
    const space = String((linha && linha[0]) ?? '').trim();
    const mensagem = String((linha && linha[1]) ?? '');
    if (!space || !mensagem.trim()) return;
    const lista = this.buffer.get(space) || [];
    lista.push({ seq: ++this.seq, mensagem, ts: String((linha && linha[2]) ?? ''), recebidoEm: this.agora() });
    while (lista.length > config.bufferPerSpace) lista.shift();
    this.buffer.set(space, lista);
    console.log(`[outbox] mensagem nova para ${space} (${lista.length} no buffer)`);
  }

  /** A âncora saiu do lugar: relê a aba, acha a âncora pela assinatura e ingere o que veio depois dela. */
  async ressincronizar() {
    const todas = await this.reader.readFrom(1);
    let achada = -1;
    for (let i = todas.length - 1; i >= 0; i--) {
      if (assinatura(todas[i]) === this.ancora) { achada = i; break; }
    }
    if (achada === -1) {
      console.warn('[outbox] linha-âncora não encontrada; reposicionando no fim da aba');
    } else {
      todas.slice(achada + 1).forEach((l) => this.ingerir(l));
    }
    this.cursor = Math.max(todas.length, 1);
    this.ancora = todas.length ? assinatura(todas[todas.length - 1]) : null;
  }

  /** Uma leitura. Lança em caso de erro de rede/Sheets (o laço trata). */
  async tick() {
    if (!this.pronto) return this.init();

    if (this.ancora === null) { // a aba estava vazia (sem nem o cabeçalho)
      const todas = await this.reader.readFrom(1);
      if (!todas.length) return;
      todas.slice(1).forEach((l) => this.ingerir(l));
      this.cursor = todas.length;
      this.ancora = assinatura(todas[todas.length - 1]);
      return;
    }

    const linhas = await this.reader.readFrom(this.cursor);
    if (!linhas.length || assinatura(linhas[0]) !== this.ancora) return this.ressincronizar();
    const novas = linhas.slice(1);
    if (novas.length) {
      novas.forEach((l) => this.ingerir(l));
      this.cursor += novas.length;
      this.ancora = assinatura(linhas[linhas.length - 1]);
    }
    this.limparAntigas();
  }

  limparAntigas() {
    const corte = this.agora() - config.bufferMaxAgeMs;
    for (const [space, lista] of this.buffer) {
      const ficam = lista.filter((m) => m.recebidoEm >= corte);
      if (ficam.length) this.buffer.set(space, ficam);
      else this.buffer.delete(space);
    }
  }

  /** Mensagens da Aurora de um space depois de `depoisDe`. Se o servidor reiniciou, o cliente recomeça do zero. */
  ler(space, depoisDe, bootDoCliente) {
    const desde = bootDoCliente === this.boot ? Number(depoisDe) || 0 : 0;
    const itens = (this.buffer.get(space) || [])
      .filter((m) => m.seq > desde)
      .map((m) => ({ seq: m.seq, mensagem: m.mensagem, ts: m.ts }));
    return { boot: this.boot, seq: this.seq, itens, leitura: this.saude };
  }

  start() {
    const ciclo = async () => {
      let espera = config.pollMs();
      try {
        await this.tick();
        if (this.ultimoErro) console.log('[outbox] leitura da planilha voltou a funcionar');
        this.ultimoErro = '';
        this.saude = { ok: true, causa: '' };
      } catch (error) {
        espera = Math.max(espera, 5000);
        if (error.message !== this.ultimoErro) console.error('[outbox] erro ao ler a planilha:', error.message);
        this.ultimoErro = error.message;
        this.saude = { ok: false, causa: classificarErro(error) };
      }
      this.timer = setTimeout(ciclo, espera);
      if (this.timer.unref) this.timer.unref();
    };
    ciclo();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = { Outbox, createSheetsReader, assinatura, classificarErro };
