// Rate limiting (OWASP A07 / API4): reduz força bruta, credential stuffing e abuso.
const { rateLimit } = require('express-rate-limit');

const criar = (janelaMin, max, mensagem) => rateLimit({
  windowMs: janelaMin * 60 * 1000,
  limit: max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: mensagem },
});

module.exports = {
  limiteGeral: criar(15, 500, 'Muitas requisições. Aguarde alguns minutos.'),
  limiteLogin: criar(15, 10, 'Muitas tentativas de login deste endereço. Aguarde 15 minutos.'),
  limiteCadastro: criar(60, 10, 'Muitos cadastros deste endereço. Tente mais tarde.'),
  limiteRecuperacao: criar(60, 5, 'Muitos pedidos de recuperação. Tente novamente em 1 hora.'),
};
