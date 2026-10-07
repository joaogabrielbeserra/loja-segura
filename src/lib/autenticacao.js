const config = require('../config');
const { db } = require('../db');
const { HttpError } = require('./http-error');
const { verificarSenha, hashFicticioPronto } = require('./crypto');
const { auditar } = require('./auditoria');
const { enviarEmail } = require('./email');
const FALHA_LOGIN = 'E-mail ou senha inválidos.';

async function autenticarUsuario(email, senha, req = null) {
  const usuario = (await db.user.findFirst({ where: { email: email } }));
  const agora = Date.now();

  if (!usuario) {
    await verificarSenha(senha, await hashFicticioPronto()); // mesmo tempo de resposta
    await auditar('LOGIN_FALHA', { req, detalhe: 'usuario_inexistente' });
    throw new HttpError(401, FALHA_LOGIN);
  }

  if (usuario.locked_until && usuario.locked_until > agora) {
    await verificarSenha(senha, await hashFicticioPronto());
    await auditar('LOGIN_BLOQUEADO', { userId: usuario.id, req });
    throw new HttpError(401, FALHA_LOGIN);
  }

  if (!(await verificarSenha(senha, usuario.password_hash))) {
    const tentativas = usuario.failed_attempts + 1;
    if (tentativas >= config.lockout.maxTentativas) {
      (await db.user.updateMany({ data: { failed_attempts: 0, locked_until: agora + config.lockout.bloqueioMs }, where: { id: usuario.id } }));
      await auditar('CONTA_BLOQUEADA', { userId: usuario.id, req, detalhe: `${tentativas} tentativas` });
      await enviarEmail(usuario.email, 'Sua conta foi bloqueada temporariamente',
        `Detectamos ${tentativas} tentativas de login com senha errada na sua conta.\n` +
        'Por segurança, o acesso ficará bloqueado por 15 minutos.\n' +
        'Se não foi você, recomendamos redefinir sua senha.');
    } else {
      (await db.user.updateMany({ data: { failed_attempts: tentativas }, where: { id: usuario.id } }));
      await auditar('LOGIN_FALHA', { userId: usuario.id, req, detalhe: `tentativa ${tentativas}` });
    }
    throw new HttpError(401, FALHA_LOGIN);
  }

  (await db.user.updateMany({ data: { failed_attempts: 0, locked_until: null }, where: { id: usuario.id } }));
  await auditar('LOGIN_OK', { userId: usuario.id, req });
  return usuario;
}

module.exports = { autenticarUsuario };
