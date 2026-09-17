import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from './password.js';

const taskColumns = 'id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt"';

export function createDatabase() {
  // O pg lê PGHOST, PGPORT, PGDATABASE, PGUSER e PGPASSWORD do ambiente.
  const pool = new Pool({
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
  });
  pool.on('error', (error) => console.error('Conexão ociosa com o banco falhou:', error.message));

  return {
    async initialize() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serializa a inicialização se duas instâncias iniciarem simultaneamente.
        await client.query('SELECT pg_advisory_xact_lock(271828)');
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            username VARCHAR(80) NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS tasks (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(120) NOT NULL CHECK (char_length(trim(title)) > 0),
            description VARCHAR(2000) NOT NULL DEFAULT '',
            status VARCHAR(10) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS tasks_user_created_idx ON tasks(user_id, created_at DESC);
        `);
        const existing = await client.query('SELECT id FROM users WHERE username = $1', ['admin']);
        if (!existing.rowCount) {
          await client.query(
            'INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
            [randomUUID(), 'admin', await hashPassword('admin')],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async health() {
      await pool.query('SELECT 1');
    },

    async findUserByUsername(username) {
      const { rows } = await pool.query(
        'SELECT id, username, password_hash AS "passwordHash" FROM users WHERE username = $1',
        [username],
      );
      return rows[0];
    },

    async findUserById(id) {
      const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [id]);
      return rows[0];
    },

    async createUser(username, passwordHash) {
      // A restrição UNIQUE decide o conflito atomicamente, inclusive em cadastros simultâneos.
      const { rows } = await pool.query(
        'INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING RETURNING id, username',
        [randomUUID(), username, passwordHash],
      );
      return rows[0];
    },

    async listTasks(userId) {
      const { rows } = await pool.query(
        `SELECT ${taskColumns} FROM tasks WHERE user_id = $1 ORDER BY created_at DESC, id`,
        [userId],
      );
      return rows;
    },

    async createTask(userId, task) {
      const { rows } = await pool.query(
        `INSERT INTO tasks (id, user_id, title, description, status) VALUES ($1, $2, $3, $4, $5) RETURNING ${taskColumns}`,
        [randomUUID(), userId, task.title, task.description, task.status],
      );
      return rows[0];
    },

    async updateTask(userId, id, patch) {
      // A whitelist vem de validateTask; os nomes de coluna nunca vêm da requisição.
      const fields = ['title', 'description', 'status'].filter((field) => Object.hasOwn(patch, field));
      const values = [userId, id, ...fields.map((field) => patch[field])];
      const assignments = fields.map((field, index) => `${field} = $${index + 3}`);
      const { rows } = await pool.query(
        `UPDATE tasks SET ${assignments.join(', ')}, updated_at = NOW() WHERE user_id = $1 AND id = $2 RETURNING ${taskColumns}`,
        values,
      );
      return rows[0];
    },

    async deleteTask(userId, id) {
      const { rowCount } = await pool.query('DELETE FROM tasks WHERE user_id = $1 AND id = $2', [userId, id]);
      return rowCount > 0;
    },

    close() {
      return pool.end();
    },
  };
}
