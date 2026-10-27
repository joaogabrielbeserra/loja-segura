// Visualizador global somente leitura; acessível apenas com uma sessão válida.
const express = require('express');
const { db } = require('../db');
const { HttpError } = require('../lib/http-error');
const { auditar } = require('../lib/auditoria');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();
const LIMITE = 50;

// Não expõe hashes de senha, hashes de tokens nem conteúdo de e-mails com links.
const tabelas = {
  users: {
    rotulo: 'Usuários',
    contar: () => db.user.count(),
    listar: (skip) => db.user.findMany({
      skip, take: LIMITE, orderBy: { created_at: 'desc' },
      select: { id: true, email: true, name_enc: true, cpf_enc: true, cpf_index: true, phone_enc: true, failed_attempts: true, locked_until: true, token_version: true, created_at: true },
    }),
  },
  addresses: {
    rotulo: 'Endereços',
    contar: () => db.address.count(),
    listar: (skip) => db.address.findMany({ skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  cards: {
    rotulo: 'Cartões (dados cifrados)',
    contar: () => db.card.count(),
    listar: (skip) => db.card.findMany({ skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  products: {
    rotulo: 'Produtos',
    contar: () => db.product.count(),
    listar: (skip) => db.product.findMany({ skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  orders: {
    rotulo: 'Pedidos',
    contar: () => db.order.count(),
    listar: (skip) => db.order.findMany({ skip, take: LIMITE, orderBy: { created_at: 'desc' } }),
  },
  password_resets: {
    rotulo: 'Redefinições de senha (sem hashes de token)',
    contar: () => db.passwordReset.count(),
    listar: (skip) => db.passwordReset.findMany({
      skip, take: LIMITE, orderBy: { created_at: 'desc' },
      select: { id: true, user_id: true, expires_at: true, used_at: true, created_at: true },
    }),
  },
  audit_log: {
    rotulo: 'Auditoria',
    contar: () => db.auditLog.count(),
    listar: (skip) => db.auditLog.findMany({ skip, take: LIMITE, orderBy: { id: 'desc' } }),
  },
  outbox: {
    rotulo: 'E-mails (sem conteúdo ou links)',
    contar: () => db.outbox.count(),
    listar: (skip) => db.outbox.findMany({
      skip, take: LIMITE, orderBy: { created_at: 'desc' },
      select: { id: true, to_email: true, subject: true, created_at: true },
    }),
  },
};

router.use(exigirLogin);

router.get('/tabelas', async (_req, res) => {
  const lista = await Promise.all(Object.entries(tabelas).map(async ([nome, tabela]) => ({
    nome,
    rotulo: tabela.rotulo,
    total: await tabela.contar(),
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
  const [registros, total] = await Promise.all([tabela.listar(offset), tabela.contar()]);

  await auditar('BANCO_GLOBAL_VISUALIZADO', {
    userId: req.usuario.id, req, detalhe: `${req.params.nome}:${offset}`,
  });
  res.set('Cache-Control', 'no-store');
  res.json({ registros, total, offset, limite: LIMITE });
});

module.exports = router;
