(function () {
  var VERSAO_PAINEL = '0.1.1';
  document.getElementById('versao-painel').textContent = 'versão ' + VERSAO_PAINEL;

  var status = document.getElementById('status');
  var api = (window.SISTEMA && window.SISTEMA.api) || '';

  if (!api) {
    status.textContent = 'Servidor ainda não ligado.';
    return;
  }

  fetch(api + '?acao=ping')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.erro);
      status.textContent = 'Servidor conectado · versão ' + res.versao +
        (res.configurado ? ' · planilha pronta' : ' · planilha ainda não criada');
    })
    .catch(function () {
      status.textContent = 'Não foi possível falar com o servidor. Verifique a internet.';
    });
})();
