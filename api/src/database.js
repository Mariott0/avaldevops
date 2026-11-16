import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './password.js';

const columns = 'id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt"';

export function createDatabase(path = process.env.DB_PATH || '/app/data/app.db') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return {
    async initialize() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
          description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
          status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tasks_user_created_idx ON tasks(user_id, created_at DESC);
      `);
      if (!db.prepare('SELECT id FROM users WHERE username = ?').get('admin')) {
        db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?) ON CONFLICT (username) DO NOTHING')
          .run(randomUUID(), 'admin', await hashPassword('admin'));
      }
    },
    async health() { db.prepare('SELECT 1').get(); },
    async findUserByUsername(username) {
      return db.prepare('SELECT id, username, password_hash AS "passwordHash" FROM users WHERE username = ?').get(username);
    },
    async findUserById(id) {
      return db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
    },
    async createUser(username, passwordHash) {
      return db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?) ON CONFLICT (username) DO NOTHING RETURNING id, username')
        .get(randomUUID(), username, passwordHash);
    },
    async listTasks(userId) {
      return db.prepare(`SELECT ${columns} FROM tasks WHERE user_id = ? ORDER BY created_at DESC, id`).all(userId);
    },
    async createTask(userId, task) {
      const now = new Date().toISOString();
      return db.prepare(`INSERT INTO tasks (id, user_id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
        .get(randomUUID(), userId, task.title, task.description, task.status, now, now);
    },
    async updateTask(userId, id, patch) {
      const fields = ['title', 'description', 'status'].filter(field => Object.hasOwn(patch, field));
      if (!fields.length) return db.prepare(`SELECT ${columns} FROM tasks WHERE user_id = ? AND id = ?`).get(userId, id);
      return db.prepare(`UPDATE tasks SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE user_id = ? AND id = ? RETURNING ${columns}`)
        .get(...fields.map(field => patch[field]), new Date().toISOString(), userId, id);
    },
    async deleteTask(userId, id) {
      return db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
    },
    async close() { db.close(); },
  };
}
