'use strict';
// Frontend sem frameworks. Regra de ouro contra XSS: todo dado vindo da API entra na página
// como texto (textContent / nós de texto). Nenhum innerHTML com dados é usado.

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
let usuario = null;

// ---------- utilitários de DOM ----------
function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  let valor;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') valor = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  if (valor !== undefined) el.value = valor; // depois dos filhos, para <select> funcionar
  return el;
}

function cadeado() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7h1zm2 0h4V5a2 2 0 0 0-4 0v2z');
  svg.append(p);
  return svg;
}
const selado = (texto, descricao) => h('span', { class: 'selado', title: descricao }, cadeado(), texto);
const aviso = (tipo, texto) => h('div', { class: `aviso ${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, texto);
const reais = (cents) => brl.format(cents / 100);
const formatarCep = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const formatarEndereco = (e) =>
  `${e.rua}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''}, ${e.bairro}, ${e.cidade}/${e.uf}, CEP ${formatarCep(e.cep)}`;

// ---------- API ----------
function lerCookie(nome) {
  const par = document.cookie.split('; ').find((c) => c.startsWith(`${nome}=`));
  return par ? decodeURIComponent(par.slice(nome.length + 1)) : '';
}
async function garantirCsrf() {
  if (!lerCookie('csrf')) await fetch('/api/auth/csrf', { credentials: 'same-origin' });
}
async function api(metodo, url, corpo) {
  if (metodo !== 'GET') await garantirCsrf();
  const res = await fetch(url, {
    method: metodo,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': lerCookie('csrf') },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let dados = {};
  try { dados = await res.json(); } catch { /* resposta sem JSON */ }
  if (!res.ok) {
    const erro = new Error(dados.error || 'Não foi possível concluir a ação. Tente de novo.');
    erro.status = res.status;
    erro.campos = dados.fields || {};
    throw erro;
  }
  return dados;
}

// ---------- formulários ----------
function campo(rotulo, nome, opcoes = {}) {
  const { dica, tag = 'input', opcoesSelect, ...attrs } = opcoes;
  const id = `f-${nome.replace(/\W/g, '-')}`;
  let controle;
  if (tag === 'textarea') controle = h('textarea', { id, name: nome, ...attrs });
  else if (tag === 'select') {
    controle = h('select', { id, name: nome, ...attrs }, opcoesSelect.map(([v, t]) => h('option', { value: v }, t)));
  } else controle = h('input', { id, name: nome, type: 'text', ...attrs });
  if (dica) controle.setAttribute('aria-describedby', `${id}-dica`);
  return h('div', { class: 'campo' },
    h('label', { for: id }, rotulo), controle,
    dica ? h('small', { class: 'dica', id: `${id}-dica` }, dica) : null,
    h('small', { class: 'erro', 'data-erro': nome, 'aria-live': 'polite' }));
}

function mostrarErros(form, erro) {
  const topo = form.querySelector('.aviso-form');
  topo.replaceChildren(aviso('erro', erro.message));
  for (const [caminho, msg] of Object.entries(erro.campos || {})) {
    const ultimo = caminho.split('.').pop();
    const alvo = form.querySelector(`[data-erro="${CSS.escape(caminho)}"]`) || form.querySelector(`[data-erro="${CSS.escape(ultimo)}"]`);
    if (alvo) {
      alvo.textContent = msg;
      const input = form.querySelector(`[name="${CSS.escape(alvo.dataset.erro)}"]`);
      if (input) input.setAttribute('aria-invalid', 'true');
    }
  }
}

function limparErros(form) {
  form.querySelector('.aviso-form').replaceChildren();
  form.querySelectorAll('[data-erro]').forEach((e) => { e.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
}

function formulario({ campos, botao, aoEnviar, classe }) {
  const btn = h('button', { type: 'submit' }, botao);
  const form = h('form', { class: classe, novalidate: true }, h('div', { class: 'aviso-form' }), campos, btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    btn.disabled = true;
    try {
      const dados = Object.fromEntries(new FormData(form));
      await aoEnviar(dados, form);
    } catch (erro) {
      if (erro.status === 401 && usuario) { usuario = null; return ir('#/entrar?ok=expirou'); }
      mostrarErros(form, erro);
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

// ---------- navegação ----------
const MENSAGENS = {
  cadastro: 'Conta criada. Agora é só entrar.',
  senha: 'Senha redefinida. Entre com a nova senha.',
  pedido: 'Pagamento aprovado. Acompanhe a entrega por aqui.',
  saiu: 'Você saiu da conta.',
  expirou: 'Sua sessão expirou. Entre novamente.',
  inativo: 'Você foi desconectado por inatividade.',
};
const mensagemDaUrl = (q) => (MENSAGENS[q.get('ok')] ? aviso('ok', MENSAGENS[q.get('ok')]) : null);

function ir(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

async function sair(motivo = 'saiu') {
  try { await api('POST', '/api/auth/logout'); } catch { /* já saiu */ }
  usuario = null;
  ir(`#/entrar?ok=${motivo}`);
}

function montarNav(caminho) {
  const link = (href, texto, extra = {}) =>
    h('a', { href, 'aria-current': caminho === href ? 'page' : null, ...extra }, texto);
  const itens = usuario
    ? [link('#/loja', 'Loja'), link('#/vender', 'Vender'), link('#/compras', 'Minhas compras'),
      link('#/vendas', 'Minhas vendas'), link('#/perfil', 'Meus dados'),
      link('#/emails', 'Caixa de e-mails (teste)', { class: 'dev' }),
      h('button', { type: 'button', onclick: () => sair() }, `Sair (${usuario.nome.split(' ')[0]})`)]
    : [link('#/loja', 'Loja'), link('#/entrar', 'Entrar'), link('#/cadastro', 'Criar conta'),
      link('#/emails', 'Caixa de e-mails (teste)', { class: 'dev' })];
  nav.replaceChildren(...itens);
}

// ---------- telas: autenticação ----------
function telaEntrar(q) {
  return h('section', { class: 'estreito' },
    h('h1', {}, 'Entrar'),
    h('p', { class: 'sub' }, 'Use o e-mail e a senha da sua conta.'),
    mensagemDaUrl(q),
    formulario({
      campos: [
        campo('E-mail', 'email', { type: 'email', autocomplete: 'username', required: true }),
        campo('Senha', 'senha', { type: 'password', autocomplete: 'current-password', required: true }),
      ],
      botao: 'Entrar',
      aoEnviar: async (d) => {
        const r = await api('POST', '/api/auth/login', d);
        usuario = r.usuario;
        ir('#/loja');
      },
    }),
    h('p', { class: 'links' }, h('a', { href: '#/cadastro' }, 'Criar conta'), h('a', { href: '#/esqueci' }, 'Esqueci minha senha')));
}

function telaCadastro() {
  return h('section', { class: 'estreito' },
    h('h1', {}, 'Criar conta'),
    h('p', { class: 'sub' }, 'Seu CPF e telefone ficam cifrados no nosso banco e só aparecem mascarados.'),
    formulario({
      campos: [
        campo('Nome completo', 'nome', { autocomplete: 'name', required: true }),
        campo('E-mail', 'email', { type: 'email', autocomplete: 'email', required: true }),
        campo('CPF', 'cpf', { inputmode: 'numeric', autocomplete: 'off', placeholder: '000.000.000-00', required: true }),
        campo('Celular', 'telefone', { type: 'tel', autocomplete: 'tel', placeholder: '(12) 99999-0000', required: true }),
        campo('Senha', 'senha', { type: 'password', autocomplete: 'new-password', required: true, dica: 'Mínimo de 12 caracteres. Uma frase longa é mais segura que uma senha curta cheia de símbolos.' }),
        campo('Confirme a senha', 'confirmar', { type: 'password', autocomplete: 'new-password', required: true }),
      ],
      botao: 'Criar conta',
      aoEnviar: async ({ confirmar, ...d }) => {
        if (confirmar !== d.senha) {
          const e = new Error('As senhas não conferem.'); e.campos = { confirmar: 'Digite a mesma senha nos dois campos.' }; throw e;
        }
        await api('POST', '/api/auth/cadastro', d);
        ir('#/entrar?ok=cadastro');
      },
    }),
    h('p', { class: 'links' }, h('a', { href: '#/entrar' }, 'Já tenho conta')));
}

function telaEsqueci() {
  const sec = h('section', { class: 'estreito' },
    h('h1', {}, 'Recuperar senha'),
    h('p', { class: 'sub' }, 'Informe o e-mail da conta. Se ele estiver cadastrado, você recebe um link válido por 15 minutos.'));
  sec.append(formulario({
    campos: [campo('E-mail', 'email', { type: 'email', autocomplete: 'email', required: true })],
    botao: 'Enviar link',
    aoEnviar: async (d, form) => {
      const r = await api('POST', '/api/auth/esqueci-senha', d);
      form.replaceWith(aviso('ok', r.message), h('p', {}, h('a', { href: '#/emails' }, 'Abrir a caixa de e-mails de teste')));
    },
  }));
  return sec;
}

function telaRedefinir(q) {
  const token = q.get('token');
  // Remove o token da barra de endereço e do histórico assim que ele é lido.
  history.replaceState(null, '', '#/redefinir');
  if (!token) {
    return h('section', { class: 'estreito' }, h('h1', {}, 'Redefinir senha'),
      aviso('erro', 'Link inválido. Peça um novo na tela de recuperação.'), h('a', { href: '#/esqueci' }, 'Pedir novo link'));
  }
  return h('section', { class: 'estreito' },
    h('h1', {}, 'Nova senha'),
    h('p', { class: 'sub' }, 'Ao salvar, todas as sessões abertas da sua conta serão encerradas.'),
    formulario({
      campos: [
        campo('Nova senha', 'senha', { type: 'password', autocomplete: 'new-password', required: true, dica: 'Mínimo de 12 caracteres.' }),
        campo('Confirme a nova senha', 'confirmar', { type: 'password', autocomplete: 'new-password', required: true }),
      ],
      botao: 'Salvar nova senha',
      aoEnviar: async ({ senha, confirmar }) => {
        if (senha !== confirmar) {
          const e = new Error('As senhas não conferem.'); e.campos = { confirmar: 'Digite a mesma senha nos dois campos.' }; throw e;
        }
        await api('POST', '/api/auth/redefinir-senha', { token, senha });
        usuario = null;
        ir('#/entrar?ok=senha');
      },
    }));
}

// ---------- telas: loja ----------
async function telaLoja(q) {
  const busca = q.get('q') || '';
  const { produtos } = await api('GET', `/api/produtos?q=${encodeURIComponent(busca)}`);
  const form = h('form', { class: 'busca', role: 'search' },
    h('input', { name: 'q', type: 'search', value: busca, 'aria-label': 'Buscar produto', placeholder: 'Buscar produto' }),
    h('button', { type: 'submit', class: 'secundario' }, 'Buscar'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const termo = new FormData(form).get('q');
    ir(termo ? `#/loja?q=${encodeURIComponent(termo)}` : '#/loja');
  });

  const lista = produtos.length
    ? h('ul', { class: 'balcao' }, produtos.map((p) => h('li', { class: 'item' },
      h('div', {},
        h('h3', {}, p.nome),
        h('p', {}, p.descricao),
        h('div', { class: 'meta' }, `Vendido por ${p.vendedor}. `, p.estoque > 0 ? `${p.estoque} em estoque.` : 'Esgotado.')),
      h('div', { class: 'lado' },
        h('span', { class: 'preco' }, reais(p.precoCents)),
        p.estoque > 0
          ? h('a', { class: 'botao', href: usuario ? `#/comprar/${p.id}` : '#/entrar' }, 'Comprar')
          : null))))
    : h('div', { class: 'balcao' }, h('p', { class: 'vazio' }, busca ? `Nenhum produto com "${busca}".` : 'Nenhum produto à venda ainda. Que tal anunciar o primeiro?'));

  return h('section', {},
    h('h1', {}, 'Produtos à venda'),
    h('p', { class: 'sub' }, 'Compre de outros usuários com entrega em casa. Frete de R$ 15,90, grátis a partir de R$ 200.'),
    form, lista);
}

async function telaComprar(q, produtoId) {
  const [{ produto }, perfil] = await Promise.all([api('GET', `/api/produtos/${encodeURIComponent(produtoId)}`), api('GET', '/api/perfil')]);
  const maxQtd = Math.min(10, produto.estoque);

  const resumoSub = h('dd', {}); const resumoFrete = h('dd', {}); const resumoTotal = h('dd', { class: 'total' });
  const btnPagar = h('button', { type: 'submit' }, 'Pagar');
  function atualizarResumo() {
    const qtd = Number(form.quantidade.value) || 1;
    const sub = produto.precoCents * qtd;
    const frete = sub >= 20000 ? 0 : 1590;
    resumoSub.textContent = reais(sub);
    resumoFrete.textContent = frete ? reais(frete) : 'Grátis';
    resumoTotal.textContent = reais(sub + frete);
    btnPagar.textContent = `Pagar ${reais(sub + frete)}`;
  }

  // Endereços
  const blocoEnderecos = h('div', {}, perfil.enderecos.length
    ? perfil.enderecos.map((e, i) => h('label', { class: 'opcao' },
      h('input', { type: 'radio', name: 'enderecoId', value: e.id, checked: i === 0 }), h('span', {}, formatarEndereco(e))))
    : h('p', { class: 'sub' }, 'Você ainda não tem endereço cadastrado.'));

  // Pagamento
  const novoCartao = h('div', { class: perfil.cartoes.length ? 'oculto' : '' },
    campo('Número do cartão', 'numero', { inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '0000 0000 0000 0000' }),
    campo('Nome impresso no cartão', 'titular', { autocomplete: 'cc-name' }),
    h('div', { class: 'grade' },
      campo('Mês', 'mesValidade', { tag: 'select', value: new Date().getMonth() + 1, autocomplete: 'cc-exp-month', opcoesSelect: Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1).padStart(2, '0')]) }),
      campo('Ano', 'anoValidade', { tag: 'select', autocomplete: 'cc-exp-year', opcoesSelect: Array.from({ length: 12 }, (_, i) => { const a = new Date().getFullYear() + i; return [a, a]; }) })),
    h('label', { class: 'checar' }, h('input', { type: 'checkbox', name: 'salvar', value: 'sim' }), 'Salvar este cartão para as próximas compras'));

  const opcoesCartao = h('div', {},
    perfil.cartoes.map((c, i) => h('label', { class: 'opcao' },
      h('input', { type: 'radio', name: 'cartao', value: c.id, checked: i === 0 }),
      selado(`${c.bandeira} final ${c.final}`, 'Número completo cifrado no servidor'), h('span', {}, `validade ${c.validade}`))),
    h('label', { class: 'opcao' }, h('input', { type: 'radio', name: 'cartao', value: 'novo', checked: !perfil.cartoes.length }), h('span', {}, 'Usar outro cartão')));

  const form = h('form', { novalidate: true },
    h('div', { class: 'aviso-form' }),
    h('div', { class: 'colunas' },
      h('div', {},
        h('div', { class: 'bloco' },
          h('h2', {}, produto.nome),
          h('p', {}, produto.descricao),
          campo('Quantidade', 'quantidade', { tag: 'select', opcoesSelect: Array.from({ length: maxQtd }, (_, i) => [i + 1, i + 1]) })),
        h('div', { class: 'bloco' },
          h('h2', {}, 'Endereço de entrega'), blocoEnderecos,
          h('small', { class: 'erro', 'data-erro': 'enderecoId' }),
          h('a', { href: '#/perfil' }, 'Cadastrar endereço em Meus dados')),
        h('div', { class: 'bloco' },
          h('h2', {}, 'Pagamento'), opcoesCartao, novoCartao,
          campo('Código de segurança (CVV)', 'cvv', { inputmode: 'numeric', autocomplete: 'cc-csc', maxlength: 4, dica: 'Usado só para autorizar esta compra. Nunca é armazenado.' }))),
      h('aside', { class: 'bloco resumo' },
        h('h2', {}, 'Resumo'),
        h('dl', {}, h('dt', {}, 'Produtos'), resumoSub, h('dt', {}, 'Frete'), resumoFrete, h('dt', { class: 'total' }, 'Total'), resumoTotal),
        btnPagar,
        h('p', { class: 'dica' }, 'O valor final é calculado pelo servidor.'))));

  form.addEventListener('change', (e) => {
    if (e.target.name === 'cartao') novoCartao.classList.toggle('oculto', e.target.value !== 'novo');
    if (e.target.name === 'quantidade') atualizarResumo();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    const d = Object.fromEntries(new FormData(form));
    const pagamento = d.cartao === 'novo'
      ? { novoCartao: { numero: d.numero, titular: d.titular, mesValidade: Number(d.mesValidade), anoValidade: Number(d.anoValidade) }, cvv: d.cvv, salvar: d.salvar === 'sim' }
      : { cartaoId: d.cartao, cvv: d.cvv };
    btnPagar.disabled = true;
    try {
      if (!d.enderecoId) { const er = new Error('Escolha um endereço de entrega.'); er.campos = {}; throw er; }
      await api('POST', '/api/pedidos', { produtoId: produto.id, quantidade: Number(d.quantidade), enderecoId: d.enderecoId, pagamento });
      ir('#/compras?ok=pedido');
    } catch (er) {
      if (er.status === 401) { usuario = null; return ir('#/entrar?ok=expirou'); }
      mostrarErros(form, er);
      form.scrollIntoView({ block: 'start' });
    } finally { btnPagar.disabled = false; }
  });
  atualizarResumo();

  return h('section', {}, h('h1', {}, 'Finalizar compra'), h('p', { class: 'sub' }, `Vendido por ${produto.vendedor}.`), form);
}

// ---------- telas: vendas ----------
async function telaVender() {
  const { produtos } = await api('GET', '/api/produtos/meus');
  const linhas = produtos.map((p) => {
    const preco = h('input', { value: (p.precoCents / 100).toFixed(2).replace('.', ','), 'aria-label': `Preço de ${p.nome}`, inputmode: 'decimal' });
    const estoque = h('input', { value: p.estoque, type: 'number', min: 0, 'aria-label': `Estoque de ${p.nome}` });
    const ativo = h('input', { type: 'checkbox', checked: p.ativo, 'aria-label': `Anúncio de ${p.nome} ativo` });
    const status = h('small', { 'aria-live': 'polite' });
    const salvar = h('button', { type: 'button', class: 'secundario pequeno' }, 'Salvar');
    salvar.addEventListener('click', async () => {
      salvar.disabled = true; status.textContent = '';
      try {
        await api('PATCH', `/api/produtos/${p.id}`, { preco: preco.value, estoque: Number(estoque.value), ativo: ativo.checked });
        status.className = ''; status.textContent = 'Salvo';
      } catch (e) { status.className = 'erro'; status.textContent = Object.values(e.campos)[0] || e.message; } finally { salvar.disabled = false; }
    });
    return h('tr', {}, h('td', {}, p.nome), h('td', {}, preco), h('td', {}, estoque), h('td', {}, ativo), h('td', {}, salvar, ' ', status));
  });

  return h('section', {},
    h('h1', {}, 'Vender'),
    h('p', { class: 'sub' }, 'Anuncie um produto. Quando alguém comprar, o pedido aparece em Minhas vendas com o endereço de entrega.'),
    h('div', { class: 'colunas' },
      h('div', { class: 'bloco' }, h('h2', {}, 'Novo anúncio'), formulario({
        campos: [
          campo('Nome do produto', 'nome', { required: true, maxlength: 80 }),
          campo('Descrição', 'descricao', { tag: 'textarea', required: true, maxlength: 500 }),
          h('div', { class: 'grade' },
            campo('Preço (R$)', 'preco', { inputmode: 'decimal', placeholder: '49,90', required: true }),
            campo('Estoque', 'estoque', { type: 'number', min: 0, max: 10000, value: 1, required: true })),
        ],
        botao: 'Publicar anúncio',
        aoEnviar: async (d) => { await api('POST', '/api/produtos', { ...d, estoque: Number(d.estoque) }); render(); },
      })),
      h('div', {}, h('h2', {}, 'Meus anúncios'), produtos.length
        ? h('div', { class: 'tabela' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Produto', 'Preço (R$)', 'Estoque', 'Ativo', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, linhas)))
        : h('p', { class: 'sub' }, 'Você ainda não anunciou nada.'))));
}

const ROTULO_STATUS = {
  AGUARDANDO_ENVIO: 'Pago, aguardando envio', ENVIADO: 'Enviado', ENTREGUE: 'Entregue', CANCELADO: 'Cancelado',
};

function etapas(status) {
  if (status === 'CANCELADO') return h('p', { class: 'cancelado' }, 'Pedido cancelado. O valor será estornado no cartão.');
  const ordem = ['AGUARDANDO_ENVIO', 'ENVIADO', 'ENTREGUE'];
  const atual = ordem.indexOf(status);
  return h('ol', { class: 'etapas', 'aria-label': `Situação: ${ROTULO_STATUS[status]}` },
    ['Pago', 'Enviado', 'Entregue'].map((t, i) => h('li', { class: i <= atual ? 'feita' : '' }, t)));
}

async function acaoPedido(url, corpo, botao) {
  botao.disabled = true;
  try { await api('POST', url, corpo); render(); } catch (e) { botao.disabled = false; throw e; }
}

async function telaCompras(q) {
  const { pedidos } = await api('GET', '/api/pedidos/compras');
  return h('section', {},
    h('h1', {}, 'Minhas compras'), mensagemDaUrl(q),
    pedidos.length ? pedidos.map((p) => {
      const erro = h('small', { class: 'erro' });
      const acoes = h('div', { class: 'acoes' });
      if (p.status === 'AGUARDANDO_ENVIO') {
        const b = h('button', { type: 'button', class: 'perigo pequeno' }, 'Cancelar pedido');
        b.addEventListener('click', () => acaoPedido(`/api/pedidos/${p.id}/cancelar`, null, b).catch((e) => { erro.textContent = e.message; }));
        acoes.append(b);
      }
      if (p.status === 'ENVIADO') {
        const b = h('button', { type: 'button', class: 'pequeno' }, 'Confirmar que recebi');
        b.addEventListener('click', () => acaoPedido(`/api/pedidos/${p.id}/confirmar-entrega`, null, b).catch((e) => { erro.textContent = e.message; }));
        acoes.append(b);
      }
      return h('article', { class: 'pedido' },
        h('header', {}, h('h3', {}, `${p.quantidade}x ${p.produto}`), h('strong', {}, reais(p.totalCents))),
        etapas(p.status),
        h('p', {}, 'Entrega em: ', formatarEndereco(p.endereco)),
        h('p', {}, 'Pago com ', selado(p.cartao, 'Só o final do cartão é exibido'), ` em ${dataHora.format(p.criadoEm)}. Frete: ${p.freteCents ? reais(p.freteCents) : 'grátis'}.`),
        p.codigoRastreio ? h('p', {}, `Código de rastreio: ${p.codigoRastreio}`) : null,
        acoes, erro);
    }) : h('p', { class: 'sub' }, 'Você ainda não comprou nada. ', h('a', { href: '#/loja' }, 'Ver produtos')));
}

async function telaVendas() {
  const { pedidos } = await api('GET', '/api/pedidos/vendas');
  return h('section', {},
    h('h1', {}, 'Minhas vendas'),
    h('p', { class: 'sub' }, 'Você vê só o nome e o endereço do comprador, o necessário para a entrega.'),
    pedidos.length ? pedidos.map((p) => {
      let acao = null;
      if (p.status === 'AGUARDANDO_ENVIO') {
        acao = formulario({
          classe: 'acoes',
          campos: [campo('Código de rastreio', 'codigoRastreio', { placeholder: 'AB123456789BR', maxlength: 13, required: true })],
          botao: 'Marcar como enviado',
          aoEnviar: async (d) => { await api('POST', `/api/pedidos/${p.id}/enviar`, d); render(); },
        });
      }
      return h('article', { class: 'pedido' },
        h('header', {}, h('h3', {}, `${p.quantidade}x ${p.produto}`), h('strong', {}, reais(p.totalCents))),
        etapas(p.status),
        h('p', {}, `Comprador: ${p.comprador}`),
        h('p', {}, 'Enviar para: ', formatarEndereco(p.endereco)),
        h('p', {}, `Vendido em ${dataHora.format(p.criadoEm)}.`),
        p.codigoRastreio ? h('p', {}, `Código de rastreio: ${p.codigoRastreio}`) : null,
        acao);
    }) : h('p', { class: 'sub' }, 'Nenhuma venda ainda.'));
}

// ---------- telas: perfil ----------
const ROTULO_EVENTO = {
  CADASTRO: 'Conta criada', LOGIN_OK: 'Login realizado', LOGIN_FALHA: 'Tentativa de login com senha errada',
  LOGIN_BLOQUEADO: 'Login recusado: conta bloqueada', CONTA_BLOQUEADA: 'Conta bloqueada por excesso de tentativas',
  LOGOUT: 'Saiu da conta', RECUPERACAO_SOLICITADA: 'Pedido de recuperação de senha', SENHA_REDEFINIDA: 'Senha redefinida',
  ENDERECO_ADICIONADO: 'Endereço adicionado', CARTAO_ADICIONADO: 'Cartão adicionado', CARTAO_REMOVIDO: 'Cartão removido',
  PRODUTO_CRIADO: 'Anúncio publicado', PRODUTO_EDITADO: 'Anúncio editado', PEDIDO_CRIADO: 'Compra realizada',
  PEDIDO_ENVIADO: 'Pedido enviado', PEDIDO_ENTREGUE: 'Entrega confirmada', PEDIDO_CANCELADO: 'Pedido cancelado',
};

async function telaPerfil() {
  const perfil = await api('GET', '/api/perfil');
  const remover = (url, rotulo) => {
    const b = h('button', { type: 'button', class: 'perigo pequeno', 'aria-label': rotulo }, 'Remover');
    b.addEventListener('click', async () => { b.disabled = true; await api('DELETE', url); render(); });
    return b;
  };
  const ufs = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

  return h('section', {},
    h('h1', {}, 'Meus dados'),
    h('p', { class: 'sub' }, 'Dados com cadeado ficam cifrados (AES-256-GCM) no banco e só aparecem mascarados.'),
    h('div', { class: 'bloco' },
      h('dl', { class: 'dados' },
        h('dt', {}, 'Nome'), h('dd', {}, usuario.nome),
        h('dt', {}, 'E-mail'), h('dd', {}, usuario.email),
        h('dt', {}, 'CPF'), h('dd', {}, selado(usuario.cpf, 'Cifrado no banco')),
        h('dt', {}, 'Celular'), h('dd', {}, selado(usuario.telefone, 'Cifrado no banco')))),
    h('div', { class: 'colunas' },
      h('div', {},
        h('div', { class: 'bloco' },
          h('h2', {}, 'Endereços'),
          h('ul', { class: 'lista-simples' }, perfil.enderecos.map((e) => h('li', {}, h('span', {}, formatarEndereco(e)), remover(`/api/perfil/enderecos/${e.id}`, 'Remover endereço')))),
          formulario({
            campos: [
              h('div', { class: 'grade' }, campo('CEP', 'cep', { inputmode: 'numeric', autocomplete: 'postal-code', required: true }), campo('Número', 'numero', { required: true })),
              campo('Rua', 'rua', { autocomplete: 'address-line1', required: true }),
              campo('Complemento', 'complemento', { autocomplete: 'address-line2' }),
              campo('Bairro', 'bairro', { required: true }),
              h('div', { class: 'grade' }, campo('Cidade', 'cidade', { autocomplete: 'address-level2', required: true }),
                campo('UF', 'uf', { tag: 'select', opcoesSelect: ufs.map((u) => [u, u]), value: 'SP' })),
            ],
            botao: 'Adicionar endereço',
            aoEnviar: async (d) => { await api('POST', '/api/perfil/enderecos', d); render(); },
          })),
        h('div', { class: 'bloco' },
          h('h2', {}, 'Cartões'),
          perfil.cartoes.length
            ? h('ul', { class: 'lista-simples' }, perfil.cartoes.map((c) => h('li', {}, h('span', {}, selado(`${c.bandeira} final ${c.final}`, 'Número completo cifrado com chave separada'), ` validade ${c.validade}`), remover(`/api/perfil/cartoes/${c.id}`, 'Remover cartão'))))
            : h('p', { class: 'sub' }, 'Nenhum cartão salvo. O CVV nunca é guardado, nem de cartões salvos.'),
          formulario({
            campos: [
              campo('Número do cartão', 'numero', { inputmode: 'numeric', autocomplete: 'cc-number', required: true }),
              campo('Nome impresso', 'titular', { autocomplete: 'cc-name', required: true }),
              h('div', { class: 'grade' },
                campo('Mês', 'mesValidade', { tag: 'select', value: new Date().getMonth() + 1, opcoesSelect: Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1).padStart(2, '0')]) }),
                campo('Ano', 'anoValidade', { tag: 'select', opcoesSelect: Array.from({ length: 12 }, (_, i) => { const a = new Date().getFullYear() + i; return [a, a]; }) })),
            ],
            botao: 'Salvar cartão',
            aoEnviar: async (d) => {
              await api('POST', '/api/perfil/cartoes', { ...d, mesValidade: Number(d.mesValidade), anoValidade: Number(d.anoValidade) });
              render();
            },
          }))),
      h('aside', { class: 'bloco' },
        h('h2', {}, 'Atividade recente'),
        h('p', { class: 'dica' }, 'Se algo aqui não foi você, redefina sua senha.'),
        h('ul', { class: 'lista-simples' }, perfil.atividade.map((a) => h('li', {},
          h('span', {}, ROTULO_EVENTO[a.event] || a.event), h('small', { class: 'dica' }, dataHora.format(a.created_at))))))));
}

// ---------- tela: caixa de e-mails simulada (só desenvolvimento) ----------
async function telaEmails() {
  const { emails } = await api('GET', '/api/dev/emails');
  const prefixoSeguro = `${location.origin}/#/`;
  return h('section', {},
    h('h1', {}, 'Caixa de e-mails de teste'),
    h('p', { class: 'sub' }, 'Simula as caixas de entrada dos usuários. Em produção esta tela não existe e os e-mails vão por um provedor real.'),
    emails.length ? emails.map((e) => {
      const url = (e.body.match(/https?:\/\/\S+/) || [])[0];
      return h('article', { class: 'email' },
        h('div', { class: 'de' }, `Para ${e.to_email}, ${dataHora.format(e.created_at)}`),
        h('strong', {}, e.subject),
        h('pre', {}, e.body),
        // Só vira link se apontar para este próprio site (evita open redirect / links maliciosos).
        url && url.startsWith(prefixoSeguro) ? h('a', { class: 'botao', href: url.slice(location.origin.length + 1) }, 'Abrir link') : null);
    }) : h('p', { class: 'sub' }, 'Nenhum e-mail enviado ainda.'));
}

// ---------- roteador ----------
const ROTAS = [
  { padrao: /^#\/loja$/, tela: telaLoja },
  { padrao: /^#\/entrar$/, tela: telaEntrar, anonima: true },
  { padrao: /^#\/cadastro$/, tela: telaCadastro, anonima: true },
  { padrao: /^#\/esqueci$/, tela: telaEsqueci },
  { padrao: /^#\/redefinir$/, tela: telaRedefinir },
  { padrao: /^#\/comprar\/([\w-]{36})$/, tela: telaComprar, protegida: true },
  { padrao: /^#\/vender$/, tela: telaVender, protegida: true },
  { padrao: /^#\/compras$/, tela: telaCompras, protegida: true },
  { padrao: /^#\/vendas$/, tela: telaVendas, protegida: true },
  { padrao: /^#\/perfil$/, tela: telaPerfil, protegida: true },
  { padrao: /^#\/emails$/, tela: telaEmails },
];

async function render() {
  const [caminho, qs] = (location.hash || '#/loja').split('?');
  const q = new URLSearchParams(qs || '');
  const rota = ROTAS.find((r) => r.padrao.test(caminho));
  if (!rota) return ir('#/loja');
  if (rota.protegida && !usuario) return ir('#/entrar');
  if (rota.anonima && usuario) return ir('#/loja');
  montarNav(caminho);
  app.replaceChildren(h('p', { class: 'carregando' }, 'Carregando...'));
  try {
    const params = caminho.match(rota.padrao).slice(1);
    const tela = await rota.tela(q, ...params);
    app.replaceChildren(tela);
    const h1 = app.querySelector('h1');
    document.title = h1 ? `${h1.textContent} | Balcão` : 'Balcão';
    app.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    if (e.status === 401) { usuario = null; return ir('#/entrar?ok=expirou'); }
    app.replaceChildren(aviso('erro', e.message), h('a', { href: '#/loja' }, 'Voltar para a loja'));
  }
}

// Encerra a sessão após 15 minutos sem interação (o servidor também expira o token em 30 min).
let timerInatividade;
function reiniciarInatividade() {
  clearTimeout(timerInatividade);
  if (usuario) timerInatividade = setTimeout(() => sair('inativo'), 15 * 60 * 1000);
}
['click', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, reiniciarInatividade, { passive: true }));

window.addEventListener('hashchange', () => { reiniciarInatividade(); render(); });
(async () => {
  try { usuario = (await api('GET', '/api/auth/me')).usuario; } catch { usuario = null; }
  reiniciarInatividade();
  render();
})();
