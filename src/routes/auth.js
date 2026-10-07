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
  const existe = (await db.prepare('SELECT 1 FROM users WHERE email = ? OR cpf_index = ?').get(dados.email, cpfIdx));
  if (existe) {
    // Mensagem genérica: não revela se foi o e-mail ou o CPF que já existe.
    throw new HttpError(409, 'Não foi possível criar a conta com esses dados. Se você já tem conta, entre ou recupere a senha.');
  }

  const id = crypto.randomUUID();
  (await db.prepare(`INSERT INTO users (id, email, password_hash, name_enc, cpf_enc, cpf_index, phone_enc, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, dados.email, await hashSenha(dados.senha), cifrar(dados.nome), cifrar(dados.cpf), cpfIdx,
      cifrar(dados.telefone), Date.now()));
  await auditar('CADASTRO', { userId: id, req });
  res.status(201).json({ message: 'Conta criada. Agora é só entrar.' });
});

router.post('/login', limiteLogin, async (req, res) => {
  const { email, senha } = schemas.login.parse(req.body);
  const usuario = (await db.prepare('SELECT * FROM users WHERE email = ?').get(email));
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
      (await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?')
        .run(agora + config.lockout.bloqueioMs, usuario.id));
      await auditar('CONTA_BLOQUEADA', { userId: usuario.id, req, detalhe: `${tentativas} tentativas` });
      await enviarEmail(usuario.email, 'Sua conta foi bloqueada temporariamente',
        `Detectamos ${tentativas} tentativas de login com senha errada na sua conta.\n` +
        'Por segurança, o acesso ficará bloqueado por 15 minutos.\n' +
        'Se não foi você, recomendamos redefinir sua senha.');
    } else {
      (await db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(tentativas, usuario.id));
      await auditar('LOGIN_FALHA', { userId: usuario.id, req, detalhe: `tentativa ${tentativas}` });
    }
    throw new HttpError(401, FALHA_LOGIN);
  }

  (await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(usuario.id));
  emitirSessao(res, usuario);
  emitirCsrf(res); // rotação do token CSRF a cada login
  await auditar('LOGIN_OK', { userId: usuario.id, req });
  res.json({ usuario: usuarioPublico(usuario) });
});

router.post('/logout', async (req, res) => {
  const usuario = await lerSessao(req);
  if (usuario) {
    // Incrementar a versão invalida o JWT no servidor, não só no navegador.
    (await db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(usuario.id));
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
  const usuario = (await db.prepare('SELECT id, email FROM users WHERE email = ?').get(email));
  if (usuario) {
    const agora = Date.now();
    const token = tokenAleatorio(32);
    await transacao(async () => {
      // Invalida links anteriores ainda não usados.
      (await db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(agora, usuario.id));
      (await db.prepare('INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), usuario.id, sha256(token), agora + config.resetTokenMs, agora));
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
  const registro = (await db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token)));
  if (!registro || registro.used_at || registro.expires_at < agora) {
    throw new HttpError(400, 'Esse link é inválido ou expirou. Peça um novo.');
  }
  const usuario = (await db.prepare('SELECT * FROM users WHERE id = ?').get(registro.user_id));
  const problema = problemaNaSenha(senha, usuario.email);
  if (problema) throw new HttpError(400, 'Confira os campos destacados.', { senha: problema });
  if (await verificarSenha(senha, usuario.password_hash)) {
    throw new HttpError(400, 'Confira os campos destacados.', { senha: 'A nova senha precisa ser diferente da atual.' });
  }

  const novoHash = await hashSenha(senha);
  await transacao(async () => {
    (await db.prepare(`UPDATE users SET password_hash = ?, token_version = token_version + 1,
                failed_attempts = 0, locked_until = NULL WHERE id = ?`).run(novoHash, usuario.id));
    (await db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(agora, registro.id));
  });
  await enviarEmail(usuario.email, 'Sua senha foi alterada',
    'A senha da sua conta acabou de ser alterada e todas as sessões abertas foram encerradas.\n' +
    'Se não foi você, entre em contato com o suporte imediatamente.');
  await auditar('SENHA_REDEFINIDA', { userId: usuario.id, req });
  encerrarSessao(res);
  res.json({ message: 'Senha redefinida. Entre com a nova senha.' });
});

module.exports = router;
