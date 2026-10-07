const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const { HttpError } = require('../lib/http-error');

const buscarUsuario = db.prepare('SELECT * FROM users WHERE id = ?');

const OPCOES_COOKIE = () => ({ httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/' });

function emitirSessao(res, usuario) {
  const token = jwt.sign({ tv: usuario.token_version }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: usuario.id,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.expiresInSec,
  });
  res.cookie('sid', token, { ...OPCOES_COOKIE(), maxAge: config.jwt.expiresInSec * 1000 });
}

async function lerSessao(req) {
  const token = req.cookies?.sid;
  if (!token) return null;
  try {
    // Algoritmo fixado: impede ataques "alg: none" e confusão de algoritmos.
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'], issuer: config.jwt.issuer, audience: config.jwt.audience,
    });
    const usuario = (await buscarUsuario.get(payload.sub));
    // token_version muda no logout e na troca de senha → invalida sessões antigas.
    if (!usuario || usuario.token_version !== payload.tv) return null;
    return usuario;
  } catch {
    return null;
  }
}

async function exigirLogin(req, res, next) {
  const usuario = await lerSessao(req);
  if (!usuario) return next(new HttpError(401, 'Sua sessão expirou ou você não entrou. Faça login.'));
  req.usuario = usuario;
  next();
}

function encerrarSessao(res) {
  res.clearCookie('sid', OPCOES_COOKIE());
}

module.exports = { exigirLogin, emitirSessao, encerrarSessao, lerSessao };
