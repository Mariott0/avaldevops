'use strict';

// Carregado antes do CSS: aplica a preferência antes de desenhar a página.
(() => {
  const storageKey = 'em-dia.theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = (value) => value === 'light' || value === 'dark';
  let preference = null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (valid(stored)) preference = stored;
  } catch { /* A interface continua funcionando se o armazenamento estiver bloqueado. */ }

  function render() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#101817' : '#f4f7f6');
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-label', 'Tema escuro');
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
      const label = button.querySelector('[data-theme-label]');
      const icon = button.querySelector('[data-theme-icon]');
      // Rótulo fixo de toggle: o estado ativo é anunciado por aria-pressed.
      if (label) label.textContent = 'Tema escuro';
      if (icon) icon.textContent = dark ? '☾' : '☀';
    });
  }

  render();
  document.addEventListener('DOMContentLoaded', render, { once: true });
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-theme-toggle]')) return;
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(storageKey, preference); } catch { /* Preferência mantida nesta página. */ }
    render();
  });
  system.addEventListener('change', () => { if (preference === null) render(); });
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    render();
  });
})();
