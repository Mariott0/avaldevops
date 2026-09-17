import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT deve ser um número entre 1 e 65535.');
  process.exit(1);
}

const database = createDatabase();
let server;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: encerrando servidor e conexões com o banco.`);
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  try {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.close();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    console.error('Falha ao encerrar:', error.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  // A configuração JWT é validada antes de abrir conexões com o banco.
  const app = createApp({ database, jwtSecret: process.env.JWT_SECRET });
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await database.initialize();
      break;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      console.warn(`Banco ainda indisponível (tentativa ${attempt}/${maxAttempts}): ${error.message}`);
      await delay(2000);
    }
  }
  if (!shuttingDown) {
    server = app.listen(port, '0.0.0.0', () => console.log(`API pronta na porta ${port}.`));
    server.on('error', async (error) => {
      console.error('Falha no servidor HTTP:', error.message);
      await database.close();
      process.exit(1);
    });
  }
} catch (error) {
  console.error('Não foi possível iniciar a API:', error.message);
  await database.close();
  process.exit(1);
}
