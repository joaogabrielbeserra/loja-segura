const { AsyncLocalStorage } = require('node:async_hooks');
const { PrismaClient } = require('@prisma/client');
const config = require('./config');
const encode = encodeURIComponent;
const { host, port, database, user, password } = config.mysql;
const url = `mysql://${encode(user)}:${encode(password)}@${host}:${port}/${encode(database)}`;

// BIGINTs de timestamps e IDs permanecem números seguros no contrato da API.
function normalizar(valor) {
  if (typeof valor === 'bigint') {
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero)) throw new RangeError('BIGINT fora do intervalo seguro da API.');
    return numero;
  }
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (valor && typeof valor === 'object' && !(valor instanceof Date) && !Buffer.isBuffer(valor)) {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, normalizar(item)]));
  }
  return valor;
}
const prisma = new PrismaClient({ datasources: { db: { url } } }).$extends({
  query: {
    async $allOperations({ args, query }) { return normalizar(await query(args)); },
  },
});
const contexto = new AsyncLocalStorage();
// Cada operação dentro de uma transação usa o mesmo cliente transacional.
const db = new Proxy({}, {
  get(_alvo, chave) {
    if (chave === 'close') return () => prisma.$disconnect();
    const cliente = contexto.getStore() || prisma;
    const valor = cliente[chave];
    return typeof valor === 'function' ? valor.bind(cliente) : valor;
  },
});
async function inicializar() { await prisma.$connect(); }
async function transacao(fn) {
  if (contexto.getStore()) throw new Error('Transações aninhadas não são suportadas.');
  return prisma.$transaction((tx) => contexto.run(tx, fn));
}
module.exports = { db, transacao, inicializar };
