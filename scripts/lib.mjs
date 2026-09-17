import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const baseUrl = (process.env.BASE_URL || `http://localhost:${process.env.HTTP_PORT || '8080'}`).replace(/\/+$/, '');

export async function request(path, { method = 'GET', token, data } = {}) {
  // O teste de persistência recria o Nginx enquanto spawnSync bloqueia o event loop.
  // Fechar cada conexão evita reutilizar sockets antigos, sem repetir POSTs automaticamente.
  const headers = { Accept: 'application/json', Connection: 'close' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const causeCode = error.cause?.code;
    // Apenas o código de transporte: nunca registra cabeçalhos, credenciais ou JWT.
    throw new Error(`${method} ${path}: ${error.message}${causeCode ? ` (${causeCode})` : ''}`, { cause: error });
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path}: resposta HTTP ${response.status} não é JSON.`);
    }
  }
  return { status: response.status, body, headers: response.headers };
}

export function expectStatus(response, status, context) {
  assert.equal(response.status, status, `${context}: HTTP esperado ${status}, recebido ${response.status}`);
  if (status >= 400) {
    assert.equal(typeof response.body?.error, 'string', `${context}: erro deve conter { error: string }`);
    assert.ok(response.body.error.length > 0, `${context}: mensagem de erro vazia`);
  }
}

export async function login() {
  const response = await request('/api/auth/login', {
    method: 'POST', data: { username: 'admin', password: 'admin' },
  });
  expectStatus(response, 200, 'Login admin/admin');
  assert.equal(response.body?.user?.username, 'admin');
  assert.equal(response.body?.expiresIn, 7200);
  assert.equal(typeof response.body?.token, 'string');
  assert.equal(response.body.token.split('.').length, 3, 'O token deve ter o formato JWT');
  return response.body.token;
}

export function compose(args, { quiet = false } = {}) {
  if (!quiet) console.log(`$ docker compose ${args.join(' ')}`);
  return docker(['compose', ...args]);
}

export function docker(args) {
  const result = spawnSync('docker', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Não foi possível executar docker ${args[0]}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} falhou (código ${result.status}):\n${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}
