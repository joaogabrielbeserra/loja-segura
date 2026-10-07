const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const mysql = require('mysql2/promise');
const config = require('./config');
const pool = mysql.createPool({ ...config.mysql, connectionLimit: 10, charset: 'utf8mb4', supportBigNumbers: true });
const contexto = new AsyncLocalStorage();
const db = {
  prepare(sql) {
    async function executar(params) {
      const [resultado] = await (contexto.getStore() || pool).execute(sql, params);
      return resultado;
    }
    return {
      async get(...params) { return (await executar(params))[0]; },
      async all(...params) { return executar(params); },
      async run(...params) {
        const resultado = await executar(params);
        return { changes: resultado.affectedRows, lastInsertRowid: resultado.insertId };
      },
    };
  },
  close() { return pool.end(); },
};
async function inicializar() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (const sql of schema.split(';').filter((s) => s.trim())) await pool.query(sql);
}
async function transacao(fn) {
  if (contexto.getStore()) throw new Error('Transações aninhadas não são suportadas.');
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    const resultado = await contexto.run(conexao, fn);
    await conexao.commit();
    return resultado;
  } catch (e) {
    await conexao.rollback();
    throw e;
  } finally { conexao.release(); }
}
module.exports = { db, transacao, inicializar };
