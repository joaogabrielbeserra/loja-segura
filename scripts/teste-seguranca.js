// Testes automatizados dos controles de segurança. Sobe o servidor num banco temporário
// e executa ataques/abusos comuns, conferindo se são bloqueados.
// Uso: npm test
const mysql = require('mysql2/promise');
const dbTemp = `balcao_teste_${Date.now()}_${process.pid}`;
process.env.DB_NAME = dbTemp;
process.env.TRUST_PROXY = 'true'; // permite simular clientes com IPs diferentes via X-Forwarded-For
process.env.APP_URL = 'http://127.0.0.1:0';

const app = require('../src/server');
const { db, inicializar } = require('../src/db');
const config = require('../src/config');
let admin;
let server;
let criado = false;

let base;
let ok = 0;
let falhas = 0;
function checar(descricao, condicao) {
  if (condicao) { ok++; console.log(`  ✔ ${descricao}`); } else { falhas++; console.log(`  ✘ ${descricao}`); }
}

// Cliente HTTP mínimo com "pote" de cookies, simulando um navegador.
function cliente(ip) {
  const jar = {};
  async function req(metodo, url, corpo, { semCsrf = false, headers = {} } = {}) {
    const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...headers };
    if (!semCsrf && jar.csrf) h['X-CSRF-Token'] = jar.csrf;
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.Cookie = cookie;
    const res = await fetch(base + url, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    for (const sc of res.headers.getSetCookie()) {
      const [par] = sc.split(';');
      const [k, ...v] = par.split('=');
      const valor = v.join('=');
      if (valor === '' || /Expires=Thu, 01 Jan 1970/i.test(sc)) delete jar[k]; else jar[k] = valor;
    }
    let json = {};
    try { json = await res.json(); } catch { /* sem corpo */ }
    return { status: res.status, json, headers: res.headers, setCookie: res.headers.getSetCookie() };
  }
  return { jar, req, get: (u, o) => req('GET', u, null, o), post: (u, b, o) => req('POST', u, b, o), patch: (u, b, o) => req('PATCH', u, b, o) };
}

async function ultimoEmail(para, assunto) {
  return (await db.prepare('SELECT * FROM outbox WHERE to_email = ? AND subject = ? ORDER BY id DESC LIMIT 1').get(para, assunto));
}

async function main() {
  const { database, ...conexao } = config.mysql;
  admin = await mysql.createConnection(conexao);
  await admin.query(`CREATE DATABASE ${dbTemp} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  criado = true;
  await inicializar();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nA05 · Cabeçalhos de segurança');
  const home = await fetch(`${base}/`);
  checar('Content-Security-Policy presente', home.headers.get('content-security-policy')?.includes("script-src 'self'"));
  checar('X-Frame-Options / frame-ancestors (anti-clickjacking)', home.headers.get('x-frame-options') === 'SAMEORIGIN');
  checar('X-Content-Type-Options: nosniff', home.headers.get('x-content-type-options') === 'nosniff');
  checar('Cabeçalho X-Powered-By removido', !home.headers.get('x-powered-by'));

  console.log('\nCSRF');
  const anon = cliente('10.0.0.1');
  let r = await anon.post('/api/auth/login', { email: 'a@a.com', senha: 'x' }, { semCsrf: true });
  checar('POST sem token CSRF é recusado (403)', r.status === 403);
  await anon.get('/api/auth/csrf');
  r = await anon.post('/api/auth/login', { email: 'a@a.com', senha: 'x' }, { headers: { Origin: 'https://site-malicioso.com' } });
  checar('POST com Origin de outro site é recusado (403)', r.status === 403);

  console.log('\nA07 · Cadastro e política de senha');
  const carla = cliente('10.0.0.2');
  await carla.get('/api/auth/csrf');
  const dadosCarla = { nome: 'Carla Mendes', email: 'carla@exemplo.com', cpf: '529.982.247-25', telefone: '(12) 99111-2222' };
  r = await carla.post('/api/auth/cadastro', { ...dadosCarla, senha: 'curta' });
  checar('Senha curta é recusada', r.status === 400 && r.json.fields?.senha);
  r = await carla.post('/api/auth/cadastro', { ...dadosCarla, senha: 'senhasegura123' });
  checar('Senha comum é recusada', r.status === 400);
  r = await carla.post('/api/auth/cadastro', { ...dadosCarla, cpf: '111.111.111-11', senha: 'Uma-Senha-Bem-Longa-1' });
  checar('CPF inválido é recusado', r.status === 400 && r.json.fields?.cpf);
  r = await carla.post('/api/auth/cadastro', { ...dadosCarla, senha: 'Uma-Senha-Bem-Longa-1', admin: true });
  checar('Campo extra não previsto (mass assignment) é recusado', r.status === 400);
  r = await carla.post('/api/auth/cadastro', { ...dadosCarla, senha: 'Uma-Senha-Bem-Longa-1' });
  checar('Cadastro válido é aceito', r.status === 201);
  r = await carla.post('/api/auth/cadastro', { ...dadosCarla, email: 'outro@exemplo.com', senha: 'Uma-Senha-Bem-Longa-1' });
  checar('CPF duplicado recusado com mensagem genérica', r.status === 409 && !/cpf/i.test(r.json.error));

  console.log('\nA02 · Dados sensíveis cifrados no banco');
  const linha = (await db.prepare("SELECT * FROM users WHERE email = 'carla@exemplo.com'").get());
  checar('Nome, CPF e telefone gravados cifrados (AES-256-GCM)', [linha.name_enc, linha.cpf_enc, linha.phone_enc].every((v) => v.startsWith('v1:')));
  checar('CPF não aparece em claro no banco', !JSON.stringify(linha).includes('52998224725'));
  checar('Senha guardada como hash scrypt com salt', linha.password_hash.startsWith('scrypt$'));

  console.log('\nA07 · Login, enumeração e bloqueio de conta');
  r = await carla.post('/api/auth/login', { email: 'naoexiste@exemplo.com', senha: 'qualquer-coisa-1' });
  const msgInexistente = r.json.error;
  r = await carla.post('/api/auth/login', { email: 'carla@exemplo.com', senha: 'senha-errada-123' });
  checar('Mesma mensagem para usuário inexistente e senha errada', r.status === 401 && r.json.error === msgInexistente);
  for (let i = 0; i < 4; i++) await carla.post('/api/auth/login', { email: 'carla@exemplo.com', senha: 'senha-errada-123' });
  r = await carla.post('/api/auth/login', { email: 'carla@exemplo.com', senha: 'Uma-Senha-Bem-Longa-1' });
  checar('Após 5 erros, conta bloqueia até com a senha certa', r.status === 401);
  checar('Usuário é avisado por e-mail do bloqueio', !!await ultimoEmail('carla@exemplo.com', 'Sua conta foi bloqueada temporariamente'));

  console.log('\nRecuperação de senha');
  r = await carla.post('/api/auth/esqueci-senha', { email: 'naoexiste@exemplo.com' });
  const respDesconhecido = r.json.message;
  r = await carla.post('/api/auth/esqueci-senha', { email: 'carla@exemplo.com' });
  checar('Resposta idêntica para e-mail cadastrado ou não', r.json.message === respDesconhecido);
  const email = await ultimoEmail('carla@exemplo.com', 'Redefinição de senha');
  const token = email.body.match(/token=([\w-]+)/)[1];
  const hashNoBanco = (await db.prepare('SELECT token_hash FROM password_resets ORDER BY created_at DESC LIMIT 1').get()).token_hash;
  checar('Banco guarda só o hash do token, não o token', hashNoBanco !== token && hashNoBanco.length === 64);
  r = await carla.post('/api/auth/redefinir-senha', { token: 'token-inventado-aaaaaaaaaaaaaaa', senha: 'Nova-Senha-Forte-2026' });
  checar('Token inventado é recusado', r.status === 400);
  r = await carla.post('/api/auth/redefinir-senha', { token, senha: 'Nova-Senha-Forte-2026' });
  checar('Token válido redefine a senha', r.status === 200);
  r = await carla.post('/api/auth/redefinir-senha', { token, senha: 'Outra-Senha-Forte-2026' });
  checar('Token é de uso único', r.status === 400);
  r = await carla.post('/api/auth/login', { email: 'carla@exemplo.com', senha: 'Nova-Senha-Forte-2026' });
  checar('Login com a nova senha funciona e desbloqueia a conta', r.status === 200);
  const sid = r.setCookie.find((c) => c.startsWith('sid='));
  checar('Cookie de sessão é HttpOnly e SameSite=Strict', /HttpOnly/i.test(sid) && /SameSite=Strict/i.test(sid));

  console.log('\nA01 · Controle de acesso');
  const semLogin = cliente('10.0.0.3');
  r = await semLogin.get('/api/perfil');
  checar('Rota protegida sem login retorna 401', r.status === 401);

  const ana = cliente('10.0.0.4');
  await ana.get('/api/auth/csrf');
  await ana.post('/api/auth/cadastro', { nome: 'Ana Souza', email: 'ana@teste.com', cpf: '390.533.447-05', telefone: '12991234567', senha: 'Ana-Vendedora-Teste-1' });
  await ana.post('/api/auth/login', { email: 'ana@teste.com', senha: 'Ana-Vendedora-Teste-1' });
  r = await ana.post('/api/produtos', { nome: 'Cadeira de praia', descricao: 'Alumínio', preco: '100,00', estoque: 2 });
  const produtoId = r.json.id;
  checar('Vendedora cadastra produto', r.status === 201);
  r = await ana.post('/api/produtos', { nome: '<script>alert(1)</script>', descricao: 'x x x', preco: '-5', estoque: 1 });
  checar('Preço negativo é recusado', r.status === 400);

  r = await carla.patch(`/api/produtos/${produtoId}`, { preco: '0,01' });
  checar('Outro usuário não altera produto alheio (IDOR → 404)', r.status === 404);

  console.log('\nCompra, pagamento e entrega');
  r = await carla.post('/api/perfil/enderecos', { cep: '12245-000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'São José dos Campos', uf: 'SP' });
  const enderecoId = r.json.id;
  checar('Endereço salvo', r.status === 201);
  const pedidoBase = { produtoId, quantidade: 1, enderecoId };
  const cartaoOk = { numero: '4111 1111 1111 1111', titular: 'CARLA MENDES', mesValidade: 12, anoValidade: new Date().getFullYear() + 2 };

  r = await carla.post('/api/pedidos', { ...pedidoBase, precoCents: 1, pagamento: { novoCartao: cartaoOk, cvv: '123' } });
  checar('Tentativa de enviar o preço pelo cliente é recusada', r.status === 400);
  r = await ana.post('/api/pedidos', { ...pedidoBase, enderecoId, pagamento: { novoCartao: cartaoOk, cvv: '123' } });
  checar('Endereço de outro usuário não pode ser usado (404)', r.status === 404);
  r = await carla.post('/api/pedidos', { ...pedidoBase, quantidade: 5, pagamento: { novoCartao: cartaoOk, cvv: '123' } });
  checar('Compra acima do estoque é recusada', r.status === 409);
  r = await carla.post('/api/pedidos', { ...pedidoBase, pagamento: { novoCartao: { ...cartaoOk, numero: '4111 1111 1111 1112' }, cvv: '123' } });
  checar('Cartão com número inválido (Luhn) é recusado', r.status === 400);
  r = await carla.post('/api/pedidos', { ...pedidoBase, pagamento: { novoCartao: { ...cartaoOk, numero: '4000 0000 0000 0002' }, cvv: '123' } });
  checar('Pagamento recusado pela operadora não gera pedido', r.status === 402 && (await db.prepare('SELECT COUNT(*) n FROM orders').get()).n === 0);
  r = await carla.post('/api/pedidos', { ...pedidoBase, pagamento: { novoCartao: cartaoOk, cvv: '987', salvar: true } });
  const pedidoId = r.json.id;
  checar('Compra válida aprovada, total calculado no servidor (100,00 + frete 15,90)', r.status === 201 && r.json.totalCents === 11590);
  checar('Estoque baixado corretamente', (await db.prepare('SELECT stock FROM products WHERE id = ?').get(produtoId)).stock === 1);

  const bytesBanco = JSON.stringify(await db.prepare('SELECT * FROM cards').all());
  checar('Número do cartão não aparece em claro nos registros do banco', !bytesBanco.includes('4111111111111111'));
  checar('Tabela de cartões não tem coluna de CVV', !(await db.prepare("SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'cards'").all()).some((c) => /cvv/i.test(c.name)));
  r = await carla.get('/api/perfil');
  checar('API devolve só final e bandeira do cartão', r.json.cartoes[0]?.final === '1111' && !JSON.stringify(r.json).includes('4111111111111111'));
  r = await carla.get('/api/auth/me');
  checar('CPF volta mascarado na API', r.json.usuario.cpf === '***.982.247-**');

  r = await carla.post(`/api/pedidos/${pedidoId}/enviar`, { codigoRastreio: 'AB123456789BR' });
  checar('Comprador não pode marcar o próprio pedido como enviado', r.status === 404);
  r = await ana.post(`/api/pedidos/${pedidoId}/enviar`, { codigoRastreio: 'invalido' });
  checar('Código de rastreio fora do padrão é recusado', r.status === 400);
  r = await ana.post(`/api/pedidos/${pedidoId}/enviar`, { codigoRastreio: 'AB123456789BR' });
  checar('Vendedora marca como enviado', r.status === 200);
  r = await ana.get('/api/pedidos/vendas');
  const venda = r.json.pedidos[0];
  checar('Vendedora vê nome e endereço, mas não CPF nem cartão', venda.comprador === 'Carla Mendes' && !venda.cartao && !JSON.stringify(venda).includes('982'));
  r = await carla.post(`/api/pedidos/${pedidoId}/cancelar`);
  checar('Pedido já enviado não pode ser cancelado', r.status === 409);
  r = await carla.post(`/api/pedidos/${pedidoId}/confirmar-entrega`);
  checar('Comprador confirma a entrega', r.status === 200);

  console.log('\nA03 · Injeção');
  r = await carla.get(`/api/produtos?q=${encodeURIComponent("' OR 1=1 --")}`);
  checar('SQL Injection na busca não retorna dados indevidos', r.status === 200 && r.json.produtos.length === 0);
  r = await carla.get("/api/produtos/1' OR '1'='1");
  checar('Id malformado é recusado pela validação', r.status === 400);

  console.log('\nSessão');
  const cookieAntigo = carla.jar.sid;
  await carla.post('/api/auth/logout');
  carla.jar.sid = cookieAntigo; // atacante reaproveitando o token roubado
  r = await carla.get('/api/perfil');
  checar('Token antigo deixa de valer após logout (revogação no servidor)', r.status === 401);

  console.log('\nRate limiting');
  const robo = cliente('10.0.0.99');
  await robo.get('/api/auth/csrf');
  let ultimo;
  for (let i = 0; i < 11; i++) ultimo = await robo.post('/api/auth/login', { email: `x${i}@x.com`, senha: 'qualquer-senha-1' });
  checar('11ª tentativa de login do mesmo IP em 15 min recebe 429', ultimo.status === 429);

  console.log('\nA09 · Auditoria');
  const eventos = (await db.prepare('SELECT DISTINCT event FROM audit_log').all()).map((e) => e.event);
  checar('Eventos de segurança registrados', ['LOGIN_FALHA', 'CONTA_BLOQUEADA', 'SENHA_REDEFINIDA', 'PEDIDO_CRIADO'].every((e) => eventos.includes(e)));
  const logTexto = JSON.stringify((await db.prepare('SELECT * FROM audit_log').all()));
  checar('Log não contém senha, token nem cartão', !logTexto.includes('Nova-Senha') && !logTexto.includes(token) && !logTexto.includes('4111'));

  console.log(`\nResultado: ${ok} aprovados, ${falhas} reprovados\n`);
  process.exitCode = falhas ? 1 : 0;
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
  if (criado) await admin.query(`DROP DATABASE ${dbTemp}`);
  if (admin) await admin.end();
});
