import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../frontend/theme.js', import.meta.url), 'utf8');

// Exercita o script real sem browser/dependências, simulando apenas APIs do ambiente.
function environment({ stored = null, systemDark = false, storageBlocked = false } = {}) {
  const handlers = {};
  const buttons = Array.from({ length: 2 }, () => ({
    attributes: {}, label: {}, icon: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelector(selector) { return selector.includes('label') ? this.label : this.icon; },
  }));
  const root = { dataset: {} };
  const meta = { setAttribute(key, value) { this[key] = value; } };
  const system = { matches: systemDark, addEventListener(_name, callback) { handlers.system = callback; } };
  const storage = new Map(stored === null ? [] : [['em-dia.theme', stored]]);
  runInNewContext(source, {
    document: {
      documentElement: root,
      querySelector: () => meta,
      querySelectorAll: () => buttons,
      addEventListener: (name, callback) => { handlers[name] = callback; },
    },
    window: {
      matchMedia: () => system,
      addEventListener: (name, callback) => { handlers[name] = callback; },
    },
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('Storage bloqueado'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error('Storage bloqueado'); storage.set(key, value); },
    },
  });
  return { root, buttons, storage, system, handlers, meta,
    toggle: () => handlers.click({ target: { closest: () => buttons[0] } }),
  };
}

test('segue o sistema e aplica o tema antes do DOMContentLoaded', () => {
  assert.equal(environment().root.dataset.theme, 'light');
  assert.equal(environment({ systemDark: true }).root.dataset.theme, 'dark');
  assert.equal(environment({ stored: 'inválido', systemDark: true }).root.dataset.theme, 'dark');
});

test('preferência salva prevalece sobre o sistema ao recarregar', () => {
  assert.equal(environment({ stored: 'light', systemDark: true }).root.dataset.theme, 'light');
  assert.equal(environment({ stored: 'dark', systemDark: false }).root.dataset.theme, 'dark');
});

test('alterna e salva o tema, sincronizando botões e estado acessível', () => {
  const page = environment();
  page.toggle();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.storage.get('em-dia.theme'), 'dark');
  for (const button of page.buttons) {
    assert.equal(button.attributes['aria-pressed'], 'true');
    assert.equal(button.attributes['aria-label'], 'Tema escuro');
    assert.equal(button.label.textContent, 'Tema escuro');
    assert.equal(button.title, 'Ativar tema claro');
  }
  page.toggle();
  assert.equal(page.root.dataset.theme, 'light');
  assert.equal(page.storage.get('em-dia.theme'), 'light');
  assert.ok(page.buttons.every((button) => button.attributes['aria-pressed'] === 'false'));
});

test('armazenamento bloqueado não impede trocar o tema', () => {
  const page = environment({ storageBlocked: true });
  page.toggle();
  assert.equal(page.root.dataset.theme, 'dark');
  page.toggle();
  assert.equal(page.root.dataset.theme, 'light');
});

test('mudanças do sistema são seguidas até o usuário fazer sua escolha', () => {
  const page = environment();
  page.system.matches = true;
  page.handlers.system();
  assert.equal(page.root.dataset.theme, 'dark');
  page.toggle();
  page.handlers.system();
  assert.equal(page.root.dataset.theme, 'light');
});

test('sincroniza outras abas e volta ao sistema quando a preferência é removida', () => {
  const page = environment({ stored: 'light', systemDark: true });
  page.handlers.storage({ key: 'em-dia.theme', newValue: 'dark' });
  assert.equal(page.root.dataset.theme, 'dark');
  page.handlers.storage({ key: 'outra-chave', newValue: 'light' });
  assert.equal(page.root.dataset.theme, 'dark');
  page.handlers.storage({ key: 'em-dia.theme', newValue: null });
  assert.equal(page.root.dataset.theme, 'dark');
  page.system.matches = false;
  page.handlers.system();
  assert.equal(page.root.dataset.theme, 'light');
});
