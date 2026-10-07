const express = require('express');
const crypto = require('node:crypto');
const config = require('../config');
const { db, transacao } = require('../db');
const { schemas, problemaNaSenha } = require('../lib/validacao');
const { HttpError } = require('../lib/http-error');
const {
  hashSenha, verificarSenha, hashFicticioPronto, cifrar, decifrar, indiceCego, sha256, tokenAleatorio,
} = require('../lib/crypto');
const { mascararCpf, mascararTelefone } = require('../lib/mascaras');
const { auditar } = require('../lib/auditoria');
const { enviarEmail } = require('../lib/email');
const { exigirLogin, emitirSessao, encerrarSessao, lerSessao } = require('../middleware/auth');
const { emitirCsrf } = require('../middleware/csrf');
const { limiteLogin, limiteCadastro, limiteRecuperacao } = require('../middleware/limites');

const router = express.Router();
const FALHA_LOGIN = 'E-mail ou senha inválidos.';

function usuarioPublico(u) {
  return {
    id: u.id,
    email: u.email,
    nome: decifrar(u.name_enc),
    cpf: mascararCpf(decifrar(u.cpf_enc)),
    telefone: mascararTelefone(decifrar(u.phone_enc)),
  };
}

router.get('/csrf', async (req, res) => {
  emitirCsrf(res);
  res.json({ ok: true });
});

router.post('/cadastro', limiteCadastro, async (req, res) => {
  const dados = schemas.cadastro.parse(req.body);
  const problema = problemaNaSenha(dados.senha, dados.email);
  if (problema) throw new HttpError(400, 'Confira os campos destacados.', { senha: problema });

  const cpfIdx = indiceCego(dados.cpf);
  const existe = (await db.user.findFirst({ where: { OR: [{ email: dados.email }, { cpf_index: cpfIdx }] } }));
  if (existe) {
    // Mensagem genérica: não revela se foi o e-mail ou o CPF que já existe.
    throw new HttpError(409, 'Não foi possível criar a conta com esses dados. Se você já tem conta, entre ou recupere a senha.');
  }

  const id = crypto.randomUUID();
  (await db.user.create({ data: { id: id, email: dados.email, password_hash: await hashSenha(dados.senha), name_enc: cifrar(dados.nome), cpf_enc: cifrar(dados.cpf), cpf_index: cpfIdx, phone_enc: cifrar(dados.telefone), created_at: Date.now() } }));
  await auditar('CADASTRO', { userId: id, req });
  res.status(201).json({ message: 'Conta criada. Agora é só entrar.' });
});

router.post('/login', limiteLogin, async (req, res) => {
  const { email, senha } = schemas.login.parse(req.body);
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
  emitirSessao(res, usuario);
  emitirCsrf(res); // rotação do token CSRF a cada login
  await auditar('LOGIN_OK', { userId: usuario.id, req });
  res.json({ usuario: usuarioPublico(usuario) });
});

router.post('/logout', async (req, res) => {
  const usuario = await lerSessao(req);
  if (usuario) {
    // Incrementar a versão invalida o JWT no servidor, não só no navegador.
    (await db.user.updateMany({ data: { token_version: { increment: 1 } }, where: { id: usuario.id } }));
    await auditar('LOGOUT', { userId: usuario.id, req });
  }
  encerrarSessao(res);
  res.json({ message: 'Você saiu da conta.' });
});

router.get('/me', exigirLogin, async (req, res) => {
  res.json({ usuario: usuarioPublico(req.usuario) });
});

router.post('/esqueci-senha', limiteRecuperacao, async (req, res) => {
  const { email } = schemas.esqueci.parse(req.body);
  const usuario = (await db.user.findFirst({ where: { email: email }, select: { id: true, email: true } }));
  if (usuario) {
    const agora = Date.now();
    const token = tokenAleatorio(32);
    await transacao(async () => {
      // Invalida links anteriores ainda não usados.
      (await db.passwordReset.updateMany({ data: { used_at: agora }, where: { user_id: usuario.id, used_at: null } }));
      (await db.passwordReset.create({ data: { id: crypto.randomUUID(), user_id: usuario.id, token_hash: sha256(token), expires_at: agora + config.resetTokenMs, created_at: agora } }));
    });
    // Token no fragmento (#) da URL: não vai para logs de servidor, proxies nem cabeçalho Referer.
    await enviarEmail(usuario.email, 'Redefinição de senha',
      'Recebemos um pedido para redefinir sua senha.\n' +
      `Abra o link abaixo em até 15 minutos:\n${config.appUrl}/#/redefinir?token=${token}\n` +
      'O link só pode ser usado uma vez. Se você não pediu, ignore este e-mail.');
    await auditar('RECUPERACAO_SOLICITADA', { userId: usuario.id, req });
  } else {
    await auditar('RECUPERACAO_EMAIL_DESCONHECIDO', { req });
  }
  // Resposta idêntica exista ou não o e-mail (anti-enumeração de usuários).
  res.json({ message: 'Se esse e-mail tiver conta, enviamos um link para redefinir a senha. Ele vale por 15 minutos.' });
});

router.post('/redefinir-senha', limiteRecuperacao, async (req, res) => {
  const { token, senha } = schemas.redefinir.parse(req.body);
  const agora = Date.now();
  const registro = (await db.passwordReset.findFirst({ where: { token_hash: sha256(token) } }));
  if (!registro || registro.used_at || registro.expires_at < agora) {
    throw new HttpError(400, 'Esse link é inválido ou expirou. Peça um novo.');
  }
  const usuario = (await db.user.findFirst({ where: { id: registro.user_id } }));
  const problema = problemaNaSenha(senha, usuario.email);
  if (problema) throw new HttpError(400, 'Confira os campos destacados.', { senha: problema });
  if (await verificarSenha(senha, usuario.password_hash)) {
    throw new HttpError(400, 'Confira os campos destacados.', { senha: 'A nova senha precisa ser diferente da atual.' });
  }

  const novoHash = await hashSenha(senha);
  await transacao(async () => {
    const consumo = await db.passwordReset.updateMany({
      where: { id: registro.id, used_at: null, expires_at: { gte: Date.now() } },
      data: { used_at: agora },
    });
    if (consumo.count !== 1) throw new HttpError(400, 'Esse link é inválido ou expirou. Peça um novo.');
    (await db.user.updateMany({ data: { password_hash: novoHash, token_version: { increment: 1 }, failed_attempts: 0, locked_until: null }, where: { id: usuario.id } }));
  });
  await enviarEmail(usuario.email, 'Sua senha foi alterada',
    'A senha da sua conta acabou de ser alterada e todas as sessões abertas foram encerradas.\n' +
    'Se não foi você, entre em contato com o suporte imediatamente.');
  await auditar('SENHA_REDEFINIDA', { userId: usuario.id, req });
  encerrarSessao(res);
  res.json({ message: 'Senha redefinida. Entre com a nova senha.' });
});

module.exports = router;
