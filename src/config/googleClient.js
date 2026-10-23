const { google } = require('googleapis');

let auth;

// Autenticação criada sob demanda (os testes não precisam de credenciais)
function getAuth() {
  if (auth) return auth;
  if (!process.env.GOOGLE_CLIENT_EMAIL) throw new Error('GOOGLE_CLIENT_EMAIL environment variable is required');
  if (!process.env.GOOGLE_PRIVATE_KEY) throw new Error('GOOGLE_PRIVATE_KEY environment variable is required');
  auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, '\n'),
    },
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

module.exports = { getSheetsClient };
