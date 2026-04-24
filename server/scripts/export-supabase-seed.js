import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');
const dbPath = path.join(serverRoot, 'data', 'qa-lite.sqlite');
const uploadDir = path.join(serverRoot, 'uploads');
const outDir = path.join(serverRoot, 'supabase', 'out');

const tableSpecs = [
  { name: 'users', columns: ['id', 'email', 'password_hash', 'role', 'name', 'active', 'created_at', 'updated_at'], booleanColumns: ['active'] },
  { name: 'projects', columns: ['id', 'name', 'icon', 'color', 'status', 'documentation', 'created_by', 'updated_by', 'created_at', 'updated_at'] },
  { name: 'folders', columns: ['id', 'project_id', 'name', 'parent_id', 'position', 'created_by', 'updated_by', 'created_at', 'updated_at'] },
  { name: 'test_cases', columns: ['id', 'project_id', 'folder_id', 'title', 'description', 'steps', 'expected_result', 'position', 'created_by', 'updated_by', 'created_at', 'updated_at'] },
  { name: 'findings', columns: ['id', 'project_id', 'test_case_id', 'title', 'description', 'status', 'priority', 'configuration', 'assigned_to', 'created_by', 'updated_by', 'created_at', 'updated_at'] },
  { name: 'comments', columns: ['id', 'finding_id', 'body', 'created_by', 'created_at'] },
  { name: 'session_logs', columns: ['id', 'finding_id', 'body', 'status', 'created_by', 'updated_by', 'created_at', 'updated_at'] },
  { name: 'attachments', columns: ['id', 'finding_id', 'log_id', 'filename', 'original_name', 'mime_type', 'size', 'url', 'uploaded_by', 'created_at'] }
];

fs.mkdirSync(outDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });

const sql = [];
sql.push('-- Generated from local SQLite data for Supabase import');
sql.push('begin;');
sql.push('');
sql.push('truncate table attachments, session_logs, comments, findings, test_cases, folders, projects, users restart identity cascade;');
sql.push('');

for (const spec of tableSpecs) {
  const rows = db.prepare(`select ${spec.columns.join(', ')} from ${spec.name} order by id asc`).all();
  if (!rows.length) continue;
  const booleanColumns = new Set(spec.booleanColumns || []);
  const values = rows.map((row) => `  (${spec.columns.map((column) => sqlLiteral(row[column], booleanColumns.has(column))).join(', ')})`);
  sql.push(`insert into ${spec.name} (${spec.columns.join(', ')}) values`);
  sql.push(values.join(',\n'));
  sql.push('on conflict do nothing;');
  sql.push('');
}

for (const spec of tableSpecs) {
  sql.push(`select setval(pg_get_serial_sequence('${spec.name}', 'id'), coalesce((select max(id) from ${spec.name}), 1), (select coalesce(max(id), 0) > 0 from ${spec.name}));`);
}

sql.push('');
sql.push('commit;');
sql.push('');

const attachments = db.prepare('select id, finding_id, log_id, filename, original_name, mime_type, size, url, created_at from attachments order by id asc').all();
const uploadsManifest = attachments.map((item) => ({
  ...item,
  local_path: path.join(uploadDir, item.filename),
  exists: fs.existsSync(path.join(uploadDir, item.filename))
}));

fs.writeFileSync(path.join(outDir, 'seed.sql'), sql.join('\n'), 'utf8');
fs.writeFileSync(path.join(outDir, 'uploads-manifest.json'), JSON.stringify(uploadsManifest, null, 2), 'utf8');

console.log(`Supabase seed exported: ${path.join(outDir, 'seed.sql')}`);
console.log(`Uploads manifest exported: ${path.join(outDir, 'uploads-manifest.json')}`);
console.log(`Rows exported: ${tableSpecs.map((spec) => `${spec.name}`).join(', ')}`);

function sqlLiteral(value, forceBoolean = false) {
  if (value === null || value === undefined) return 'null';
  if (forceBoolean) return Number(value) ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Buffer.isBuffer(value)) return `decode('${value.toString('hex')}', 'hex')`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
