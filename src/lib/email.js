// "Envio" de e-mail. Em desenvolvimento os e-mails ficam numa caixa de saída local (tabela outbox),
// visível em /#/emails. Em produção, trocar por um provedor SMTP/API real.
const { db } = require('../db');
const { mascararEmail } = require('./mascaras');

const inserir = db.prepare('INSERT INTO outbox (to_email, subject, body, created_at) VALUES (?, ?, ?, ?)');

async function enviarEmail(para, assunto, corpo) {
  (await inserir.run(para, assunto, corpo, Date.now()));
  // O conteúdo (que pode ter link com token) NÃO vai para o log do servidor.
  console.log(`[e-mail] para ${mascararEmail(para)}: ${assunto}`);
}

module.exports = { enviarEmail };
