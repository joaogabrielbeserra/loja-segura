// Proteção CSRF em camadas: cookie SameSite=Strict + double-submit token + checagem de Origin.
const config = require('../config');
const { HttpError } = require('../lib/http-error');
const { tokenAleatorio, iguaisTempoConstante } = require('../lib/crypto');

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function emitirCsrf(res) {
  const token = tokenAleatorio(24);
  res.cookie('csrf', token, { httpOnly: false, secure: config.isProd, sameSite: 'strict', path: '/' });
  return token;
}

function protecaoCsrf(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();

  const origem = req.get('origin');
  if (origem && origem !== `${req.protocol}://${req.get('host')}`) {
    return next(new HttpError(403, 'Origem da requisição não permitida.'));
  }
  const cookie = req.cookies?.csrf;
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !iguaisTempoConstante(cookie, header)) {
    return next(new HttpError(403, 'Token de segurança inválido. Recarregue a página.'));
  }
  next();
}

module.exports = { protecaoCsrf, emitirCsrf };
