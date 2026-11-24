(function () {
  'use strict';

  var VERSAO_PAINEL = '0.3.0';
  var API = (window.SISTEMA && window.SISTEMA.api) || '';
  var CHAVE = { sessao: 'painel.sessao', aparelho: 'painel.aparelho', dados: 'painel.dados' };
  var COLECOES = ['clientes', 'processos', 'financeiro', 'fixas', 'ajustes'];
  var STATUS_PROCESSO = ['Em andamento', 'Aguardando prazo', 'Suspenso', 'Encerrado'];
  var FORMAS_PAGAMENTO = ['Pix', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão'];
  var CATEGORIAS_DESPESA = ['Aluguel', 'Contas (luz, água, internet)', 'Sistemas e assinaturas', 'Anuidade OAB',
    'Impostos', 'Material de escritório', 'Custas processuais', 'Deslocamento', 'Outros'];
  var MENSAGEM_COBRANCA_PADRAO = 'Olá, {nome}! Tudo bem?\n' +
    'Passando para lembrar dos honorários em aberto:\n{lista}\nTotal: {total}\n\n' +
    'Chave Pix: {pix}\n\n' +
    'Se já pagou, por favor desconsidere esta mensagem. Qualquer dúvida, estou à disposição.\n' +
    'Carla Baptista – Advocacia';
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro',
    'outubro', 'novembro', 'dezembro'];

  var MENSAGENS = {
    senha_incorreta: 'E-mail ou senha incorretos.',
    muitas_tentativas: 'Muitas tentativas seguidas. Espere 15 minutos e tente de novo.',
    muitos_envios: 'Muitos códigos enviados. Espere 15 minutos e tente de novo.',
    codigo_incorreto: 'Código incorreto. Vale qualquer código enviado nos últimos 10 minutos.',
    codigo_expirado: 'O código expirou. Comece de novo.',
    senha_curta: 'A senha precisa ter pelo menos 8 caracteres.',
    senhas_diferentes: 'As duas senhas não são iguais.',
    rede: 'Não foi possível falar com o servidor. Verifique a internet.',
    erro_interno: 'O servidor encontrou um problema e não concluiu o pedido. Tente de novo; se continuar, avise quem cuida do sistema.',
    sem_servidor: 'O servidor ainda não está ligado.'
  };

  // ---------- armazenamento no aparelho ----------
  function ler(chave) {
    try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try {
      if (valor === null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
    } catch (e) { /* sem armazenamento: segue só na memória */ }
  }
  function dadosVazios() {
    var d = { registros: {}, pendentes: {} };
    COLECOES.forEach(function (c) { d.registros[c] = {}; d.pendentes[c] = {}; });
    return d;
  }

  var estado = {
    sessao: ler(CHAVE.sessao),
    dados: ler(CHAVE.dados) || dadosVazios(),
    filtros: { clientes: '', processos: '', status: '', mes: '', tipoFin: '', statusFin: '' },
    sincronizando: false,
    sincronizarDeNovo: false,
    ultimaSinc: null,
    semConexao: false,
    renderPendente: false
  };
  COLECOES.forEach(function (c) {
    estado.dados.registros[c] = estado.dados.registros[c] || {};
    estado.dados.pendentes[c] = estado.dados.pendentes[c] || {};
  });

  function salvarDados() { gravar(CHAVE.dados, estado.dados); }

  // ---------- servidor ----------
  function api(acao, corpo) {
    if (!API) return Promise.reject(new Error('sem_servidor'));
    var pedido = Object.assign({ acao: acao }, corpo || {});
    // Corpo como texto simples: evita a checagem extra de CORS que o Apps Script não responde.
    return fetch(API, { method: 'POST', body: JSON.stringify(pedido) }).then(function (r) { return r.json(); });
  }

  // ---------- utilidades de tela ----------
  function $(sel) { return document.querySelector(sel); }

  function el(tag, props, filhos) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'texto') n.textContent = v;
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (filhos || []).forEach(function (f) {
      if (f === null || f === undefined || f === false) return;
      n.append(f.nodeType ? f : document.createTextNode(String(f)));
    });
    return n;
  }

  function botao(texto, acao, classe) {
    return el('button', { type: 'button', class: 'btn ' + (classe || ''), texto: texto, onclick: acao });
  }

  function campo(id, rotulo, controle) {
    controle.id = id;
    return el('div', { class: 'campo' }, [el('label', { for: id, texto: rotulo }), controle]);
  }

  function soNumeros(t) { return String(t || '').replace(/\D/g, ''); }
  function semAcento(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function fmtCpf(d) {
    d = soNumeros(d);
    return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d;
  }
  function fmtTel(d) {
    d = soNumeros(d);
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return d;
  }
  function hora(data) {
    return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function novoId(prefixo) {
    return prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- dinheiro e datas ----------
  /** "1.500,00", "1500", "1500,5", "R$ 1.500" → centavos (NaN se não der para ler). */
  function paraCentavos(texto) {
    var t = String(texto || '').replace(/R\$|\s/g, '');
    if (!t) return NaN;
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    var n = Number(t);
    return isFinite(n) ? Math.round(n * 100) : NaN;
  }
  function centavos(valor) { return Math.round(Number(valor || 0) * 100); }
  function valorTexto(c) { return (c / 100).toFixed(2); }
  function fmtReais(c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function fmtValorCampo(valor) {
    return valor === '' || valor === undefined ? '' : (centavos(valor) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  }
  function isoLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function hoje() { return isoLocal(new Date()); }
  function mesAtual() { return hoje().slice(0, 7); }
  function fmtData(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }
  function nomeMes(aaaamm) {
    var p = aaaamm.split('-');
    return MESES[Number(p[1]) - 1] + ' de ' + p[0];
  }
  function somarMeses(aaaamm, n) {
    var p = aaaamm.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1 + n, 1);
    return isoLocal(d).slice(0, 7);
  }
  /** Mesmo dia em outro mês; se o mês não tiver esse dia (31/02), usa o último dia. */
  function dataNoMes(diaIso, n) {
    var p = diaIso.split('-').map(Number);
    var ultimo = new Date(p[0], p[1] - 1 + n + 1, 0).getDate();
    return isoLocal(new Date(p[0], p[1] - 1 + n, Math.min(p[2], ultimo)));
  }
  function situacao(l) {
    if (l.pagoEm) return 'pago';
    return l.vencimento && l.vencimento < hoje() ? 'vencido' : 'pendente';
  }
  function ajuste(id, padrao) {
    var a = estado.dados.registros.ajustes[id];
    return a && !a.excluido && a.valor !== '' ? a.valor : padrao;
  }

  /** Busca por texto (sem acento) e, se tiver números, por CPF/telefone só com números. */
  function combina(busca, textos, numeros) {
    var q = semAcento(busca).trim();
    if (!q) return true;
    if (textos.some(function (t) { return semAcento(t).indexOf(q) !== -1; })) return true;
    var qn = soNumeros(busca);
    return qn.length >= 3 && numeros.some(function (n) { return soNumeros(n).indexOf(qn) !== -1; });
  }

  function ativos(colecao) {
    var regs = estado.dados.registros[colecao];
    return Object.keys(regs).map(function (id) { return regs[id]; }).filter(function (r) { return !r.excluido; });
  }
  function porNome(a, b) { return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'); }
  function processosDoCliente(id) {
    return ativos('processos').filter(function (p) { return p.clienteId === id; });
  }
  function nomeCliente(id) {
    var c = estado.dados.registros.clientes[id];
    return c && !c.excluido ? c.nome : '—';
  }
  function totalPendentes() {
    return COLECOES.reduce(function (s, c) { return s + Object.keys(estado.dados.pendentes[c]).length; }, 0);
  }

  // ---------- login ----------
  function mostrarErroLogin(codigo) {
    var alvo = $('#login-erro');
    if (alvo) alvo.textContent = MENSAGENS[codigo] || 'Algo deu errado. Tente de novo.';
  }

  function aoEnviar(form, tarefa) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      mostrarErroLogin('');
      $('#login-erro').textContent = '';
      Promise.resolve()
        .then(tarefa)
        .catch(function (err) { mostrarErroLogin(err && err.message === 'sem_servidor' ? 'sem_servidor' : 'rede'); })
        .then(function () { btn.disabled = false; });
    });
  }

  function telaLogin(etapa, info) {
    info = info || {};
    $('#app').hidden = true;
    var raiz = $('#tela-login');
    raiz.hidden = false;

    var erro = el('p', { class: 'msg-erro', id: 'login-erro', role: 'alert' });
    var cartao = el('div', { class: 'cartao-login' }, [
      el('h1', { texto: 'Painel do escritório' }),
      el('p', { class: 'sub', texto: 'Carla Baptista · OAB/PR 74.479' })
    ]);
    var form;

    if (etapa === 'codigo' || etapa === 'nova-senha') {
      var aviso = el('p', { class: 'explica', id: 'login-aviso' },
        ['Enviamos um código de 6 dígitos para ' + (info.enviadoPara || 'o seu e-mail') +
          (info.enviadoAs ? ' às ' + info.enviadoAs : '') + '. Confira também a caixa de spam.']);
      var codigo = el('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', required: true });
      var lembrar = el('input', { type: 'checkbox', id: 'login-lembrar' });
      var filhos = [aviso, campo('login-codigo', 'Código', codigo)];
      var senha1, senha2;
      if (etapa === 'nova-senha') {
        senha1 = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
        senha2 = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
        filhos.push(campo('login-nova', 'Nova senha (mínimo 8 caracteres)', senha1));
        filhos.push(campo('login-repetir', 'Repita a nova senha', senha2));
      }
      filhos.push(el('div', { class: 'marcar' }, [lembrar, el('label', { for: 'login-lembrar', texto: 'Lembrar este aparelho por 30 dias' })]));
      filhos.push(el('button', { type: 'submit', class: 'btn primario', texto: etapa === 'nova-senha' ? 'Salvar senha e entrar' : 'Confirmar' }));
      filhos.push(botao('Reenviar código', function () {
        api('reenviarCodigo', { desafio: info.desafio }).then(function (res) {
          if (!res.ok) return mostrarErroLogin(res.erro);
          aviso.textContent = 'Novo código enviado às ' + res.enviadoAs +
            '. Qualquer código dos últimos 10 minutos vale.';
        }).catch(function () { mostrarErroLogin('rede'); });
      }, 'link'));
      filhos.push(botao('Voltar', function () { telaLogin('senha', { email: info.email }); }, 'link'));
      form = el('form', {}, filhos);

      aoEnviar(form, function () {
        if (etapa === 'nova-senha') {
          if (senha1.value !== senha2.value) return mostrarErroLogin('senhas_diferentes');
          return api('definirSenha', {
            desafio: info.desafio, codigo: codigo.value, novaSenha: senha1.value, lembrar: lembrar.checked
          }).then(resultadoLogin);
        }
        return api('confirmarCodigo', { desafio: info.desafio, codigo: codigo.value, lembrar: lembrar.checked })
          .then(resultadoLogin);
      });
    } else if (etapa === 'pedir') {
      var emailPedir = el('input', { type: 'email', autocomplete: 'username', required: true, value: info.email || '' });
      form = el('form', {}, [
        el('p', { class: 'explica', texto: 'Informe o seu e-mail. Vamos mandar um código para você criar uma senha nova.' }),
        campo('login-email', 'E-mail', emailPedir),
        el('button', { type: 'submit', class: 'btn primario', texto: 'Enviar código' }),
        botao('Voltar', function () { telaLogin('senha', { email: emailPedir.value }); }, 'link')
      ]);
      aoEnviar(form, function () {
        return api('pedirCodigoSenha', { email: emailPedir.value }).then(function (res) {
          if (!res.ok) return mostrarErroLogin(res.erro);
          telaLogin('nova-senha', Object.assign({ email: emailPedir.value }, res));
        });
      });
    } else {
      var email = el('input', { type: 'email', autocomplete: 'username', required: true, value: info.email || '' });
      var senha = el('input', { type: 'password', autocomplete: 'current-password', required: true });
      form = el('form', {}, [
        campo('login-email', 'E-mail', email),
        campo('login-senha', 'Senha', senha),
        el('button', { type: 'submit', class: 'btn primario', texto: 'Entrar' }),
        botao('Primeiro acesso ou esqueci minha senha', function () { telaLogin('pedir', { email: email.value }); }, 'link')
      ]);
      // Esse caminho depende do código por e-mail; só aparece quando ele está ligado no servidor.
      var linkPedir = form.lastChild;
      linkPedir.hidden = true;
      api('ping').then(function (res) { linkPedir.hidden = !(res && res.codigoPorEmail); }).catch(function () {});
      aoEnviar(form, function () {
        return api('entrar', { email: email.value, senha: senha.value, aparelho: ler(CHAVE.aparelho) })
          .then(function (res) {
            if (res.token) return resultadoLogin(res);
            if (res.etapa === 'codigo') return telaLogin('codigo', Object.assign({ email: email.value }, res));
            mostrarErroLogin(res.erro);
          });
      });
    }

    cartao.append(form, erro);
    raiz.replaceChildren(cartao);
    var primeiro = raiz.querySelector('input');
    if (primeiro) primeiro.focus();
  }

  function resultadoLogin(res) {
    if (!res.ok || !res.token) return mostrarErroLogin(res.erro);
    estado.sessao = { token: res.token, usuario: res.usuario, expiraEm: res.expiraEm };
    gravar(CHAVE.sessao, estado.sessao);
    if (res.aparelho) gravar(CHAVE.aparelho, res.aparelho);
    mostrarApp();
    sincronizar();
  }

  function sessaoExpirou() {
    estado.sessao = null;
    gravar(CHAVE.sessao, null);
    // Os dados e as alterações pendentes ficam guardados e sobem depois do novo login.
    telaLogin('senha');
  }

  function sair() {
    var pend = totalPendentes();
    if (pend && !confirm('Há ' + pend + ' alteração(ões) que ainda não chegaram ao servidor. Se sair agora, elas se perdem. Sair mesmo assim?')) return;
    if (estado.sessao) api('sair', { token: estado.sessao.token }).catch(function () {});
    estado.sessao = null;
    estado.dados = dadosVazios();
    gravar(CHAVE.sessao, null);
    gravar(CHAVE.dados, null);
    location.hash = '';
    telaLogin('senha');
  }

  // ---------- sincronização ----------
  function sincronizar() {
    if (!estado.sessao || !API) return Promise.resolve();
    if (estado.sincronizando) { estado.sincronizarDeNovo = true; return Promise.resolve(); }
    estado.sincronizando = true;
    atualizarStatus();

    var enviados = {};
    COLECOES.forEach(function (c) {
      var p = estado.dados.pendentes[c];
      enviados[c] = Object.keys(p).map(function (id) { return p[id]; });
    });

    return api('sincronizar', { token: estado.sessao.token, alteracoes: enviados })
      .then(function (res) {
        if (!res.ok) {
          if (res.erro === 'sessao_expirada') sessaoExpirou();
          throw new Error(res.erro);
        }
        COLECOES.forEach(function (c) {
          var pendentes = estado.dados.pendentes[c];
          // Sai da fila o que foi enviado e não mudou de novo enquanto o servidor respondia.
          enviados[c].forEach(function (r) {
            if (pendentes[r.id] && pendentes[r.id].atualizadoEm === r.atualizadoEm) delete pendentes[r.id];
          });
          var novos = {};
          (res.dados[c] || []).forEach(function (r) { novos[r.id] = r; });
          // O que ainda está na fila é mais novo que o servidor: vale o do aparelho.
          Object.keys(pendentes).forEach(function (id) { novos[id] = pendentes[id]; });
          estado.dados.registros[c] = novos;
        });
        estado.ultimaSinc = new Date();
        estado.semConexao = false;
        salvarDados();
        renderizar();
        lancarDespesasFixas();
      })
      .catch(function () { estado.semConexao = true; })
      .then(function () {
        estado.sincronizando = false;
        atualizarStatus();
        if (estado.sincronizarDeNovo) { estado.sincronizarDeNovo = false; sincronizar(); }
      });
  }

  function atualizarStatus() {
    var alvo = $('#sinc');
    if (!alvo) return;
    var pend = totalPendentes();
    var txtPend = pend ? ' · ' + pend + ' alteração(ões) aguardando envio' : '';
    if (estado.sincronizando) alvo.textContent = 'Sincronizando…';
    else if (estado.semConexao) alvo.textContent = 'Sem conexão com o servidor' + txtPend;
    else if (estado.ultimaSinc) alvo.textContent = 'Sincronizado às ' + hora(estado.ultimaSinc) + txtPend;
    else alvo.textContent = 'Ainda não sincronizado' + txtPend;
  }

  /** emLote = true: só guarda (quem chamou redesenha e sincroniza no fim). */
  function salvarRegistro(colecao, registro, emLote) {
    var agora = new Date().toISOString();
    registro.criadoEm = registro.criadoEm || agora;
    registro.atualizadoEm = agora;
    estado.dados.registros[colecao][registro.id] = registro;
    estado.dados.pendentes[colecao][registro.id] = registro;
    salvarDados();
    atualizarStatus();
    if (emLote) return;
    renderizar(true);
    sincronizar();
  }

  // ---------- desenho das telas ----------

  // Não redesenha enquanto a pessoa digita ou tem um formulário aberto (a escolha se perderia).
  function editando() {
    if ($('#janela').open) return true;
    var a = document.activeElement;
    return !!(a && $('#conteudo').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }

  function renderizar(forcar) {
    if (!estado.sessao) return;
    if (!forcar && editando()) { estado.renderPendente = true; return; }
    estado.renderPendente = false;

    var partes = location.hash.replace(/^#\/?/, '').split('/');
    var rota = partes[0] || 'inicio';
    var main = $('#conteudo');
    main.replaceChildren();
    document.querySelectorAll('.menu a').forEach(function (a) {
      if (a.getAttribute('data-rota') === rota) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (rota === 'clientes' && partes[1]) telaCliente(main, partes[1]);
    else if (rota === 'clientes') telaClientes(main);
    else if (rota === 'processos') telaProcessos(main);
    else if (rota === 'financeiro') telaFinanceiro(main);
    else if (rota === 'configuracoes') telaConfiguracoes(main);
    else telaInicio(main);
    atualizarStatus();
  }

  function cabecalho(titulo, acoes) {
    return el('div', { class: 'cab-view' }, [el('h1', { texto: titulo }), acoes || null]);
  }

  function vazio(texto, rotuloAcao, acao) {
    return el('div', { class: 'vazio' }, [el('p', { texto: texto }), rotuloAcao ? botao(rotuloAcao, acao, 'primario') : null]);
  }

  function tabela(colunas, linhas) {
    var corpo = el('tbody', {}, linhas.map(function (l) {
      var celulas = l.celulas.map(function (c, i) {
        if (i === 0) return el('td', {}, [el('a', { href: l.href, onclick: l.abrir ? function (e) { e.preventDefault(); l.abrir(); } : null, texto: c || '(sem nome)' })]);
        return el('td', { texto: c });
      });
      return el('tr', {
        'data-id': l.id,
        onclick: function (e) {
          if (e.target.tagName === 'A') return;
          if (l.abrir) l.abrir(); else location.hash = l.href;
        }
      }, celulas);
    }));
    var cab = el('thead', {}, [el('tr', {}, colunas.map(function (c) { return el('th', { scope: 'col', texto: c }); }))]);
    return el('div', { class: 'rolagem' }, [el('table', {}, [cab, corpo])]);
  }

  function telaInicio(main) {
    var nome = (estado.sessao.usuario && estado.sessao.usuario.nome) || '';
    var emAndamento = ativos('processos').filter(function (p) { return p.status !== 'Encerrado'; }).length;
    var vencidas = ativos('financeiro').filter(function (l) { return l.tipo === 'receita' && situacao(l) === 'vencido'; });
    var totalVencido = vencidas.reduce(function (s, l) { return s + centavos(l.valor); }, 0);
    main.append(
      cabecalho('Olá, ' + nome.split(' ')[0]),
      el('div', { class: 'cartoes' }, [
        el('div', { class: 'cartao' }, [el('strong', { texto: String(ativos('clientes').length) }), el('span', { texto: 'clientes' })]),
        el('div', { class: 'cartao' }, [el('strong', { texto: String(emAndamento) }), el('span', { texto: 'processos não encerrados' })]),
        el('a', { class: 'cartao', href: '#/financeiro', id: 'cartao-vencidas' }, [
          el('strong', { texto: fmtReais(totalVencido) }),
          el('span', { texto: vencidas.length + ' parcela(s) vencida(s)' })
        ])
      ]),
      el('div', { class: 'acoes', style: 'margin-top:16px' }, [
        botao('+ Novo cliente', function () { formCliente(); }, 'primario'),
        botao('+ Novo processo', function () { formProcesso(); }),
        botao('+ Honorários', function () { formReceita(); })
      ])
    );
  }

  function telaClientes(main) {
    var busca = el('input', {
      type: 'search', id: 'busca-clientes', placeholder: 'Buscar por nome, CPF, telefone ou e-mail',
      'aria-label': 'Buscar clientes', value: estado.filtros.clientes
    });
    var lista = el('div', { id: 'lista-clientes' });
    busca.addEventListener('input', function () { estado.filtros.clientes = busca.value; listaClientes(lista); });
    main.append(
      cabecalho('Clientes', botao('+ Novo cliente', function () { formCliente(); }, 'primario')),
      el('div', { class: 'filtros' }, [busca]),
      lista
    );
    listaClientes(lista);
  }

  function listaClientes(alvo) {
    var q = estado.filtros.clientes;
    var itens = ativos('clientes').filter(function (c) {
      return combina(q, [c.nome, c.email], [c.cpf, c.telefone]);
    }).sort(porNome);
    if (!itens.length) {
      alvo.replaceChildren(q ? vazio('Nenhum cliente encontrado para essa busca.')
        : vazio('Nenhum cliente cadastrado ainda.', 'Cadastrar o primeiro cliente', function () { formCliente(); }));
      return;
    }
    alvo.replaceChildren(tabela(['Nome', 'CPF', 'Telefone', 'Processos'], itens.map(function (c) {
      return {
        id: c.id, href: '#/clientes/' + c.id,
        celulas: [c.nome, fmtCpf(c.cpf), fmtTel(c.telefone), String(processosDoCliente(c.id).length)]
      };
    })));
  }

  function telaCliente(main, id) {
    var c = estado.dados.registros.clientes[id];
    main.append(el('a', { href: '#/clientes', class: 'voltar', texto: '← Clientes' }));
    if (!c || c.excluido) {
      main.append(el('p', { texto: 'Cliente não encontrado.' }));
      return;
    }
    main.append(cabecalho(c.nome, el('div', { class: 'acoes' }, [
      botao('Editar', function () { formCliente(c); }),
      botao('+ Processo', function () { formProcesso({ clienteId: c.id }); }),
      botao('Excluir', function () { excluirCliente(c); }, 'perigo')
    ])));

    var tel = soNumeros(c.telefone);
    var linhas = [
      ['CPF', fmtCpf(c.cpf)],
      ['RG', c.rg],
      ['Telefone', tel ? el('span', {}, [fmtTel(tel) + ' · ', el('a', { href: 'https://wa.me/55' + tel, target: '_blank', rel: 'noopener', texto: 'abrir no WhatsApp' })]) : ''],
      ['E-mail', c.email ? el('a', { href: 'mailto:' + c.email, texto: c.email }) : ''],
      ['Endereço', c.endereco],
      ['Observações', c.observacoes]
    ];
    var ficha = el('dl', { class: 'ficha' });
    linhas.forEach(function (l) {
      ficha.append(el('dt', { texto: l[0] }), el('dd', {}, [l[1] || '—']));
    });
    main.append(ficha);

    main.append(el('h2', { texto: 'Processos' }));
    var procs = processosDoCliente(c.id);
    main.append(procs.length ? tabelaProcessos(procs, false)
      : vazio('Nenhum processo deste cliente.', 'Cadastrar processo', function () { formProcesso({ clienteId: c.id }); }));

    var lancs = ativos('financeiro').filter(function (l) { return l.clienteId === c.id; });
    var emAberto = lancs.filter(function (l) { return !l.pagoEm; }).reduce(function (s, l) { return s + centavos(l.valor); }, 0);
    main.append(el('div', { class: 'cab-view', style: 'margin-top:32px' }, [
      el('h2', { texto: 'Financeiro', style: 'margin:0;flex:1' }),
      el('div', { class: 'acoes' }, [
        botao('+ Honorários', function () { formReceita({ clienteId: c.id }); }),
        temVencidas(c.id) ? botaoCobrar(c) : null
      ])
    ]));
    if (lancs.length) {
      main.append(el('p', { texto: 'Em aberto: ' + fmtReais(emAberto) }), tabelaLancamentos(lancs, false));
    } else {
      main.append(vazio('Nenhum lançamento deste cliente.'));
    }
  }

  function excluirCliente(c) {
    var n = processosDoCliente(c.id).length;
    if (n) {
      alert('Este cliente tem ' + n + ' processo(s). Exclua ou passe os processos para outro cliente antes.');
      return;
    }
    if (!confirm('Excluir o cliente "' + c.nome + '"?')) return;
    location.hash = '#/clientes';
    salvarRegistro('clientes', Object.assign({}, c, { excluido: true }));
  }

  function telaProcessos(main) {
    var busca = el('input', {
      type: 'search', id: 'busca-processos', placeholder: 'Buscar por número, cliente, vara ou assunto',
      'aria-label': 'Buscar processos', value: estado.filtros.processos
    });
    var status = el('select', { id: 'filtro-status', 'aria-label': 'Filtrar por status' },
      [el('option', { value: '', texto: 'Todos os status' })].concat(STATUS_PROCESSO.map(function (s) {
        return el('option', { value: s, texto: s });
      })));
    status.value = estado.filtros.status;
    var lista = el('div', { id: 'lista-processos' });
    busca.addEventListener('input', function () { estado.filtros.processos = busca.value; listaProcessos(lista); });
    status.addEventListener('change', function () { estado.filtros.status = status.value; listaProcessos(lista); });
    main.append(
      cabecalho('Processos', botao('+ Novo processo', function () { formProcesso(); }, 'primario')),
      el('div', { class: 'filtros' }, [busca, status]),
      lista
    );
    listaProcessos(lista);
  }

  function listaProcessos(alvo) {
    var q = estado.filtros.processos;
    var st = estado.filtros.status;
    var itens = ativos('processos').filter(function (p) {
      return (!st || p.status === st) && combina(q, [p.numero, p.vara, p.assunto, nomeCliente(p.clienteId)], [p.numero]);
    });
    if (!itens.length) {
      alvo.replaceChildren(q || st ? vazio('Nenhum processo encontrado com esses filtros.')
        : vazio('Nenhum processo cadastrado ainda.', 'Cadastrar o primeiro processo', function () { formProcesso(); }));
      return;
    }
    alvo.replaceChildren(tabelaProcessos(itens, true));
  }

  function tabelaProcessos(itens, comCliente) {
    itens = itens.slice().sort(function (a, b) { return String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)); });
    var colunas = ['Número', 'Assunto', 'Vara', 'Status'];
    if (comCliente) colunas.splice(1, 0, 'Cliente');
    return tabela(colunas, itens.map(function (p) {
      var celulas = [p.numero || '(sem número)', p.assunto, p.vara, p.status];
      if (comCliente) celulas.splice(1, 0, nomeCliente(p.clienteId));
      return { id: p.id, href: '#/processos', abrir: function () { formProcesso(p); }, celulas: celulas };
    }));
  }

  function telaConfiguracoes(main) {
    var u = estado.sessao.usuario || {};
    main.append(
      cabecalho('Configurações'),
      el('h2', { texto: 'Sua conta' }),
      el('p', { texto: (u.nome || '') + ' · ' + (u.email || '') }),
      el('h2', { texto: 'Sincronização' }),
      el('p', { id: 'config-sinc', texto: $('#sinc').textContent }),
      el('div', { class: 'acoes' }, [
        botao('Sincronizar agora', function () { sincronizar().then(function () { renderizar(true); }); }),
        botao('Baixar backup (arquivo)', exportarBackup)
      ]),
      el('p', { class: 'explica', texto: 'Além deste botão, o servidor guarda sozinho uma cópia da planilha por dia no seu Google Drive (últimas 30 cópias).' }),
      el('h2', { texto: 'Cobrança' }),
      secaoCobranca(),
      el('h2', { texto: 'Despesas fixas' }),
      secaoFixas(),
      el('h2', { texto: 'Sair' }),
      botao('Sair deste aparelho', sair, 'perigo')
    );
  }

  function exportarBackup() {
    var conteudo = { geradoEm: new Date().toISOString(), versaoPainel: VERSAO_PAINEL, dados: {} };
    COLECOES.forEach(function (c) { conteudo.dados[c] = ativos(c); });
    var blob = new Blob([JSON.stringify(conteudo, null, 2)], { type: 'application/json' });
    var link = el('a', { href: URL.createObjectURL(blob), download: 'backup-painel-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(link);
    link.click();
    link.remove();
  }

  // ---------- financeiro ----------
  function temVencidas(clienteId) {
    return ativos('financeiro').some(function (l) {
      return l.clienteId === clienteId && l.tipo === 'receita' && situacao(l) === 'vencido';
    });
  }

  /** Uma mensagem por cliente, com todas as parcelas vencidas dele. */
  function mensagemCobranca(cliente) {
    var vencidas = ativos('financeiro').filter(function (l) {
      return l.clienteId === cliente.id && l.tipo === 'receita' && situacao(l) === 'vencido';
    }).sort(function (a, b) { return a.vencimento.localeCompare(b.vencimento); });
    var total = vencidas.reduce(function (s, l) { return s + centavos(l.valor); }, 0);
    var lista = vencidas.map(function (l) {
      return '• ' + (l.descricao || 'Honorários') + (l.parcela ? ' (parcela ' + l.parcela + ')' : '') +
        ' – venceu em ' + fmtData(l.vencimento) + ' – ' + fmtReais(centavos(l.valor));
    }).join('\n');
    var pix = ajuste('pix', '');
    var texto = ajuste('mensagemCobranca', MENSAGEM_COBRANCA_PADRAO);
    if (!pix) texto = texto.split('\n').filter(function (linha) { return linha.indexOf('{pix}') === -1; }).join('\n');
    return texto.replace(/\{nome\}/g, String(cliente.nome || '').split(' ')[0])
      .replace(/\{lista\}/g, lista).replace(/\{total\}/g, fmtReais(total)).replace(/\{pix\}/g, pix);
  }

  function botaoCobrar(cliente) {
    var tel = soNumeros(cliente.telefone);
    if (!tel) return el('span', { class: 'explica', texto: 'Sem telefone cadastrado' });
    return el('a', {
      class: 'btn', target: '_blank', rel: 'noopener', texto: 'Cobrar no WhatsApp',
      href: 'https://wa.me/55' + tel + '?text=' + encodeURIComponent(mensagemCobranca(cliente))
    });
  }

  function mostrarAviso(texto, rotuloAcao, acao) {
    var alvo = $('#aviso');
    clearTimeout(mostrarAviso.timer);
    alvo.replaceChildren(el('span', { texto: texto }), rotuloAcao ? botao(rotuloAcao, function () {
      alvo.hidden = true;
      acao();
    }, 'link') : null);
    alvo.hidden = false;
    mostrarAviso.timer = setTimeout(function () { alvo.hidden = true; }, 8000);
  }

  function marcarPago(l) {
    var antes = l.pagoEm || '';
    salvarRegistro('financeiro', Object.assign({}, l, { pagoEm: hoje() }));
    mostrarAviso('Marcado como pago: ' + (l.descricao || '') + ' · ' + fmtReais(centavos(l.valor)), 'Desfazer', function () {
      var atual = estado.dados.registros.financeiro[l.id];
      salvarRegistro('financeiro', Object.assign({}, atual, { pagoEm: antes }));
    });
  }

  function tabelaLancamentos(itens, comCliente) {
    itens = itens.slice().sort(function (a, b) { return String(a.vencimento).localeCompare(String(b.vencimento)); });
    var colunas = ['Vencimento', 'Descrição', 'Valor', 'Situação', ''];
    if (comCliente) colunas.splice(2, 0, 'Cliente / categoria');
    var corpo = el('tbody', {}, itens.map(function (l) {
      var sit = situacao(l);
      var rotuloSit = sit === 'pago' ? 'Pago em ' + fmtData(l.pagoEm) : sit === 'vencido' ? 'Vencido' : 'A vencer';
      var acao = sit === 'pago' ? null : botao(l.tipo === 'despesa' ? 'Marcar como paga' : 'Marcar como pago', function (e) {
        e.stopPropagation();
        marcarPago(l);
      }, 'pequeno');
      var desc = (l.descricao || (l.tipo === 'despesa' ? 'Despesa' : 'Honorários')) + (l.parcela ? ' · ' + l.parcela : '');
      var celulas = [
        el('td', { texto: fmtData(l.vencimento) }),
        el('td', {}, [el('a', { href: '#/financeiro', onclick: function (e) { e.preventDefault(); formLancamento(l); }, texto: desc })]),
        el('td', { class: 'valor ' + (l.tipo === 'despesa' ? 'saida' : 'entrada'), texto: (l.tipo === 'despesa' ? '− ' : '') + fmtReais(centavos(l.valor)) }),
        el('td', {}, [el('span', { class: 'selo ' + sit, texto: rotuloSit })]),
        el('td', {}, [acao])
      ];
      if (comCliente) celulas.splice(2, 0, el('td', { texto: l.tipo === 'despesa' ? (l.categoria || '—') : nomeCliente(l.clienteId) }));
      return el('tr', { 'data-id': l.id, onclick: function (e) { if (!e.target.closest('a, button')) formLancamento(l); } }, celulas);
    }));
    var cab = el('thead', {}, [el('tr', {}, colunas.map(function (c) { return el('th', { scope: 'col', texto: c }); }))]);
    return el('div', { class: 'rolagem' }, [el('table', { class: 'tabela-fin' }, [cab, corpo])]);
  }

  function telaFinanceiro(main) {
    var mes = estado.filtros.mes || mesAtual();
    var doMes = ativos('financeiro').filter(function (l) { return String(l.vencimento).slice(0, 7) === mes; });
    var soma = function (lista) { return lista.reduce(function (s, l) { return s + centavos(l.valor); }, 0); };
    var receitas = doMes.filter(function (l) { return l.tipo === 'receita'; });
    var despesas = doMes.filter(function (l) { return l.tipo === 'despesa'; });
    var recebido = soma(receitas.filter(function (l) { return l.pagoEm; }));
    var aReceber = soma(receitas.filter(function (l) { return !l.pagoEm; }));
    var despPagas = soma(despesas.filter(function (l) { return l.pagoEm; }));
    var despTotal = soma(despesas);

    main.append(cabecalho('Financeiro', el('div', { class: 'acoes' }, [
      botao('+ Honorários', function () { formReceita(); }, 'primario'),
      botao('+ Despesa', function () { formDespesa(); })
    ])));

    main.append(el('div', { class: 'navega-mes' }, [
      botao('‹', function () { estado.filtros.mes = somarMeses(mes, -1); renderizar(true); }, 'pequeno'),
      el('strong', { id: 'mes-atual', texto: nomeMes(mes) }),
      botao('›', function () { estado.filtros.mes = somarMeses(mes, 1); renderizar(true); }, 'pequeno'),
      mes !== mesAtual() ? botao('Voltar para o mês atual', function () { estado.filtros.mes = ''; renderizar(true); }, 'link') : null
    ]));
    main.querySelector('.navega-mes button').setAttribute('aria-label', 'Mês anterior');
    main.querySelectorAll('.navega-mes button')[1].setAttribute('aria-label', 'Próximo mês');

    main.append(el('div', { class: 'cartoes' }, [
      cartaoValor('Recebido', recebido),
      cartaoValor('A receber', aReceber),
      cartaoValor('Despesas (pagas ' + fmtReais(despPagas) + ')', despTotal),
      cartaoValor('Resultado (recebido − despesas pagas)', recebido - despPagas)
    ]));

    // Cobranças: todas as parcelas vencidas, de qualquer mês, uma linha por cliente.
    var porCliente = {};
    ativos('financeiro').forEach(function (l) {
      if (l.tipo !== 'receita' || situacao(l) !== 'vencido') return;
      porCliente[l.clienteId] = porCliente[l.clienteId] || { total: 0, n: 0 };
      porCliente[l.clienteId].total += centavos(l.valor);
      porCliente[l.clienteId].n += 1;
    });
    var idsVencidos = Object.keys(porCliente);
    if (idsVencidos.length) {
      main.append(el('h2', { texto: 'Cobranças em atraso' }));
      main.append(el('ul', { class: 'cobrancas' }, idsVencidos.map(function (id) {
        var c = estado.dados.registros.clientes[id] || { id: id, nome: '(cliente excluído)' };
        return el('li', {}, [
          el('span', {}, [el('a', { href: '#/clientes/' + id, texto: c.nome }),
            ' · ' + porCliente[id].n + ' parcela(s) · ' + fmtReais(porCliente[id].total)]),
          botaoCobrar(c)
        ]);
      })));
    }

    main.append(el('h2', { texto: 'Lançamentos de ' + nomeMes(mes) }));
    var tipo = el('select', { id: 'filtro-tipo', 'aria-label': 'Tipo de lançamento' }, [
      el('option', { value: '', texto: 'Receitas e despesas' }),
      el('option', { value: 'receita', texto: 'Só receitas' }),
      el('option', { value: 'despesa', texto: 'Só despesas' })
    ]);
    var sit = el('select', { id: 'filtro-situacao', 'aria-label': 'Situação' }, [
      el('option', { value: '', texto: 'Todas as situações' }),
      el('option', { value: 'pendente', texto: 'A vencer' }),
      el('option', { value: 'vencido', texto: 'Vencidos' }),
      el('option', { value: 'pago', texto: 'Pagos' })
    ]);
    tipo.value = estado.filtros.tipoFin;
    sit.value = estado.filtros.statusFin;
    var lista = el('div', { id: 'lista-financeiro' });
    function desenharLista() {
      var itens = doMes.filter(function (l) {
        return (!estado.filtros.tipoFin || l.tipo === estado.filtros.tipoFin) &&
          (!estado.filtros.statusFin || situacao(l) === estado.filtros.statusFin);
      });
      lista.replaceChildren(itens.length ? tabelaLancamentos(itens, true)
        : vazio(doMes.length ? 'Nenhum lançamento com esses filtros.' : 'Nenhum lançamento neste mês.'));
    }
    tipo.addEventListener('change', function () { estado.filtros.tipoFin = tipo.value; desenharLista(); });
    sit.addEventListener('change', function () { estado.filtros.statusFin = sit.value; desenharLista(); });
    main.append(el('div', { class: 'filtros' }, [tipo, sit]), lista);
    desenharLista();

    main.append(el('h2', { texto: 'Últimos 6 meses' }), graficoMeses(mes));
  }

  function cartaoValor(rotulo, c) {
    return el('div', { class: 'cartao' }, [el('strong', { texto: fmtReais(c) }), el('span', { texto: rotulo })]);
  }

  /** Barras agrupadas: recebido × despesas pagas, por mês de vencimento. Uma escala só. */
  function graficoMeses(mesFinal) {
    var meses = [];
    for (var i = 5; i >= 0; i--) meses.push(somarMeses(mesFinal, -i));
    var linhas = meses.map(function (m) {
      var r = 0, d = 0;
      ativos('financeiro').forEach(function (l) {
        if (!l.pagoEm || String(l.vencimento).slice(0, 7) !== m) return;
        if (l.tipo === 'receita') r += centavos(l.valor); else d += centavos(l.valor);
      });
      return { mes: m, recebido: r, despesas: d };
    });
    var maximo = Math.max.apply(null, linhas.map(function (l) { return Math.max(l.recebido, l.despesas); }).concat([1]));
    var NS = 'http://www.w3.org/2000/svg';
    function s(tag, attrs, filhos) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      (filhos || []).forEach(function (f) { n.append(f); });
      return n;
    }
    var L = 600, A = 220, topo = 16, base = 190, esq = 8;
    var largGrupo = (L - esq) / 6, largBarra = 22;
    var svg = s('svg', { viewBox: '0 0 ' + L + ' ' + A, role: 'img', 'aria-label': 'Recebido e despesas pagas nos últimos 6 meses', class: 'grafico' });
    [0.5, 1].forEach(function (f) {
      var y = base - (base - topo) * f;
      svg.append(s('line', { x1: esq, x2: L, y1: y, y2: y, class: 'grade' }),
        s('text', { x: L, y: y - 4, 'text-anchor': 'end', class: 'eixo' }, [fmtReais(Math.round(maximo * f))]));
    });
    svg.append(s('line', { x1: esq, x2: L, y1: base, y2: base, class: 'base' }));
    function barra(x, valor, classe, titulo) {
      var h = Math.max((base - topo) * valor / maximo, valor ? 2 : 0);
      var y = base - h, r = Math.min(4, h);
      var d = 'M' + x + ',' + base + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        'H' + (x + largBarra - r) + 'Q' + (x + largBarra) + ',' + y + ' ' + (x + largBarra) + ',' + (y + r) + 'V' + base + 'Z';
      var g = s('g', { class: 'barra' }, [s('title', {}, [titulo]),
        s('rect', { x: x - 3, y: topo, width: largBarra + 6, height: base - topo, fill: 'transparent' }),
        s('path', { d: d, class: classe })]);
      return g;
    }
    linhas.forEach(function (l, i) {
      var cx = esq + largGrupo * i + largGrupo / 2;
      var rotulo = MESES[Number(l.mes.slice(5)) - 1].slice(0, 3) + '/' + l.mes.slice(2, 4);
      svg.append(
        barra(cx - largBarra - 1, l.recebido, 'serie-recebido', rotulo + ' · recebido ' + fmtReais(l.recebido)),
        barra(cx + 1, l.despesas, 'serie-despesas', rotulo + ' · despesas pagas ' + fmtReais(l.despesas)),
        s('text', { x: cx, y: base + 18, 'text-anchor': 'middle', class: 'eixo' }, [rotulo])
      );
    });
    var legenda = el('div', { class: 'legenda' }, [
      el('span', {}, [el('i', { class: 'amostra serie-recebido' }), 'Recebido']),
      el('span', {}, [el('i', { class: 'amostra serie-despesas' }), 'Despesas pagas'])
    ]);
    var tabelaDados = el('details', { class: 'ver-tabela' }, [
      el('summary', { texto: 'Ver em tabela' }),
      el('div', { class: 'rolagem' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['Mês', 'Recebido', 'Despesas pagas', 'Resultado'].map(function (c) { return el('th', { scope: 'col', texto: c }); }))]),
        el('tbody', {}, linhas.map(function (l) {
          return el('tr', {}, [el('td', { texto: nomeMes(l.mes) }), el('td', { texto: fmtReais(l.recebido) }),
            el('td', { texto: fmtReais(l.despesas) }), el('td', { texto: fmtReais(l.recebido - l.despesas) })]);
        }))
      ])])
    ]);
    return el('div', { class: 'cartao grafico-caixa' }, [legenda, svg, tabelaDados]);
  }

  function opcoesClientes() {
    return [['', 'Escolha o cliente']].concat(ativos('clientes').sort(porNome).map(function (c) { return [c.id, c.nome]; }));
  }
  function opcoesProcessos() {
    return [['', 'Nenhum']].concat(ativos('processos').map(function (p) {
      return [p.id, (p.numero || '(sem número)') + ' · ' + nomeCliente(p.clienteId)];
    }));
  }
  function opcoesLista(lista) { return lista.map(function (x) { return [x, x]; }); }

  /** Honorários: valor total dividido em parcelas mensais (os centavos que sobram vão na última). */
  function formReceita(base) {
    if (!ativos('clientes').length) {
      alert('Cadastre o cliente primeiro. Os honorários ficam ligados a um cliente.');
      return;
    }
    var campos = [
      { k: 'clienteId', r: 'Cliente', tipo: 'opcoes', obrig: true, opcoes: opcoesClientes },
      { k: 'processoId', r: 'Processo (opcional)', tipo: 'opcoes', opcoes: opcoesProcessos },
      { k: 'descricao', r: 'Descrição', obrig: true },
      { k: 'valor', r: 'Valor total (R$)', tipo: 'dinheiro', obrig: true },
      { k: 'parcelas', r: 'Número de parcelas', tipo: 'number', min: 1, max: 60, obrig: true },
      { k: 'vencimento', r: 'Vencimento da 1ª parcela', tipo: 'date', obrig: true },
      { k: 'forma', r: 'Forma de pagamento', tipo: 'opcoes', opcoes: function () { return opcoesLista(FORMAS_PAGAMENTO); } }
    ];
    var inicial = Object.assign({ descricao: 'Honorários', parcelas: '1', vencimento: hoje(), forma: 'Pix' }, base || {});
    abrirFormulario('Novos honorários', campos, inicial, function (d) {
      var n = Number(d.parcelas);
      var total = centavos(d.valor);
      var cada = Math.floor(total / n);
      var grupo = novoId('grp_');
      estado.filtros.mes = d.vencimento.slice(0, 7);
      for (var i = 0; i < n; i++) {
        var valor = i === n - 1 ? total - cada * (n - 1) : cada;
        salvarRegistro('financeiro', {
          id: novoId('fin_'), tipo: 'receita', clienteId: d.clienteId, processoId: d.processoId,
          descricao: d.descricao, valor: valorTexto(valor), vencimento: dataNoMes(d.vencimento, i),
          pagoEm: '', forma: d.forma, grupoId: grupo, parcela: n > 1 ? (i + 1) + '/' + n : ''
        }, i < n - 1);
      }
    });
  }

  function formDespesa() {
    var campos = [
      { k: 'descricao', r: 'Descrição', obrig: true },
      { k: 'categoria', r: 'Categoria', tipo: 'opcoes', opcoes: function () { return opcoesLista(CATEGORIAS_DESPESA); } },
      { k: 'valor', r: 'Valor (R$)', tipo: 'dinheiro', obrig: true },
      { k: 'vencimento', r: 'Vencimento', tipo: 'date', obrig: true },
      { k: 'paga', r: 'Situação', tipo: 'opcoes', opcoes: function () { return [['', 'A pagar'], ['sim', 'Já paga']]; } }
    ];
    abrirFormulario('Nova despesa', campos, { categoria: 'Outros', vencimento: hoje() }, function (d) {
      estado.filtros.mes = d.vencimento.slice(0, 7);
      salvarRegistro('financeiro', {
        id: novoId('fin_'), tipo: 'despesa', descricao: d.descricao, categoria: d.categoria,
        valor: d.valor, vencimento: d.vencimento, pagoEm: d.paga ? hoje() : ''
      });
    });
  }

  /** Editar um lançamento já existente (uma parcela ou uma despesa). */
  function formLancamento(l) {
    var campos = [{ k: 'descricao', r: 'Descrição', obrig: true }];
    if (l.tipo === 'despesa') campos.push({ k: 'categoria', r: 'Categoria', tipo: 'opcoes', opcoes: function () { return opcoesLista(CATEGORIAS_DESPESA); } });
    else campos.push({ k: 'clienteId', r: 'Cliente', tipo: 'opcoes', obrig: true, opcoes: opcoesClientes },
      { k: 'forma', r: 'Forma de pagamento', tipo: 'opcoes', opcoes: function () { return opcoesLista(FORMAS_PAGAMENTO); } });
    campos.push({ k: 'valor', r: 'Valor (R$)', tipo: 'dinheiro', obrig: true },
      { k: 'vencimento', r: 'Vencimento', tipo: 'date', obrig: true },
      { k: 'pagoEm', r: 'Pago em (deixe vazio se não foi pago)', tipo: 'date' });
    var titulo = l.tipo === 'despesa' ? 'Editar despesa' : 'Editar honorários' + (l.parcela ? ' · parcela ' + l.parcela : '');
    abrirFormulario(titulo, campos, l, function (d) { salvarRegistro('financeiro', d); });
    $('#janela .acoes').prepend(botao('Excluir', function () {
      if (!confirm('Excluir este lançamento?')) return;
      $('#janela').close();
      salvarRegistro('financeiro', Object.assign({}, l, { excluido: true }));
    }, 'perigo'));
  }

  // ---------- despesas fixas e ajustes ----------

  /**
   * Lança no mês atual as despesas fixas ativas que ainda não foram lançadas.
   * O id vem da despesa fixa + mês: dois aparelhos ao mesmo tempo geram o mesmo id, sem duplicar.
   * Só roda depois de uma sincronização bem-sucedida (para não sobrescrever o que já está pago).
   */
  function lancarDespesasFixas() {
    if (!estado.ultimaSinc) return;
    var mes = mesAtual();
    var criou = false;
    ativos('fixas').forEach(function (f) {
      if (f.ativa !== 'sim') return;
      var id = 'fx_' + f.id + '_' + mes.replace('-', '');
      if (estado.dados.registros.financeiro[id]) return;
      var ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0).getDate();
      var dia = String(Math.min(Number(f.dia) || 1, ultimoDia)).padStart(2, '0');
      salvarRegistro('financeiro', {
        id: id, tipo: 'despesa', descricao: f.descricao, categoria: f.categoria, valor: f.valor,
        vencimento: mes + '-' + dia, pagoEm: '', fixaId: f.id
      }, true);
      criou = true;
    });
    if (criou) { renderizar(); sincronizar(); }
  }

  function formFixa(f) {
    var campos = [
      { k: 'descricao', r: 'Descrição (ex.: Aluguel da sala)', obrig: true },
      { k: 'categoria', r: 'Categoria', tipo: 'opcoes', opcoes: function () { return opcoesLista(CATEGORIAS_DESPESA); } },
      { k: 'valor', r: 'Valor mensal (R$)', tipo: 'dinheiro', obrig: true },
      { k: 'dia', r: 'Dia do vencimento', tipo: 'number', min: 1, max: 31, obrig: true },
      { k: 'ativa', r: 'Lançar todo mês?', tipo: 'opcoes', opcoes: function () { return [['sim', 'Sim'], ['nao', 'Não (pausada)']]; } }
    ];
    abrirFormulario(f ? 'Editar despesa fixa' : 'Nova despesa fixa', campos,
      f || { id: novoId('fix_'), categoria: 'Aluguel', dia: '10', ativa: 'sim' }, function (d) {
        salvarRegistro('fixas', d);
        lancarDespesasFixas();
      });
  }

  function secaoCobranca() {
    var pix = el('input', { id: 'ajuste-pix', value: ajuste('pix', ''), autocomplete: 'off' });
    var msg = el('textarea', { id: 'ajuste-mensagem', value: ajuste('mensagemCobranca', MENSAGEM_COBRANCA_PADRAO), rows: '9' });
    var ok = el('p', { class: 'msg-ok', role: 'status' });
    var form = el('form', { class: 'form-ajustes' }, [
      el('div', { class: 'campo' }, [el('label', { for: 'ajuste-pix', texto: 'Chave Pix do escritório' }), pix]),
      el('div', { class: 'campo' }, [
        el('label', { for: 'ajuste-mensagem', texto: 'Mensagem de cobrança pelo WhatsApp' }),
        el('small', { class: 'explica', texto: 'Use {nome}, {lista} (parcelas vencidas), {total} e {pix}. A linha com {pix} some se a chave estiver vazia.' }),
        msg
      ]),
      el('div', { class: 'acoes' }, [
        el('button', { type: 'submit', class: 'btn primario', texto: 'Salvar' }),
        botao('Voltar ao texto padrão', function () { msg.value = MENSAGEM_COBRANCA_PADRAO; })
      ]),
      ok
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      [['pix', pix.value.trim()], ['mensagemCobranca', msg.value]].forEach(function (par) {
        var atual = estado.dados.registros.ajustes[par[0]] || { id: par[0] };
        salvarRegistro('ajustes', Object.assign({}, atual, { valor: par[1], excluido: false }), true);
      });
      sincronizar();
      ok.textContent = 'Salvo.';
    });
    return form;
  }

  function secaoFixas() {
    var fixas = ativos('fixas').sort(function (a, b) { return Number(a.dia) - Number(b.dia); });
    var caixa = el('div', {}, [
      el('p', { class: 'explica', texto: 'São lançadas sozinhas no começo de cada mês, como despesa a pagar.' }),
      el('div', { class: 'acoes', style: 'margin-bottom:12px' }, [botao('+ Despesa fixa', function () { formFixa(); })])
    ]);
    if (!fixas.length) {
      caixa.append(vazio('Nenhuma despesa fixa cadastrada (aluguel, internet, sistemas…).'));
      return caixa;
    }
    caixa.append(tabela(['Descrição', 'Valor', 'Dia', 'Situação'], fixas.map(function (f) {
      return {
        id: f.id, href: '#/configuracoes', abrir: function () { formFixa(f); },
        celulas: [f.descricao, fmtReais(centavos(f.valor)), 'todo dia ' + f.dia, f.ativa === 'sim' ? 'Ativa' : 'Pausada']
      };
    })));
    return caixa;
  }

  // ---------- formulários ----------
  function abrirFormulario(titulo, campos, registro, aoSalvar) {
    var janela = $('#janela');
    var erro = el('p', { class: 'msg-erro', role: 'alert' });
    var controles = {};
    var filhos = [el('h2', { id: 'janela-titulo', texto: titulo })];

    campos.forEach(function (c) {
      var ctrl;
      var valor = registro[c.k] || '';
      if (c.tipo === 'area') ctrl = el('textarea', { value: valor });
      else if (c.tipo === 'opcoes') {
        ctrl = el('select', {}, c.opcoes().map(function (o) { return el('option', { value: o[0], texto: o[1] }); }));
        ctrl.value = valor || (c.padrao || '');
      } else if (c.tipo === 'dinheiro') ctrl = el('input', { inputmode: 'decimal', value: fmtValorCampo(valor), placeholder: '0,00', autocomplete: 'off' });
      else if (c.tipo === 'number') ctrl = el('input', { type: 'number', inputmode: 'numeric', min: c.min, max: c.max, step: '1', value: valor });
      else if (c.tipo === 'cpf') ctrl = el('input', { inputmode: 'numeric', value: fmtCpf(valor), autocomplete: 'off' });
      else if (c.tipo === 'tel') ctrl = el('input', { type: 'tel', value: fmtTel(valor), autocomplete: 'off' });
      else ctrl = el('input', { type: c.tipo || 'text', value: valor, autocomplete: 'off' });
      if (c.obrig) ctrl.required = true;
      controles[c.k] = ctrl;
      filhos.push(campo('f-' + c.k, c.r + (c.obrig ? ' *' : ''), ctrl));
    });

    var form = el('form', { method: 'dialog' }, filhos.concat([
      erro,
      el('div', { class: 'acoes' }, [
        botao('Cancelar', function () { janela.close(); }),
        el('button', { type: 'submit', class: 'btn primario', texto: 'Salvar' })
      ])
    ]));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var dados = Object.assign({}, registro);
      for (var i = 0; i < campos.length; i++) {
        var c = campos[i];
        var v = controles[c.k].value.trim();
        if (c.tipo === 'cpf' || c.tipo === 'tel') v = soNumeros(v);
        if (c.tipo === 'cpf' && v && v.length !== 11) { erro.textContent = 'O CPF precisa ter 11 números.'; controles[c.k].focus(); return; }
        if (c.obrig && !v) { erro.textContent = 'Preencha o campo "' + c.r + '".'; controles[c.k].focus(); return; }
        if (c.tipo === 'dinheiro' && v) {
          var cent = paraCentavos(v);
          if (!(cent > 0)) { erro.textContent = 'Valor inválido em "' + c.r + '". Exemplo: 1.500,00'; controles[c.k].focus(); return; }
          v = valorTexto(cent);
        }
        if (c.tipo === 'number' && v) {
          var num = Number(v);
          if (!Number.isInteger(num) || (c.min !== undefined && num < c.min) || (c.max !== undefined && num > c.max)) {
            erro.textContent = '"' + c.r + '" precisa ser um número de ' + c.min + ' a ' + c.max + '.';
            controles[c.k].focus();
            return;
          }
        }
        dados[c.k] = v;
      }
      janela.close();
      aoSalvar(dados);
    });

    janela.replaceChildren(form);
    janela.showModal();
    var primeiro = form.querySelector('input, select, textarea');
    if (primeiro) primeiro.focus();
  }

  var CAMPOS_CLIENTE = [
    { k: 'nome', r: 'Nome completo', obrig: true },
    { k: 'cpf', r: 'CPF', tipo: 'cpf' },
    { k: 'rg', r: 'RG' },
    { k: 'telefone', r: 'Telefone (WhatsApp)', tipo: 'tel' },
    { k: 'email', r: 'E-mail', tipo: 'email' },
    { k: 'endereco', r: 'Endereço completo' },
    { k: 'observacoes', r: 'Observações', tipo: 'area' }
  ];

  function formCliente(c) {
    var novo = !c;
    abrirFormulario(novo ? 'Novo cliente' : 'Editar cliente', CAMPOS_CLIENTE, c || { id: novoId('cli_') }, function (dados) {
      salvarRegistro('clientes', dados);
      if (novo) location.hash = '#/clientes/' + dados.id;
    });
  }

  function formProcesso(p) {
    var novo = !p || !p.id;
    var clientes = ativos('clientes').sort(porNome);
    if (!clientes.length) {
      alert('Cadastre o cliente primeiro. Todo processo precisa estar ligado a um cliente.');
      return;
    }
    var campos = [
      { k: 'clienteId', r: 'Cliente', tipo: 'opcoes', obrig: true, opcoes: function () {
        return [['', 'Escolha o cliente']].concat(clientes.map(function (c) { return [c.id, c.nome]; }));
      } },
      { k: 'numero', r: 'Número do processo' },
      { k: 'vara', r: 'Vara / Juízo' },
      { k: 'assunto', r: 'Assunto' },
      { k: 'status', r: 'Status', tipo: 'opcoes', padrao: STATUS_PROCESSO[0], opcoes: function () {
        return STATUS_PROCESSO.map(function (s) { return [s, s]; });
      } },
      { k: 'observacoes', r: 'Observações', tipo: 'area' }
    ];
    var registro = Object.assign({ id: novoId('pro_') }, p || {});
    abrirFormulario(novo ? 'Novo processo' : 'Editar processo', campos, registro, function (dados) {
      salvarRegistro('processos', dados);
    });
    if (!novo) {
      // Excluir fica dentro do formulário de edição do processo.
      var acoes = $('#janela .acoes');
      acoes.prepend(botao('Excluir', function () {
        if (!confirm('Excluir este processo?')) return;
        $('#janela').close();
        salvarRegistro('processos', Object.assign({}, p, { excluido: true }));
      }, 'perigo'));
    }
  }

  // ---------- início ----------
  function mostrarApp() {
    $('#tela-login').hidden = true;
    $('#app').hidden = false;
    if (!location.hash || location.hash === '#') location.hash = '#/inicio';
    renderizar(true);
  }

  $('#versao-painel').textContent = 'versão ' + VERSAO_PAINEL;
  window.addEventListener('hashchange', function () { renderizar(true); $('#conteudo').focus(); });
  document.addEventListener('focusout', function () {
    setTimeout(function () { if (estado.renderPendente && !editando()) renderizar(); }, 0);
  });
  $('#janela').addEventListener('close', function () {
    setTimeout(function () { if (estado.renderPendente) renderizar(); }, 0);
  });
  window.addEventListener('online', sincronizar);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sincronizar(); });
  setInterval(sincronizar, 60000);

  if (estado.sessao && estado.sessao.expiraEm && estado.sessao.expiraEm < new Date().toISOString()) sessaoExpirou();
  else if (estado.sessao) { mostrarApp(); sincronizar(); }
  else telaLogin('senha');
})();
