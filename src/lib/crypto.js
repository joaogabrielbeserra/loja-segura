// Primitivas criptográficas: hash de senha (scrypt), cifragem de campos (AES-256-GCM),
// índice cego (HMAC-SHA256) e tokens aleatórios.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('../config');

const scrypt = promisify(crypto.scrypt);

// Parâmetros recomendados pelo OWASP Password Storage Cheat Sheet (N=2^15, r=8, p=3).
const SCRYPT = { N: 2 ** 15, r: 8, p: 3, maxmem: 128 * 1024 * 1024 };
const KEYLEN = 64;

async function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(senha.normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verificarSenha(senha, armazenado) {
  const [alg, N, r, p, saltB64, hashB64] = String(armazenado).split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hashB64, 'base64');
  const obtido = await scrypt(senha.normalize('NFKC'), Buffer.from(saltB64, 'base64'), esperado.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  // Comparação em tempo constante evita ataques de temporização.
  return obtido.length === esperado.length && crypto.timingSafeEqual(obtido, esperado);
}

// Hash "falso" usado quando o usuário não existe, para o tempo de resposta ser igual (anti-enumeração).
let hashFicticio;
async function hashFicticioPronto() {
  if (!hashFicticio) hashFicticio = await hashSenha(crypto.randomBytes(16).toString('hex'));
  return hashFicticio;
}

function cifrar(texto, chave = config.dataKey) {
  if (texto === null || texto === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const ct = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decifrar(payload, chave = config.dataKey) {
  if (!payload) return null;
  const [versao, iv, tag, ct] = payload.split(':');
  if (versao !== 'v1') throw new Error('Formato de dado cifrado desconhecido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

// Índice cego: permite checar unicidade de CPF sem guardar o CPF em claro.
function indiceCego(valor) {
  return crypto.createHmac('sha256', config.indexKey).update(valor).digest('hex');
}

function sha256(valor) {
  return crypto.createHash('sha256').update(valor).digest('hex');
}

function tokenAleatorio(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function iguaisTempoConstante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  hashSenha, verificarSenha, hashFicticioPronto, cifrar, decifrar,
  indiceCego, sha256, tokenAleatorio, iguaisTempoConstante,
};
