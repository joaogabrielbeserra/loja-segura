// "Envio" de e-mail. Em desenvolvimento os e-mails ficam numa caixa de saída local (tabela outbox),
// visível em /#/emails. Em produção, trocar por um provedor SMTP/API real.
const { db } = require('../db');
const { mascararEmail } = require('./mascaras');


async function enviarEmail(para, assunto, corpo) {
  await db.outbox.create({ data: { to_email: para, subject: assunto, body: corpo, created_at: Date.now() } });
  // O conteúdo (que pode ter link com token) NÃO vai para o log do servidor.
  console.log(`[e-mail] para ${mascararEmail(para)}: ${assunto}`);
}

module.exports = { enviarEmail };
