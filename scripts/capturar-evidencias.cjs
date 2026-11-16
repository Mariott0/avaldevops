// Requer Playwright: npm install --prefix <pasta-temporaria> playwright
// Informe o caminho do modulo em PLAYWRIGHT_MODULE, se nao estiver instalado localmente.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'evidencias');
fs.mkdirSync(out, { recursive: true });
function run(args, expected = 0, input) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', input, windowsHide: true, timeout: 180000 });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return { command: `docker ${args.join(' ')}`, exitCode: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
const escape = s => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const report = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const capturedAt = new Date().toISOString();
    async function capture(name, title, records) {
      fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ capturedAt, records }, null, 2));
      const text = records.map(r => `> ${r.command}\n${r.stdout}${r.stderr ? '\n' + r.stderr : ''}\nExit code: ${r.exitCode}`).join('\n\n');
      fs.writeFileSync(path.join(out, name + '.log'), `Capturado em: ${capturedAt}\n${text}\n`);
      const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:48px;background:#f3f6fa;color:#142033;font:18px system-ui}h1{font-size:30px}p{color:#48566a}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;border:1px solid #bcc9da;border-radius:12px;padding:28px;font:19px/1.65 Consolas,monospace}</style><h1>${escape(title)}</h1><p>Registro de execução real em Docker · ${escape(capturedAt)}</p><pre>${escape(text)}</pre><p>Imagem do relatório de stdout/stderr capturados. Os arquivos .log e .json acompanham esta imagem.</p>`;
      fs.writeFileSync(path.join(out, name + '.html'), html);
      await report.setContent(html);
      await report.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
    }
    const lint = run(['run', '--rm', '-i', 'hadolint/hadolint'], 0, fs.readFileSync(path.join(root, 'api/Dockerfile')));
    lint.command += ' < api/Dockerfile';
    assert.equal(lint.stdout + lint.stderr, '');
    await capture('00-hadolint-docker', 'Quality gate — Hadolint aprovado', [lint]);
    const whoami = run(['exec', 'backend_api', 'whoami']);
    assert.equal(whoami.stdout, 'appuser');
    await capture('01-usuario', 'Execução sem privilégios de root', [whoami, run(['exec', 'backend_api', 'id'])]);
    const denied = run(['exec', 'backend_api', 'touch', '/teste.txt'], 1);
    assert.match(denied.stderr, /Read-only file system/);
    await capture('02-read-only', 'Raiz somente leitura — escrita negada', [denied]);

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto('http://localhost:8080');
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('admin');
    await page.locator('#login-submit').click();
    await page.locator('#new-task').waitFor({ state: 'visible' });
    const title = 'Hardening validado pelo frontend - ' + new Date().toISOString().slice(0, 19);
    await page.locator('#new-task').click();
    await page.locator('#task-title').fill(title);
    await page.locator('#task-description').fill('Criada pelo formulario com API non-root e raiz read-only. Deve sobreviver a recriacao dos containers.');
    await page.locator('#task-status').selectOption('doing');
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/tasks') && r.request().method() === 'POST');
    await page.locator('#task-submit').click();
    const response = await responsePromise;
    assert.equal(response.status(), 201);
    const saved = (await response.json()).task;
    await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    await page.locator('#doing-tasks').getByText(title, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, '03-frontend-gravacao.png'), fullPage: true });
    const query = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/app.db',{readOnly:true});console.log(JSON.stringify(db.prepare('SELECT id,title,status FROM tasks WHERE id = ?').get(${JSON.stringify(saved.id)})));db.close()`;
    const before = run(['inspect', '--format', '{{.Id}}', 'backend_api']);
    const beforeDb = run(['exec', 'backend_api', 'node', '-e', query]);
    assert.equal(JSON.parse(beforeDb.stdout).id, saved.id);
    run(['compose', 'up', '-d', '--force-recreate', '--wait']);
    const after = run(['inspect', '--format', '{{.Id}}', 'backend_api']);
    assert.notEqual(before.stdout, after.stdout);
    const afterDb = run(['exec', 'backend_api', 'node', '-e', query]);
    assert.deepEqual(JSON.parse(afterDb.stdout), JSON.parse(beforeDb.stdout));
    await page.reload();
    await page.locator('#doing-tasks').getByText(title, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, '04-frontend-apos-recriar.png'), fullPage: true });
    await capture('05-sqlite-persistencia', 'SQLite — registro preservado após recriação', [before, after, run(['exec', 'backend_api', 'ls', '-ln', '/app/data/app.db']), afterDb]);
    fs.writeFileSync(path.join(out, 'frontend-persistencia.json'), JSON.stringify({ capturedAt, url: 'http://localhost:8080', method: 'Formulario real via navegador Chromium', httpStatus: response.status(), task: saved, containerBefore: before.stdout, containerAfter: after.stdout, sqliteAfter: JSON.parse(afterDb.stdout), visibleAfterRecreation: true }, null, 2));
    console.log('PASS: Hadolint, usuario, read-only, formulario real, SQLite e persistencia. Imagens em evidencias/.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
