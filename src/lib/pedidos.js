const crypto = require('node:crypto');
const config = require('../config');
const { db, transacao } = require('../db');
const { bandeira } = require('./validacao');
const { HttpError } = require('./http-error');
const { decifrar } = require('./crypto');
const { auditar } = require('./auditoria');
const { enviarEmail } = require('./email');
const { autorizarPagamento } = require('./pagamento');
const { salvarCartao } = require('../routes/perfil');

// Regra de frete calculada SEMPRE no servidor (o cliente nunca define preço, frete ou total).
function calcularFrete(subtotalCents) {
  return subtotalCents >= 20000 ? 0 : 1590;
}

async function registrarPedido(dados, comprador, req = null) {
  const endereco = (await db.address.findFirst({ where: { id: dados.enderecoId, user_id: comprador.id }, select: { data_enc: true } }));
  if (!endereco) throw new HttpError(404, 'Endereço não encontrado.');

  let numeroCartao; let final; let band;
  if ('cartaoId' in dados.pagamento) {
    const c = (await db.card.findFirst({ where: { id: dados.pagamento.cartaoId, user_id: comprador.id } }));
    if (!c) throw new HttpError(404, 'Cartão não encontrado.');
    const agora = new Date();
    if (c.exp_year < agora.getFullYear() || (c.exp_year === agora.getFullYear() && c.exp_month < agora.getMonth() + 1)) {
      throw new HttpError(400, 'Esse cartão está vencido.');
    }
    numeroCartao = decifrar(c.pan_enc, config.cardKey);
    final = c.last4; band = c.brand;
  } else {
    numeroCartao = dados.pagamento.novoCartao.numero;
    final = numeroCartao.slice(-4); band = bandeira(numeroCartao);
  }

  const pedido = await transacao(async () => {
    const p = (await db.$queryRaw`SELECT * FROM products WHERE id = ${dados.produtoId} AND active = 1 FOR UPDATE`.then((rows) => rows[0]));
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    if (p.seller_id === comprador.id) throw new HttpError(400, 'Você não pode comprar o seu próprio produto.');
    if (p.stock < dados.quantidade) throw new HttpError(409, `Só há ${p.stock} unidade(s) em estoque.`);

    const subtotal = p.price_cents * dados.quantidade;
    const frete = calcularFrete(subtotal);
    const total = subtotal + frete;

    const pagamento = autorizarPagamento({ numeroCartao, cvv: dados.pagamento.cvv, valorCents: total });
    if (!pagamento.aprovado) throw new HttpError(402, pagamento.motivo);

    // Baixa de estoque condicional: nunca fica negativo, mesmo com compras simultâneas.
    const baixa = (await db.product.updateMany({ data: { stock: { decrement: dados.quantidade } }, where: { id: p.id, stock: { gte: dados.quantidade } } }));
    if (baixa.count !== 1) throw new HttpError(409, 'Estoque insuficiente.');

    const id = crypto.randomUUID();
    const agora = Date.now();
    (await db.order.create({ data: { id: id, buyer_id: comprador.id, seller_id: p.seller_id, product_id: p.id, product_name: p.name, unit_cents: p.price_cents, quantity: dados.quantidade, shipping_cents: frete, total_cents: total, address_enc: endereco.data_enc, card_last4: final, card_brand: band, status: 'AGUARDANDO_ENVIO', created_at: agora, updated_at: agora } }));

    if ('novoCartao' in dados.pagamento && dados.pagamento.salvar) await salvarCartao(comprador.id, dados.pagamento.novoCartao);
    return { id, total, vendedorId: p.seller_id, produto: p.name };
  });
  // O CVV sai de escopo aqui: nunca foi gravado em banco nem em log.

  await auditar('PEDIDO_CRIADO', { userId: comprador.id, req, detalhe: pedido.id });
  const vendedor = (await db.user.findFirst({ where: { id: pedido.vendedorId }, select: { email: true } }));
  await enviarEmail(vendedor.email, 'Você fez uma venda', `Nova venda de "${pedido.produto}". Acesse Minhas vendas para enviar o pedido.`);
  await enviarEmail(comprador.email, 'Pedido confirmado', `Pagamento aprovado para "${pedido.produto}". Avisaremos quando for enviado.`);
  return { id: pedido.id, totalCents: pedido.total };
}

module.exports = { registrarPedido };
