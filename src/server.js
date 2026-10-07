const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { inicializar, db } = require('./db');
const { protecaoCsrf } = require('./middleware/csrf');
const { limiteGeral } = require('./middleware/limites');
const { naoEncontrado, tratarErros } = require('./middleware/erros');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy ? 1 : false);

// Cabeçalhos de segurança (OWASP A05). CSP estrita: sem scripts inline, sem origens externas.
const csp = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};
if (config.isProd) csp['upgrade-insecure-requests'] = [];

app.use(helmet({
  contentSecurityPolicy: { useDefaults: false, directives: csp },
  strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginEmbedderPolicy: false,
}));
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  next();
});

app.use(express.json({ limit: '10kb' })); // limita o tamanho do corpo (anti-DoS)
app.use(cookieParser());

app.use('/api', limiteGeral, (req, res, next) => {
  res.set('Cache-Control', 'no-store'); // respostas com dados pessoais não ficam em cache
  next();
}, protecaoCsrf);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/perfil', require('./routes/perfil').router);
app.use('/api/produtos', require('./routes/produtos'));
app.use('/api/pedidos', require('./routes/pedidos'));
if (!config.isProd) app.use('/api/dev', require('./routes/dev'));
app.use('/api', naoEncontrado);

app.use(express.static(path.join(__dirname, '..', 'public'), { dotfiles: 'deny', index: 'index.html' }));
app.use(tratarErros);

if (require.main === module) {
  inicializar().then(() => app.listen(config.port, () => {
    console.log(`Balcão rodando em ${config.appUrl} (${config.isProd ? 'produção' : 'desenvolvimento'})`);
  })).catch(async (e) => {
    console.error('Não foi possível inicializar o MySQL:', e.message);
    await db.close();
    process.exitCode = 1;
  });
}

module.exports = app;
