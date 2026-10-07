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
  return (await db.prepare('SELECT id, data_enc FROM addresses WHERE user_id = ? ORDER BY created_at').all(userId))
    .map((a) => ({ id: a.id, ...JSON.parse(decifrar(a.data_enc)) }));
}

async function listarCartoes(userId) {
  // Só dados não sensíveis saem da API: bandeira, final e validade.
  return (await db.prepare('SELECT id, last4, brand, exp_month, exp_year FROM cards WHERE user_id = ? ORDER BY created_at')
    .all(userId))
    .map((c) => ({ id: c.id, final: c.last4, bandeira: c.brand, validade: `${String(c.exp_month).padStart(2, '0')}/${c.exp_year}` }));
}

async function salvarCartao(userId, c) {
  const id = crypto.randomUUID();
  (await db.prepare(`INSERT INTO cards (id, user_id, holder_enc, pan_enc, last4, brand, exp_month, exp_year, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, cifrar(c.titular), cifrar(c.numero, config.cardKey), c.numero.slice(-4), bandeira(c.numero),
      c.mesValidade, c.anoValidade, Date.now()));
  return id;
}

router.get('/', async (req, res) => {
  const atividade = (await db.prepare(
    'SELECT event, ip, created_at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 15',
  ).all(req.usuario.id));
  res.json({ enderecos: await listarEnderecos(req.usuario.id), cartoes: await listarCartoes(req.usuario.id), atividade });
});

router.post('/enderecos', async (req, res) => {
  const dados = schemas.endereco.parse(req.body);
  const qtd = (await db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').get(req.usuario.id)).n;
  if (qtd >= 5) throw new HttpError(400, 'Você pode ter no máximo 5 endereços.');
  const id = crypto.randomUUID();
  (await db.prepare('INSERT INTO addresses (id, user_id, data_enc, created_at) VALUES (?, ?, ?, ?)')
    .run(id, req.usuario.id, cifrar(JSON.stringify(dados)), Date.now()));
  await auditar('ENDERECO_ADICIONADO', { userId: req.usuario.id, req });
  res.status(201).json({ id });
});

router.delete('/enderecos/:id', async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  // Filtro por user_id: um usuário nunca apaga dado de outro (proteção contra IDOR).
  const r = (await db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(id, req.usuario.id));
  if (r.changes === 0) throw new HttpError(404, 'Endereço não encontrado.');
  res.json({ ok: true });
});

router.post('/cartoes', async (req, res) => {
  const dados = schemas.cartao.parse(req.body);
  const qtd = (await db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?').get(req.usuario.id)).n;
  if (qtd >= 5) throw new HttpError(400, 'Você pode ter no máximo 5 cartões.');
  const id = await salvarCartao(req.usuario.id, dados);
  await auditar('CARTAO_ADICIONADO', { userId: req.usuario.id, req });
  res.status(201).json({ id });
});

router.delete('/cartoes/:id', async (req, res) => {
  const id = schemas.uuid.parse(req.params.id);
  const r = (await db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(id, req.usuario.id));
  if (r.changes === 0) throw new HttpError(404, 'Cartão não encontrado.');
  await auditar('CARTAO_REMOVIDO', { userId: req.usuario.id, req });
  res.json({ ok: true });
});

module.exports = { router, salvarCartao };
