// Mascaramento de dados sensíveis para exibição (minimização de exposição — LGPD).
function mascararCpf(cpf) {
  if (!cpf) return null;
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}
function mascararTelefone(tel) {
  if (!tel) return null;
  return `(${tel.slice(0, 2)}) *****-${tel.slice(-4)}`;
}
function mascararEmail(email) {
  const [local, dominio] = String(email).split('@');
  return `${local.slice(0, 2)}***@${dominio}`;
}
function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0];
}
module.exports = { mascararCpf, mascararTelefone, mascararEmail, primeiroNome };
