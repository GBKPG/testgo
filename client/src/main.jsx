import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  BookOpen,
  Bold,
  Bug,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CircleDot,
  Clock3,
  Copy,
  Download,
  Folder,
  FolderPlus,
  Image,
  Italic,
  Link2,
  ListChecks,
  List,
  LogOut,
  MessageCircleMore,
  Minus,
  Plus,
  Pencil,
  Save,
  Search,
  Settings,
  Trash2,
  Underline,
  Upload
} from 'lucide-react';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import './styles.css';

const API = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://127.0.0.1:4000/api')).replace(/\/$/, '');
const API_ORIGIN = API.endsWith('/api') ? API.slice(0, -4) : API;
const assetUrl = (url) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
};
const SESSION_STATES = ['New', 'In Progress', 'Done'];
const SESSION_STATE_META = {
  New: { color: '#2b8ccf', icon: CircleDot },
  'In Progress': { color: '#f59e0b', icon: Clock3 },
  Done: { color: '#34a853', icon: CheckCheck }
};
const LOG_STATUSES = ['Note', 'Passed', 'Failed', 'Retest', 'Blocked', 'Skipped'];
const LOG_STATUS_META = {
  Note: { color: '#2b8ccf' },
  Passed: { color: '#34a853' },
  Failed: { color: '#ff5a36' },
  Retest: { color: '#f59e0b' },
  Blocked: { color: '#8b8b8b' },
  Skipped: { color: '#18a7c9' }
};
const CONFIGURATION_OPTIONS = [
  'Windows Chrome',
  'Windows Edge',
  'Windows Firefox',
  'MacOS Safari',
  'MacOS Chrome',
  'Android Chrome',
  'Android WebView',
  'iOS Safari',
  'iOS Chrome',
  'Tablet Safari',
  'Tablet Chrome'
];
const STATUSES = ['Açık', 'Devam Ediyor', 'Çözüldü', 'Kapalı', 'Test Başarısız'];
const PRIORITIES = ['', 'Düşük', 'Orta', 'Yüksek'];
const allowedRichTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'A', 'HR']);

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'İşlem tamamlanamadı');
  }
  return res.json();
}

function projectQuery(projectId) {
  return `project_id=${projectId}`;
}

function sanitizeRichHtml(html = '') {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('*').forEach((node) => {
    if (!allowedRichTags.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ''));
      return;
    }
    [...node.attributes].forEach((attribute) => {
      if (node.tagName === 'A' && attribute.name === 'href') {
        const value = String(attribute.value || '').trim();
        if (/^https?:\/\//i.test(value)) {
          node.setAttribute('href', value);
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noreferrer noopener');
          return;
        }
      }
      node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/me').then((data) => setUser(data.user)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="boot">QA Lite</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Shell user={user} onLogout={() => setUser(null)} />;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@local.test');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div>
          <span className="mark">QA</span>
          <h1>QA Lite</h1>
          <p>Manuel QA ekipleri için hızlı test yönetimi</p>
        </div>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Şifre<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary">Giriş Yap</button>
      </form>
    </main>
  );
}

function Shell({ user, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [modal, setModal] = useState(null);

  async function loadProjects() {
    const data = await api('/projects');
    setProjects(data.projects);
    if (selectedProject) {
      const fresh = data.projects.find((item) => item.id === selectedProject.id);
      if (fresh) setSelectedProject(fresh);
    }
  }

  useEffect(() => { loadProjects(); }, []);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    onLogout();
  }

  if (!selectedProject) {
    return (
      <>
        <ProjectHome
          user={user}
          projects={projects}
          onOpen={setSelectedProject}
          onLogout={logout}
          onNewProject={() => setModal({ type: 'project' })}
        />
        {modal?.type === 'project' && <ProjectModal setModal={setModal} reload={loadProjects} />}
      </>
    );
  }

  return (
    <ProjectWorkspace
      user={user}
      project={selectedProject}
      onBack={() => setSelectedProject(null)}
      onLogout={logout}
    />
  );
}

function ProjectHome({ user, projects, onOpen, onLogout, onNewProject }) {
  return (
    <main className="project-home">
      <header className="home-top">
        <div className="home-brand"><span className="mark">QA</span><strong>QA Lite</strong></div>
        <div className="home-actions">
          {user.role === 'Admin' && <button className="primary" onClick={onNewProject}><Plus size={16} /> Project</button>}
          <button onClick={onLogout}><LogOut size={16} /></button>
        </div>
      </header>
      <section className="project-list-card">
        <p className="section-kicker">ACTIVE</p>
        <div className="project-list-title">Project</div>
        <div className="project-list">
          {projects.map((project) => (
            <button key={project.id} className="project-item" onClick={() => onOpen(project)}>
              <span className="project-icon" style={{ backgroundColor: project.color }}>{project.icon}</span>
              <span>{project.name}</span>
            </button>
          ))}
          {projects.length === 0 && <div className="empty slim">Henüz proje yok</div>}
        </div>
      </section>
    </main>
  );
}

function ProjectWorkspace({ user, project, onBack, onLogout }) {
  const [section, setSection] = useState('documentation');
  const [folders, setFolders] = useState([]);
  const [cases, setCases] = useState([]);
  const [findings, setFindings] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedFindingId, setSelectedFindingId] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(['root']));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const folderTree = useMemo(() => buildTree(folders), [folders]);
  const qs = projectQuery(project.id);

  async function refresh() {
    const folderPart = selectedFolder ? `&folder_id=${selectedFolder}` : '';
    const qPart = query ? `&q=${encodeURIComponent(query)}` : '';
    const [folderData, caseData, findingData] = await Promise.all([
      api(`/folders?${qs}`),
      api(`/test-cases?${qs}${folderPart}${qPart}`),
      api(`/findings?${qs}`)
    ]);
    setFolders(folderData.folders);
    setCases(caseData.testCases);
    setFindings(findingData.findings);
    if (selectedCase) {
      const next = await api(`/test-cases/${selectedCase}?${qs}`).catch(() => null);
      setDetail(next);
    }
  }

  useEffect(() => { refresh(); }, [project.id, selectedFolder, query]);
  useEffect(() => {
    api('/users/lookup').then((data) => setUsers(data.users || [])).catch(() => setUsers([]));
  }, [project.id]);

  async function loadCase(id) {
    setSelectedCase(id);
    setDetail(await api(`/test-cases/${id}?${qs}`));
  }

  async function handleDragEnd(event) {
    const caseId = event.active?.data?.current?.caseId;
    const folderId = event.over?.data?.current?.folderId;
    if (!caseId || folderId === undefined) return;
    await api(`/test-cases/${caseId}?${qs}`, { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) });
    await refresh();
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="product-shell">
        <aside className="product-nav">
          <button className="project-switch" onClick={onBack}>
            <span className="project-icon" style={{ backgroundColor: project.color }}>{project.icon}</span>
            <strong>{project.name}</strong>
            <ChevronDown size={14} />
          </button>
          <NavGroup title="PROJECT">
            <NavButton active={section === 'documentation'} icon={<BookOpen size={17} />} onClick={() => setSection('documentation')}>Documentation</NavButton>
          </NavGroup>
          <NavGroup title="MANAGEMENT">
            <NavButton active={section === 'repository'} icon={<ListChecks size={17} />} onClick={() => setSection('repository')}>Test Case</NavButton>
            <NavButton active={section === 'findings'} icon={<Bug size={17} />} onClick={() => setSection('findings')}>Bulgu Dokümanları</NavButton>
          </NavGroup>
          {user.role === 'Admin' && (
            <NavGroup title="ADMIN">
              <NavButton active={section === 'users'} icon={<Settings size={17} />} onClick={() => setSection('users')}>Kullanıcılar</NavButton>
            </NavGroup>
          )}
          <div className="nav-bottom">
            <button onClick={onBack}><ArrowLeft size={16} /> Projects</button>
            <button onClick={onLogout}><LogOut size={16} /> Çıkış</button>
          </div>
        </aside>

        {section === 'documentation' && <Documentation project={project} />}
        {section === 'repository' && (
          <Repository
            project={project}
            folders={folders}
            folderTree={folderTree}
            cases={cases}
            detail={detail}
            expandedFolders={expandedFolders}
            selectedFolder={selectedFolder}
            selectedCase={selectedCase}
            query={query}
            setQuery={setQuery}
            setSelectedFolder={setSelectedFolder}
            setExpandedFolders={setExpandedFolders}
            loadCase={loadCase}
            setModal={setModal}
            refresh={refresh}
          />
        )}
        {section === 'findings' && (
          <FindingsBoard
            project={project}
            findings={findings}
            users={users}
            setModal={setModal}
            selectedFindingId={selectedFindingId}
            setSelectedFindingId={setSelectedFindingId}
            refresh={refresh}
          />
        )}
        {section === 'users' && <UsersScreen user={user} />}

        {modal && (
          <Modal
            modal={modal}
            setModal={setModal}
            project={project}
            folders={folders}
            cases={cases}
            users={users}
            setSelectedFindingId={setSelectedFindingId}
            refresh={refresh}
          />
        )}

        <a
          className="feedback-fab"
          href="https://shrib.com/#Jaiden7obV2Qg"
          target="_blank"
          rel="noreferrer noopener"
          title="Bug veya öneri ilet"
        >
          <span className="feedback-fab-label">Bug veya öneri ilet</span>
          <span className="feedback-fab-icon">
            <MessageCircleMore size={20} />
          </span>
        </a>
      </div>
    </DndContext>
  );
}

function Documentation({ project }) {
  const [documentation, setDocumentation] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api(`/projects/${project.id}/documentation`).then((data) => setDocumentation(data.documentation || ''));
  }, [project.id]);

  async function save() {
    await api(`/projects/${project.id}/documentation`, {
      method: 'PUT',
      body: JSON.stringify({ documentation })
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  }

  return (
    <main className="doc-screen">
      <header className="screen-title">
        <h1>Documentation</h1>
        <button className="primary" onClick={save}><Save size={16} /> Kaydet</button>
      </header>
      <section className="doc-editor">
        <textarea
          value={documentation}
          onChange={(event) => setDocumentation(event.target.value)}
          spellCheck="false"
          placeholder="CMS linklerini, test hesaplarını, proje ile ilgili önemli dataları buraya girebilirsiniz."
        />
      </section>
      {saved && <div className="toast">Kaydedildi</div>}
    </main>
  );
}

function Repository({ project, folders, folderTree, cases, detail, expandedFolders, selectedFolder, selectedCase, query, setQuery, setSelectedFolder, setExpandedFolders, loadCase, setModal, refresh }) {
  const qs = projectQuery(project.id);
  const toggleFolder = (folderId) => {
    const key = folderId ?? 'root';
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const deleteFolder = async (folderId) => {
    if (!folderId) return;
    await api(`/folders/${folderId}?${qs}`, { method: 'DELETE' });
    if (selectedFolder === folderId) setSelectedFolder(null);
    refresh();
  };
  return (
    <main className="repo-screen">
      <header className="screen-title compact">
        <h1>Repository</h1>
        <div className="toolbar">
          <button onClick={() => window.location.href = `${API}/export/xlsx?${qs}${selectedFolder ? `&folder_id=${selectedFolder}` : ''}`}><Download size={16} /> Excel</button>
          <button onClick={() => window.location.href = `${API}/export/pdf?${qs}${selectedFolder ? `&folder_id=${selectedFolder}` : ''}&findings=1`}><Download size={16} /> PDF</button>
        </div>
      </header>
      <section className="repo-grid">
        <aside className="folder-pane">
          <div className="pane-head">
            <span>Folder</span>
            <button className="pane-add" title="Folder ekle" onClick={() => setModal({ type: 'folder', parent_id: selectedFolder })}><Plus size={15} /></button>
          </div>
          <FolderNode
            folder={{ id: null, name: 'TEST CASE', children: folderTree }}
            selected={selectedFolder}
            expanded={expandedFolders}
            setSelected={setSelectedFolder}
            toggleFolder={toggleFolder}
            deleteFolder={deleteFolder}
          />
        </aside>
        <section className="case-pane">
          <div className="case-pane-top">
            <div>
              <h2>{selectedFolder ? folders.find((item) => item.id === selectedFolder)?.name : 'Tüm Testler'}</h2>
              <p>{cases.length} case</p>
            </div>
            <div className="search small-search"><Search size={16} /><input placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          </div>
          <div className="repository-table">
            <div className="repo-row head"><span>Case</span><span></span></div>
            {cases.map((testCase) => (
              <CaseRow
                key={testCase.id}
                testCase={testCase}
                selected={selectedCase === testCase.id}
                onSelect={loadCase}
                onEdit={(item) => setModal({ type: 'case', testCase: item })}
                onCopy={async (id) => { await api(`/test-cases/${id}/copy?${qs}`, { method: 'POST', body: JSON.stringify({}) }); refresh(); }}
                onDelete={async (id) => { await api(`/test-cases/${id}?${qs}`, { method: 'DELETE' }); refresh(); }}
              />
            ))}
            <button className="add-case-row" onClick={() => setModal({ type: 'case', folder_id: selectedFolder })}>
              <Plus size={16} /> Add new case
            </button>
          </div>
        </section>
        <aside className="case-detail-pane">
          <CaseDetail
            detail={detail}
            onOpenFinding={(id) => setModal({ type: 'findingDetail', id })}
          />
        </aside>
      </section>
    </main>
  );
}

function FindingsBoard({ project, findings, users, setModal, selectedFindingId, setSelectedFindingId, refresh }) {
  async function deleteSession(event, findingId) {
    event.stopPropagation();
    if (!window.confirm('Bu session silinsin mi?')) return;
    await api(`/findings/${findingId}?${projectQuery(project.id)}`, { method: 'DELETE' });
    await refresh();
  }

  if (selectedFindingId) {
    return (
      <SessionDetailPage
        id={selectedFindingId}
        project={project}
        users={users}
        onBack={() => setSelectedFindingId(null)}
        refresh={refresh}
      />
    );
  }
  return (
    <main className="findings-screen">
      <header className="screen-title">
        <h1>{project.name} Session Dokumanlari</h1>
        <div className="toolbar">
          <button onClick={() => window.location.href = `${API}/export/findings/xlsx?${projectQuery(project.id)}`}><Download size={16} /> XLSX</button>
          <button onClick={() => window.location.href = `${API}/export/findings/pdf?${projectQuery(project.id)}`}><Download size={16} /> PDF</button>
          <button className="primary" onClick={() => setModal({ type: 'finding' })}><Plus size={16} /> Session</button>
        </div>
      </header>
      <section className="sessions-board">
        <div className="sessions-headline">
          <span>Unscheduled</span>
          <button className="ghost-plus" onClick={() => setModal({ type: 'finding' })}><Plus size={18} /></button>
        </div>
        <div className="sessions-table">
          <div className="session-row head">
            <span>Session</span>
            <span>State</span>
            <span>Contributors</span>
            <span>Activity</span>
            <span></span>
          </div>
          {findings.map((finding) => (
            <button key={finding.id} className="session-row" onClick={() => setSelectedFindingId(finding.id)}>
              <span className="session-main">
                <span className="session-link-icon"><Bug size={15} /></span>
                <span className="session-title-stack">
                  <strong>{finding.title}</strong>
                  {finding.configuration ? <em>({finding.configuration})</em> : null}
                </span>
              </span>
              <span className={`session-state state-${(finding.ui_status || 'New').toLowerCase().replace(/\s+/g, '-')}`}>{finding.ui_status || 'New'}</span>
              <span className="contributors">
                {getSessionContributors(finding).map((name, index) => (
                  <AvatarBadge key={name} label={name} alt={index > 0} />
                ))}
              </span>
              <span className="activity-cells" aria-hidden="true">
                {buildActivityCells(finding).map((cell, index) => (
                  <i
                    key={index}
                    className={cell.filled ? 'on' : ''}
                    style={cell.filled ? { backgroundColor: cell.color, borderColor: cell.color } : undefined}
                  />
                ))}
              </span>
              <span className="session-menu">
                <button type="button" className="session-delete-btn" title="Session sil" onClick={(event) => deleteSession(event, finding.id)}>
                  <Trash2 size={14} />
                </button>
              </span>
            </button>
          ))}
          {findings.length === 0 && <div className="empty slim">Henuz session yok</div>}
        </div>
      </section>
    </main>
  );
}

function AvatarBadge({ label, alt = false }) {
  const initials = (label || 'Q')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'Q';
  return <span className={`avatar-badge ${alt ? 'alt' : ''}`}>{initials}</span>;
}

function getSessionContributors(finding, logs = []) {
  const seen = new Set();
  const contributors = [];
  const add = (name) => {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const key = cleanName.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) return;
    seen.add(key);
    contributors.push(cleanName);
  };

  add(finding?.created_by_name);
  (finding?.contributor_names || []).forEach(add);
  logs.forEach((log) => add(log.created_by_name));

  return contributors.length ? contributors : ['Q'];
}

function formatSessionDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function statusClassName(status) {
  return `status-${String(status || 'note').toLowerCase()}`;
}

function StatusDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="status-dropdown" ref={ref}>
      <button type="button" className={`status-select-button ${statusClassName(value)}`} onClick={() => setOpen((current) => !current)}>
        <span className="status-dot" style={{ backgroundColor: LOG_STATUS_META[value]?.color }} />
        <span>{value}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="status-dropdown-menu">
          {LOG_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`status-option ${value === status ? 'active' : ''}`}
              onClick={() => { onChange(status); setOpen(false); }}
            >
              <span className="status-dot" style={{ backgroundColor: LOG_STATUS_META[status]?.color }} />
              <span>{status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionStateDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const ActiveIcon = SESSION_STATE_META[value]?.icon || CircleDot;

  useEffect(() => {
    function handleClick(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="status-dropdown state-dropdown" ref={ref}>
      <button type="button" className={`status-select-button session-state-button ${statusClassName(value)}`} onClick={() => setOpen((current) => !current)}>
        <ActiveIcon size={16} />
        <span>{value}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="status-dropdown-menu">
          {SESSION_STATES.map((status) => {
            const Icon = SESSION_STATE_META[status]?.icon || CircleDot;
            return (
              <button
                key={status}
                type="button"
                className={`status-option ${value === status ? 'active' : ''}`}
                onClick={() => { onChange(status); setOpen(false); }}
              >
                <Icon size={16} color={SESSION_STATE_META[status]?.color} />
                <span>{status}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildActivityCells(finding) {
  const filledCount = Math.max(0, Math.min(10, Number(finding.comments_count || 0)));
  const state = finding.ui_status || 'New';
  return Array.from({ length: 10 }, (_, index) => ({
    filled: index < filledCount,
    color: SESSION_STATE_META[state]?.color || '#2b8ccf'
  }));
}

function SessionDetailPage({ id, project, users, onBack, refresh }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({ body: '', status: 'Note', file: null });
  const [menuLogId, setMenuLogId] = useState(null);
  const [editingLogId, setEditingLogId] = useState(null);
  const [editDraft, setEditDraft] = useState({ body: '', status: 'Note' });
  const [previewImage, setPreviewImage] = useState(null);
  const [draftPreviewUrl, setDraftPreviewUrl] = useState('');
  const qs = projectQuery(project.id);

  async function reload() {
    setData(await api(`/findings/${id}?${qs}`));
  }

  useEffect(() => { reload(); }, [id]);
  useEffect(() => {
    if (!draft.file) {
      setDraftPreviewUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(draft.file);
    setDraftPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [draft.file]);

  async function createLog(event) {
    event.preventDefault();
    if (!draft.body.trim()) return;
    const created = await api(`/findings/${id}/logs?${qs}`, {
      method: 'POST',
      body: JSON.stringify({ body: draft.body, status: draft.status })
    });
    if (draft.file) {
      const body = new FormData();
      body.append('file', draft.file);
      body.append('log_id', created.log.id);
      await api(`/findings/${id}/attachments?${qs}`, { method: 'POST', body });
    }
    setDraft({ body: '', status: 'Note', file: null });
    await reload();
    refresh();
  }

  function startEdit(log) {
    setEditingLogId(log.id);
    setEditDraft({ body: log.body, status: log.status });
    setMenuLogId(null);
  }

  async function saveEdit(logId) {
    await api(`/findings/${id}/logs/${logId}?${qs}`, {
      method: 'PATCH',
      body: JSON.stringify(editDraft)
    });
    setEditingLogId(null);
    await reload();
    refresh();
  }

  async function deleteLog(logId) {
    await api(`/findings/${id}/logs/${logId}?${qs}`, { method: 'DELETE' });
    setMenuLogId(null);
    await reload();
    refresh();
  }

  if (!data) return <main className="findings-screen"><div className="empty">Session yukleniyor</div></main>;

  const finding = data.finding;
  const contributors = getSessionContributors(finding, data.logs);

  return (
    <main className="findings-screen">
      <header className="screen-title">
        <h1>{finding.title}</h1>
        <div className="toolbar">
          <button onClick={onBack}>Close</button>
        </div>
      </header>
      <section className="session-detail-layout">
        <section className="session-main-column">
          <div className="session-log-title">SESSION LOG</div>

          <form className="session-composer" onSubmit={createLog}>
            <RichEditor
              value={draft.body}
              onChange={(body) => setDraft((current) => ({ ...current, body }))}
              placeholder="Add note or result"
              hideLabel
              minHeight={120}
              editorClassName="session-rich-editor"
            />
            <div className="session-composer-actions">
              <div className="session-composer-actions-left">
                <StatusDropdown value={draft.status} onChange={(status) => setDraft((current) => ({ ...current, status }))} />
                <label className={`attach-inline${draft.file ? ' has-file' : ''}`}>
                  <Upload size={15} />
                  <span className="attach-inline-copy">
                    <strong>{draft.file ? 'Attached' : 'Attach image'}</strong>
                    <small>{draft.file ? draft.file.name : 'PNG, JPG veya JPEG'}</small>
                  </span>
                  <input type="file" accept="image/*" onChange={(event) => setDraft((current) => ({ ...current, file: event.target.files?.[0] || null }))} />
                </label>
              </div>
              <div className="session-composer-actions-right">
                <button className="primary">
                  <Plus size={16} />
                  <span>Add log</span>
                </button>
                <button type="button" className="ghost-button" onClick={() => setDraft({ body: '', status: 'Note', file: null })}>Clear</button>
              </div>
            </div>
            {draft.file ? (
              <div className="composer-attachment-preview">
                <img src={draftPreviewUrl} alt={draft.file.name} />
                <div className="composer-attachment-meta">
                  <strong>{draft.file.name}</strong>
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, file: null }))}>Remove</button>
                </div>
              </div>
            ) : null}
          </form>

          <div className="session-logs">
            {data.logs.map((log) => (
              <article key={log.id} className="session-log-card">
                <div className="log-avatar">{(log.created_by_name || 'Q').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'Q'}</div>
                <div className="log-content">
                  <div className="log-header">
                    <strong>{log.created_by_name || 'QA'}</strong>
                    <span>{formatSessionDate(log.created_at)}</span>
                    <button className="log-menu-button" type="button" onClick={() => setMenuLogId((current) => current === log.id ? null : log.id)}>≡</button>
                    {menuLogId === log.id && (
                      <div className="log-menu">
                        <button type="button" onClick={() => startEdit(log)}>Edit</button>
                        <button type="button" onClick={() => deleteLog(log.id)}>Delete</button>
                      </div>
                    )}
                    <span className={`log-status-badge status-${log.status.toLowerCase()}`}>{log.status}</span>
                  </div>

                  {editingLogId === log.id ? (
                    <div className="log-editor">
                      <RichEditor
                        value={editDraft.body}
                        onChange={(body) => setEditDraft((current) => ({ ...current, body }))}
                        placeholder="Log duzenle"
                        hideLabel
                        minHeight={140}
                        editorClassName="session-rich-editor"
                      />
                      <div className="session-composer-actions">
                        <StatusDropdown value={editDraft.status} onChange={(status) => setEditDraft((current) => ({ ...current, status }))} />
                        <button type="button" className="primary" onClick={() => saveEdit(log.id)}>Save</button>
                        <button type="button" onClick={() => setEditingLogId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="log-body rich-output" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(log.body) }} />
                      {log.attachments?.length ? (
                      <div className="log-shots">
                          {log.attachments.map((file) => (
                            <button key={file.id} type="button" className="log-shot-button" onClick={() => setPreviewImage({ src: assetUrl(file.url), name: file.original_name })}>
                              <img src={assetUrl(file.url)} alt={file.original_name} />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            ))}
            {data.logs.length === 0 && <div className="empty slim">Bu session icin henuz log yok.</div>}
          </div>
        </section>

        <aside className="session-side-column">
          <div className="side-panel">
            <div className="side-label">ABOUT</div>
            <div className="about-card">
              <div className="about-icon"><Bug size={18} /></div>
              <div>
                <strong>Active: {finding.ui_status}</strong>
                <div>{finding.configuration || 'No configuration'}</div>
                <div>Created {formatSessionDate(finding.created_at)}</div>
              </div>
            </div>
          </div>
          <div className="side-panel">
            <div className="side-label">Contributors</div>
            <div className="contributors-stack">
              {contributors.map((name, index) => (
                <AvatarBadge key={name} label={name} alt={index > 0} />
              ))}
            </div>
          </div>
        </aside>
      </section>
      {previewImage ? (
        <div className="image-lightbox" onMouseDown={() => setPreviewImage(null)}>
          <div className="image-lightbox-inner" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="image-lightbox-close" onClick={() => setPreviewImage(null)}>×</button>
            <img src={previewImage.src} alt={previewImage.name} />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function UsersScreen({ user }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'Tester' });

  async function reload() {
    if (user.role === 'Admin') setUsers((await api('/users')).users);
  }

  useEffect(() => { reload(); }, []);

  async function submit(event) {
    event.preventDefault();
    await api('/users', { method: 'POST', body: JSON.stringify(form) });
    setForm({ email: '', password: '', name: '', role: 'Tester' });
    reload();
  }

  if (user.role !== 'Admin') {
    return <main className="overview-screen"><div className="empty">Bu ekran için Admin yetkisi gerekli.</div></main>;
  }

  return (
    <main className="overview-screen">
      <header className="screen-title"><h1>Kullanıcılar</h1></header>
      <form className="user-form" onSubmit={submit}>
        <input placeholder="Ad" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <input placeholder="Şifre" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option>Tester</option><option>Admin</option></select>
        <button className="primary"><Plus size={16} /> Ekle</button>
      </form>
      <div className="repository-table">
        {users.map((item) => <div className="repo-row users" key={item.id}><span>{item.name}</span><span>{item.email}</span><span>{item.role}</span><span>{item.active ? 'Aktif' : 'Pasif'}</span></div>)}
      </div>
    </main>
  );
}

function FolderNode({ folder, selected, expanded, setSelected, toggleFolder, deleteFolder, depth = 0 }) {
  const { setNodeRef, isOver } = useDroppable({ id: `folder-${folder.id ?? 'root'}`, data: { folderId: folder.id } });
  const key = folder.id ?? 'root';
  const isExpanded = expanded.has(key);
  const hasChildren = Boolean(folder.children?.length);
  return (
    <div>
      <div ref={setNodeRef} className={`folder-row ${selected === folder.id ? 'active' : ''} ${isOver ? 'drop-over' : ''}`} style={{ paddingLeft: 8 + depth * 18 }}>
        <button className={`folder-toggle ${isExpanded ? 'open' : ''}`} disabled={!hasChildren} onClick={(event) => { event.stopPropagation(); toggleFolder(folder.id); }}>
          <ChevronRight size={13} />
        </button>
        <button className="folder-main" onClick={() => setSelected(folder.id)}>
          <Folder size={17} fill="currentColor" />
          <span>{folder.name}</span>
        </button>
        {folder.id !== null && (
          <button className="folder-delete" title="Klasörü sil" onClick={(event) => { event.stopPropagation(); deleteFolder(folder.id); }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {isExpanded && (folder.children || []).map((child) => (
        <FolderNode
          key={child.id}
          folder={child}
          selected={selected}
          expanded={expanded}
          setSelected={setSelected}
          toggleFolder={toggleFolder}
          deleteFolder={deleteFolder}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function CaseRow({ testCase, selected, onSelect, onEdit, onCopy, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `case-${testCase.id}`,
    data: { caseId: testCase.id }
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`repo-row ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} onClick={() => onSelect(testCase.id)} {...listeners} {...attributes}>
      <span><ClipboardList size={16} /> {testCase.title}</span>
      <span className="row-actions">
        <IconButton title="Düzenle" onClick={(event) => { event.stopPropagation(); onEdit(testCase); }}><Pencil size={15} /></IconButton>
        <IconButton title="Kopyala" onClick={(event) => { event.stopPropagation(); onCopy(testCase.id); }}><Copy size={15} /></IconButton>
        <IconButton title="Sil" onClick={(event) => { event.stopPropagation(); onDelete(testCase.id); }}><Trash2 size={15} /></IconButton>
      </span>
    </div>
  );
}

function CaseDetail({ detail }) {
  if (!detail) return <div className="empty"><ClipboardList size={28} /><p>Case seç</p></div>;
  const { testCase } = detail;
  const folderPath = (testCase.folder_path || '').replace(/^[/\\]+/, '');
  return (
    <div className="case-detail">
      <h2>{testCase.title}</h2>
      <p className="subtle">{folderPath}</p>
      <Field title="Description" body={testCase.description} />
      <Field title="Expected" body={testCase.expected_result} />
    </div>
  );
}

function Field({ title, body }) {
  return (
    <section className="field">
      <h3>{title}</h3>
      {body ? <div className="rich-output" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(body) }} /> : <p>-</p>}
    </section>
  );
}

function RichEditor({ label, value, onChange, placeholder, hideLabel = false, minHeight = 150, editorClassName = '' }) {
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorRef.current) {
      const nextValue = value || '';
      if (editorRef.current.innerHTML !== nextValue) {
        const isFocused = document.activeElement === editorRef.current;
        if (!isFocused) {
          editorRef.current.innerHTML = nextValue;
        }
      }
    }
  }, [value]);

  function runCommand(event, command) {
    event.preventDefault();
    event.stopPropagation();
    editorRef.current?.focus();
    document.execCommand(command, false, null);
    onChange(sanitizeRichHtml(editorRef.current?.innerHTML || ''));
  }

  function insertLink(event) {
    event.preventDefault();
    event.stopPropagation();
    const href = window.prompt('Link URL');
    if (!href || !/^https?:\/\//i.test(href.trim())) return;
    editorRef.current?.focus();
    document.execCommand('createLink', false, href.trim());
    onChange(sanitizeRichHtml(editorRef.current?.innerHTML || ''));
  }

  function insertRule(event) {
    event.preventDefault();
    event.stopPropagation();
    editorRef.current?.focus();
    document.execCommand('insertHorizontalRule', false, null);
    document.execCommand('insertParagraph', false, null);
    onChange(sanitizeRichHtml(editorRef.current?.innerHTML || ''));
  }

  function handleInput() {
    onChange(editorRef.current?.innerHTML || '');
  }

  function handlePaste(event) {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleInput();
  }

  return (
    <div className="rich-field">
      {!hideLabel && <label>{label}</label>}
      <div className="rich-toolbar">
        <button type="button" title="Bold" onMouseDown={(event) => runCommand(event, 'bold')}><Bold size={15} /></button>
        <button type="button" title="Italic" onMouseDown={(event) => runCommand(event, 'italic')}><Italic size={15} /></button>
        <button type="button" title="Underline" onMouseDown={(event) => runCommand(event, 'underline')}><Underline size={15} /></button>
        <button type="button" title="Liste" onMouseDown={(event) => runCommand(event, 'insertUnorderedList')}><List size={15} /></button>
        <button type="button" title="Link" onMouseDown={insertLink}><Link2 size={15} /></button>
        <button type="button" title="Horizontal line" onMouseDown={insertRule}><Minus size={15} /></button>
      </div>
      <div
        ref={editorRef}
        className={`rich-editor ${editorClassName}`.trim()}
        contentEditable
        data-placeholder={placeholder}
        tabIndex={0}
        onInput={handleInput}
        onPaste={handlePaste}
        onMouseDown={(event) => event.stopPropagation()}
        style={{ minHeight }}
        suppressContentEditableWarning
      />
    </div>
  );
}

function Modal({ modal, setModal, project, folders, cases, users, setSelectedFindingId, refresh }) {
  if (modal.type === 'folder') return <FolderModal modal={modal} project={project} setModal={setModal} refresh={refresh} />;
  if (modal.type === 'case') return <CaseModal modal={modal} project={project} setModal={setModal} refresh={refresh} />;
  if (modal.type === 'finding') return <FindingModal modal={modal} project={project} setModal={setModal} users={users} setSelectedFindingId={setSelectedFindingId} refresh={refresh} />;
  return null;
}

function ProjectModal({ setModal, reload }) {
  const [form, setForm] = useState({ name: '', icon: 'A', color: '#0ea5e9' });
  async function submit(event) {
    event.preventDefault();
    await api('/projects', { method: 'POST', body: JSON.stringify(form) });
    setModal(null);
    reload();
  }
  return (
    <Dialog title="Project Ekle" onClose={() => setModal(null)}>
      <form className="modal-form" onSubmit={submit}>
        <input autoFocus placeholder="Project adı" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <div className="split">
          <input placeholder="Icon" value={form.icon} maxLength={2} onChange={(event) => setForm({ ...form, icon: event.target.value })} />
          <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
        </div>
        <button className="primary">Kaydet</button>
      </form>
    </Dialog>
  );
}

function FolderModal({ modal, project, setModal, refresh }) {
  const [name, setName] = useState('');
  async function submit(event) {
    event.preventDefault();
    await api(`/folders?${projectQuery(project.id)}`, { method: 'POST', body: JSON.stringify({ name, parent_id: modal.parent_id }) });
    setModal(null);
    refresh();
  }
  return <Dialog title="Folder Ekle" onClose={() => setModal(null)}><form onSubmit={submit} className="modal-form"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Folder adı" /><button className="primary">Kaydet</button></form></Dialog>;
}

function CaseModal({ modal, project, setModal, refresh }) {
  const initial = modal.testCase || { folder_id: modal.folder_id, title: '', description: '', steps: '', expected_result: '' };
  const [form, setForm] = useState(initial);
  async function submit(event) {
    event.preventDefault();
    const method = modal.testCase ? 'PATCH' : 'POST';
    const path = modal.testCase ? `/test-cases/${modal.testCase.id}?${projectQuery(project.id)}` : `/test-cases?${projectQuery(project.id)}`;
    await api(path, {
      method,
      body: JSON.stringify({
        ...form,
        description: sanitizeRichHtml(form.description || ''),
        expected_result: sanitizeRichHtml(form.expected_result || '')
      })
    });
    setModal(null);
    refresh();
  }
  return (
    <Dialog title={modal.testCase ? 'Case Düzenle' : 'Case Ekle'} onClose={() => setModal(null)}>
      <form onSubmit={submit} className="modal-form">
        <input autoFocus placeholder="Başlık" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <RichEditor label="Açıklama" placeholder="Açıklama" value={form.description} onChange={(description) => setForm({ ...form, description })} />
        <RichEditor label="Beklenen sonuç" placeholder="Beklenen sonuç" value={form.expected_result} onChange={(expected_result) => setForm({ ...form, expected_result })} />
        <button className="primary">Kaydet</button>
      </form>
    </Dialog>
  );
}

function FindingModal({ modal, project, setModal, users, setSelectedFindingId, refresh }) {
  const [form, setForm] = useState({ title: '', configuration: CONFIGURATION_OPTIONS[0], status: 'New', assigned_to: '' });
  async function submit(event) {
    event.preventDefault();
    const data = await api(`/findings?${projectQuery(project.id)}`, {
      method: 'POST',
      body: JSON.stringify({
        title: form.title,
        configuration: form.configuration,
        status: form.status,
        assigned_to: form.assigned_to || null
      })
    });
    setSelectedFindingId(data.finding.id);
    setModal(null);
    await refresh();
  }
  return (
    <Dialog title="Session Ekle" onClose={() => setModal(null)}>
      <form onSubmit={submit} className="modal-form session-modal-form">
        <div className="split">
          <label>
            <span>Name *</span>
            <input autoFocus placeholder="Session name" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            <span>State *</span>
            <SessionStateDropdown value={form.status} onChange={(status) => setForm({ ...form, status })} />
          </label>
        </div>
        <div className="split">
          <label>
            <span>Configuration</span>
            <select value={form.configuration} onChange={(event) => setForm({ ...form, configuration: event.target.value })}>
              {CONFIGURATION_OPTIONS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Assigned to</span>
            <select value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })}>
              <option value="">Unassigned</option>
              {users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
        <button className="primary">Add session</button>
      </form>
    </Dialog>
  );
}

function FindingDetail({ id, project, setModal, refresh }) {
  const [data, setData] = useState(null);
  const [comment, setComment] = useState('');
  const qs = projectQuery(project.id);

  async function reload() {
    setData(await api(`/findings/${id}?${qs}`));
  }

  useEffect(() => { reload(); }, [id]);
  if (!data) return <Dialog title="Bulgu" onClose={() => setModal(null)}><div className="empty">Yükleniyor</div></Dialog>;

  async function uploadFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    await api(`/findings/${id}/attachments?${qs}`, { method: 'POST', body });
    await reload();
    refresh();
  }

  async function addComment(event) {
    event.preventDefault();
    await api(`/findings/${id}/comments?${qs}`, { method: 'POST', body: JSON.stringify({ body: comment }) });
    setComment('');
    await reload();
    refresh();
  }

  return (
    <Dialog title={data.finding.title} onClose={() => setModal(null)}>
      <div className="finding-detail">
        <div className="meta"><span>{data.finding.status}</span><span>{data.finding.priority || '-'}</span><span>{data.finding.test_case_title || 'Bağlı test yok'}</span></div>
        <p>{data.finding.description || 'Session notu henuz yok.'}</p>
        <label className="upload"><Upload size={16} /> Görsel yükle<input type="file" accept="image/*" onChange={uploadFile} /></label>
        <div className="shots">{data.attachments.map((file) => <img key={file.id} src={assetUrl(file.url)} alt={file.original_name} />)}</div>
        <form className="comment-form" onSubmit={addComment}><input placeholder="Session notu ekle" value={comment} onChange={(event) => setComment(event.target.value)} /><button>Gönder</button></form>
        <div className="comments">{data.comments.map((item) => <p key={item.id}><strong>{item.created_by_name || '-'}</strong> {item.body}</p>)}</div>
      </div>
    </Dialog>
  );
}

function NavGroup({ title, children }) {
  return <div className="nav-group"><p>{title}</p>{children}</div>;
}

function NavButton({ active, icon, children, onClick }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function Dialog({ title, children, onClose }) {
  return <div className="overlay" onMouseDown={onClose}><div className="dialog" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-head"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div>;
}

function IconButton({ title, children, onClick }) {
  return <button type="button" className="icon-btn" title={title} onClick={onClick}>{children}</button>;
}

function buildTree(folders) {
  const map = new Map(folders.map((folder) => [folder.id, { ...folder, children: [] }]));
  const roots = [];
  map.forEach((folder) => {
    if (folder.parent_id && map.has(folder.parent_id)) map.get(folder.parent_id).children.push(folder);
    else roots.push(folder);
  });
  return roots;
}

createRoot(document.getElementById('root')).render(<App />);
