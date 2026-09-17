#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { baseUrl, expectStatus, login, request } from './lib.mjs';

// Execute manualmente com a aplicação iniciada: node scripts/test-api.mjs
// Limpa exclusivamente as tarefas que esta execução conseguiu criar.
const createdIds = new Set();
const prefix = `[teste-api ${randomUUID()}]`;
let token;
let passed = 0;

async function check(label, run) {
  await run();
  passed += 1;
  console.log(`OK ${String(passed).padStart(2, '0')} — ${label}`);
}

function assertTask(task) {
  assert.match(task?.id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(typeof task.title, 'string');
  assert.equal(typeof task.description, 'string');
  assert.ok(['todo', 'doing', 'done'].includes(task.status));
  assert.ok(Number.isFinite(Date.parse(task.createdAt)), 'createdAt deve ser uma data válida');
  assert.ok(Number.isFinite(Date.parse(task.updatedAt)), 'updatedAt deve ser uma data válida');
  assert.ok(Date.parse(task.updatedAt) >= Date.parse(task.createdAt));
}

async function main() {
  console.log(`Testando a API em ${baseUrl}`);
  for (const credentials of [
    { username: 'admin', password: 'senha-incorreta' },
    { username: 'outro-usuario', password: 'admin' },
  ]) {
    await check(`Login inválido (${credentials.username}): 401`, async () => {
      expectStatus(await request('/api/auth/login', { method: 'POST', data: credentials }), 401, 'Login inválido');
    });
  }
  await check('Login admin/admin fornece JWT com validade de 7200 segundos', async () => {
    token = await login();
  });

  const missingId = randomUUID();
  for (const [method, path, data] of [
    ['GET', '/api/tasks', undefined],
    ['POST', '/api/tasks', { title: `${prefix} sem token`, description: '', status: 'todo' }],
    ['PATCH', `/api/tasks/${missingId}`, { status: 'doing' }],
    ['DELETE', `/api/tasks/${missingId}`, undefined],
  ]) {
    await check(`${method} tarefas sem JWT: 401`, async () => {
      const response = await request(path, { method, data });
      if (method === 'POST' && response.body?.task?.id) createdIds.add(response.body.task.id);
      expectStatus(response, 401, `${method} sem JWT`);
    });
  }
  await check('JWT com assinatura adulterada: 401', async () => {
    const parts = token.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    expectStatus(await request('/api/tasks', { token: parts.join('.') }), 401, 'JWT adulterado');
  });

  let task;
  await check('Criação de tarefa em to-do: 201', async () => {
    const response = await request('/api/tasks', {
      method: 'POST', token,
      data: { title: `${prefix} tarefa`, description: 'Descrição inicial de teste.', status: 'todo' },
    });
    if (response.body?.task?.id) createdIds.add(response.body.task.id);
    expectStatus(response, 201, 'Criar tarefa');
    task = response.body.task;
    assertTask(task);
    assert.equal(task.title, `${prefix} tarefa`);
    assert.equal(task.description, 'Descrição inicial de teste.');
    assert.equal(task.status, 'todo');
  });
  await check('Listagem autenticada contém a tarefa criada', async () => {
    const response = await request('/api/tasks', { token });
    expectStatus(response, 200, 'Listar tarefas');
    assert.ok(Array.isArray(response.body?.tasks));
    assert.deepEqual(response.body.tasks.find((item) => item.id === task.id), task);
  });

  for (const status of ['doing', 'done', 'todo']) {
    await check(`Movimentação do kanban para ${status}`, async () => {
      const response = await request(`/api/tasks/${task.id}`, { method: 'PATCH', token, data: { status } });
      expectStatus(response, 200, `Mover para ${status}`);
      assertTask(response.body.task);
      assert.equal(response.body.task.id, task.id);
      assert.equal(response.body.task.status, status);
      assert.equal(response.body.task.title, task.title, 'PATCH deve preservar campos omitidos');
      assert.equal(response.body.task.description, task.description);
      task = response.body.task;
      const listed = await request('/api/tasks', { token });
      expectStatus(listed, 200, 'Listar após movimentação');
      assert.deepEqual(listed.body.tasks.find((item) => item.id === task.id), task);
    });
  }
  await check('Edição parcial de título e descrição', async () => {
    const response = await request(`/api/tasks/${task.id}`, {
      method: 'PATCH', token,
      data: { title: `${prefix} editada`, description: 'Descrição atualizada: acentos ç ã é.' },
    });
    expectStatus(response, 200, 'Editar tarefa');
    assertTask(response.body.task);
    assert.equal(response.body.task.title, `${prefix} editada`);
    assert.equal(response.body.task.description, 'Descrição atualizada: acentos ç ã é.');
    assert.equal(response.body.task.status, 'todo');
    task = response.body.task;
  });

  const invalidInputs = [
    ['título ausente', { description: '', status: 'todo' }],
    ['título vazio', { title: '' }],
    ['título somente com espaços', { title: '   ' }],
    ['título com mais de 120 caracteres', { title: 'x'.repeat(121) }],
    ['título numérico', { title: 123 }],
    ['descrição com mais de 2000 caracteres', { title: `${prefix} inválida`, description: 'x'.repeat(2001) }],
    ['descrição com tipo incorreto', { title: `${prefix} inválida`, description: [] }],
    ['status inexistente', { title: `${prefix} inválida`, status: 'blocked' }],
    ['status com tipo incorreto', { title: `${prefix} inválida`, status: 1 }],
  ];
  for (const [label, data] of invalidInputs) {
    await check(`Criação rejeita ${label}: 400`, async () => {
      const response = await request('/api/tasks', { method: 'POST', token, data });
      if (response.body?.task?.id) createdIds.add(response.body.task.id);
      expectStatus(response, 400, label);
    });
  }
  for (const [label, data] of [
    ['título vazio', { title: '' }],
    ['título com tipo incorreto', { title: false }],
    ['descrição com tipo incorreto', { description: {} }],
    ['status inválido', { status: 'blocked' }],
  ]) {
    await check(`Edição rejeita ${label}: 400`, async () => {
      expectStatus(await request(`/api/tasks/${task.id}`, { method: 'PATCH', token, data }), 400, label);
    });
  }
  for (const method of ['PATCH', 'DELETE']) {
    const data = method === 'PATCH' ? { status: 'doing' } : undefined;
    await check(`${method} com UUID inválido: 400`, async () => {
      expectStatus(await request('/api/tasks/uuid-invalido', { method, token, data }), 400, 'UUID inválido');
    });
    await check(`${method} com UUID inexistente: 404`, async () => {
      expectStatus(await request(`/api/tasks/${missingId}`, { method, token, data }), 404, 'Tarefa inexistente');
    });
  }
  await check('Exclusão de tarefa: 204 e ausência na listagem', async () => {
    const response = await request(`/api/tasks/${task.id}`, { method: 'DELETE', token });
    expectStatus(response, 204, 'Excluir tarefa');
    assert.equal(response.body, null, 'Resposta 204 deve ter corpo vazio');
    createdIds.delete(task.id);
    const listed = await request('/api/tasks', { token });
    expectStatus(listed, 200, 'Listar após exclusão');
    assert.ok(!listed.body.tasks.some((item) => item.id === task.id));
  });
  console.log(`\nSucesso: ${passed} verificações da API concluídas.`);
}

try {
  await main();
} catch (error) {
  console.error(`\nFALHA após ${passed} verificações: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const id of createdIds) {
    try {
      token ||= await login();
      const response = await request(`/api/tasks/${id}`, { method: 'DELETE', token });
      assert.ok([204, 404].includes(response.status), `HTTP ${response.status}`);
      console.log(`Limpeza: tarefa de teste ${id} removida.`);
    } catch (error) {
      process.exitCode = 1;
      console.error(`Não foi possível limpar a tarefa de teste ${id}: ${error.message}`);
    }
  }
}
