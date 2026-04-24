import { db } from './db.js';

export async function folderPath(folderId, projectId = null) {
  if (!folderId) return '/';
  const names = [];
  let current = folderId;
  const get = db.prepare('SELECT id, name, parent_id, project_id FROM folders WHERE id = ?');
  while (current) {
    const row = await get.get(current);
    if (!row) break;
    if (projectId && Number(row.project_id) !== Number(projectId)) break;
    names.unshift(row.name);
    current = row.parent_id;
  }
  return `/${names.join('/')}`;
}

export async function expandCase(row) {
  return {
    ...row,
    folder_path: await folderPath(row.folder_id, row.project_id),
    created_by_name: row.created_by_name || null,
    updated_by_name: row.updated_by_name || null
  };
}
