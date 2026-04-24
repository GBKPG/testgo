import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'qa-lite.sqlite');
const isPostgres = Boolean(process.env.DATABASE_URL);

export const db = isPostgres ? createPostgresDb() : await createSqliteDb();

async function createSqliteDb() {
  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return {
    dialect: 'sqlite',
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: async (...params) => statement.get(...params),
        all: async (...params) => statement.all(...params),
        run: async (...params) => statement.run(...params)
      };
    },
    exec: async (sql) => sqlite.exec(sql),
    raw: sqlite
  };
}

function createPostgresDb() {
  const pool = new Pool({
    connectionString: normalizedDatabaseUrl(process.env.DATABASE_URL),
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 3)
  });

  return {
    dialect: 'postgres',
    prepare(sql) {
      return {
        get: async (...params) => {
          const result = await pool.query(toPostgresSql(sql), params);
          return result.rows[0];
        },
        all: async (...params) => {
          const result = await pool.query(toPostgresSql(sql), params);
          return result.rows;
        },
        run: async (...params) => {
          const query = appendReturningId(toPostgresSql(sql));
          const result = await pool.query(query, params);
          return {
            changes: result.rowCount,
            lastInsertRowid: result.rows[0]?.id
          };
        }
      };
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    pool
  };
}

function normalizedDatabaseUrl(value) {
  if (!value) return value;
  const url = new URL(value);
  url.searchParams.delete('sslmode');
  return url.toString();
}

function toPostgresSql(sql) {
  let index = 0;
  return sql
    .replace(/\bIS\s+\?/gi, 'IS NOT DISTINCT FROM ?')
    .replace(/\?/g, () => `$${++index}`);
}

function appendReturningId(sql) {
  const trimmed = sql.trim();
  if (!/^insert\s+/i.test(trimmed) || /\breturning\b/i.test(trimmed)) return sql;
  return `${trimmed} RETURNING id`;
}

export async function migrate() {
  if (db.dialect === 'postgres') {
    return;
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin','Tester')),
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'A',
      color TEXT NOT NULL DEFAULT '#1d4ed8',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      documentation TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS test_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL DEFAULT '',
      expected_result TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_case_id INTEGER REFERENCES test_cases(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('AÃ§Ä±k','Devam Ediyor','Ã‡Ã¶zÃ¼ldÃ¼','KapalÄ±','Test BaÅŸarÄ±sÄ±z')),
      priority TEXT CHECK(priority IN ('DÃ¼ÅŸÃ¼k','Orta','YÃ¼ksek') OR priority IS NULL),
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      url TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Note',
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_cases_folder ON test_cases(folder_id);
    CREATE INDEX IF NOT EXISTS idx_findings_case ON findings(test_case_id);
    CREATE INDEX IF NOT EXISTS idx_session_logs_finding ON session_logs(finding_id);
  `);

  await ensureColumn('folders', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE CASCADE');
  await ensureColumn('test_cases', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE CASCADE');
  await ensureColumn('findings', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE CASCADE');
  await ensureColumn('findings', 'configuration', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('findings', 'assigned_to', 'INTEGER REFERENCES users(id)');
  await ensureColumn('attachments', 'log_id', 'INTEGER');

  const count = (await db.prepare('SELECT COUNT(*) as total FROM users').get()).total;
  if (count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.prepare(`
      INSERT INTO users (email, password_hash, role, name)
      VALUES (?, ?, 'Admin', 'Admin User')
    `).run('admin@local.test', hash);
  }

  const projectCount = (await db.prepare('SELECT COUNT(*) as total FROM projects').get()).total;
  if (projectCount === 0) {
    const admin = await db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1').get('Admin');
    const result = await db.prepare(`
      INSERT INTO projects (name, icon, color, documentation, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'KoÃ§Ailem',
      'ðŸŽ®',
      '#0ea5e9',
      'ABOUT KOÃ‡AILEM\n\nKoÃ§Ailem Linkler:\n\nDev site: https://preprodnewsite.kocailem.com/\nDev panel: https://test.kocailem.com/Admin/CMSAdministration.aspx\nDev swagger: https://test-mobil-api.kocailem.com/swagger/ui/index\n\nPreprod site: https://preprodweb.kocailem.com/\nPreprod panel: https://preprod.kocailem.com/Admin/CMSAdministration.aspx\n\nCanlÄ± site: https://www.kocailem.com/',
      admin?.id ?? null,
      admin?.id ?? null
    );
    await db.prepare('UPDATE folders SET project_id = ? WHERE project_id IS NULL').run(result.lastInsertRowid);
    await db.prepare('UPDATE test_cases SET project_id = ? WHERE project_id IS NULL').run(result.lastInsertRowid);
    await db.prepare('UPDATE findings SET project_id = ? WHERE project_id IS NULL').run(result.lastInsertRowid);
  }

  const fallbackProject = await db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get();
  if (fallbackProject) {
    await db.prepare('UPDATE folders SET project_id = ? WHERE project_id IS NULL').run(fallbackProject.id);
    await db.prepare('UPDATE test_cases SET project_id = ? WHERE project_id IS NULL').run(fallbackProject.id);
    await db.prepare('UPDATE findings SET project_id = ? WHERE project_id IS NULL').run(fallbackProject.id);
  }
}

export function nowSql() {
  return new Date().toISOString();
}

async function ensureColumn(table, column, definition) {
  const columns = await db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
