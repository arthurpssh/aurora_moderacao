// Chat da Aurora. Dados dinâmicos sempre entram no DOM por textContent / nós criados (nunca innerHTML).
(function () {
  'use strict';

  var MAX_HISTORICO = 300;          // mensagens guardadas no navegador
  var ESPERA_MAX_MS = 8 * 60 * 1000; // depois disso o aviso "respondendo…" vira alerta
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    me: null, chave: null,
    mensagens: [],       // { de: 'eu' | 'aurora', texto, ts, pendente?, falha? }
    boot: '', seq: 0,    // posição de leitura das respostas da Aurora
    aguardando: 0,       // instante em que enviou e ainda não veio resposta (0 = não aguardando)
    consultando: false, naoLidas: 0,
  };

  // ---------------------------------------------------------------- armazenamento (opcional)
  function guardar() {
    try {
      localStorage.setItem(S.chave, JSON.stringify({
        mensagens: S.mensagens.slice(-MAX_HISTORICO).map(function (m) { return { de: m.de, texto: m.texto, ts: m.ts, falha: m.falha }; }),
        boot: S.boot, seq: S.seq,
      }));
    } catch (e) { /* sem armazenamento: segue sem histórico */ }
  }
  function carregar() {
    try {
      var d = JSON.parse(localStorage.getItem(S.chave) || 'null');
      if (d && Array.isArray(d.mensagens)) { S.mensagens = d.mensagens; S.boot = d.boot || ''; S.seq = Number(d.seq) || 0; }
    } catch (e) { /* ignora */ }
  }

  // ---------------------------------------------------------------- API
  function api(caminho, opcoes) {
    return fetch(caminho, opcoes).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (corpo) {
        if (!r.ok) { var e = new Error(corpo.message || 'Erro ' + r.status); e.status = r.status; throw e; }
        return corpo;
      });
    });
  }

  // ---------------------------------------------------------------- formatação (estilo Google Chat), segura
  var TOKEN = /(`[^`\n]+`)|(https?:\/\/[^\s<>"']+)|((?<![\w*])\*[^*\n]+\*(?![\w*]))|((?<!\w)_[^_\n]+_(?!\w))/g;

  function textoRico(pai, texto) {
    texto.split('\n').forEach(function (linha, i) {
      if (i) pai.appendChild(document.createElement('br'));
      var ultimo = 0, m;
      TOKEN.lastIndex = 0;
      while ((m = TOKEN.exec(linha)) !== null) {
        if (m.index > ultimo) pai.appendChild(document.createTextNode(linha.slice(ultimo, m.index)));
        var bruto = m[0], el;
        if (m[1]) { el = document.createElement('code'); el.textContent = bruto.slice(1, -1); }
        else if (m[2]) {
          var url = bruto.replace(/[.,;:!?)]+$/, '');
          el = document.createElement('a'); el.href = url; el.textContent = url; el.target = '_blank'; el.rel = 'noopener noreferrer';
          TOKEN.lastIndex = m.index + url.length; // devolve a pontuação final ao texto normal
          bruto = url;
        }
        else if (m[3]) { el = document.createElement('b'); el.textContent = bruto.slice(1, -1); }
        else { el = document.createElement('i'); el.textContent = bruto.slice(1, -1); }
        pai.appendChild(el);
        ultimo = m.index + bruto.length;
      }
      if (ultimo < linha.length) pai.appendChild(document.createTextNode(linha.slice(ultimo)));
    });
  }

  function hora(ts) {
    var d = ts ? new Date(ts) : new Date();
    if (isNaN(d)) d = new Date();
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  // ---------------------------------------------------------------- tela
  function render() {
    var el = $('msgs');
    el.textContent = '';
    if (!S.mensagens.length) {
      var v = document.createElement('div');
      v.className = 'vazio';
      v.textContent = 'Olá, ' + S.me.primeiroNome + '! Escreva "oi" para começar a analisar um caso com a Aurora.';
      el.appendChild(v);
    }
    S.mensagens.forEach(function (m) {
      var linha = document.createElement('div');
      linha.className = 'linha ' + (m.de === 'eu' ? 'eu' : 'aurora');
      var bolha = document.createElement('div');
      bolha.className = 'bolha';
      textoRico(bolha, m.texto);
      if (m.falha) {
        var f = document.createElement('div');
        f.className = 'falha';
        f.textContent = m.falha;
        bolha.appendChild(f);
      }
      var h = document.createElement('span');
      h.className = 'hora';
      h.textContent = (m.de === 'eu' ? '' : 'Aurora · ') + hora(m.ts) + (m.pendente ? ' · enviando…' : '');
      bolha.appendChild(h);
      linha.appendChild(bolha);
      el.appendChild(linha);
    });
    el.scrollTop = el.scrollHeight;
    renderDigitando();
  }

  function renderDigitando() {
    var el = $('digitando');
    if (!S.aguardando) { el.textContent = ''; return; }
    var ms = Date.now() - S.aguardando;
    if (ms > ESPERA_MAX_MS) { el.textContent = 'A Aurora está demorando mais que o normal. Se não responder, envie "status".'; return; }
    var seg = Math.floor(ms / 1000);
    el.textContent = 'Aurora está respondendo… ' + Math.floor(seg / 60) + ':' + ('0' + (seg % 60)).slice(-2);
  }

  function avisarTitulo() {
    document.title = S.naoLidas ? '(' + S.naoLidas + ') Aurora' : 'Aurora';
  }

  // ---------------------------------------------------------------- envio
  // opcoes.oculto: envia sem mostrar a mensagem na tela (usado pelo "Limpar e encerrar caso"); se falhar, aparece o erro
  function enviar(texto, opcoes) {
    texto = String(texto || '');
    if (!texto.trim()) return;
    var oculto = !!(opcoes && opcoes.oculto);
    var item = { de: 'eu', texto: texto, ts: new Date().toISOString(), pendente: true };
    if (!oculto) S.mensagens.push(item);
    S.aguardando = Date.now();
    render();
    api('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto }),
    }).then(function () {
      item.pendente = false; guardar(); render();
    }).catch(function (e) {
      item.pendente = false;
      item.falha = 'Não enviado: ' + e.message + (oculto ? ' O caso anterior pode continuar em andamento: envie "cancelar" para encerrá-lo.' : '');
      if (oculto) { item.texto = texto; S.mensagens.push(item); }
      S.aguardando = 0; guardar(); render();
    });
  }

  // Limpa a tela E encerra o caso em andamento, para nunca ficar um caso rodando sem conversa visível
  function limparEEncerrar() {
    if (!confirm('Limpar a conversa e encerrar o caso em andamento?')) return;
    S.mensagens = [];
    guardar();
    enviar('cancelar', { oculto: true });
  }

  function ajustarAltura() {
    var t = $('txt');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 220) + 'px';
  }

  // ---------------------------------------------------------------- respostas da Aurora
  function consultar() {
    if (S.consultando) return;
    S.consultando = true;
    api('/api/messages?after=' + encodeURIComponent(S.seq) + '&boot=' + encodeURIComponent(S.boot)).then(function (r) {
      S.consultando = false;
      S.boot = r.boot; S.seq = r.seq;
      mostrarAviso(r.leitura && r.leitura.ok === false
        ? 'Não estou conseguindo ler as respostas da Aurora agora (' + (CAUSAS[r.leitura.causa] || CAUSAS.indisponivel) + '). Avise o time responsável.'
        : '');
      if (!r.itens.length) return;
      r.itens.forEach(function (i) {
        S.mensagens.push({ de: 'aurora', texto: i.mensagem, ts: i.ts && !isNaN(new Date(i.ts)) ? i.ts : new Date().toISOString() });
      });
      S.aguardando = 0;
      if (document.hidden) { S.naoLidas += r.itens.length; avisarTitulo(); }
      guardar(); render();
    }).catch(function (e) {
      S.consultando = false;
      if (e.status === 403) { location.reload(); return; } // sessão do ingress expirou: o login reaparece
      mostrarAviso('Sem conexão com o servidor da Aurora. Tentando de novo…');
    });
  }

  var CAUSAS = {
    configuracao: 'configuração do servidor incompleta',
    chave_invalida: 'credencial do servidor inválida',
    sem_acesso: 'sem acesso à planilha',
    aba_ou_planilha_nao_encontrada: 'planilha ou aba não encontrada',
    indisponivel: 'planilha indisponível',
  };
  function mostrarAviso(texto) {
    var el = $('aviso');
    el.textContent = texto;
    el.hidden = !texto;
  }

  function laco() {
    consultar();
    setTimeout(laco, document.hidden ? 8000 : 2500);
  }

  // ---------------------------------------------------------------- início
  function ligar() {
    $('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var t = $('txt').value;
      if (!t.trim()) return;
      $('txt').value = ''; ajustarAltura();
      enviar(t);
    });
    $('txt').addEventListener('input', ajustarAltura);
    $('txt').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
    });
    $('btnStatus').addEventListener('click', function () { enviar('status'); });
    $('btnLimpar').addEventListener('click', limparEEncerrar);
    $('btnTema').addEventListener('click', function () { window.alternarTema(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { S.naoLidas = 0; avisarTitulo(); consultar(); }
    });
    setInterval(renderDigitando, 1000);
    laco();
  }

  api('/api/me').then(function (me) {
    S.me = me;
    S.chave = 'aurora_chat_v1:' + me.email;
    carregar();
    $('subtitulo').textContent = 'Assistente de moderação do Reclame AQUI · ' + me.nome;
    render(); ligar(); $('txt').focus();
  }).catch(function (e) {
    var el = $('msgs');
    el.textContent = '';
    var v = document.createElement('div');
    v.className = 'vazio';
    v.textContent = 'Não foi possível iniciar: ' + e.message;
    el.appendChild(v);
  });
})();
