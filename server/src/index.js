import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { db, migrate, nowSql } from './db.js';
import { clearSession, issueSession, requireAdmin, requireAuth } from './auth.js';
import { expandCase, folderPath } from './paths.js';
import { excelExport, findingsExcelExport, findingsPdfExport, pdfExport } from './exporters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const port = Number(process.env.PORT || 4000);
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173,http://localhost:5173')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
if (process.env.VERCEL_URL) {
  allowedOrigins.push(`https://${process.env.VERCEL_URL}`);
}
const uploadDir = process.env.UPLOAD_DIR
  ? (path.isAbsolute(process.env.UPLOAD_DIR) ? process.env.UPLOAD_DIR : path.join(root, process.env.UPLOAD_DIR))
  : (process.env.VERCEL === '1' ? path.join('/tmp', 'qa-lite-uploads') : path.join(root, 'uploads'));
const useInlineUploads = process.env.INLINE_UPLOADS === 'true' || process.env.VERCEL === '1';
fs.mkdirSync(uploadDir, { recursive: true });

await migrate();

function safeUploadName(originalname = 'upload.bin') {
  const safe = originalname.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`;
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, safeUploadName(file.originalname))
});
const upload = multer({
  storage: useInlineUploads ? multer.memoryStorage() : storage,
  limits: { fileSize: 8 * 1024 * 1024 }
});

const app = express();
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    try {
      const { hostname } = new URL(origin);
      if (hostname.endsWith('.vercel.app')) return callback(null, true);
    } catch {
      // Fall through to the explicit rejection below.
    }
    return callback(new Error(`Origin izinli degil: ${origin}`));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadDir));

for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) => original(route, ...handlers.map(wrapAsync));
}

function wrapAsync(handler) {
  if (typeof handler !== 'function' || handler.length === 4) return handler;
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const publicUser = (user) => user && ({
  id: user.id,
  email: user.email,
  role: user.role,
  name: user.name,
  active: Boolean(user.active)
});

const colors = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b'];
const icons = ['A', 'R', 'T', 'Q', 'M', 'K', 'P', 'D'];
const sessionStatusMap = {
  New: 'A\u00E7\u0131k',
  'In Progress': 'Devam Ediyor',
  Done: 'Kapal\u0131'
};
const sessionStatusReverseMap = {
  'A\u00E7\u0131k': 'New',
  'Devam Ediyor': 'In Progress',
  '\u00C7\u00F6z\u00FCld\u00FC': 'Done',
  'Kapal\u0131': 'Done',
  'Test Ba\u015Far\u0131s\u0131z': 'Done'
};

function projectIdFrom(req) {
  return Number(req.params.projectId || req.query.project_id || req.body.project_id);
}

async function requireProject(req, res, next) {
  const projectId = projectIdFrom(req);
  if (!projectId) return res.status(400).json({ error: 'Project gerekli' });
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project bulunamadi' });
  req.project = project;
  req.projectId = projectId;
  next();
}

app.get('/api/health', async (_, res) => {
  try {
    const row = await db.prepare('SELECT COUNT(*) as total FROM users').get();
    res.json({
      ok: true,
      dbOk: true,
      dialect: db.dialect,
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      users: Number(row?.total || 0)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      dbOk: false,
      dialect: db.dialect,
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      error: error.message
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE email = ? AND active = TRUE').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Email veya şifre hatalı' });
  }
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', async (_, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.id);
  res.json({ user: publicUser(user) });
});

app.get('/api/users', requireAuth, requireAdmin, async (_, res) => {
  const users = await db.prepare('SELECT id, email, role, name, active, created_at, updated_at FROM users ORDER BY created_at DESC').all();
  res.json({ users });
});

app.get('/api/users/lookup', requireAuth, async (_, res) => {
  const users = await db.prepare('SELECT id, name, email, role FROM users WHERE active = TRUE ORDER BY name').all();
  res.json({ users });
});

app.get('/api/projects', requireAuth, async (_, res) => {
  const projects = await db.prepare(`
    SELECT p.*, c.name as created_by_name, u.name as updated_by_name
    FROM projects p
    LEFT JOIN users c ON c.id = p.created_by
    LEFT JOIN users u ON u.id = p.updated_by
    ORDER BY p.name
  `).all();
  res.json({ projects });
});

app.post('/api/projects', requireAuth, requireAdmin, async (req, res) => {
  const { name, icon, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project adi gerekli' });
  const count = (await db.prepare('SELECT COUNT(*) as total FROM projects').get()).total;
  const result = await db.prepare(`
    INSERT INTO projects (name, icon, color, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), icon || icons[count % icons.length], color || colors[count % colors.length], req.session.id, req.session.id);
  res.status(201).json({ project: await db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) });
});

app.patch('/api/projects/:projectId', requireAuth, requireAdmin, requireProject, async (req, res) => {
  const next = { ...req.project, ...req.body };
  await db.prepare(`
    UPDATE projects
    SET name = ?, icon = ?, color = ?, status = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.icon, next.color, next.status || 'ACTIVE', req.session.id, nowSql(), req.projectId);
  res.json({ project: await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.projectId) });
});

app.delete('/api/projects/:projectId', requireAuth, requireAdmin, requireProject, async (req, res) => {
  await db.prepare('DELETE FROM findings WHERE project_id = ?').run(req.projectId);
  await db.prepare('DELETE FROM test_cases WHERE project_id = ?').run(req.projectId);
  await db.prepare('DELETE FROM folders WHERE project_id = ?').run(req.projectId);
  await db.prepare('DELETE FROM projects WHERE id = ?').run(req.projectId);
  res.json({ ok: true });
});

app.get('/api/projects/:projectId/documentation', requireAuth, requireProject, async (req, res) => {
  res.json({ documentation: req.project.documentation || '' });
});

app.put('/api/projects/:projectId/documentation', requireAuth, requireProject, async (req, res) => {
  await db.prepare('UPDATE projects SET documentation = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(req.body.documentation || '', req.session.id, nowSql(), req.projectId);
  res.json({ documentation: req.body.documentation || '' });
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, role, name } = req.body;
  if (!email || !password || !['Admin', 'Tester'].includes(role)) {
    return res.status(400).json({ error: 'Email, şifre ve rol gerekli' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.prepare('INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)').run(email, hash, role, name || email);
    const user = await db.prepare('SELECT id, email, role, name, active, created_at, updated_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ user });
  } catch {
    res.status(409).json({ error: 'Bu email zaten kayıtlı' });
  }
});

app.patch('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { role, name, active, password } = req.body;
  const current = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const next = {
    role: role || current.role,
    name: name ?? current.name,
    active: active === undefined ? current.active : Boolean(active),
    password_hash: password ? bcrypt.hashSync(password, 10) : current.password_hash
  };
  await db.prepare('UPDATE users SET role = ?, name = ?, active = ?, password_hash = ?, updated_at = ? WHERE id = ?')
    .run(next.role, next.name, next.active, next.password_hash, nowSql(), req.params.id);
  const user = await db.prepare('SELECT id, email, role, name, active, created_at, updated_at FROM users WHERE id = ?').get(req.params.id);
  res.json({ user });
});

app.get('/api/folders', requireAuth, requireProject, async (req, res) => {
  const folders = await db.prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY parent_id, position, name').all(req.projectId);
  res.json({ folders: await Promise.all(folders.map(async (f) => ({ ...f, path: await folderPath(f.id, req.projectId) }))) });
});

app.post('/api/folders', requireAuth, requireProject, async (req, res) => {
  const { name, parent_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Klasör adı gerekli' });
  const max = (await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as next FROM folders WHERE parent_id IS NOT DISTINCT FROM ? AND project_id = ?').get(parent_id ?? null, req.projectId)).next;
  const result = await db.prepare('INSERT INTO folders (project_id, name, parent_id, position, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.projectId, name.trim(), parent_id ?? null, max, req.session.id, req.session.id);
  const folder = await db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ folder: { ...folder, path: await folderPath(result.lastInsertRowid, req.projectId) } });
});

app.patch('/api/folders/:id', requireAuth, requireProject, async (req, res) => {
  const current = await db.prepare('SELECT * FROM folders WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!current) return res.status(404).json({ error: 'Klasör bulunamadı' });
  const { name, parent_id, position } = req.body;
  await db.prepare('UPDATE folders SET name = ?, parent_id = ?, position = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(name ?? current.name, parent_id === undefined ? current.parent_id : parent_id, position ?? current.position, req.session.id, nowSql(), req.params.id);
  const folder = await db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  res.json({ folder: { ...folder, path: await folderPath(req.params.id, req.projectId) } });
});

app.delete('/api/folders/:id', requireAuth, requireProject, async (req, res) => {
  await db.prepare('DELETE FROM folders WHERE id = ? AND project_id = ?').run(req.params.id, req.projectId);
  res.json({ ok: true });
});

app.get('/api/test-cases', requireAuth, requireProject, async (req, res) => {
  const { folder_id, q } = req.query;
  const rows = await db.prepare(`
    SELECT tc.*, c.name as created_by_name, u.name as updated_by_name
    FROM test_cases tc
    LEFT JOIN users c ON c.id = tc.created_by
    LEFT JOIN users u ON u.id = tc.updated_by
    WHERE tc.project_id = ?
      AND (CAST(? AS bigint) IS NULL OR tc.folder_id = CAST(? AS bigint))
      AND (CAST(? AS text) IS NULL OR lower(tc.title || ' ' || tc.description || ' ' || tc.steps || ' ' || tc.expected_result) LIKE '%' || lower(CAST(? AS text)) || '%')
    ORDER BY tc.position ASC, tc.id ASC
  `).all(req.projectId, folder_id || null, folder_id || null, q || null, q || null);
  res.json({ testCases: await Promise.all(rows.map(expandCase)) });
});

app.get('/api/test-cases/:id', requireAuth, requireProject, async (req, res) => {
  const row = await db.prepare(`
    SELECT tc.*, c.name as created_by_name, u.name as updated_by_name
    FROM test_cases tc
    LEFT JOIN users c ON c.id = tc.created_by
    LEFT JOIN users u ON u.id = tc.updated_by
    WHERE tc.id = ? AND tc.project_id = ?
  `).get(req.params.id, req.projectId);
  if (!row) return res.status(404).json({ error: 'Test case bulunamadı' });
  const findings = await db.prepare(`
    SELECT f.*, c.name as created_by_name, u.name as updated_by_name
    FROM findings f
    LEFT JOIN users c ON c.id = f.created_by
    LEFT JOIN users u ON u.id = f.updated_by
    WHERE f.test_case_id = ?
    ORDER BY f.updated_at DESC
  `).all(req.params.id);
  res.json({ testCase: await expandCase(row), findings });
});

app.post('/api/test-cases', requireAuth, requireProject, async (req, res) => {
  const { folder_id, title, description, steps, expected_result } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Başlık gerekli' });
  const position = (await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as next FROM test_cases WHERE folder_id IS NOT DISTINCT FROM ? AND project_id = ?').get(folder_id ?? null, req.projectId)).next;
  const result = await db.prepare(`
    INSERT INTO test_cases (project_id, folder_id, title, description, steps, expected_result, position, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.projectId, folder_id ?? null, title.trim(), description || '', steps || '', expected_result || '', position, req.session.id, req.session.id);
  res.status(201).json({ testCase: await expandCase(await db.prepare('SELECT * FROM test_cases WHERE id = ?').get(result.lastInsertRowid)) });
});

app.patch('/api/test-cases/:id', requireAuth, requireProject, async (req, res) => {
  const current = await db.prepare('SELECT * FROM test_cases WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!current) return res.status(404).json({ error: 'Test case bulunamadı' });
  const next = { ...current, ...req.body };
  await db.prepare(`
    UPDATE test_cases
    SET folder_id = ?, title = ?, description = ?, steps = ?, expected_result = ?, position = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(next.folder_id ?? null, next.title, next.description, next.steps, next.expected_result, next.position, req.session.id, nowSql(), req.params.id);
  res.json({ testCase: await expandCase(await db.prepare('SELECT * FROM test_cases WHERE id = ?').get(req.params.id)) });
});

app.post('/api/test-cases/:id/copy', requireAuth, requireProject, async (req, res) => {
  const current = await db.prepare('SELECT * FROM test_cases WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!current) return res.status(404).json({ error: 'Test case bulunamadı' });
  const folderId = req.body.folder_id === undefined ? current.folder_id : req.body.folder_id;
  const position = (await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as next FROM test_cases WHERE folder_id IS NOT DISTINCT FROM ? AND project_id = ?').get(folderId ?? null, req.projectId)).next;
  const result = await db.prepare(`
    INSERT INTO test_cases (project_id, folder_id, title, description, steps, expected_result, position, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.projectId, folderId ?? null, `${current.title} kopya`, current.description, current.steps, current.expected_result, position, req.session.id, req.session.id);
  res.status(201).json({ testCase: await expandCase(await db.prepare('SELECT * FROM test_cases WHERE id = ?').get(result.lastInsertRowid)) });
});

app.delete('/api/test-cases/:id', requireAuth, requireProject, async (req, res) => {
  await db.prepare('DELETE FROM test_cases WHERE id = ? AND project_id = ?').run(req.params.id, req.projectId);
  res.json({ ok: true });
});

app.get('/api/findings', requireAuth, requireProject, async (req, res) => {
  const rows = await db.prepare(`
    SELECT
      f.*,
      tc.title as test_case_title,
      c.name as created_by_name,
      u.name as updated_by_name,
      a.name as assigned_to_name,
      (SELECT COUNT(*) FROM session_logs WHERE session_logs.finding_id = f.id) as comments_count,
      (SELECT COUNT(*) FROM attachments WHERE attachments.finding_id = f.id) as attachments_count
    FROM findings f
    LEFT JOIN test_cases tc ON tc.id = f.test_case_id
    LEFT JOIN users c ON c.id = f.created_by
    LEFT JOIN users u ON u.id = f.updated_by
    LEFT JOIN users a ON a.id = f.assigned_to
    WHERE f.project_id = ?
    ORDER BY f.updated_at DESC
  `).all(req.projectId);
  const findings = await Promise.all(rows.map(async (row) => {
    const logContributors = await db.prepare(`
      SELECT DISTINCT users.name as name
      FROM session_logs
      LEFT JOIN users ON users.id = session_logs.created_by
      WHERE session_logs.finding_id = ? AND users.name IS NOT NULL
      ORDER BY users.name
    `).all(row.id);
    return {
      ...row,
      contributor_names: [row.created_by_name, ...logContributors.map((contributor) => contributor.name)],
      ui_status: sessionStatusReverseMap[row.status] || 'New'
    };
  }));
  res.json({ findings });
});

app.get('/api/findings/:id', requireAuth, requireProject, async (req, res) => {
  const finding = await db.prepare(`
    SELECT f.*, tc.title as test_case_title, c.name as created_by_name, u.name as updated_by_name, a.name as assigned_to_name
    FROM findings f
    LEFT JOIN test_cases tc ON tc.id = f.test_case_id
    LEFT JOIN users c ON c.id = f.created_by
    LEFT JOIN users u ON u.id = f.updated_by
    LEFT JOIN users a ON a.id = f.assigned_to
    WHERE f.id = ? AND f.project_id = ?
  `).get(req.params.id, req.projectId);
  if (!finding) return res.status(404).json({ error: 'Bulgu bulunamadı' });
  const attachments = await db.prepare('SELECT * FROM attachments WHERE finding_id = ? AND log_id IS NULL ORDER BY created_at DESC').all(req.params.id);
  const logRows = await db.prepare(`
    SELECT
      session_logs.*,
      cu.name as created_by_name,
      uu.name as updated_by_name
    FROM session_logs
    LEFT JOIN users cu ON cu.id = session_logs.created_by
    LEFT JOIN users uu ON uu.id = session_logs.updated_by
    WHERE finding_id = ?
    ORDER BY session_logs.created_at DESC, session_logs.id DESC
  `).all(req.params.id);
  const logs = await Promise.all(logRows.map(async (log) => ({
    ...log,
    attachments: await db.prepare('SELECT * FROM attachments WHERE log_id = ? ORDER BY created_at DESC').all(log.id)
  })));
  res.json({ finding: { ...finding, ui_status: sessionStatusReverseMap[finding.status] || 'New' }, attachments, logs });
});

app.post('/api/findings', requireAuth, requireProject, async (req, res) => {
  const { test_case_id, title, description, status, priority, configuration, assigned_to } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Baslik gerekli' });
  const dbStatus = sessionStatusMap[status] || status || sessionStatusMap.New;
  const result = await db.prepare(`
    INSERT INTO findings (project_id, test_case_id, title, description, status, priority, configuration, assigned_to, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.projectId, test_case_id ?? null, title.trim(), description || '', dbStatus, priority || null, configuration || '', assigned_to ?? null, req.session.id, req.session.id);
  res.status(201).json({ finding: await db.prepare('SELECT * FROM findings WHERE id = ?').get(result.lastInsertRowid) });
});

app.patch('/api/findings/:id', requireAuth, requireProject, async (req, res) => {
  const current = await db.prepare('SELECT * FROM findings WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!current) return res.status(404).json({ error: 'Bulgu bulunamadi' });
  const next = { ...current, ...req.body };
  const dbStatus = sessionStatusMap[next.status] || next.status;
  await db.prepare(`
    UPDATE findings
    SET test_case_id = ?, title = ?, description = ?, status = ?, priority = ?, configuration = ?, assigned_to = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(next.test_case_id ?? null, next.title, next.description, dbStatus, next.priority || null, next.configuration || '', next.assigned_to ?? null, req.session.id, nowSql(), req.params.id);
  res.json({ finding: await db.prepare('SELECT * FROM findings WHERE id = ?').get(req.params.id) });
});

app.delete('/api/findings/:id', requireAuth, requireProject, async (req, res) => {
  const finding = await db.prepare('SELECT id FROM findings WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!finding) return res.status(404).json({ error: 'Bulgu bulunamadi' });
  await db.prepare('DELETE FROM findings WHERE id = ? AND project_id = ?').run(req.params.id, req.projectId);
  res.json({ ok: true });
});

app.post('/api/findings/:id/attachments', requireAuth, requireProject, upload.single('file'), async (req, res) => {
  const finding = await db.prepare('SELECT * FROM findings WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!finding || !req.file) return res.status(400).json({ error: 'Bulgu ve dosya gerekli' });
  const logId = req.body.log_id ? Number(req.body.log_id) : null;
  const filename = req.file.filename || safeUploadName(req.file.originalname);
  const url = useInlineUploads
    ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
    : `/uploads/${filename}`;
  const result = await db.prepare(`
    INSERT INTO attachments (finding_id, log_id, filename, original_name, mime_type, size, url, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, logId, filename, req.file.originalname, req.file.mimetype, req.file.size, url, req.session.id);
  res.status(201).json({ attachment: await db.prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid) });
});

app.post('/api/findings/:id/comments', requireAuth, requireProject, async (req, res) => {
  if (!req.body.body?.trim()) return res.status(400).json({ error: 'Yorum gerekli' });
  const finding = await db.prepare('SELECT id FROM findings WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!finding) return res.status(404).json({ error: 'Bulgu bulunamadi' });
  const result = await db.prepare('INSERT INTO comments (finding_id, body, created_by) VALUES (?, ?, ?)')
    .run(req.params.id, req.body.body.trim(), req.session.id);
  await db.prepare('UPDATE findings SET updated_by = ?, updated_at = ? WHERE id = ?').run(req.session.id, nowSql(), req.params.id);
  res.status(201).json({ comment: await db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid) });
});

app.post('/api/findings/:id/logs', requireAuth, requireProject, async (req, res) => {
  const finding = await db.prepare('SELECT id FROM findings WHERE id = ? AND project_id = ?').get(req.params.id, req.projectId);
  if (!finding) return res.status(404).json({ error: 'Bulgu bulunamadi' });
  if (!req.body.body?.trim()) return res.status(400).json({ error: 'Log gerekli' });
  const result = await db.prepare(`
    INSERT INTO session_logs (finding_id, body, status, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, req.body.body.trim(), req.body.status || 'Note', req.session.id, req.session.id, nowSql(), nowSql());
  await db.prepare('UPDATE findings SET updated_by = ?, updated_at = ? WHERE id = ?').run(req.session.id, nowSql(), req.params.id);
  res.status(201).json({ log: await db.prepare('SELECT * FROM session_logs WHERE id = ?').get(result.lastInsertRowid) });
});

app.patch('/api/findings/:id/logs/:logId', requireAuth, requireProject, async (req, res) => {
  const log = await db.prepare(`
    SELECT session_logs.*
    FROM session_logs
    JOIN findings ON findings.id = session_logs.finding_id
    WHERE session_logs.id = ? AND session_logs.finding_id = ? AND findings.project_id = ?
  `).get(req.params.logId, req.params.id, req.projectId);
  if (!log) return res.status(404).json({ error: 'Log bulunamadi' });
  await db.prepare(`
    UPDATE session_logs
    SET body = ?, status = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(req.body.body?.trim() || log.body, req.body.status || log.status, req.session.id, nowSql(), req.params.logId);
  await db.prepare('UPDATE findings SET updated_by = ?, updated_at = ? WHERE id = ?').run(req.session.id, nowSql(), req.params.id);
  res.json({ log: await db.prepare('SELECT * FROM session_logs WHERE id = ?').get(req.params.logId) });
});

app.delete('/api/findings/:id/logs/:logId', requireAuth, requireProject, async (req, res) => {
  const found = await db.prepare(`
    SELECT session_logs.id
    FROM session_logs
    JOIN findings ON findings.id = session_logs.finding_id
    WHERE session_logs.id = ? AND session_logs.finding_id = ? AND findings.project_id = ?
  `).get(req.params.logId, req.params.id, req.projectId);
  if (!found) return res.status(404).json({ error: 'Log bulunamadi' });
  await db.prepare('DELETE FROM attachments WHERE log_id = ?').run(req.params.logId);
  await db.prepare('DELETE FROM session_logs WHERE id = ?').run(req.params.logId);
  await db.prepare('UPDATE findings SET updated_by = ?, updated_at = ? WHERE id = ?').run(req.session.id, nowSql(), req.params.id);
  res.json({ ok: true });
});

app.get('/api/export/xlsx', requireAuth, requireProject, async (req, res) => await excelExport(res, req.projectId, req.query.folder_id ? Number(req.query.folder_id) : null));
app.get('/api/export/pdf', requireAuth, requireProject, async (req, res) => await pdfExport(res, req.projectId, req.query.folder_id ? Number(req.query.folder_id) : null, req.query.findings === '1'));
app.get('/api/export/findings/xlsx', requireAuth, requireProject, async (req, res) => await findingsExcelExport(res, req.projectId));
app.get('/api/export/findings/pdf', requireAuth, requireProject, async (req, res) => await findingsPdfExport(res, req.projectId));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Beklenmeyen bir hata olustu' });
});

if (process.env.VERCEL !== '1') {
  app.listen(port, () => console.log(`QA Lite API running on port ${port}`));
}

export default app;
