// Popula o banco com dois usuários de demonstração, endereços e produtos.
const crypto = require('node:crypto');
const { db, inicializar } = require('../src/db');
const { hashSenha, cifrar, indiceCego } = require('../src/lib/crypto');

function gerarCpf() {
  const n = Array.from({ length: 9 }, () => crypto.randomInt(10));
  const dv = (base) => {
    const soma = base.reduce((s, d, i) => s + d * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join('');
}

async function criarUsuario({ nome, email, telefone, senha }) {
  const existente = (await db.prepare('SELECT id FROM users WHERE email = ?').get(email));
  if (existente) return existente.id;
  const id = crypto.randomUUID();
  const cpf = gerarCpf();
  (await db.prepare(`INSERT INTO users (id, email, password_hash, name_enc, cpf_enc, cpf_index, phone_enc, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, email, await hashSenha(senha), cifrar(nome), cifrar(cpf), indiceCego(cpf), cifrar(telefone), Date.now()));
  return id;
}

async function criarEndereco(userId, dados) {
  const ja = (await db.prepare('SELECT 1 FROM addresses WHERE user_id = ?').get(userId));
  if (ja) return;
  (await db.prepare('INSERT INTO addresses (id, user_id, data_enc, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, cifrar(JSON.stringify(dados)), Date.now()));
}

(async () => {
  await inicializar();
  const ana = await criarUsuario({
    nome: 'Ana Souza', email: 'ana@exemplo.com', telefone: '12991234567', senha: 'Balcao-Vendedora-2026',
  });
  const bruno = await criarUsuario({
    nome: 'Bruno Lima', email: 'bruno@exemplo.com', telefone: '12998765432', senha: 'Balcao-Comprador-2026',
  });
  await criarEndereco(ana, { cep: '11660000', rua: 'Avenida da Praia', numero: '100', complemento: '', bairro: 'Centro', cidade: 'Caraguatatuba', uf: 'SP' });
  await criarEndereco(bruno, { cep: '12245000', rua: 'Rua das Acácias', numero: '45', complemento: 'Apto 12', bairro: 'Jardim Aquarius', cidade: 'São José dos Campos', uf: 'SP' });

  const temProdutos = (await db.prepare('SELECT 1 FROM products WHERE seller_id = ?').get(ana));
  if (!temProdutos) {
    const produtos = [
      ['Cadeira de praia dobrável', 'Alumínio, 5 posições, suporta até 110 kg.', 18990, 8],
      ['Guarda-sol 2 m com proteção UV', 'Tecido com FPS 50+ e haste articulada.', 12900, 5],
      ['Caixa térmica 32 litros', 'Mantém o gelo por até 24 horas.', 21950, 3],
      ['Kit de frescobol', 'Duas raquetes de madeira e duas bolas.', 7990, 12],
    ];
    const ins = db.prepare(`INSERT INTO products (id, seller_id, name, description, price_cents, stock, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const [i, [nome, desc, preco, est]] of produtos.entries()) { await ins.run(crypto.randomUUID(), ana, nome, desc, preco, est, Date.now() + i); }
  }
  console.log('Dados de demonstração criados:');
  console.log('  Vendedora: ana@exemplo.com   / Balcao-Vendedora-2026');
  console.log('  Comprador: bruno@exemplo.com / Balcao-Comprador-2026');
  console.log('  Cartão de teste aprovado: 4111 1111 1111 1111 | recusado: 4000 0000 0000 0002');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.close());
