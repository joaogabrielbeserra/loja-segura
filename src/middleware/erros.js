// Tratamento centralizado de erros: o cliente nunca recebe stack trace nem detalhes internos.
const { ZodError } = require('zod');
const { HttpError } = require('../lib/http-error');

function naoEncontrado(req, res, next) {
  next(new HttpError(404, 'Recurso não encontrado.'));
}

// eslint-disable-next-line no-unused-vars
function tratarErros(err, req, res, next) {
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) {
      const campo = issue.path.join('.') || '_';
      if (!fields[campo]) fields[campo] = issue.message;
    }
    return res.status(400).json({ error: 'Confira os campos destacados.', fields });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, fields: err.fields });
  }
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Não foi possível salvar esses dados. Já existe um registro com essas informações.' });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição grande demais.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });

  // Erro inesperado: registra no servidor com um id e devolve mensagem genérica.
  const id = Math.random().toString(36).slice(2, 10);
  console.error(`[erro ${id}]`, err);
  res.status(500).json({ error: `Erro interno. Código de referência: ${id}` });
}

module.exports = { naoEncontrado, tratarErros };
