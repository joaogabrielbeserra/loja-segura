const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../db');
const { schemas } = require('../lib/validacao');
const { HttpError } = require('../lib/http-error');
const { decifrar } = require('../lib/crypto');
const { primeiroNome } = require('../lib/mascaras');
const { auditar } = require('../lib/auditoria');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();

function formatar(p, incluirVendedor = true) {
  const r = {
    id: p.id, nome: p.name, descricao: p.description, precoCents: p.price_cents, estoque: p.stock, ativo: !!p.active,
  };
  // Para o público, só o primeiro nome do vendedor (minimização de dados).
  if (incluirVendedor) r.vendedor = primeiroNome(decifrar(p.name_enc));
  return r;
}

router.get('/', async (req, res) => {
  const busca = String(req.query.q || '').slice(0, 60);
  const linhas = (await db.prepare(`
    SELECT p.*, u.name_enc FROM products p JOIN users u ON u.id = p.seller_id
    WHERE p.active = 1 AND (? = '' OR instr(lower(p.name), lower(?)) > 0)
    ORDER BY p.created_at DESC LIMIT 100`).all(busca, busca));
  res.json({ produtos: linhas.map((p) => formatar(p)) });
});

router.get('/meus', exigirLogin, async (req, res) => {
  const linhas = (await db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC').all(req.usuario.id));
  res.json({ produtos: linhas.map((p) => formatar(p, false)) });
});

router.get('/:id', async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  const p = (await db.prepare(`SELECT p.*, u.name_enc FROM products p JOIN users u ON u.id = p.seller_id
                        WHERE p.id = ? AND p.active = 1`).get(id));
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  res.json({ produto: formatar(p) });
});

router.post('/', exigirLogin, async (req, res) => {
  const dados = schemas.produto.parse(req.body);
  const id = crypto.randomUUID();
  (await db.prepare(`INSERT INTO products (id, seller_id, name, description, price_cents, stock, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.usuario.id, dados.nome, dados.descricao, dados.preco, dados.estoque, Date.now()));
  await auditar('PRODUTO_CRIADO', { userId: req.usuario.id, req, detalhe: id });
  res.status(201).json({ id });
});

router.patch('/:id', exigirLogin, async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  const dados = schemas.produtoEdicao.parse(req.body);
  const atual = (await db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(id, req.usuario.id));
  if (!atual) throw new HttpError(404, 'Produto não encontrado.'); // 404 e não 403: não confirma que o id existe
  (await db.prepare('UPDATE products SET price_cents = ?, stock = ?, active = ? WHERE id = ? AND seller_id = ?').run(
    dados.preco ?? atual.price_cents,
    dados.estoque ?? atual.stock,
    dados.ativo === undefined ? atual.active : Number(dados.ativo),
    id, req.usuario.id,
  ));
  await auditar('PRODUTO_EDITADO', { userId: req.usuario.id, req, detalhe: id });
  res.json({ ok: true });
});

module.exports = router;
