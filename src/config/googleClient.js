const crypto = require('crypto');
const { google } = require('googleapis');

/**
 * Chave privada da service account (variável GOOGLE_PRIVATE_KEY).
 *
 * 1) Primeiro tenta o valor ORIGINAL, só convertendo "\n" escrito em quebra de linha (o formato do .env e do JSON da
 *    service account). Se a chave é válida, nada mais acontece: o comportamento é o mesmo de sempre.
 * 2) Só se isso FALHAR tenta uma versão normalizada (aspas, "\\n" duplo, espaços no lugar das quebras, linhas coladas,
 *    espaços sobrando, corpo sem cabeçalho...). A versão normalizada só é usada se o Node a aceitar como chave válida.
 * 3) Se nada funcionar, lança um erro claro. O log traz apenas o FORMATO do valor (contagens e sim/não), nunca um
 *    trecho da chave.
 */

const ERRO_CHAVE = 'GOOGLE_PRIVATE_KEY inválida: o valor não é uma chave privada PEM válida';

/** Só o formato do valor, sem nenhum trecho dele. */
function diagnosticarChave(bruto) {
  const s = String(bruto);
  const t = s.trim();
  const cabecalho = t.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----/);
  const contar = (re) => (s.match(re) || []).length;
  return {
    comprimento: s.length,
    comecaComBegin: t.startsWith('-----BEGIN'),
    terminaComEnd: /-----END [A-Z ]*PRIVATE KEY-----$/.test(t),
    tipoCabecalho: cabecalho ? cabecalho[1] : null,
    quebrasReais: contar(/\n/g),
    barraNLiteral: contar(/\\n/g),
    temCR: s.includes('\r'),
    aspasNasPontas: /^["']|["']$/.test(t),
    brancosNasPontas: s !== t,
    espacosInternos: contar(/ /g),
  };
}

/** Reconstrói o PEM a partir do corpo base64, descartando o que não pertence a ele. Devolve '' se não achar um corpo. */
function normalizarChave(bruto) {
  let s = String(bruto).trim();
  while (s.length > 1 && /^["'`]/.test(s) && s.slice(-1) === s[0]) s = s.slice(1, -1).trim();
  s = s.replace(/\\+r/g, '').replace(/\\+n/g, '\n').replace(/\r/g, '');

  const m = s.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/);
  const tipo = m ? m[1] : 'PRIVATE KEY'; // sem cabeçalho, assume PKCS#8 (o formato do JSON do Google)
  const corpo = (m ? m[2] : s).replace(/[^A-Za-z0-9+/=]/g, '');
  if (corpo.length < 200) return ''; // pequeno demais para ser uma chave RSA
  const linhas = corpo.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${tipo}-----\n${linhas}\n-----END ${tipo}-----\n`;
}

function ehChaveValida(pem) {
  try { crypto.createPrivateKey(pem); return true; } catch (e) { return false; }
}

/**
 * Devolve o PEM a usar, ou lança Error(ERRO_CHAVE). `log` recebe só mensagens sem material da chave.
 */
function prepararChave(bruto, log = console) {
  const original = String(bruto).replace(/\\n/g, '\n');
  if (ehChaveValida(original)) return original;

  const diag = diagnosticarChave(bruto);
  const normalizada = normalizarChave(bruto);
  if (normalizada && ehChaveValida(normalizada)) {
    log.warn('[google] GOOGLE_PRIVATE_KEY chegou fora do formato PEM esperado; usando a versão normalizada. Formato recebido:', JSON.stringify(diag));
    return normalizada;
  }
  log.error('[google] GOOGLE_PRIVATE_KEY não é uma chave PEM válida, nem depois de normalizada. Formato recebido:', JSON.stringify(diag));
  throw new Error(ERRO_CHAVE);
}

let auth;
let falhaChave = null;

// Autenticação criada sob demanda (os testes não precisam de credenciais)
function getAuth() {
  if (auth) return auth;
  if (falhaChave) throw falhaChave; // o formato não muda sem reiniciar: não repete o diagnóstico a cada leitura
  if (!process.env.GOOGLE_CLIENT_EMAIL) throw new Error('GOOGLE_CLIENT_EMAIL environment variable is required');
  if (!process.env.GOOGLE_PRIVATE_KEY) throw new Error('GOOGLE_PRIVATE_KEY environment variable is required');
  let chave;
  try {
    chave = prepararChave(process.env.GOOGLE_PRIVATE_KEY);
  } catch (error) {
    falhaChave = error;
    throw error;
  }
  auth = new google.auth.GoogleAuth({
    credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: chave },
    // Esta aplicação só LÊ a planilha da Aurora (aba de saída): acesso de leitor basta
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return auth;
}

// Retorna a instância já autenticada do Sheets
async function getSheetsClient() {
  const client = await getAuth().getClient();
  return google.sheets({ version: 'v4', auth: client });
}

module.exports = { getSheetsClient, prepararChave, normalizarChave, diagnosticarChave, ERRO_CHAVE };
