const express = require('express');
const crypto = require('node:crypto');
const config = require('../config');
const { db } = require('../db');
const { schemas, bandeira } = require('../lib/validacao');
const { HttpError } = require('../lib/http-error');
const { cifrar, decifrar } = require('../lib/crypto');
const { auditar } = require('../lib/auditoria');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();
router.use(exigirLogin);

async function listarEnderecos(userId) {
  return (await db.address.findMany({ where: { user_id: userId }, orderBy: { created_at: "asc" }, select: { id: true, data_enc: true } }))
    .map((a) => ({ id: a.id, ...JSON.parse(decifrar(a.data_enc)) }));
}

async function listarCartoes(userId) {
  // Só dados não sensíveis saem da API: bandeira, final e validade.
  return (await db.card.findMany({ where: { user_id: userId }, orderBy: { created_at: "asc" }, select: { id: true, last4: true, brand: true, exp_month: true, exp_year: true } }))
    .map((c) => ({ id: c.id, final: c.last4, bandeira: c.brand, validade: `${String(c.exp_month).padStart(2, '0')}/${c.exp_year}` }));
}

async function salvarCartao(userId, c) {
  const id = crypto.randomUUID();
  (await db.card.create({ data: { id: id, user_id: userId, holder_enc: cifrar(c.titular), pan_enc: cifrar(c.numero, config.cardKey), last4: c.numero.slice(-4), brand: bandeira(c.numero), exp_month: c.mesValidade, exp_year: c.anoValidade, created_at: Date.now() } }));
  return id;
}

router.get('/', async (req, res) => {
  const atividade = (await db.auditLog.findMany({ where: { user_id: req.usuario.id }, orderBy: { id: "desc" }, take: 15, select: { event: true, ip: true, created_at: true } }));
  res.json({ enderecos: await listarEnderecos(req.usuario.id), cartoes: await listarCartoes(req.usuario.id), atividade });
});

router.post('/enderecos', async (req, res) => {
  const dados = schemas.endereco.parse(req.body);
  const qtd = (await db.address.count({ where: { user_id: req.usuario.id } }).then((n) => ({ n }))).n;
  if (qtd >= 5) throw new HttpError(400, 'Você pode ter no máximo 5 endereços.');
  const id = crypto.randomUUID();
  (await db.address.create({ data: { id: id, user_id: req.usuario.id, data_enc: cifrar(JSON.stringify(dados)), created_at: Date.now() } }));
  await auditar('ENDERECO_ADICIONADO', { userId: req.usuario.id, req });
  res.status(201).json({ id });
});

router.delete('/enderecos/:id', async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  // Filtro por user_id: um usuário nunca apaga dado de outro (proteção contra IDOR).
  const r = (await db.address.deleteMany({ where: { id: id, user_id: req.usuario.id } }));
  if (r.count === 0) throw new HttpError(404, 'Endereço não encontrado.');
  res.json({ ok: true });
});

router.post('/cartoes', async (req, res) => {
  const dados = schemas.cartao.parse(req.body);
  const qtd = (await db.card.count({ where: { user_id: req.usuario.id } }).then((n) => ({ n }))).n;
  if (qtd >= 5) throw new HttpError(400, 'Você pode ter no máximo 5 cartões.');
  const id = await salvarCartao(req.usuario.id, dados);
  await auditar('CARTAO_ADICIONADO', { userId: req.usuario.id, req });
  res.status(201).json({ id });
});

router.delete('/cartoes/:id', async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  const r = (await db.card.deleteMany({ where: { id: id, user_id: req.usuario.id } }));
  if (r.count === 0) throw new HttpError(404, 'Cartão não encontrado.');
  await auditar('CARTAO_REMOVIDO', { userId: req.usuario.id, req });
  res.json({ ok: true });
});

module.exports = { router, salvarCartao };
