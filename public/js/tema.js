// Tema claro/escuro. Carregado no <head> (antes do CSS) para a página já abrir no tema certo, sem piscar.
// Sem escolha manual, segue o tema do sistema; com escolha manual (botão), guarda no navegador.
(function () {
  'use strict';
  var CHAVE = 'aurora_chat_tema';
  var raiz = document.documentElement;
  var escuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function guardado() {
    try { var t = localStorage.getItem(CHAVE); return t === 'light' || t === 'dark' ? t : ''; } catch (e) { return ''; }
  }
  function aplicar(tema) { raiz.setAttribute('data-theme', tema); }
  function doSistema() { return escuro && escuro.matches ? 'dark' : 'light'; }

  aplicar(guardado() || doSistema());

  if (escuro && escuro.addEventListener) {
    escuro.addEventListener('change', function () { if (!guardado()) aplicar(doSistema()); });
  }

  window.alternarTema = function () {
    var novo = raiz.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    aplicar(novo);
    try { localStorage.setItem(CHAVE, novo); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
  };
})();
