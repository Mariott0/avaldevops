import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp, TOKEN_SETTINGS } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/password.js';

const jwtSecret = 'segredo-exclusivo-dos-testes-com-mais-de-32-caracteres';
const userId = randomUUID();
let server;
let baseUrl;
let passwordHash;
let healthy = true;
const tasks = new Map();
const users = new Map();

// Este repositório em memória valida o contrato HTTP e a autenticação.
// Ele NÃO comprova persistência: essa verificação usa o PostgreSQL real via Compose.
const database = {
  async health() {
    if (!healthy) throw new Error('offline');
  },
  async findUserByUsername(username) {
    return users.get(username);
  },
  async findUserById(id) {
    return [...users.values()].find((user) => user.id === id);
  },
  async createUser(username, hash) {
    if (users.has(username)) return undefined;
    const user = { id: randomUUID(), username, passwordHash: hash };
    users.set(username, user);
    return { id: user.id, username };
  },
  async listTasks(owner) {
    return [...tasks.values()].filter((task) => task.userId === owner).map(publicTask);
  },
  async createTask(owner, values) {
    const task = {
      ...values,
      id: randomUUID(),
      userId: owner,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tasks.set(task.id, task);
    return publicTask(task);
  },
  async updateTask(owner, id, patch) {
    const task = tasks.get(id);
    if (!task || task.userId !== owner) return undefined;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    return publicTask(task);
  },
  async deleteTask(owner, id) {
    if (tasks.get(id)?.userId !== owner) return false;
    return tasks.delete(id);
  },
};

function publicTask({ userId: _owner, ...task }) {
  return task;
}

function signToken(options = {}, payload = { username: 'admin' }) {
  return jwt.sign(payload, jwtSecret, { ...TOKEN_SETTINGS, subject: userId, ...options });
}

async function request(path, { token = signToken(), body, headers, ...options } = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

before(async () => {
  passwordHash = await hashPassword('admin');
  users.set('admin', { id: userId, username: 'admin', passwordHash });
  server = createApp({ database, jwtSecret }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('a senha usa salt aleatório e o verificador rejeita senha incorreta', async () => {
  const second = await hashPassword('admin');
  assert.notEqual(passwordHash, second);
  assert.ok(!passwordHash.includes('admin'));
  assert.equal(await verifyPassword('admin', passwordHash), true);
  assert.equal(await verifyPassword('senha-incorreta', passwordHash), false);
  assert.equal(await verifyPassword('admin', 'hash-inválido'), false);
});

test('a API exige um segredo JWT de pelo menos 32 caracteres', () => {
  assert.throws(() => createApp({ database, jwtSecret: undefined }), /JWT_SECRET/);
  assert.throws(() => createApp({ database, jwtSecret: 'curto' }), /JWT_SECRET/);
});

test('login admin/admin retorna JWT assinado e com expiração de duas horas', async () => {
  const response = await request('/api/auth/login', {
    method: 'POST', token: null, body: { username: 'admin', password: 'admin' },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.user, { username: 'admin' });
  assert.equal(result.expiresIn, 7200);
  const payload = jwt.verify(result.token, jwtSecret, {
    algorithms: ['HS256'], issuer: 'kanban-api', audience: 'kanban-web',
  });
  assert.equal(payload.sub, userId);
  assert.equal(payload.username, 'admin');
  assert.equal(payload.exp - payload.iat, 7200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('login recusa credenciais erradas, tipos inválidos e campos extras', async () => {
  for (const [body, status] of [
    [{ username: 'admin', password: 'errada' }, 401],
    [{ username: 'outro', password: 'admin' }, 401],
    [{ username: ['admin'], password: 'admin' }, 400],
    [{ username: 'admin', password: 'admin', role: 'admin' }, 400],
  ]) {
    const response = await request('/api/auth/login', { method: 'POST', token: null, body });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('todas as operações de tarefas exigem autenticação', async () => {
  for (const [method, path] of [
    ['GET', '/api/auth/me'],
    ['GET', '/api/tasks'], ['POST', '/api/tasks'],
    ['PATCH', `/api/tasks/${randomUUID()}`], ['DELETE', `/api/tasks/${randomUUID()}`],
  ]) {
    const response = await request(path, { method, token: null });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test('cadastro normaliza usuário, protege senha, retorna JWT e permite login e restauração', async () => {
  const response = await request('/api/auth/register', {
    method: 'POST', token: null, body: { username: '  Maria.Silva  ', password: 'senha-segura-123' },
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['expiresIn', 'token', 'user']);
  assert.deepEqual(result.user, { username: 'maria.silva' });
  assert.equal(result.expiresIn, 7200);
  const user = users.get('maria.silva');
  assert.ok(await verifyPassword('senha-segura-123', user.passwordHash));
  assert.notEqual(user.passwordHash, 'senha-segura-123');
  const payload = jwt.verify(result.token, jwtSecret, {
    algorithms: ['HS256'], issuer: 'kanban-api', audience: 'kanban-web',
  });
  assert.equal(payload.sub, user.id);
  const me = await request('/api/auth/me', { token: result.token });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: { username: 'maria.silva' } });
  const loggedIn = await request('/api/auth/login', {
    method: 'POST', token: null, body: { username: ' MARIA.SILVA ', password: 'senha-segura-123' },
  });
  assert.equal(loggedIn.status, 200);
  assert.deepEqual((await loggedIn.json()).user, result.user);
});

test('cadastro rejeita duplicados sem substituir senha, incluindo admin e diferenças de caixa', async () => {
  for (const username of ['maria.silva', ' MARIA.SILVA ', 'Admin']) {
    const response = await request('/api/auth/register', {
      method: 'POST', token: null, body: { username, password: 'outra-senha-123' },
    });
    assert.equal(response.status, 409);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.ok(await verifyPassword('admin', users.get('admin').passwordHash));
  assert.ok(await verifyPassword('senha-segura-123', users.get('maria.silva').passwordHash));
});

test('cadastro valida usuário, senha e campos extras', async () => {
  for (const body of [
    {}, null, [], { username: 'aa', password: 'senha1234' },
    { username: 'a'.repeat(33), password: 'senha1234' },
    { username: 'com espaço', password: 'senha1234' },
    { username: 'joão', password: 'senha1234' },
    { username: 123, password: 'senha1234' },
    { username: 'teste', password: 12345678 },
    { username: 'teste', password: '1234567' },
    { username: 'teste', password: ' '.repeat(8) },
    { username: 'teste', password: 'x'.repeat(201) },
    { username: 'teste', password: 'senha1234', role: 'admin' },
  ]) {
    const response = await request('/api/auth/register', { method: 'POST', token: null, body });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(users.has('teste'), false);
});

test('duas contas cadastradas só acessam suas próprias tarefas', async () => {
  const tokens = [];
  for (const username of ['conta.a', 'conta.b']) {
    const response = await request('/api/auth/register', {
      method: 'POST', token: null, body: { username, password: 'senha1234' },
    });
    assert.equal(response.status, 201);
    tokens.push((await response.json()).token);
  }
  const response = await request('/api/tasks', {
    method: 'POST', token: tokens[0], body: { title: 'Somente conta A' },
  });
  assert.equal(response.status, 201);
  const { task } = await response.json();
  for (const otherToken of [tokens[1], signToken()]) {
    const list = await request('/api/tasks', { token: otherToken });
    assert.equal(list.status, 200);
    assert.ok(!(await list.json()).tasks.some((item) => item.id === task.id));
    assert.equal((await request(`/api/tasks/${task.id}`, { method: 'PATCH', token: otherToken, body: { status: 'done' } })).status, 404);
    assert.equal((await request(`/api/tasks/${task.id}`, { method: 'DELETE', token: otherToken })).status, 404);
  }
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'DELETE', token: tokens[0] })).status, 204);
});

test('tokens de usuários inexistentes ou com nome divergente são rejeitados', async () => {
  for (const token of [signToken({ subject: randomUUID() }), signToken({}, { username: 'maria.silva' })]) {
    assert.equal((await request('/api/auth/me', { token })).status, 401);
    assert.equal((await request('/api/tasks', { token })).status, 401);
  }
});

test('limita cadastros antes de executar hash ou gravação', async () => {
  const isolated = createApp({ database, jwtSecret, registrationLimit: 1 }).listen(0, '127.0.0.1');
  await once(isolated, 'listening');
  try {
    for (const expected of [400, 429]) {
      const response = await fetch(`http://127.0.0.1:${isolated.address().port}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(response.status, expected);
    }
  } finally {
    await new Promise((resolve) => isolated.close(resolve));
  }
});

test('rejeita JWT expirado, adulterado, sem expiração e com emissor, público ou algoritmo errados', async () => {
  const noExpiry = jwt.sign({ username: 'admin' }, jwtSecret, {
    algorithm: 'HS256', issuer: 'kanban-api', audience: 'kanban-web', subject: userId,
  });
  const wrongKey = jwt.sign({ username: 'admin' }, 'outro-segredo-com-mais-de-32-caracteres', {
    ...TOKEN_SETTINGS, subject: userId,
  });
  for (const token of [
    signToken({ expiresIn: -1 }), signToken({ issuer: 'outro' }),
    signToken({ audience: 'outro' }), signToken({ algorithm: 'HS384' }),
    signToken({}, { username: 'intruso' }), signToken({ subject: 'não-é-uuid' }),
    noExpiry, wrongKey, 'não-é-um-jwt',
  ]) {
    assert.equal((await request('/api/tasks', { token })).status, 401);
  }
});

test('cria, lista, move entre colunas, edita e exclui uma tarefa', async () => {
  const createdResponse = await request('/api/tasks', {
    method: 'POST', body: { title: '  Estudar Docker  ', description: 'Testar volume nomeado' },
  });
  assert.equal(createdResponse.status, 201);
  let { task } = await createdResponse.json();
  assert.equal(task.title, 'Estudar Docker');
  assert.equal(task.status, 'todo');
  assert.equal(task.description, 'Testar volume nomeado');
  assert.ok(Number.isFinite(Date.parse(task.createdAt)));
  assert.ok(Number.isFinite(Date.parse(task.updatedAt)));
  assert.equal(typeof task.id, 'string');
  assert.equal(Object.hasOwn(task, 'userId'), false);

  const list = await (await request('/api/tasks')).json();
  assert.ok(list.tasks.some((item) => item.id === task.id));

  for (const status of ['doing', 'done']) {
    const response = await request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status } });
    assert.equal(response.status, 200);
    ({ task } = await response.json());
    assert.equal(task.status, status);
    assert.equal(task.title, 'Estudar Docker');
  }

  const edited = await request(`/api/tasks/${task.id}`, {
    method: 'PATCH', body: { title: 'Docker concluído', description: '' },
  });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).task.description, '');

  const deleted = await request(`/api/tasks/${task.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status: 'todo' } })).status, 404);
});

test('valida campos de tarefas e não permite alterar id ou proprietário', async () => {
  for (const body of [
    {}, [], null, { title: '   ' }, { title: 123 }, { title: 'x'.repeat(121) },
    { title: 'Título', description: 123 }, { title: 'Título', description: 'x'.repeat(2001) },
    { title: 'Título', status: 'blocked' }, { title: 'Título', status: ['todo'] },
    { title: 'Título', id: randomUUID() }, { title: 'Título', user_id: randomUUID() },
  ]) {
    const response = await request('/api/tasks', { method: 'POST', body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const emptyPatch = await request(`/api/tasks/${randomUUID()}`, { method: 'PATCH', body: {} });
  assert.equal(emptyPatch.status, 400);
  const badId = await request('/api/tasks/id-invalido', { method: 'DELETE' });
  assert.equal(badId.status, 400);
});

test('tarefas de outro usuário não podem ser listadas, alteradas ou excluídas', async () => {
  const owner = randomUUID();
  const task = await database.createTask(owner, { title: 'Privada', description: '', status: 'todo' });
  const { tasks: visibleTasks } = await (await request('/api/tasks')).json();
  assert.ok(!visibleTasks.some((item) => item.id === task.id));
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status: 'done' } })).status, 404);
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'DELETE' })).status, 404);
  assert.equal(tasks.get(task.id).status, 'todo');
});

test('erros de JSON e payload excessivo retornam JSON amigável', async () => {
  const malformed = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signToken()}`, 'Content-Type': 'application/json' },
    body: '{"title":',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'JSON inválido.' });
  const large = await request('/api/tasks', { method: 'POST', body: { title: 'x'.repeat(17000) } });
  assert.equal(large.status, 413);
  assert.equal(typeof (await large.json()).error, 'string');
});

test('health público reflete a disponibilidade do banco', async () => {
  const good = await request('/api/health', { token: null });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { status: 'ok', database: 'connected' });
  healthy = false;
  try {
    const bad = await request('/api/health', { token: null });
    assert.equal(bad.status, 503);
    assert.equal(typeof (await bad.json()).error, 'string');
  } finally {
    healthy = true;
  }
});

test('limita tentativas inválidas de login por endereço IP', async () => {
  const isolated = createApp({ database, jwtSecret, loginLimit: 2 }).listen(0, '127.0.0.1');
  await once(isolated, 'listening');
  try {
    for (const expected of [401, 401, 429]) {
      const response = await fetch(`http://127.0.0.1:${isolated.address().port}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'incorreta' }),
      });
      assert.equal(response.status, expected);
      assert.equal(typeof (await response.json()).error, 'string');
    }
  } finally {
    await new Promise((resolve) => isolated.close(resolve));
  }
});
