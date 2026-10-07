// Rotas SÓ de desenvolvimento: caixa de e-mails simulada. Não são registradas quando NODE_ENV=production.
const express = require('express');
const { db } = require('../db');

const router = express.Router();
router.get('/emails', async (req, res) => {
  const emails = (await db.prepare('SELECT id, to_email, subject, body, created_at FROM outbox ORDER BY id DESC LIMIT 30').all());
  res.json({ emails });
});
module.exports = router;
