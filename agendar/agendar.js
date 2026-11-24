(function () {
  'use strict';

  var API = (window.SISTEMA && window.SISTEMA.api) || '';
  var MENSAGENS = {
    nome_invalido: 'Informe o seu nome completo.',
    telefone_invalido: 'Informe um telefone com DDD, por exemplo (45) 99999-9999.',
    email_invalido: 'Confira o seu e-mail.',
    area_invalida: 'Escolha o assunto.',
    modalidade_invalida: 'Escolha presencial ou online.',
    sem_consentimento: 'Para continuar, marque que concorda com a política de privacidade.',
    muitos_pedidos: 'Recebemos muitos pedidos seus em pouco tempo. Tente de novo mais tarde.',
    horario_ocupado: 'Esse horário acabou de ser reservado. Escolha outro, por favor.',
    rede: 'Não foi possível enviar agora. Verifique a internet e tente de novo.'
  };

  var dias = [];
  var diaEscolhido = null;
  var horaEscolhida = null;

  function $(s) { return document.querySelector(s); }

  function api(acao, corpo) {
    return fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ acao: acao }, corpo || {})) })
      .then(function (r) { return r.json(); });
  }

  function botaoOpcao(principal, detalhe, aoEscolher) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.setAttribute('aria-pressed', 'false');
    b.append(principal);
    if (detalhe) {
      var s = document.createElement('small');
      s.textContent = detalhe;
      b.append(s);
    }
    b.addEventListener('click', function () {
      b.parentNode.querySelectorAll('.opcao').forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      aoEscolher();
    });
    return b;
  }

  function fmtDia(data) {
    var p = data.split('-');
    return p[2] + '/' + p[1];
  }

  function desenharDias() {
    var alvo = $('#dias');
    alvo.replaceChildren();
    if (!dias.length) {
      var p = document.createElement('p');
      p.textContent = 'No momento não há horários livres pelo site. Entre em contato pelo WhatsApp ou e-mail do escritório.';
      alvo.append(p);
      return;
    }
    dias.forEach(function (d) {
      alvo.append(botaoOpcao(fmtDia(d.data), d.diaSemana.replace('-feira', ''), function () {
        diaEscolhido = d;
        horaEscolhida = null;
        desenharHoras();
      }));
    });
  }

  function desenharHoras() {
    $('#secao-hora').hidden = false;
    $('#secao-dados').hidden = true;
    var alvo = $('#horas');
    alvo.replaceChildren();
    diaEscolhido.horarios.forEach(function (h) {
      alvo.append(botaoOpcao(h.hora, null, function () {
        horaEscolhida = h;
        $('#secao-dados').hidden = false;
        $('#escolha').textContent = 'Você escolheu ' + diaEscolhido.diaSemana + ', ' + fmtDia(diaEscolhido.data) + ' às ' + h.hora + '.';
        $('#nome').focus();
      }));
    });
    alvo.querySelector('.opcao').focus();
  }

  function carregar() {
    if (!API) {
      $('#carregando').textContent = 'O agendamento online ainda não está disponível.';
      return;
    }
    api('horariosLivres').then(function (res) {
      if (!res.ok) throw new Error(res.erro);
      dias = res.dias;
      var area = $('#area');
      area.replaceChildren(new Option('Escolha o assunto', ''));
      res.areas.forEach(function (a) { area.append(new Option(a, a)); });
      desenharDias();
    }).catch(function () {
      $('#carregando').textContent = 'Não foi possível carregar os horários. Atualize a página em instantes.';
    });
  }

  $('#form-agendar').addEventListener('submit', function (e) {
    e.preventDefault();
    var erro = $('#erro');
    erro.textContent = '';
    if (!horaEscolhida) { erro.textContent = 'Escolha um dia e um horário.'; return; }
    var btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    api('pedirAgendamento', {
      inicio: horaEscolhida.inicio,
      nome: $('#nome').value,
      telefone: $('#telefone').value,
      email: $('#email').value,
      area: $('#area').value,
      modalidade: (document.querySelector('input[name=modalidade]:checked') || {}).value,
      resumo: $('#resumo').value,
      consentimento: $('#consentimento').checked,
      site: $('#site').value
    }).then(function (res) {
      if (!res.ok) {
        erro.textContent = MENSAGENS[res.erro] || 'Não foi possível enviar. Tente de novo.';
        if (res.erro === 'horario_ocupado') carregar();
        return;
      }
      ['section[aria-labelledby=titulo-dia]', '#secao-hora', '#secao-dados'].forEach(function (s) { $(s).hidden = true; });
      var ok = $('#sucesso');
      ok.replaceChildren();
      var h = document.createElement('h2');
      h.textContent = 'Pedido enviado!';
      var p = document.createElement('p');
      p.textContent = 'Seu pedido de consulta para ' + (res.quando || 'o horário escolhido') +
        ' foi recebido. Enviamos um e-mail de recebimento e você receberá outro quando a consulta for confirmada.';
      ok.append(h, p);
      ok.hidden = false;
      ok.focus();
    }).catch(function () {
      erro.textContent = MENSAGENS.rede;
    }).then(function () { btn.disabled = false; });
  });

  carregar();
})();
