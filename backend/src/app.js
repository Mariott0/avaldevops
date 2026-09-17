import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { hashPassword, verifyPassword } from './password.js';
import { UUID_PATTERN, USERNAME_PATTERN, ValidationError, validateLogin, validateRegistration, validateTask } from './validation.js';

export const TOKEN_SETTINGS = {
  algorithm: 'HS256',
  issuer: 'kanban-api',
  audience: 'kanban-web',
  expiresIn: 7200,
};

export function createApp({ database, jwtSecret, loginLimit = 10, registrationLimit = 30 }) {
  if (typeof jwtSecret !== 'string' || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET é obrigatório e deve ter pelo menos 32 caracteres.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Uma camada de proxy: o Nginx do frontend.
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await database.health();
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ error: 'Banco de dados indisponível.' });
    }
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  });

  function createSession(user) {
    const token = jwt.sign({ username: user.username }, jwtSecret, {
      ...TOKEN_SETTINGS,
      subject: user.id,
    });
    return { token, user: { username: user.username }, expiresIn: TOKEN_SETTINGS.expiresIn };
  }

  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = validateLogin(req.body);
    const user = await database.findUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    return res.json(createSession(user));
  });

  const registrationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: registrationLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de cadastro. Tente novamente em 15 minutos.' },
  });

  app.post('/api/auth/register', registrationLimiter, async (req, res) => {
    const { username, password } = validateRegistration(req.body);
    const user = await database.createUser(username, await hashPassword(password));
    if (!user) return res.status(409).json({ error: 'Este usuário já está em uso. Escolha outro nome.' });
    return res.status(201).json(createSession(user));
  });

  async function authenticate(req, res, next) {
    const authorization = req.get('authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Autenticação necessária. Faça login.' });
    }
    let payload;
    try {
      payload = jwt.verify(match[1], jwtSecret, {
        algorithms: [TOKEN_SETTINGS.algorithm],
        issuer: TOKEN_SETTINGS.issuer,
        audience: TOKEN_SETTINGS.audience,
      });
      if (typeof payload !== 'object' || !UUID_PATTERN.test(payload.sub ?? '')
        || typeof payload.username !== 'string' || !USERNAME_PATTERN.test(payload.username)
        || !Number.isInteger(payload.exp)) {
        throw new Error('Payload inválido.');
      }
    } catch {
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
    const user = await database.findUserById(payload.sub);
    if (!user || user.username !== payload.username) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
    req.userId = user.id;
    req.user = user;
    return next();
  }

  app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({ user: { username: req.user.username } });
  });
  app.use('/api/tasks', authenticate);

  app.get('/api/tasks', async (req, res) => {
    res.json({ tasks: await database.listTasks(req.userId) });
  });

  app.post('/api/tasks', async (req, res) => {
    const task = await database.createTask(req.userId, validateTask(req.body));
    res.status(201).json({ task });
  });

  app.param('id', (_req, _res, next, id) => {
    if (!UUID_PATTERN.test(id)) return next(new ValidationError('Identificador de tarefa inválido.'));
    return next();
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    const task = await database.updateTask(req.userId, req.params.id, validateTask(req.body, { partial: true }));
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    return res.json({ task });
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    if (!(await database.deleteTask(req.userId, req.params.id))) {
      return res.status(404).json({ error: 'Tarefa não encontrada.' });
    }
    return res.status(204).end();
  });

  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use((error, _req, res, _next) => {
    if (error instanceof ValidationError || error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: error instanceof ValidationError ? error.message : 'JSON inválido.' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'O conteúdo enviado é muito grande.' });
    }
    console.error('Erro ao processar a requisição:', error.message);
    return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
  });
  return app;
}
