// Visualizador somente leitura dos registros associados à conta autenticada.
const express = require('express');
const { db } = require('../db');
const { HttpError } = require('../lib/http-error');
const { auditar } = require('../lib/auditoria');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();
const LIMITE = 50;

// Campos de autenticação e tokens de recuperação nunca são enviados ao navegador.
const tabelas = {
  users: {
    rotulo: 'Usuários',
    contar: (id) => db.user.count({ where: { id } }),
    listar: (id, skip) => db.user.findMany({
      where: { id }, skip, take: LIMITE, orderBy: { created_at: 'desc' },
      select: { id: true, email: true, name_enc: true, cpf_enc: true, cpf_index: true, phone_enc: true, failed_attempts: true, locked_until: true, token_version: true, created_at: true },
    }),
  },
  addresses: {
    rotulo: 'Endereços',
    contar: (id) => db.address.count({ where: { user_id: id } }),
    listar: (id, skip) => db.address.findMany({ where: { user_id: id }, skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  cards: {
    rotulo: 'Cartões (dados cifrados)',
    contar: (id) => db.card.count({ where: { user_id: id } }),
    listar: (id, skip) => db.card.findMany({ where: { user_id: id }, skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  products: {
    rotulo: 'Produtos anunciados por você',
    contar: (id) => db.product.count({ where: { seller_id: id } }),
    listar: (id, skip) => db.product.findMany({ where: { seller_id: id }, skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  orders: {
    rotulo: 'Pedidos relacionados à sua conta',
    contar: (id) => db.order.count({ where: { OR: [{ buyer_id: id }, { seller_id: id }] } }),
    listar: (id, skip) => db.order.findMany({ where: { OR: [{ buyer_id: id }, { seller_id: id }] }, skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  password_resets: {
    rotulo: 'Redefinições de senha (sem hashes de token)',
    contar: (id) => db.passwordReset.count({ where: { user_id: id } }),
    listar: (id, skip) => db.passwordReset.findMany({
      where: { user_id: id }, skip, take: LIMITE, orderBy: { created_at: 'desc' },
      select: { id: true, user_id: true, expires_at: true, used_at: true, created_at: true },
    }),
  },
  audit_log: {
    rotulo: 'Atividade da sua conta',
    contar: (id) => db.auditLog.count({ where: { user_id: id } }),
    listar: (id, skip) => db.auditLog.findMany({ where: { user_id: id }, skip, take: LIMITE, orderBy: { id: 'desc' } }),
  },
  outbox: {
    rotulo: 'E-mails da sua conta (sem conteúdo ou links)',
    contar: (id, _req, email) => db.outbox.count({ where: { to_email: email } }),
    listar: (_id, skip, email) => db.outbox.findMany({
      where: { to_email: email }, skip, take: LIMITE, orderBy: { created_at: 'desc' },
      select: { id: true, to_email: true, subject: true, created_at: true },
    }),
  },
};

router.use(exigirLogin);

router.get('/tabelas', async (req, res) => {
  const usuarioId = req.usuario.id;
  const email = req.usuario.email;
  const lista = await Promise.all(Object.entries(tabelas).map(async ([nome, tabela]) => ({
    nome,
    rotulo: tabela.rotulo,
    total: await tabela.contar(usuarioId, req, email),
  })));
  res.set('Cache-Control', 'no-store');
  res.json({ tabelas: lista });
});

router.get('/:nome', async (req, res) => {
  const tabela = Object.hasOwn(tabelas, req.params.nome) ? tabelas[req.params.nome] : null;
  if (!tabela) throw new HttpError(404, 'Tabela não encontrada.');

  const rawOffset = String(req.query.offset ?? '0');
  if (!/^\d{1,7}$/.test(rawOffset)) throw new HttpError(400, 'Página inválida.');
  const offset = Number(rawOffset);
  const usuarioId = req.usuario.id;
  const email = req.usuario.email;
  const [registros, total] = await Promise.all([
    tabela.listar(usuarioId, offset, email),
    tabela.contar(usuarioId, req, email),
  ]);

  await auditar('DADOS_PROPRIOS_VISUALIZADOS', {
    userId: usuarioId, req, detalhe: `${req.params.nome}:${offset}`,
  });
  res.set('Cache-Control', 'no-store');
  res.json({ registros, total, offset, limite: LIMITE });
});

module.exports = router;
