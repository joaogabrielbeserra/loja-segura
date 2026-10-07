# Balcão: marketplace com foco em segurança

Sistema de compra e venda de produtos com entrega, construído para demonstrar controles de segurança
em uma aplicação que lida com dados sensíveis (nomes, CPFs, endereços, telefones e cartões de crédito),
seguindo o **OWASP Top 10 (2021)**, o **OWASP ASVS** e os cheat sheets do OWASP.

Stack: Node.js 22 + Express 5, MySQL 8.4 com Prisma ORM 6.19, frontend em JavaScript puro.
O acesso ao banco usa Prisma Client; `mysql2` é usado apenas para criar e remover o banco isolado dos testes.

## Como rodar

Pré-requisitos: Node.js 22.13 ou superior e MySQL 8.4.

Após `npm run setup`, configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` e
`DB_PASSWORD` no `.env`. Crie o banco e um usuário com acesso a ele antes do seed.
As tabelas são criadas com `npm run db:migrate`; a aplicação apenas conecta ao banco.

```sql
CREATE DATABASE balcao CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'balcao'@'localhost' IDENTIFIED BY 'troque-esta-senha';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON balcao.* TO 'balcao'@'localhost';
```

`npm test` usa um banco temporário exclusivo e o remove no final. Para os testes,
use credenciais com permissão de criar e remover bancos `balcao_teste_*`.
Os arquivos SQLite antigos em `data/` são preservados, mas seus dados não são
transferidos automaticamente para MySQL. Mantenha as chaves existentes do `.env`.

```bash
npm install
npm run setup   # gera o .env com chaves aleatórias
npm run db:migrate # aplica as migrations do Prisma
npm run seed    # cria usuários e produtos de demonstração
npm start       # abre em http://localhost:3000
npm test        # roda os testes automatizados de segurança em banco isolado
npm run banco   # mostra como os dados estão gravados (cifrados) no banco
```

### Dados de demonstração

| Papel | E-mail | Senha |
|---|---|---|
| Vendedora | ana@exemplo.com | Balcao-Vendedora-2026 |
| Comprador | bruno@exemplo.com | Balcao-Comprador-2026 |

Cartão aprovado: `4111 1111 1111 1111`. Cartão recusado pela operadora: `4000 0000 0000 0002`.
Qualquer CVV de 3 dígitos e validade futura.

Os e-mails (recuperação de senha, bloqueio de conta, avisos de pedido) aparecem em
**Caixa de e-mails (teste)** no menu. Essa tela só existe em desenvolvimento.

## Funcionalidades

- Cadastro com nome, e-mail, CPF (validado pelos dígitos verificadores), celular e senha.
- Login, logout, bloqueio de conta e recuperação de senha por e-mail com link de uso único.
- Anúncio de produtos com preço e estoque; edição e desativação só pelo dono.
- Compra com escolha de endereço, cartão salvo ou novo, cálculo de frete e pagamento (gateway simulado).
- Entrega com máquina de estados: Pago → Enviado (vendedor informa rastreio) → Entregue (comprador confirma).
  O comprador pode cancelar antes do envio, e o estoque volta.
- Área "Meus dados" com dados mascarados, endereços, cartões e histórico de atividade da conta.

## Controles de segurança por categoria OWASP Top 10 (2021)

### A01: Quebra de controle de acesso
- Toda consulta de recurso do usuário filtra pelo dono (`WHERE id = ? AND user_id = ?`). Tentar acessar
  pedido, endereço, cartão ou produto de outra pessoa (IDOR) retorna **404**, sem confirmar que o id existe.
- Ids são UUID v4 aleatórios, não sequenciais.
- Transições de status do pedido validam papel e estado: só o vendedor marca como enviado, só o comprador
  confirma entrega ou cancela, e só a partir do status correto.
- **Mínimo privilégio nos dados**: o vendedor vê só nome e endereço do comprador (o necessário para
  entregar), nunca CPF, telefone ou cartão. Na vitrine aparece só o primeiro nome do vendedor.

### A02: Falhas criptográficas
- **Senhas**: scrypt (N=2^15, r=8, p=3) com salt aleatório por usuário, parâmetros do OWASP Password
  Storage Cheat Sheet. Comparação em tempo constante (`timingSafeEqual`).
- **Dados pessoais em repouso**: nome, CPF, telefone, endereços e titular do cartão são cifrados com
  **AES-256-GCM** (cifragem autenticada, IV aleatório de 96 bits por registro).
- **Cartão**: número cifrado com uma **chave separada** (`CARD_KEY`); a API só devolve bandeira, final e
  validade. **O CVV nunca é armazenado**, nem em banco nem em log (PCI DSS requisito 3.2).
- **Índice cego**: a unicidade do CPF é checada por HMAC-SHA256, sem guardar o CPF em claro.
- Chaves de 256 bits geradas com `crypto.randomBytes`, ficam no `.env` (fora do Git) e o sistema
  se recusa a iniciar se alguma estiver ausente, curta ou repetida.
- Em produção: cookies com `Secure` e cabeçalho HSTS.

### A03: Injeção
- Consultas usam os filtros do Prisma e SQL parametrizado via `$queryRaw`; nenhum dado do usuário é concatenado ao SQL.
- Toda entrada é validada no servidor com schemas de allowlist (zod) com tipos, tamanhos e formatos.
  Campos não previstos são **rejeitados** (`.strict()`), o que bloqueia mass assignment
  (ex.: mandar `"admin": true` ou `"precoCents": 1` junto com o pedido).
- **XSS**: o frontend nunca usa `innerHTML` com dados; tudo entra como texto. Além disso, a CSP proíbe
  scripts inline e de outras origens.

### A04: Design inseguro
- Preço, frete e total são calculados **no servidor**; o cliente só informa produto e quantidade.
- Baixa de estoque atômica dentro de transação (`UPDATE ... WHERE stock >= ?`), o que evita vender mais do que
  existe mesmo com compras simultâneas.
- Recuperação de senha segue o OWASP Forgot Password Cheat Sheet (detalhes abaixo).
- Limites de negócio: até 10 unidades por pedido, 5 endereços e 5 cartões por conta.

### A05: Configuração incorreta de segurança
- Cabeçalhos via Helmet: Content-Security-Policy estrita (`default-src 'self'`, `frame-ancestors 'none'`,
  `object-src 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, anti-clickjacking.
- `X-Powered-By` removido; erros inesperados devolvem só um código de referência, sem stack trace.
- Corpo de requisição limitado a 10 KB; respostas da API com `Cache-Control: no-store`.
- Rotas de desenvolvimento (caixa de e-mails) não são registradas com `NODE_ENV=production`.

### A06: Componentes vulneráveis e desatualizados
- Poucas dependências, versões fixadas pelo `package-lock.json`, verificação com `npm audit`.
- Banco usa Prisma ORM com consultas parametrizadas; criptografia usa `node:crypto`.

### A07: Falhas de identificação e autenticação
- Política de senha do NIST 800-63B / ASVS: mínimo de 12 caracteres, máximo de 128, bloqueio de senhas
  comuns e de senhas que contêm o e-mail. Sem regras de composição forçada.
- **Anti-enumeração**: login responde a mesma mensagem para usuário inexistente, senha errada ou conta
  bloqueada, e gasta o mesmo tempo (verifica um hash fictício). Cadastro duplicado e "esqueci a senha"
  também não revelam se o e-mail/CPF existe.
- **Bloqueio de conta**: 5 senhas erradas bloqueiam por 15 minutos, e o usuário é avisado por e-mail.
- **Rate limiting por IP**: 10 logins / 15 min, 10 cadastros / hora, 5 recuperações / hora, 500 req / 15 min no geral.
- **Sessão**: JWT assinado (HS256, algoritmo fixado, `iss` e `aud` validados) em cookie `HttpOnly`,
  `SameSite=Strict`, expira em 30 minutos. O frontend desconecta após 15 minutos sem interação.
- **Revogação real**: logout e troca de senha incrementam `token_version`, invalidando no servidor
  qualquer token antigo, mesmo que tenha sido roubado.
- **CSRF** em três camadas: `SameSite=Strict`, token double-submit no cabeçalho `X-CSRF-Token`
  (rotacionado no login) e checagem do cabeçalho `Origin`.

### A08: Falhas de integridade de software e dados
- Token de sessão assinado e verificado com algoritmo fixo (impede `alg: none`).
- Nenhum valor financeiro vem do cliente.

### A09: Falhas de log e monitoramento
- Tabela `audit_log` registra cadastro, login ok/falha, bloqueio, logout, recuperação e troca de senha,
  alterações de cartão/endereço, anúncios e cada mudança de status de pedido, com IP e horário.
- Logs **nunca** contêm senha, token, CPF ou número de cartão. O corpo dos e-mails (que tem o link de
  recuperação) não vai para o log do servidor.
- O usuário vê a atividade recente da própria conta em "Meus dados".

### A10: SSRF
- O servidor não faz nenhuma requisição para URLs vindas do usuário (produtos não aceitam URL de imagem).
  A CSP também limita `connect-src` à própria origem.

## Recuperação de senha em detalhe

1. O usuário informa o e-mail; a resposta é sempre a mesma, exista a conta ou não.
2. Se existir, é gerado um token de 256 bits (`crypto.randomBytes`). O banco guarda **só o hash SHA-256**,
   então quem vazar o banco não consegue usar os links.
3. O link vale **15 minutos**, é de **uso único** e pedir um novo invalida o anterior.
4. O token vai no **fragmento** da URL (`/#/redefinir?token=...`), que não é enviado ao servidor nem aparece
   em logs de proxy ou no cabeçalho Referer. O frontend lê o token e o apaga da barra de endereço na hora.
5. Ao redefinir: a nova senha passa pela mesma política, não pode ser igual à atual, todas as sessões
   abertas são encerradas, o bloqueio é removido e o usuário recebe um e-mail avisando da troca.

## LGPD

Minimização (cada tela e cada papel recebe só o dado de que precisa), mascaramento na exibição
(`***.456.789-**`, `(12) *****-4567`, `Visa final 1111`), criptografia em repouso e registro de atividade
visível ao titular.

## Limitações conhecidas (e o que mudaria em produção)

- O gateway de pagamento é simulado. Em produção, o número do cartão seria tokenizado direto pelo gateway
  no navegador (ex.: campos hospedados), sem passar pelo servidor, o que reduz o escopo PCI DSS.
- As chaves ficam no `.env`. Em produção, usar um cofre (AWS KMS, HashiCorp Vault) com rotação.
- A lista de senhas comuns é curta; em produção, consultar a API Pwned Passwords (k-anonymity).
- O rate limit fica em memória; com várias instâncias, usar Redis.
- Faltam MFA (TOTP) e confirmação de e-mail no cadastro, que seriam os próximos passos.
- Rodar sempre atrás de HTTPS (proxy reverso) com `NODE_ENV=production` e `TRUST_PROXY=true`.

## Estrutura

```
src/
  server.js            cabeçalhos, CSP, limites e montagem das rotas
  config.js            leitura e validação das chaves (fail fast)
  db.js                Prisma Client e transações
  lib/crypto.js        scrypt, AES-256-GCM, HMAC, tokens
  lib/validacao.js     schemas de entrada, CPF, Luhn, política de senha
  lib/auditoria.js     log de eventos de segurança
  middleware/          sessão, CSRF, rate limit, tratamento de erros
  routes/              auth, perfil, produtos, pedidos, dev
public/                frontend (index.html, app.js, styles.css)
scripts/               setup, seed, testes de segurança, visualização do banco
```

## Prisma ORM

Os modelos e relações ficam em `prisma/schema.prisma`, com nomes mapeados para
as tabelas MySQL existentes. `prisma.config.ts` monta a conexão usando as mesmas
variáveis `DB_*` do `.env`; não é necessário duplicar credenciais.

```bash
npm run db:generate             # gera o Prisma Client
npm run db:validate             # valida o schema
npm run db:migrate              # aplica migrations pendentes
npm run db:migrate:dev -- --name nome_da_alteracao
npm run db:studio               # interface visual do banco
```

Para um banco que já possui as tabelas da versão anterior, confira a estrutura
contra a migration inicial antes de registrar a baseline:
`npx prisma migrate resolve --applied 20261006000000_init`. Depois use
`npm run db:migrate`. Não aplique a migration inicial sobre tabelas existentes.

Consultas, inserções e alterações usam os modelos do Prisma. A compra mantém
SQL parametrizado via `$queryRaw` para o bloqueio `FOR UPDATE`; a busca usa
`INSTR` para preservar a procura literal sem distinguir maiúsculas.
Todas as operações de estoque, pedido e cartão usam a mesma transação.
Os timestamps BIGINT são convertidos para números seguros antes de saírem na API.
