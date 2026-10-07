// Rotas SÓ de desenvolvimento: caixa de e-mails simulada. Não são registradas quando NODE_ENV=production.
const express = require('express');
const { db } = require('../db');

const router = express.Router();
router.get('/emails', async (req, res) => {
  const emails = (await db.outbox.findMany({ orderBy: { id: "desc" }, take: 30, select: { id: true, to_email: true, subject: true, body: true, created_at: true } }));
  res.json({ emails });
});
module.exports = router;
