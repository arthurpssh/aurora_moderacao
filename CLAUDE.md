# Guia para Assistente de Programação

Este projeto chama-se `aurora-chat`: o chat web da **Aurora**, assistente de moderação do Reclame AQUI usada pelos analistas. Ele reproduz a conversa de DM que antes acontecia no Google Chat: a mensagem da pessoa vira um evento no formato do Google Chat, é enviada por POST ao fluxo da Aurora no **Astroflow**, e as respostas voltam pela planilha da Aurora (Google Sheets). A pessoa que está logada **é** a persona da conversa (nome, ids e conversa derivados do e-mail dela).

Os fluxos, a máquina de estados e a planilha ficam em outros diretórios do repositório de trabalho (`Astroflow/`, `Apps Script/`); este app não duplica nada disso.

## Stack Tecnológica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Runtime | Node.js | 24 |
| Framework | Express | 5 |
| Google API | googleapis (somente Sheets, leitura) | 181+ |
| Front-end | HTML/CSS/JS puro | — |
| Testes | node:test (sem dependências extras) | — |
| Container | Docker (Alpine) | — |
| CI/CD | GitHub Actions (Magic Deploy) | — |

## Estrutura do Projeto

```
├── src/
│   ├── app.js                      # createApp({ astroflow, outbox, limiter }): health, auth, estáticos, rotas
│   ├── server.js                   # Entry point: liga o leitor da planilha e escuta em PORT
│   ├── config/
│   │   ├── aurora.js               # Env vars e limites
│   │   └── googleClient.js         # Service Account (escopo spreadsheets.readonly)
│   ├── middlewares/
│   │   ├── auth.js                 # requireUser: X-Auth-Request-Email -> req.user (persona)
│   │   └── errorHandler.js         # Erros -> JSON { message }
│   ├── routes/apiRoutes.js         # /api/me, /api/messages
│   ├── services/
│   │   ├── personaService.js       # e-mail -> persona (nome, userId, space) e evento no formato do Chat
│   │   ├── astroflowClient.js      # POST do evento no webhook do Astroflow
│   │   ├── outboxService.js        # Leitor único da aba de saída + buffer em memória por space
│   │   └── rateLimiter.js          # Limite de mensagens por minuto, por usuário
│   ├── utils/errors.js             # HttpError
│   └── views/403.html
├── public/                         # index.html, css/style.css, js/app.js, js/tema.js, img/ (avatar e doodles), favicon.svg
├── test/                           # persona, outbox e api (npm test)
├── .github/workflows/deploy.yaml, Dockerfile, package.json, values.yml
```

## Arquitetura

- Todas as rotas, exceto `GET /api/health`, exigem usuário autenticado: o ingress (`auth-url` do `values.yml`) injeta o e-mail em `X-Auth-Request-Email`. Sem e-mail, 403.
- **Persona = quem está logado.** `personaService.personaDoEmail` deriva do e-mail: nome (`arthur.santos@...` vira "Arthur Santos"), `userId` (`users/` + 21 dígitos) e `space` (`spaces/WEB` + 8 hex), todos determinísticos. A chave da conversa no Astroflow é `space|autor_id`, então a mesma pessoa sempre retoma o mesmo caso. Nenhum campo do corpo da requisição escolhe a identidade.
- **Envio** (`POST /api/messages`, `{ text }`): valida (texto não vazio, até 20 000 caracteres, JSON, 12 por minuto por usuário), monta o evento (`message.name`, `argumentText`, `sender.*`, `space.name`, `thread.name`, as mesmas chaves que o `adaptador_step.js` do fluxo lê) e faz POST em `ASTROFLOW_WEBHOOK_URL`. O gatilho é **assíncrono**: o HTTP só confirma o recebimento. Responde 202.
- **Respostas**: o Astroflow acrescenta linhas (`space`, `mensagem`, `ts`) na aba `AURORA_OUTBOX_SHEET` (padrão `Saída_Prod`). Um **único leitor** (`Outbox`) lê a aba a cada `AURORA_OUTBOX_POLL_MS` (2,5 s; a cota do Sheets é de 60 leituras/min) e guarda as mensagens em memória por `space` (200 por pessoa, 6 h). O navegador consulta `GET /api/messages?after=<seq>&boot=<id>` a cada 2,5 s e recebe só as mensagens do próprio space.
- **Posição de leitura**: o `Outbox` guarda o número da última linha lida (âncora) e uma assinatura do conteúdo dela; toda leitura começa nessa linha. Se a limpeza diária do Apps Script (`limparSaidaTeste`) apagar linhas antigas e deslocar tudo, ele ressincroniza pela assinatura, sem perder nem repetir mensagens. Ao iniciar, só mensagens **novas** entram (o que já estava na aba fica de fora). Mensagens gravadas enquanto o servidor está fora do ar (por exemplo, durante um deploy) não são entregues.
- `boot` muda a cada reinício; um navegador com `boot` antigo recomeça do zero (o buffer novo só tem mensagens posteriores ao reinício, então não repete).
- **Histórico**: guardado no `localStorage` do navegador, por e-mail (até 300 mensagens). Não há histórico no servidor.
- O estado (buffer, âncora, limitador) vive **em memória**: `replicaCount` deve ser **1**.
- Esta aplicação **só lê** a planilha da Aurora (escopo `spreadsheets.readonly`). Quem escreve em `Eventos`, `Analises`, `Logs` e na aba de saída é o Astroflow e o Apps Script.
- Health check: `GET /api/health` retorna `{ status: 'ok' }`.

### Secrets de Produção

Injetadas pelo Secrets Manager (ver `values.yml`):

- `GOOGLE_CLIENT_EMAIL` — e-mail da service account (precisa de acesso de **Leitor** à planilha da Aurora)
- `GOOGLE_PRIVATE_KEY` — chave privada da service account
- `AURORA_SPREADSHEET_ID` — ID da planilha da Aurora (a mesma do Apps Script)
- `ASTROFLOW_WEBHOOK_URL` — URL do gatilho POST do fluxo "Chat Bot Aurora"

Configuração (não secret, no `env:` do `values.yml`): `AURORA_OUTBOX_SHEET` (padrão `Saída_Prod`), `AURORA_OUTBOX_POLL_MS` (padrão 2500).
Somente dev local: `DEV_USER_EMAIL` simula o e-mail do usuário logado (NUNCA definir em produção).

## Interface

- **Limpar e encerrar caso**: um só botão. Limpa a conversa da tela e envia `cancelar` ao fluxo (sem mostrar a mensagem), para nunca ficar um caso em andamento sem conversa visível. Se o fluxo recusar (por exemplo, análise em andamento), a resposta da Aurora aparece na tela; se o envio falhar, o erro aparece.
- **Tema**: claro e escuro, seguindo o sistema por padrão; o botão do topo alterna e guarda a escolha no navegador (`js/tema.js`, carregado no `<head>`). Texto sempre preto no claro e branco no escuro; só os detalhes visuais usam o laranja Hotmart `#FF4000` (variáveis `--acento` etc. em `css/style.css`).
- **Avatar** da Aurora: `public/img/aurora-avatar.jpg` (recorte 256x256 da arte original, mostrado em círculo no topo).
- **Doodles** do fundo: `public/img/doodles.svg`, padrão repetido de ícones Phosphor (MIT) usado como máscara CSS em `.conversa::before`; a cor vem de `--doodle`.
- **Aviso de leitura**: se o servidor não consegue ler a planilha (sem acesso, aba inexistente, configuração faltando), a tela mostra um aviso em vez de ficar muda. O detalhe do erro fica só no log do servidor.

## Planilha: aba de saída

| Aba | Colunas | Quem escreve |
|-----|---------|--------------|
| `Saída_Prod` (ou o nome em `AURORA_OUTBOX_SHEET`) | `space`, `mensagem`, `ts` (opcional) | Astroflow (um "Adicionar uma linha" em cada ponto que envia mensagem ao analista) |

`space` precisa ser exatamente o `space.name` que o evento trouxe (o fluxo devolve o mesmo valor). O Apps Script (`limparSaidaTeste`) mantém a aba pequena.

## Desenvolvimento Local

```bash
cp .env.example .env
# Preencha GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, AURORA_SPREADSHEET_ID, ASTROFLOW_WEBHOOK_URL e DEV_USER_EMAIL
npm install
npm run dev   # igual a "npm start", mas com --use-system-ca (usa os certificados raiz do sistema operacional)
npm test      # 25 testes, sem rede e sem credenciais
```

Em rede corporativa com inspeção TLS, o `fetch` do Node falha com `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` / `SELF_SIGNED_CERT_IN_CHAIN`. Use `npm run dev` ou aponte `NODE_EXTRA_CA_CERTS` para o certificado raiz da empresa (lido na inicialização do Node: NÃO funciona via `.env`). NUNCA usar `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Deploy

- `npm ci` instala dependências de produção
- Docker copia `src/` e `public/`
- Container roda `node src/server.js` na porta 3001
- O pipeline (`.github/workflows/deploy.yaml`) roda a cada push em branch diferente de `main`; o host sai de `values.yml` (`lb.hosts[0].host`)

## Regras

1. `GET /api/health` NUNCA remover — deve retornar `{ status: 'ok' }` (200) sempre, sem tocar em Sheets/Astroflow
2. `HOSTNAME=0.0.0.0` para o servidor escutar em todas as interfaces no container
3. NÃO adicionar banco de dados relacional — Google Sheets é o storage do sistema da Aurora
4. Secrets NUNCA hardcodar (nem a URL do webhook, nem IDs de planilha) e NUNCA logar a URL do webhook nem devolvê-la ao navegador
5. A identidade vem SEMPRE de `req.user` (e-mail do ingress); nunca de parâmetros, corpo ou cabeçalhos escolhidos pelo navegador
6. Dados dinâmicos no front sempre via `textContent`/nós DOM, nunca `innerHTML`
7. Manter `replicaCount: 1` enquanto o buffer das respostas estiver em memória
8. Esta aplicação não escreve no Sheets (escopo somente leitura)
9. Rotas `/api/*` ANTES do static serve; POST só com `Content-Type: application/json`

## Rotas

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | /api/health | Health check (sem autenticação) |
| GET | /api/me | `{ email, nome, primeiroNome }` do usuário autenticado |
| POST | /api/messages | Envia `{ text }` à Aurora (202); 400/413/415/429/502/503 em caso de erro |
| GET | /api/messages?after=&boot= | Respostas novas da Aurora para o usuário: `{ boot, seq, itens: [{ seq, mensagem, ts }] }` |
| GET | / | Página do chat |
