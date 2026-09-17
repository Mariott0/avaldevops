#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baseUrl, compose, docker, expectStatus, login, projectRoot, request } from './lib.mjs';

// Execute MANUALMENTE: este teste interrompe a stack local com docker compose down.
// Nunca usa -v. O volume e as tarefas preexistentes são preservados.
// node scripts/test-persistence.mjs [--keep-task]
const options = process.argv.slice(2);
const keepTask = options.includes('--keep-task');
const evidence = {
  startedAt: new Date().toISOString(),
  baseUrl,
  keepTask,
  success: false,
};
let taskId;
let stackStopped = false;

function snapshot() {
  const containers = {};
  for (const service of ['frontend', 'backend', 'db']) {
    const ids = compose(['ps', '--all', '--quiet', service], { quiet: true }).split(/\r?\n/).filter(Boolean);
    assert.equal(ids.length, 1, `Esperado exatamente um contêiner do serviço ${service}`);
    containers[service] = ids[0];
  }
  const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', containers.db]));
  const volumes = mounts
    .filter((mount) => mount.Type === 'volume')
    .map((mount) => ({ name: mount.Name, destination: mount.Destination }))
    .sort((left, right) => left.destination.localeCompare(right.destination));
  assert.ok(volumes.length > 0, 'O serviço db precisa usar um volume nomeado');
  for (const volume of volumes) {
    assert.ok(volume.name && volume.destination, 'Volume precisa ter nome e destino');
    const labels = JSON.parse(docker(['volume', 'inspect', '--format', '{{json .Labels}}', volume.name]));
    assert.ok(labels?.['com.docker.compose.volume'], 'O volume do banco deve estar declarado no Compose, sem volume anônimo');
  }
  return { capturedAt: new Date().toISOString(), containers, volumes };
}

async function main() {
  assert.ok(options.every((option) => option === '--keep-task'), 'Opção permitida: --keep-task');
  console.log('TESTE MANUAL DE PERSISTÊNCIA: a stack Docker Compose local será interrompida e recriada.');
  console.log('O comando down será executado SEM -v; somente a tarefa criada por este teste poderá ser removida.');
  console.log(`API: ${baseUrl}`);
  const token = await login();
  const title = `[teste-persistência ${randomUUID()}]`;
  const description = `Evidência criada em ${evidence.startedAt}. Deve sobreviver à recriação dos contêineres.`;
  const created = await request('/api/tasks', {
    method: 'POST', token, data: { title, description, status: 'todo' },
  });
  taskId = created.body?.task?.id;
  expectStatus(created, 201, 'Criar tarefa de persistência');
  assert.ok(taskId, 'A criação precisa retornar o ID da tarefa');
  evidence.task = { id: taskId, title, description, status: 'doing' };
  const moved = await request(`/api/tasks/${taskId}`, { method: 'PATCH', token, data: { status: 'doing' } });
  expectStatus(moved, 200, 'Mover tarefa para doing');
  assert.equal(moved.body?.task?.status, 'doing');
  console.log(`Tarefa criada e movida para doing: ${taskId}`);

  evidence.before = snapshot();
  console.log(`Antes: ${JSON.stringify(evidence.before)}`);
  compose(['down', '--timeout', '15']);
  stackStopped = true;
  evidence.destroyedAt = new Date().toISOString();
  for (const service of ['frontend', 'backend', 'db']) {
    assert.equal(compose(['ps', '--all', '--quiet', service], { quiet: true }), '', `${service} deveria ter sido removido`);
  }
  console.log('Os três contêineres foram removidos; o volume foi preservado.');
  compose(['up', '-d', '--wait', '--wait-timeout', '120']);
  stackStopped = false;
  evidence.after = snapshot();
  console.log(`Depois: ${JSON.stringify(evidence.after)}`);
  for (const service of ['frontend', 'backend', 'db']) {
    assert.notEqual(evidence.after.containers[service], evidence.before.containers[service], `O contêiner ${service} precisa ter um novo ID`);
  }
  assert.deepEqual(evidence.after.volumes, evidence.before.volumes, 'O banco precisa reutilizar exatamente o mesmo volume');

  const newToken = await login();
  const response = await request('/api/tasks', { token: newToken });
  expectStatus(response, 200, 'Listar tarefas após recriação');
  assert.ok(Array.isArray(response.body?.tasks));
  const persisted = response.body.tasks.find((task) => task.id === taskId);
  assert.ok(persisted, 'A tarefa deve continuar existindo após a recriação');
  for (const [field, value] of Object.entries(evidence.task)) {
    assert.equal(persisted[field], value, `O campo ${field} precisa ser preservado`);
  }
  evidence.success = true;
  evidence.verifiedAt = new Date().toISOString();
  console.log('SUCESSO: contêineres novos, mesmo volume e tarefa preservada com ID, título, descrição e status doing.');
}

try {
  await main();
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
  console.error(`FALHA: ${error.message}`);
} finally {
  if (stackStopped) {
    try {
      console.log('Tentando restaurar a stack após a falha...');
      compose(['up', '-d', '--wait', '--wait-timeout', '120']);
      stackStopped = false;
      evidence.stackRestoredAfterFailure = true;
    } catch (error) {
      evidence.restoreError = error.message;
      console.error(`Não foi possível restaurar a stack: ${error.message}`);
    }
  }
  if (taskId && !keepTask) {
    try {
      const token = await login();
      const response = await request(`/api/tasks/${taskId}`, { method: 'DELETE', token });
      assert.ok([204, 404].includes(response.status), `HTTP ${response.status}`);
      evidence.cleanup = { taskId, removed: true };
      console.log(`Limpeza: tarefa de teste ${taskId} removida.`);
    } catch (error) {
      evidence.cleanup = { taskId, removed: false, error: error.message };
      process.exitCode = 1;
      console.error(`Não foi possível limpar a tarefa de teste ${taskId}: ${error.message}`);
    }
  } else if (taskId) {
    evidence.cleanup = { taskId, removed: false, keptByRequest: true };
    console.log(`Evidência mantida no kanban (--keep-task): ${taskId}`);
  }
  evidence.finishedAt = new Date().toISOString();
  const artifactsDir = join(projectRoot, '.artifacts');
  try {
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, 'persistence-result.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log('Relatório salvo em .artifacts/persistence-result.json (sem credenciais ou JWT).');
  } catch (error) {
    process.exitCode = 1;
    console.error(`Não foi possível gravar o relatório: ${error.message}`);
  }
}
