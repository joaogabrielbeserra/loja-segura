const express = require('express');
const { db, transacao } = require('../db');
const { schemas } = require('../lib/validacao');
const { HttpError } = require('../lib/http-error');
const { decifrar } = require('../lib/crypto');
const { auditar } = require('../lib/auditoria');
const { enviarEmail } = require('../lib/email');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();
router.use(exigirLogin);

const { registrarPedido } = require('../lib/pedidos');

router.post('/', async (req, res) => {
  const dados = schemas.pedido.parse(req.body);
  const pedido = await registrarPedido(dados, req.usuario, req);
  res.status(201).json(pedido);
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
