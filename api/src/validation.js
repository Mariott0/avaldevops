export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const STATUSES = ['todo', 'doing', 'done'];
export const USERNAME_PATTERN = /^[a-z0-9_.-]{3,32}$/;

export class ValidationError extends Error {}

function checkObject(body, allowedFields) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Envie um objeto JSON válido.');
  }
  if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
    throw new ValidationError('O pedido contém campos desconhecidos.');
  }
}

export function validateLogin(body) {
  checkObject(body, ['username', 'password']);
  if (typeof body.username !== 'string' || !body.username.length || body.username.length > 80
    || typeof body.password !== 'string' || !body.password.length || body.password.length > 200) {
    throw new ValidationError('Informe usuário e senha válidos.');
  }
  return { username: body.username.trim().toLowerCase(), password: body.password };
}

export function validateRegistration(body) {
  const { username, password } = validateLogin(body);
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError('O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.');
  }
  if (password.length < 8 || !password.trim()) {
    throw new ValidationError('A senha deve ter de 8 a 200 caracteres e não pode conter apenas espaços.');
  }
  return { username, password };
}

export function validateTask(body, { partial = false } = {}) {
  checkObject(body, ['title', 'description', 'status']);
  if (partial && Object.keys(body).length === 0) {
    throw new ValidationError('Informe ao menos um campo para atualizar.');
  }

  const task = {};
  if (!partial || Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) {
      throw new ValidationError('O título deve ter entre 1 e 120 caracteres.');
    }
    task.title = body.title.trim();
  }

  if (Object.hasOwn(body, 'description')) {
    if (typeof body.description !== 'string' || body.description.length > 2000) {
      throw new ValidationError('A descrição deve ser um texto de até 2000 caracteres.');
    }
    task.description = body.description.trim();
  } else if (!partial) {
    task.description = '';
  }

  if (Object.hasOwn(body, 'status')) {
    if (!STATUSES.includes(body.status)) {
      throw new ValidationError('O status deve ser todo, doing ou done.');
    }
    task.status = body.status;
  } else if (!partial) {
    task.status = 'todo';
  }
  return task;
}
