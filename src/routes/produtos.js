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
  if (incluirVendedor) r.vendedor = primeiroNome(decifrar(p.seller.name_enc));
  return r;
}

router.get('/', async (req, res) => {
  const busca = String(req.query.q || '').slice(0, 60);
  // INSTR preserva busca sem distinguir maiúsculas e trata % e _ literalmente.
  const encontrados = busca ? await db.$queryRaw`
    SELECT id FROM products
    WHERE active = 1 AND INSTR(LOWER(name), LOWER(${busca})) > 0
    ORDER BY created_at DESC LIMIT 100
  ` : null;
  const linhas = await db.product.findMany({
    where: { active: 1, ...(encontrados ? { id: { in: encontrados.map((p) => p.id) } } : {}) },
    orderBy: { created_at: 'desc' },
    take: 100,
    include: { seller: { select: { name_enc: true } } },
  });
  res.json({ produtos: linhas.map((p) => formatar(p)) });
});

router.get('/meus', exigirLogin, async (req, res) => {
  const linhas = (await db.product.findMany({ where: { seller_id: req.usuario.id }, orderBy: { created_at: "desc" } }));
  res.json({ produtos: linhas.map((p) => formatar(p, false)) });
});

router.get('/:id', async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  const p = (await db.product.findFirst({ where: { id: id, active: 1 }, include: { seller: { select: { name_enc: true } } } }));
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  res.json({ produto: formatar(p) });
});

router.post('/', exigirLogin, async (req, res) => {
  const dados = schemas.produto.parse(req.body);
  const id = crypto.randomUUID();
  (await db.product.create({ data: { id: id, seller_id: req.usuario.id, name: dados.nome, description: dados.descricao, price_cents: dados.preco, stock: dados.estoque, created_at: Date.now() } }));
  await auditar('PRODUTO_CRIADO', { userId: req.usuario.id, req, detalhe: id });
  res.status(201).json({ id });
});

router.patch('/:id', exigirLogin, async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  const dados = schemas.produtoEdicao.parse(req.body);
  const atual = (await db.product.findFirst({ where: { id: id, seller_id: req.usuario.id } }));
  if (!atual) throw new HttpError(404, 'Produto não encontrado.'); // 404 e não 403: não confirma que o id existe
  (await db.product.updateMany({ data: { price_cents: dados.preco ?? atual.price_cents, stock: dados.estoque ?? atual.stock, active: dados.ativo === undefined ? atual.active : Number(dados.ativo) }, where: { id: id, seller_id: req.usuario.id } }));
  await auditar('PRODUTO_EDITADO', { userId: req.usuario.id, req, detalhe: id });
  res.json({ ok: true });
});

module.exports = router;
