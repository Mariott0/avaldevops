#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baseUrl, compose, expectStatus, login, projectRoot, request } from './lib.mjs';

// Teste da stack LOCAL: a limpeza remove somente as contas criadas nesta execução.
// --recreate também interrompe/recria os contêineres, sempre sem -v.
const options = process.argv.slice(2);
const recreate = options.includes('--recreate');
const accounts = [];
const password = `teste-${randomUUID()}`;
const prefix = `teste_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const evidence = { startedAt: new Date().toISOString(), recreate, checks: [], success: false };
let stackStopped = false;

function sql(input) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'sh', '-c',
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At -f -'], {
    cwd: projectRoot, shell: false, windowsHide: true, encoding: 'utf8', input, timeout: 15000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || 'Falha no PostgreSQL local');
  return result.stdout.trim();
}

async function check(label, run) {
  await run();
  evidence.checks.push(label);
  console.log(`OK ${evidence.checks.length} — ${label}`);
}

function remember(body, username) {
  assert.equal(body.user.username, username);
  assert.equal(body.expiresIn, 7200);
  const id = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url')).sub;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.match(username, /^teste_[a-f0-9]{16}_[ab]$/);
  const account = { username, id, token: body.token };
  accounts.push(account);
  return account;
}

async function main() {
  assert.ok(options.every((value) => value === '--recreate'), 'Única opção: --recreate');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname), 'Execute somente contra a stack local');
  assert.equal(sql('SELECT 1;'), '1', 'O PostgreSQL local deve estar disponível para limpar as contas de teste');
  let accountA;
  let accountB;
  await check('Cadastros simultâneos do mesmo nome: um 201 e um 409', async () => {
    const username = `${prefix}_a`;
    const responses = await Promise.all([username, ` ${username.toUpperCase()} `].map((value) => request('/api/auth/register', {
      method: 'POST', data: { username: value, password },
    })));
    for (const response of responses) if (response.status === 201) accountA = remember(response.body, username);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    expectStatus(responses.find((response) => response.status === 409), 409, 'Duplicado');
  });
  await check('Segunda conta recebe sessão própria no cadastro', async () => {
    const username = `${prefix}_b`;
    const response = await request('/api/auth/register', { method: 'POST', data: { username, password } });
    expectStatus(response, 201, 'Cadastro B');
    accountB = remember(response.body, username);
    assert.notEqual(accountA.id, accountB.id);
  });
  await check('Senhas persistidas como hashes scrypt com salt', async () => {
    for (const account of accounts) {
      assert.equal(sql(`SELECT password_hash ~ '^[a-f0-9]{32}:[a-f0-9]{128}$' FROM users WHERE id = '${account.id}' AND username = '${account.username}';`), 't');
    }
  });
  await check('Cadastro não substitui a conta admin', async () => {
    expectStatus(await request('/api/auth/register', { method: 'POST', data: { username: ' ADMIN ', password } }), 409, 'Admin duplicado');
    await login();
  });
  await check('Cadastro rejeita campos e tipos inválidos', async () => {
    for (const data of [
      { username: 'ab', password }, { username: 'nome inválido', password },
      { username: 'x'.repeat(33), password }, { username: [], password },
      { username: `${prefix}_a`, password: '1234567' },
      { username: `${prefix}_a`, password: ' '.repeat(8) },
      { username: `${prefix}_a`, password: 'x'.repeat(201) },
      { username: `${prefix}_a`, password, role: 'admin' },
    ]) expectStatus(await request('/api/auth/register', { method: 'POST', data }), 400, 'Cadastro inválido');
  });
  await check('Login da nova conta normaliza o nome e valida a senha', async () => {
    const response = await request('/api/auth/login', {
      method: 'POST', data: { username: ` ${accountA.username.toUpperCase()} `, password },
    });
    expectStatus(response, 200, 'Login A');
    assert.equal(response.body.user.username, accountA.username);
    expectStatus(await request('/api/auth/login', {
      method: 'POST', data: { username: accountA.username, password: 'errada' },
    }), 401, 'Senha incorreta');
  });
  await check('Restauração identifica cada conta; sem JWT retorna 401', async () => {
    expectStatus(await request('/api/auth/me'), 401, 'Sem JWT');
    for (const account of accounts) {
      const response = await request('/api/auth/me', { token: account.token });
      expectStatus(response, 200, 'Identidade');
      assert.deepEqual(response.body, { user: { username: account.username } });
    }
  });
  await check('Cada conta pode criar sua própria tarefa', async () => {
    for (const account of accounts) {
      const response = await request('/api/tasks', {
        method: 'POST', token: account.token, data: { title: `Privada de ${account.username}`, status: 'doing' },
      });
      expectStatus(response, 201, 'Criar tarefa');
      account.task = response.body.task;
    }
  });
  await check('Contas não listam, editam nem excluem tarefas de outras contas', async () => {
    const adminToken = await login();
    for (const [owner, otherToken] of [[accountA, accountB.token], [accountB, accountA.token], [accountA, adminToken]]) {
      const list = await request('/api/tasks', { token: otherToken });
      expectStatus(list, 200, 'Listagem');
      assert.ok(!list.body.tasks.some((task) => task.id === owner.task.id));
      expectStatus(await request(`/api/tasks/${owner.task.id}`, {
        method: 'PATCH', token: otherToken, data: { status: 'done' },
      }), 404, 'Editar tarefa alheia');
      expectStatus(await request(`/api/tasks/${owner.task.id}`, { method: 'DELETE', token: otherToken }), 404, 'Excluir tarefa alheia');
    }
  });
  if (recreate) {
    console.log('Recriando os três contêineres SEM remover volumes...');
    compose(['down', '--timeout', '15']);
    stackStopped = true;
    compose(['up', '-d', '--wait', '--wait-timeout', '120']);
    stackStopped = false;
    await check('Contas, senhas e tarefas persistem após recriar os contêineres', async () => {
      for (const account of accounts) {
        const response = await request('/api/auth/login', { method: 'POST', data: { username: account.username, password } });
        expectStatus(response, 200, 'Login após recriação');
        const list = await request('/api/tasks', { token: response.body.token });
        expectStatus(list, 200, 'Tarefas após recriação');
        assert.deepEqual(list.body.tasks, [account.task]);
      }
    });
  }
  evidence.success = true;
}

try {
  await main();
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
  console.error(`FALHA: ${error.message}`);
} finally {
  if (stackStopped) {
    try { compose(['up', '-d', '--wait', '--wait-timeout', '120']); }
    catch (error) { console.error(`Falha ao restaurar a stack: ${error.message}`); }
  }
  evidence.cleanup = [];
  for (const account of accounts) {
    try {
      // Nomes gerados localmente e IDs validados; nunca usa dados digitados pelo usuário.
      const output = sql(`DELETE FROM users WHERE id = '${account.id}' AND username = '${account.username}' RETURNING id;`);
      assert.ok(output.includes(account.id), 'A conta criada pelo teste deve ser removida');
      evidence.cleanup.push({ username: account.username, removed: true });
      expectStatus(await request('/api/auth/me', { token: account.token }), 401, 'Token de conta removida');
      console.log(`Limpeza: ${account.username} e suas tarefas removidas; token revogado.`);
    } catch (error) {
      process.exitCode = 1;
      evidence.success = false;
      evidence.cleanup.push({ username: account.username, removed: false, error: error.message });
      console.error(`Limpeza falhou para ${account.username}: ${error.message}`);
    }
  }
  evidence.finishedAt = new Date().toISOString();
  await mkdir(join(projectRoot, '.artifacts'), { recursive: true });
  await writeFile(join(projectRoot, '.artifacts/registration-result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`${evidence.success ? 'Sucesso' : 'Falha'}: ${evidence.checks.length} verificações de cadastro. Relatório sem tokens em .artifacts/registration-result.json`);
}
