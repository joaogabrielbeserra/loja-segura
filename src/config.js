// Configuração centralizada. Falha na inicialização se algum segredo estiver ausente ou fraco (fail fast).
function falhar(msg) {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

function chave32(nome) {
  const valor = process.env[nome];
  if (!valor) falhar(`Variável ${nome} ausente. Rode "npm run setup".`);
  const buf = Buffer.from(valor, 'base64');
  if (buf.length !== 32) falhar(`${nome} deve ter 32 bytes em base64.`);
  return buf;
}

const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);

const jwtSecret = chave32('JWT_SECRET');
const dataKey = chave32('DATA_KEY');
const cardKey = chave32('CARD_KEY');
const indexKey = chave32('INDEX_KEY');

// Separação de chaves: cada finalidade tem a sua.
const todas = [jwtSecret, dataKey, cardKey, indexKey].map((b) => b.toString('hex'));
if (new Set(todas).size !== todas.length) falhar('Cada chave deve ser diferente das outras.');

module.exports = {
  isProd,
  port,
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  mysql: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'balcao',
    user: process.env.DB_USER || 'balcao',
    password: process.env.DB_PASSWORD || '',
  },
  trustProxy: process.env.TRUST_PROXY === 'true',
  jwtSecret,
  dataKey,
  cardKey,
  indexKey,
  jwt: { issuer: 'balcao', audience: 'balcao-web', expiresInSec: 30 * 60 },
  lockout: { maxTentativas: 5, bloqueioMs: 15 * 60 * 1000 },
  resetTokenMs: 15 * 60 * 1000,
};
