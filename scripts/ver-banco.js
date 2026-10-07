// Mostra como os dados sensíveis estão gravados de verdade no banco (cifrados).
// Útil para evidenciar a criptografia em repouso. Uso: npm run banco
const { db, inicializar } = require('../src/db');
const cortar = (v) => (v && v.length > 38 ? `${v.slice(0, 38)}...` : v);

(async () => {
await inicializar();
console.log('\nTabela users (como está no disco):');
console.table((await db.prepare('SELECT email, name_enc, cpf_enc, phone_enc, password_hash FROM users').all())
  .map((u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, cortar(v)]))));

console.log('\nTabela cards (sem coluna de CVV):');
console.table((await db.prepare('SELECT last4, brand, exp_month, exp_year, pan_enc FROM cards').all())
  .map((c) => ({ ...c, pan_enc: cortar(c.pan_enc) })));

console.log('\nTabela password_resets (só o hash SHA-256 do token):');
console.table((await db.prepare('SELECT token_hash, expires_at, used_at FROM password_resets').all())
  .map((r) => ({ ...r, token_hash: cortar(r.token_hash) })));

console.log('\nÚltimos eventos de auditoria:');
console.table((await db.prepare("SELECT event, ip, FROM_UNIXTIME(created_at/1000) AS quando FROM audit_log ORDER BY id DESC LIMIT 10").all()));

})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.close());
