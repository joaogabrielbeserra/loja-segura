const crypto = require('node:crypto');
const { db, inicializar, transacao } = require('../src/db');
const { schemas, cpfValido } = require('../src/lib/validacao');
const { hashSenha, cifrar, indiceCego } = require('../src/lib/crypto');
const { auditar } = require('../src/lib/auditoria');
const { autenticarUsuario } = require('../src/lib/autenticacao');
const { criarTokenSessao, lerSessao } = require('../src/middleware/auth');
const { registrarPedido } = require('../src/lib/pedidos');

const INTERVALO_MS = 15_000;
const EMAIL_VENDEDOR = 'scheduler-vendedor@exemplo.com';
let timer;
let tarefa;
let parando = false;
let ciclos = 0;

function gerarCpf() {
  for (;;) {
    const numeros = Array.from({ length: 9 }, () => crypto.randomInt(10));
    for (let tamanho = 9; tamanho <= 10; tamanho++) {
      const soma = numeros.reduce((total, n, i) => total + n * (tamanho + 1 - i), 0);
      const resto = (soma * 10) % 11;
      numeros.push(resto === 10 ? 0 : resto);
    }
    const cpf = numeros.join('');
    if (cpfValido(cpf)) return cpf;
  }
}

async function dadosUsuario(nome, email, senha) {
  const cadastro = schemas.cadastro.parse({ nome, email, senha, cpf: gerarCpf(), telefone: '11991234567' });
  return {
    id: crypto.randomUUID(), email: cadastro.email,
    password_hash: await hashSenha(cadastro.senha),
    name_enc: cifrar(cadastro.nome), cpf_enc: cifrar(cadastro.cpf),
    cpf_index: indiceCego(cadastro.cpf), phone_enc: cifrar(cadastro.telefone),
    created_at: Date.now(),
  };
}

async function prepararVendedor() {
  const existente = await db.user.findUnique({ where: { email: EMAIL_VENDEDOR } });
  if (existente) return existente;
  const vendedor = await db.user.create({
    data: await dadosUsuario('Vendedor Simulado', EMAIL_VENDEDOR, crypto.randomBytes(24).toString('base64url')),
  });
  await auditar('CADASTRO', { userId: vendedor.id, detalhe: 'scheduler: vendedor fictício' });
  return vendedor;
}

async function executarCiclo(vendedor) {
  const email = `scheduler-${crypto.randomUUID()}@exemplo.com`;
  const senha = crypto.randomBytes(24).toString('base64url');
  const dados = await dadosUsuario('Comprador Simulado', email, senha);
  const endereco = schemas.endereco.parse({
    cep: '12245000', rua: 'Rua de Teste', numero: '15', bairro: 'Centro',
    cidade: 'São José dos Campos', uf: 'SP',
  });
  const { usuario, enderecoId } = await transacao(async () => {
    const usuario = await db.user.create({ data: dados });
    const registro = await db.address.create({ data: {
      id: crypto.randomUUID(), user_id: usuario.id,
      data_enc: cifrar(JSON.stringify(endereco)), created_at: Date.now(),
    } });
    return { usuario, enderecoId: registro.id };
  });
  await auditar('CADASTRO', { userId: usuario.id, detalhe: 'scheduler: comprador fictício' });
  console.log(`[scheduler] Usuário criado: ${email}`);

  const autenticado = await autenticarUsuario(email, senha);
  const token = criarTokenSessao(autenticado);
  const sessao = await lerSessao({ cookies: { sid: token } });
  if (!sessao) throw new Error('Não foi possível validar a sessão do comprador.');
  console.log(`[scheduler] Login realizado: ${email}`);

  // Produto exclusivo deste ciclo: não altera anúncios nem estoque de outros usuários.
  const produto = await db.product.create({ data: {
    id: crypto.randomUUID(), seller_id: vendedor.id,
    name: 'Produto do simulador', description: 'Venda fictícia gerada pelo scheduler.',
    price_cents: 10000, stock: 1, created_at: Date.now(),
  } });
  const pedido = schemas.pedido.parse({
    produtoId: produto.id, quantidade: 1, enderecoId,
    pagamento: {
      novoCartao: {
        numero: '4111111111111111', titular: 'COMPRADOR SIMULADO',
        mesValidade: 12, anoValidade: new Date().getFullYear() + 2,
      },
      cvv: '123', salvar: false,
    },
  });
  const venda = await registrarPedido(pedido, sessao);
  await db.product.update({ where: { id: produto.id }, data: { active: 0 } });
  ciclos++;
  console.log(`[scheduler] Venda registrada: ${venda.id} | Total: R$ ${(venda.totalCents / 100).toFixed(2)} | Ciclo ${ciclos}`);
}

async function encerrar() {
  if (parando) return;
  parando = true;
  clearInterval(timer);
  console.log('[scheduler] Encerrando após o ciclo em andamento...');
  if (tarefa) await tarefa;
  await db.close();
}

async function main() {
  await inicializar();
  const vendedor = await prepararVendedor();
  if (process.argv.includes('--once')) {
    try { await executarCiclo(vendedor); } finally { await db.close(); }
    return;
  }
  function disparar() {
    if (parando || tarefa) return;
    tarefa = executarCiclo(vendedor)
      .catch((erro) => console.error(`[scheduler] Ciclo falhou (${erro.code || 'erro'}): ${erro.message}`))
      .finally(() => { tarefa = null; });
  }
  process.once('SIGINT', () => { encerrar().catch(falhar); });
  process.once('SIGTERM', () => { encerrar().catch(falhar); });
  console.log('[scheduler] Ativo: cadastro, login e venda a cada 15 segundos. Ctrl+C para parar.');
  timer = setInterval(disparar, INTERVALO_MS);
  disparar();
}

async function falhar(erro) {
  clearInterval(timer);
  console.error(`[scheduler] Falha (${erro.code || 'erro'}): ${erro.message}`);
  process.exitCode = 1;
  await db.close();
}

main().catch(falhar);
