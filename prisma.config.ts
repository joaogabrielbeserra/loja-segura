import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';

try { loadEnvFile('.env'); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const encode = encodeURIComponent;
const url = `mysql://${encode(process.env.DB_USER || 'balcao')}:${encode(process.env.DB_PASSWORD || '')}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '3306'}/${encode(process.env.DB_NAME || 'balcao')}`;
process.env.DATABASE_URL = url;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
});
