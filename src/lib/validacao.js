// Validação de entrada com allowlist (zod). Tudo que chega do cliente é validado no servidor.
const { z } = require('zod');

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// Lista curta de senhas muito comuns. Em produção, consultar a API Pwned Passwords (k-anonymity).
const SENHAS_COMUNS = [
  '123456789012', 'senha1234567', 'password1234', 'qwertyuiopas', 'aaaaaaaaaaaa',
  '111111111111', 'minhasenha123', 'senhasegura123', 'administrador', 'iloveyou1234',
  '1234567890123', 'abcdefghijkl', 'brasil123456', 'mudar123456', 'trocar123456',
];

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (fatorInicial) => {
    let soma = 0;
    for (let i = 0; i < fatorInicial - 1; i++) soma += Number(cpf[i]) * (fatorInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(10) === Number(cpf[9]) && calc(11) === Number(cpf[10]);
}

function luhnValido(numero) {
  let soma = 0;
  let dobrar = false;
  for (let i = numero.length - 1; i >= 0; i--) {
    let d = Number(numero[i]);
    if (dobrar) { d *= 2; if (d > 9) d -= 9; }
    soma += d;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

function bandeira(numero) {
  if (/^4/.test(numero)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(numero)) return 'Mastercard';
  if (/^3[47]/.test(numero)) return 'Amex';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(numero)) return 'Elo';
  return 'Outro';
}

// Política de senha alinhada ao OWASP ASVS / NIST 800-63B: comprimento, não regras de composição.
function problemaNaSenha(senha, email) {
  const s = senha.toLowerCase();
  if (SENHAS_COMUNS.includes(s)) return 'Essa senha é muito comum. Escolha outra.';
  if (/^(.)\1+$/.test(s)) return 'A senha não pode ser um único caractere repetido.';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && s.includes(local)) return 'A senha não pode conter seu e-mail.';
  return null;
}

const email = z.string().trim().toLowerCase().max(254).pipe(z.email({ message: 'Informe um e-mail válido.' }));
const senha = z.string().min(12, 'A senha precisa ter pelo menos 12 caracteres.').max(128, 'A senha pode ter no máximo 128 caracteres.');
const nome = z.string().trim().min(3, 'Informe o nome completo.').max(100)
  .regex(/^[\p{L}][\p{L}' .-]+$/u, 'O nome só pode ter letras, espaços, apóstrofo e hífen.');
const cpf = z.string().transform(soDigitos).refine(cpfValido, 'CPF inválido.');
const telefone = z.string().transform(soDigitos).refine((v) => /^[1-9]{2}9?\d{8}$/.test(v), 'Telefone inválido. Use DDD + número.');
const uuid = z.uuid({ message: 'Identificador inválido.' });

const cadastro = z.object({ nome, email, cpf, telefone, senha }).strict();
const login = z.object({ email, senha: z.string().min(1).max(128) }).strict();
const esqueci = z.object({ email }).strict();
const redefinir = z.object({ token: z.string().min(20).max(100).regex(/^[\w-]+$/), senha }).strict();

const endereco = z.object({
  cep: z.string().transform(soDigitos).refine((v) => /^\d{8}$/.test(v), 'CEP inválido.'),
  rua: z.string().trim().min(2).max(120),
  numero: z.string().trim().min(1).max(10).regex(/^[\w/-]+$/, 'Número inválido.'),
  complemento: z.string().trim().max(60).optional().default(''),
  bairro: z.string().trim().min(2).max(80),
  cidade: z.string().trim().min(2).max(80),
  uf: z.string().trim().toUpperCase().refine((v) => UFS.includes(v), 'UF inválida.'),
}).strict();

const anoAtual = new Date().getFullYear();
const cartao = z.object({
  numero: z.string().transform(soDigitos).refine((v) => /^\d{13,19}$/.test(v) && luhnValido(v), 'Número de cartão inválido.'),
  titular: z.string().trim().min(3).max(60).regex(/^[\p{L} .'-]+$/u, 'Nome do titular inválido.'),
  mesValidade: z.coerce.number().int().min(1).max(12),
  anoValidade: z.coerce.number().int().min(anoAtual).max(anoAtual + 20),
}).strict().refine((c) => {
  const agora = new Date();
  return c.anoValidade > agora.getFullYear() || c.mesValidade >= agora.getMonth() + 1;
}, { message: 'Cartão vencido.', path: ['mesValidade'] });

const cvv = z.string().regex(/^\d{3,4}$/, 'CVV inválido.');

const preco = z.string().trim().regex(/^\d{1,7}([.,]\d{1,2})?$/, 'Preço inválido. Ex.: 49,90')
  .transform((v) => Math.round(Number(v.replace(',', '.')) * 100))
  .refine((c) => c > 0 && c <= 100000000, 'Preço fora do limite permitido.');

const produto = z.object({
  nome: z.string().trim().min(3).max(80),
  descricao: z.string().trim().min(3).max(500),
  preco,
  estoque: z.coerce.number().int().min(0).max(10000),
}).strict();

const produtoEdicao = z.object({
  preco: preco.optional(),
  estoque: z.coerce.number().int().min(0).max(10000).optional(),
  ativo: z.boolean().optional(),
}).strict();

const pedido = z.object({
  produtoId: uuid,
  quantidade: z.coerce.number().int().min(1).max(10),
  enderecoId: uuid,
  pagamento: z.union([
    z.object({ cartaoId: uuid, cvv }).strict(),
    z.object({ novoCartao: cartao, cvv, salvar: z.boolean().default(false) }).strict(),
  ]),
}).strict();

const rastreio = z.object({
  codigoRastreio: z.string().trim().toUpperCase().regex(/^[A-Z]{2}\d{9}[A-Z]{2}$/, 'Use o formato dos Correios, ex.: AB123456789BR'),
}).strict();

module.exports = {
  schemas: { cadastro, login, esqueci, redefinir, endereco, cartao, produto, produtoEdicao, pedido, rastreio, uuid },
  problemaNaSenha, bandeira, cpfValido,
};
