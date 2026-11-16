import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';

test('SQLite real: cadastro, isolamento, CRUD HTTP e persistencia apos reabrir app.db', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hardening-sqlite-'));
  const path = join(directory, 'app.db');
  let database;
  let server;
  try {
    database = createDatabase(path);
    await database.initialize();
    server = createApp({ database, jwtSecret: 'segredo-de-integracao-sqlite-com-32-caracteres' }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, method = 'GET', data, token) {
      const response = await fetch(base + route, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }
    const first = await request('/api/auth/register', 'POST', { username: 'aluno01', password: 'senha-segura-123' });
    assert.equal(first.status, 201);
    const second = await request('/api/auth/register', 'POST', { username: 'aluno02', password: 'senha-segura-456' });
    assert.equal(second.status, 201);
    assert.equal((await request('/api/auth/register', 'POST', { username: 'aluno01', password: 'outra-senha-123' })).status, 409);
    const created = await request('/api/tasks', 'POST', { title: "SQLite ' seguro", description: 'Persistencia real', status: 'todo' }, first.body.token);
    assert.equal(created.status, 201);
    const id = created.body.task.id;
    assert.equal((await request(`/api/tasks/${id}`, 'PATCH', { status: 'done' }, second.body.token)).status, 404);
    assert.equal((await request(`/api/tasks/${id}`, 'DELETE', undefined, second.body.token)).status, 404);
    assert.deepEqual((await request('/api/tasks', 'GET', undefined, second.body.token)).body.tasks, []);
    const moved = await request(`/api/tasks/${id}`, 'PATCH', { status: 'doing' }, first.body.token);
    assert.equal(moved.status, 200);
    assert.equal(moved.body.task.status, 'doing');
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = undefined;
    const owner = await database.findUserByUsername('aluno01');
    await database.close();
    database = createDatabase(path);
    await database.initialize();
    const persisted = await database.listTasks(owner.id);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].id, id);
    assert.equal(persisted[0].title, "SQLite ' seguro");
    assert.equal(persisted[0].status, 'doing');
    assert.equal(await database.deleteTask(owner.id, id), true);
    assert.deepEqual(await database.listTasks(owner.id), []);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
