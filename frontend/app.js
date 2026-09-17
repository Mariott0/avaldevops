'use strict';

(() => {
  const TOKEN_KEY = 'em-dia.token';
  const STATUS = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' };
  const EMPTY = {
    todo: ['Tudo pronto para começar', 'Crie uma tarefa e dê o primeiro passo.', '+'],
    doing: ['Um passo de cada vez', 'Mova para cá o que está recebendo sua atenção.', '↗'],
    done: ['Suas conquistas vão morar aqui', 'Concluiu uma tarefa? Este é o lugar dela.', '✓'],
  };
  const $ = (id) => document.getElementById(id);
  const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
  let token = sessionStorage.getItem(TOKEN_KEY);
  let tasks = [];
  let sessionVersion = 0;
  let editingId = null;
  let deletingId = null;
  let draggedId = null;
  let toastTimer;
  let loadingSession = null;
  let tasksRevision = 0;
  let authBusy = false;
  const pendingIds = new Set();

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function setMessage(element, message = '') {
    element.textContent = message;
    element.hidden = !message;
  }

  function notify(message, error = false) {
    window.clearTimeout(toastTimer);
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('toast-error', error);
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4500);
  }

  function showLogin(message = '') {
    sessionVersion += 1;
    token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    tasks = [];
    pendingIds.clear();
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    $('app-view').hidden = true;
    $('login-view').hidden = false;
    $('password').value = '';
    $('register-password').value = '';
    $('register-confirm-password').value = '';
    $('session-username').textContent = '';
    $('session-avatar').textContent = '';
    $('toast').hidden = true;
    showAuthMode(false);
    setMessage($('login-error'), message);
    document.title = 'Em dia · Seu quadro de tarefas';
    $('password').focus();
  }

  function showAuthMode(register) {
    $('login-content').hidden = register;
    $('register-content').hidden = !register;
    $('auth-panel').setAttribute('aria-labelledby', register ? 'register-title' : 'login-title');
    setMessage($('login-error'));
    setMessage($('register-error'));
    $('password').value = '';
    $('register-password').value = '';
    $('register-confirm-password').value = '';
    $(register ? 'register-username' : 'username').focus();
  }

  function showUser(user) {
    if (typeof user?.username !== 'string' || !user.username) {
      throw new Error('Não foi possível identificar sua conta. Entre novamente.');
    }
    $('session-username').textContent = user.username;
    $('session-avatar').textContent = user.username[0].toUpperCase();
  }

  function setAuthPending(pending) {
    authBusy = pending;
    setFormPending($('login-form'), pending);
    setFormPending($('register-form'), pending);
  }

  async function startSession(data) {
    if (typeof data.token !== 'string' || !data.token) {
      throw new Error('Não foi possível iniciar a sessão. Tente entrar novamente.');
    }
    showUser(data.user);
    sessionStorage.setItem(TOKEN_KEY, data.token);
    token = data.token;
    sessionVersion += 1;
    tasks = [];
    pendingIds.clear();
    $('password').value = '';
    $('register-form').reset();
    showBoard();
    await loadTasks();
  }

  async function restoreSession() {
    const version = sessionVersion;
    setAuthPending(true);
    $('auth-loading').hidden = false;
    try {
      const data = await request('/auth/me');
      if (version !== sessionVersion) return;
      showUser(data.user);
      showBoard();
      await loadTasks();
    } catch (error) {
      if (version === sessionVersion) showLogin(error.message);
    } finally {
      $('auth-loading').hidden = true;
      setAuthPending(false);
    }
  }

  function showBoard() {
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    document.title = 'Meu quadro · Em dia';
    renderTasks();
    $('board-title').focus({ preventScroll: true });
  }

  async function request(path, options = {}, authenticated = true) {
    const requestVersion = sessionVersion;
    const headers = { Accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let response;
    let data = null;
    try {
      response = await fetch(`/api${path}`, { ...options, headers, cache: 'no-store', signal: controller.signal });
      if (response.status !== 204) {
        try { data = await response.json(); } catch (error) {
          // An unavailable proxy may send a non-JSON response.
          if (error.name === 'AbortError') throw error;
        }
      }
    } catch (error) {
      throw new ApiError(error.name === 'AbortError'
        ? 'O servidor demorou para responder. Atualize o quadro antes de tentar novamente.'
        : 'Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.', 0);
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) {
      if (response.status === 401 && authenticated && requestVersion === sessionVersion) {
        showLogin('Sua sessão expirou. Entre novamente para continuar.');
      }
      throw new ApiError(data?.error || 'Não foi possível concluir a operação. Tente novamente.', response.status);
    }
    if (response.status !== 204 && data === null) {
      throw new ApiError('O servidor retornou uma resposta inesperada. Tente novamente.', response.status);
    }
    return data;
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function iconButton(kind, task) {
    const label = kind === 'edit' ? 'Editar' : 'Excluir';
    const button = element('button', `icon-button ${kind}-task`);
    button.type = 'button';
    button.setAttribute('aria-label', `${label} tarefa: ${task.title}`);
    button.title = `${label} tarefa`;
    button.disabled = pendingIds.has(task.id);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', kind === 'edit'
      ? 'M15 5l4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5z'
      : 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5');
    svg.append(path);
    button.append(svg);
    button.addEventListener('click', () => kind === 'edit' ? openTaskDialog(task) : openDeleteDialog(task));
    return button;
  }

  function taskCard(task) {
    const card = element('article', 'task-card');
    card.setAttribute('role', 'listitem');
    card.dataset.id = task.id;
    card.draggable = !pendingIds.has(task.id);
    card.classList.toggle('pending', pendingIds.has(task.id));
    card.setAttribute('aria-busy', String(pendingIds.has(task.id)));
    const heading = element('h3', '', task.title);
    card.append(heading);
    if (task.description) card.append(element('p', 'task-description', task.description));
    const created = new Date(task.createdAt);
    if (!Number.isNaN(created.getTime())) {
      const date = element('time', 'task-date', `Criada em ${dateFormat.format(created)}`);
      date.dateTime = task.createdAt;
      date.title = created.toLocaleString('pt-BR');
      card.append(date);
    }
    const footer = element('div', 'task-card-footer');
    const select = element('select', 'task-status');
    select.setAttribute('aria-label', `Etapa da tarefa: ${task.title}`);
    select.disabled = pendingIds.has(task.id);
    Object.entries(STATUS).forEach(([value, label]) => {
      const option = element('option', '', label);
      option.value = value;
      select.append(option);
    });
    select.value = task.status;
    select.addEventListener('change', () => moveTask(task.id, select.value, true));
    const actions = element('div', 'task-actions');
    actions.append(iconButton('edit', task), iconButton('delete', task));
    footer.append(select, actions);
    card.append(footer);
    card.addEventListener('dragstart', (event) => {
      if (event.target.closest('button, select') || pendingIds.has(task.id)) {
        event.preventDefault();
        return;
      }
      draggedId = task.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', task.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      draggedId = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach((column) => column.classList.remove('drag-over'));
    });
    return card;
  }

  function renderTasks() {
    Object.keys(STATUS).forEach((status) => {
      const list = $(`${status}-tasks`);
      list.replaceChildren();
      const filtered = tasks.filter((task) => task.status === status);
      $(status === 'done' ? 'done-column-count' : `${status}-count`).textContent = String(filtered.length);
      filtered.forEach((task) => list.append(taskCard(task)));
      if (filtered.length === 0) {
        const empty = element('div', 'empty-column');
        empty.setAttribute('role', 'listitem');
        const symbol = element('span', 'empty-symbol', EMPTY[status][2]);
        symbol.setAttribute('aria-hidden', 'true');
        empty.append(symbol, element('h3', '', EMPTY[status][0]), element('p', '', EMPTY[status][1]));
        list.append(empty);
      }
    });
    const done = tasks.filter((task) => task.status === 'done').length;
    const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    $('total-count').textContent = String(tasks.length);
    $('done-count').textContent = String(done);
    $('progress-text').textContent = `${percent}%`;
    $('board-progress').value = percent;
    $('board-progress').textContent = `${percent}%`;
  }

  async function loadTasks(announce = false) {
    if (loadingSession === sessionVersion) return;
    const version = sessionVersion;
    const revision = tasksRevision;
    loadingSession = version;
    $('refresh-tasks').disabled = true;
    $('new-task').disabled = true;
    document.querySelectorAll('.column-add').forEach((button) => { button.disabled = true; });
    $('board-loading').hidden = false;
    $('kanban-board').setAttribute('aria-busy', 'true');
    setMessage($('board-error'));
    try {
      const data = await request('/tasks');
      if (version !== sessionVersion || revision !== tasksRevision) return;
      if (!Array.isArray(data.tasks)) throw new Error('Não foi possível ler as tarefas. Tente atualizar novamente.');
      tasks = data.tasks;
      renderTasks();
      if (announce) notify('Quadro atualizado.');
    } catch (error) {
      if (version === sessionVersion && error.status !== 401) setMessage($('board-error'), error.message);
    } finally {
      if (loadingSession === version) {
        loadingSession = null;
        $('refresh-tasks').disabled = false;
        $('new-task').disabled = false;
        document.querySelectorAll('.column-add').forEach((button) => { button.disabled = false; });
        $('board-loading').hidden = true;
        $('kanban-board').setAttribute('aria-busy', 'false');
      }
    }
  }

  function openTaskDialog(task = null, initialStatus = 'todo') {
    editingId = task?.id || null;
    $('task-form').reset();
    $('task-title').value = task?.title || '';
    $('task-description').value = task?.description || '';
    $('task-status').value = task?.status || initialStatus;
    $('task-dialog-title').textContent = task ? 'Editar tarefa' : 'Nova tarefa';
    $('task-submit').textContent = task ? 'Salvar alterações' : 'Criar tarefa';
    setMessage($('task-error'));
    $('task-dialog').showModal();
    $('task-title').focus();
  }

  function openDeleteDialog(task) {
    deletingId = task.id;
    $('delete-task-name').textContent = `“${task.title}”`;
    setMessage($('delete-error'));
    $('delete-dialog').showModal();
  }

  function setFormPending(form, pending) {
    form.setAttribute('aria-busy', String(pending));
    form.querySelectorAll('button, input, textarea, select').forEach((control) => { control.disabled = pending; });
  }

  function focusTaskStatus(id) {
    const card = Array.from(document.querySelectorAll('.task-card')).find((item) => item.dataset.id === id);
    card?.querySelector('.task-status')?.focus({ preventScroll: true });
  }

  async function moveTask(id, status, restoreFocus = false) {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.status === status || pendingIds.has(id)) return;
    const version = sessionVersion;
    pendingIds.add(id);
    renderTasks();
    try {
      const data = await request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (version !== sessionVersion) return;
      tasksRevision += 1;
      tasks = tasks.map((item) => item.id === id ? data.task : item);
      notify(`Tarefa movida para ${STATUS[status]}.`);
    } catch (error) {
      if (version === sessionVersion && error.status !== 401) notify(error.message, true);
    } finally {
      pendingIds.delete(id);
      if (version === sessionVersion) {
        renderTasks();
        if (restoreFocus) focusTaskStatus(id);
      }
    }
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (authBusy) return;
    const username = $('username').value.trim().toLowerCase();
    const password = $('password').value;
    if (!username) { setMessage($('login-error'), 'Informe seu usuário.'); $('username').focus(); return; }
    setAuthPending(true);
    $('login-submit').firstElementChild.textContent = 'Entrando…';
    setMessage($('login-error'));
    try {
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
      await startSession(data);
    } catch (error) {
      setMessage($('login-error'), error.message);
    } finally {
      setAuthPending(false);
      $('login-submit').firstElementChild.textContent = 'Entrar no meu quadro';
    }
  });

  $('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (authBusy) return;
    const username = $('register-username').value.trim().toLowerCase();
    const password = $('register-password').value;
    const confirmation = $('register-confirm-password').value;
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
      setMessage($('register-error'), 'Use de 3 a 32 caracteres: letras sem acento, números, ponto, hífen ou _.');
      $('register-username').focus();
      return;
    }
    if (password.length < 8 || password.length > 200 || !password.trim()) {
      setMessage($('register-error'), 'A senha deve ter de 8 a 200 caracteres e não pode conter apenas espaços.');
      $('register-password').focus();
      return;
    }
    if (password !== confirmation) {
      setMessage($('register-error'), 'As senhas não coincidem. Confira a confirmação.');
      $('register-confirm-password').focus();
      return;
    }
    setAuthPending(true);
    $('register-submit').firstElementChild.textContent = 'Criando conta…';
    setMessage($('register-error'));
    try {
      const data = await request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
      await startSession(data);
      if (token) notify('Conta criada! Seu quadro está pronto.');
    } catch (error) {
      setMessage($('register-error'), error.message);
    } finally {
      setAuthPending(false);
      $('register-submit').firstElementChild.textContent = 'Criar minha conta';
    }
  });

  $('show-register').addEventListener('click', () => { if (!authBusy) showAuthMode(true); });
  $('show-login').addEventListener('click', () => { if (!authBusy) showAuthMode(false); });

  $('task-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = $('task-title').value.trim();
    if (!title) { setMessage($('task-error'), 'Escreva um título para a tarefa.'); $('task-title').focus(); return; }
    const values = { title, description: $('task-description').value.trim(), status: $('task-status').value };
    const id = editingId;
    const version = sessionVersion;
    setFormPending(form, true);
    $('task-submit').textContent = 'Salvando…';
    setMessage($('task-error'));
    try {
      const data = await request(id ? `/tasks/${encodeURIComponent(id)}` : '/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(values) });
      if (version !== sessionVersion) return;
      tasksRevision += 1;
      tasks = id ? tasks.map((task) => task.id === id ? data.task : task) : [data.task, ...tasks];
      renderTasks();
      $('task-dialog').close();
      notify(id ? 'Alterações salvas.' : 'Tarefa criada. Um passo a mais!');
      focusTaskStatus(data.task.id);
    } catch (error) {
      if (version === sessionVersion && error.status !== 401) setMessage($('task-error'), error.message);
    } finally {
      setFormPending(form, false);
      $('task-submit').textContent = id ? 'Salvar alterações' : 'Criar tarefa';
    }
  });

  $('delete-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = deletingId;
    const version = sessionVersion;
    setFormPending(form, true);
    $('delete-submit').textContent = 'Excluindo…';
    setMessage($('delete-error'));
    try {
      await request(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (version !== sessionVersion) return;
      tasksRevision += 1;
      tasks = tasks.filter((task) => task.id !== id);
      renderTasks();
      $('delete-dialog').close();
      notify('Tarefa excluída.');
      $('new-task').focus({ preventScroll: true });
    } catch (error) {
      if (version === sessionVersion && error.status !== 401) setMessage($('delete-error'), error.message);
    } finally {
      setFormPending(form, false);
      $('delete-submit').textContent = 'Excluir tarefa';
    }
  });

  $('logout').addEventListener('click', () => showLogin());
  $('new-task').addEventListener('click', () => openTaskDialog());
  $('refresh-tasks').addEventListener('click', () => loadTasks(true));
  document.querySelectorAll('[data-new-status]').forEach((button) => {
    button.addEventListener('click', () => openTaskDialog(null, button.dataset.newStatus));
  });
  document.querySelectorAll('.close-dialog').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('cancel', (event) => {
      if (dialog.querySelector('form').getAttribute('aria-busy') === 'true') event.preventDefault();
    });
  });
  document.querySelectorAll('.kanban-column').forEach((column) => {
    column.addEventListener('dragover', (event) => {
      if (!draggedId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      column.classList.add('drag-over');
    });
    column.addEventListener('dragleave', (event) => {
      if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over');
    });
    column.addEventListener('drop', (event) => {
      event.preventDefault();
      column.classList.remove('drag-over');
      const id = draggedId;
      draggedId = null;
      if (id) moveTask(id, column.dataset.status);
    });
  });

  if (token) {
    restoreSession();
  }
})();
