// Gera um arquivo .env com segredos aleatórios (criptograficamente seguros).
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const destino = path.join(__dirname, '..', '.env');
if (fs.existsSync(destino)) {
  console.log('.env já existe. Apague-o se quiser gerar novas chaves (os dados cifrados atuais ficarão ilegíveis).');
  process.exit(0);
}
const rnd = () => crypto.randomBytes(32).toString('base64');
const conteudo = [
  'NODE_ENV=development',
  'PORT=3000',
  'APP_URL=http://localhost:3000',
  'DB_HOST=127.0.0.1',
  'DB_PORT=3306',
  'DB_NAME=balcao',
  'DB_USER=balcao',
  'DB_PASSWORD=troque-esta-senha',
  'TRUST_PROXY=false',
  `JWT_SECRET=${rnd()}`,
  `DATA_KEY=${rnd()}`,
  `CARD_KEY=${rnd()}`,
  `INDEX_KEY=${rnd()}`,
  '',
].join('\n');
fs.writeFileSync(destino, conteudo, { mode: 0o600 });
console.log('.env criado com chaves aleatórias (permissão 600).');
