// Log de auditoria de eventos de segurança (OWASP A09). Nunca registra senhas, tokens, CPF ou cartão.
const { db } = require('../db');


async function auditar(evento, { userId = null, req = null, detalhe = null } = {}) {
  const ip = req ? req.ip : null;
  await db.auditLog.create({ data: { user_id: userId, event: evento, ip, detail: detalhe, created_at: Date.now() } });
  console.log(JSON.stringify({ tipo: 'auditoria', evento, userId, ip, detalhe, em: new Date().toISOString() }));
}

module.exports = { auditar };
