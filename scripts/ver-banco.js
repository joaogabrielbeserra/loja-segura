// Mostra como os dados sensíveis estão gravados de verdade no banco (cifrados).
// Útil para evidenciar a criptografia em repouso. Uso: npm run banco
const { db, inicializar } = require('../src/db');
const cortar = (v) => (v && v.length > 38 ? `${v.slice(0, 38)}...` : v);

(async () => {
await inicializar();
console.log('\nTabela users (como está no disco):');
console.table((await db.user.findMany({ select: { email: true, name_enc: true, cpf_enc: true, phone_enc: true, password_hash: true } }))
  .map((u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, cortar(v)]))));

console.log('\nTabela cards (sem coluna de CVV):');
console.table((await db.card.findMany({ select: { last4: true, brand: true, exp_month: true, exp_year: true, pan_enc: true } }))
  .map((c) => ({ ...c, pan_enc: cortar(c.pan_enc) })));

console.log('\nTabela password_resets (só o hash SHA-256 do token):');
console.table((await db.passwordReset.findMany({ select: { token_hash: true, expires_at: true, used_at: true } }))
  .map((r) => ({ ...r, token_hash: cortar(r.token_hash) })));

console.log('\nÚltimos eventos de auditoria:');
console.table((await db.auditLog.findMany({ orderBy: { id: "desc" }, take: 10, select: { event: true, ip: true, created_at: true } }))
  .map(({ created_at, ...evento }) => ({ ...evento, quando: new Date(created_at).toLocaleString('pt-BR') })));

})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.close());
