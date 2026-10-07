// Gateway de pagamento SIMULADO. Num sistema real, o número do cartão iria direto para o
// gateway (tokenização) e nem passaria pelo nosso servidor — reduzindo o escopo PCI DSS.
function autorizarPagamento({ numeroCartao, cvv, valorCents }) {
  if (!numeroCartao || !cvv || valorCents <= 0) return { aprovado: false, motivo: 'Dados de pagamento incompletos.' };
  // Cartão de teste que sempre é recusado, para demonstrar o fluxo de erro.
  if (numeroCartao.endsWith('0002')) return { aprovado: false, motivo: 'Pagamento recusado pela operadora do cartão.' };
  return { aprovado: true };
}
module.exports = { autorizarPagamento };
