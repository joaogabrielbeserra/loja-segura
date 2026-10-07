const express = require('express');
const crypto = require('node:crypto');
const config = require('../config');
const { db, transacao } = require('../db');
const { schemas, bandeira } = require('../lib/validacao');
const { HttpError } = require('../lib/http-error');
const { cifrar, decifrar } = require('../lib/crypto');
const { auditar } = require('../lib/auditoria');
const { enviarEmail } = require('../lib/email');
const { autorizarPagamento } = require('../lib/pagamento');
const { exigirLogin } = require('../middleware/auth');
const { salvarCartao } = require('./perfil');

const router = express.Router();
router.use(exigirLogin);

// Regra de frete calculada SEMPRE no servidor (o cliente nunca define preço, frete ou total).
function calcularFrete(subtotalCents) {
  return subtotalCents >= 20000 ? 0 : 1590;
}

router.post('/', async (req, res) => {
  const dados = schemas.pedido.parse(req.body);
  const comprador = req.usuario;

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
  res.status(201).json({ id: pedido.id, totalCents: pedido.total });
});

function formatarPedido(o, visao) {
  const end = JSON.parse(decifrar(o.address_enc));
  const r = {
    id: o.id, produto: o.product_name, quantidade: o.quantity, unitarioCents: o.unit_cents, freteCents: o.shipping_cents,
    totalCents: o.total_cents, status: o.status, codigoRastreio: o.tracking_code, criadoEm: o.created_at,
    atualizadoEm: o.updated_at, endereco: end,
  };
  if (visao === 'comprador') r.cartao = `${o.card_brand} final ${o.card_last4}`;
  // O vendedor vê só o necessário para entregar: nome e endereço. Nunca CPF, telefone ou cartão.
  if (visao === 'vendedor') r.comprador = decifrar(o.buyer.name_enc);
  return r;
}

router.get('/compras', async (req, res) => {
  const linhas = (await db.order.findMany({ where: { buyer_id: req.usuario.id }, orderBy: { created_at: "desc" } }));
  res.json({ pedidos: linhas.map((o) => formatarPedido(o, 'comprador')) });
});

router.get('/vendas', async (req, res) => {
  const linhas = (await db.order.findMany({ where: { seller_id: req.usuario.id }, orderBy: { created_at: "desc" }, include: { buyer: { select: { name_enc: true } } } }));
  res.json({ pedidos: linhas.map((o) => formatarPedido(o, 'vendedor')) });
});

// Máquina de estados: cada transição só pode ser feita pelo papel certo e a partir do status certo.
async function mudarStatus({ req, papel, de, para, extra = {} }) {
  const id = schemas.uuid.parse(req.params.id);
  const coluna = papel === 'vendedor' ? 'seller_id' : 'buyer_id';
  const pedido = (await db.order.findFirst({ where: { id: id, [coluna]: req.usuario.id } }));
  if (!pedido) throw new HttpError(404, 'Pedido não encontrado.');
  if (pedido.status !== de) throw new HttpError(409, 'Esse pedido não está no status certo para essa ação.');
  const agora = Date.now();
  await transacao(async () => {
    const alteracao = (await db.order.updateMany({ data: { status: para, tracking_code: extra.codigoRastreio ?? undefined, updated_at: agora }, where: { id: id, status: de } }));
    if (alteracao.count !== 1) throw new HttpError(409, 'O status do pedido já foi alterado.');
    if (para === 'CANCELADO') {
      (await db.product.updateMany({ data: { stock: { increment: pedido.quantity } }, where: { id: pedido.product_id } }));
    }
  });
  await auditar(`PEDIDO_${para}`, { userId: req.usuario.id, req, detalhe: id });
  return pedido;
}

router.post('/:id/enviar', async (req, res) => {
  const { codigoRastreio } = schemas.rastreio.parse(req.body);
  const pedido = await mudarStatus({ req, papel: 'vendedor', de: 'AGUARDANDO_ENVIO', para: 'ENVIADO', extra: { codigoRastreio } });
  const comprador = (await db.user.findFirst({ where: { id: pedido.buyer_id }, select: { email: true } }));
  await enviarEmail(comprador.email, 'Seu pedido foi enviado', `"${pedido.product_name}" saiu para entrega. Rastreio: ${codigoRastreio}`);
  res.json({ ok: true });
});

router.post('/:id/confirmar-entrega', async (req, res) => {
  await mudarStatus({ req, papel: 'comprador', de: 'ENVIADO', para: 'ENTREGUE' });
  res.json({ ok: true });
});

router.post('/:id/cancelar', async (req, res) => {
  await mudarStatus({ req, papel: 'comprador', de: 'AGUARDANDO_ENVIO', para: 'CANCELADO' });
  res.json({ ok: true });
});

module.exports = router;
