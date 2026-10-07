// Log de auditoria de eventos de segurança (OWASP A09). Nunca registra senhas, tokens, CPF ou cartão.
const { db } = require('../db');

const inserir = db.prepare('INSERT INTO audit_log (user_id, event, ip, detail, created_at) VALUES (?, ?, ?, ?, ?)');

async function auditar(evento, { userId = null, req = null, detalhe = null } = {}) {
  const ip = req ? req.ip : null;
  (await inserir.run(userId, evento, ip, detalhe, Date.now()));
  console.log(JSON.stringify({ tipo: 'auditoria', evento, userId, ip, detalhe, em: new Date().toISOString() }));
}

module.exports = { auditar };
