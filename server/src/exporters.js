import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import dayjs from 'dayjs';
import { db } from './db.js';
import { folderPath } from './paths.js';

const fontCandidates = [
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
];

function setupPdf(doc) {
  const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
  if (fontPath) {
    doc.registerFont('Body', fontPath);
    doc.registerFont('BodyBold', fontPath);
    doc.font('Body');
  }
}

async function fetchCases(projectId, folderId, includeFindings) {
  const rows = await db.prepare(`
    SELECT tc.*, f.name as folder_name
    FROM test_cases tc
    LEFT JOIN folders f ON f.id = tc.folder_id
    WHERE tc.project_id = ?
    AND (? IS NULL OR tc.folder_id IN (
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM folders WHERE id = ? AND project_id = ?
        UNION ALL
        SELECT folders.id FROM folders JOIN tree ON folders.parent_id = tree.id WHERE folders.project_id = ?
      )
      SELECT id FROM tree
    ))
    ORDER BY tc.folder_id, tc.position, tc.id
  `).all(projectId, folderId ?? null, folderId ?? null, projectId, projectId);

  return Promise.all(rows.map(async (row) => ({
    ...row,
    folder_path: await folderPath(row.folder_id, projectId),
    findings: includeFindings
      ? await db.prepare('SELECT * FROM findings WHERE test_case_id = ? ORDER BY created_at DESC').all(row.id)
      : []
  })));
}

export async function excelExport(res, projectId, folderId) {
  const cases = await fetchCases(projectId, folderId, false);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Test Cases');
  sheet.columns = [
    { header: 'Klasör Yolu', key: 'folder_path', width: 32 },
    { header: 'Başlık', key: 'title', width: 36 },
    { header: 'Açıklama', key: 'description', width: 42 },
    { header: 'Adımlar', key: 'steps', width: 48 },
    { header: 'Beklenen Sonuç', key: 'expected_result', width: 42 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF5' } };
  cases.forEach((testCase) => sheet.addRow(testCase));
  sheet.eachRow((row) => row.alignment = { vertical: 'top', wrapText: true });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="qa-lite-test-cases.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}

export async function pdfExport(res, projectId, folderId, includeFindings) {
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const cases = await fetchCases(projectId, folderId, includeFindings);
  const doc = new PDFDocument({ margin: 42, size: 'A4', bufferPages: true });
  setupPdf(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="qa-lite-test-cases.pdf"');
  doc.pipe(res);

  drawCaseExportHeader(doc, project);
  cases.forEach((testCase) => drawCaseExportItem(doc, testCase, includeFindings));

  addPageNumbers(doc);
  doc.end();
}

function drawCaseExportHeader(doc, project) {
  doc.fillColor('#111827').fontSize(18).text(`${project?.name || 'QA Lite'} Test Case Export`);
  doc.moveDown(0.35);
  doc.fillColor('#6b7280').fontSize(9).text(`Export tarihi: ${dayjs().format('YYYY-MM-DD HH:mm')}`);
  doc.moveDown(1);
}

function drawCaseExportItem(doc, testCase, includeFindings) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const expected = testCase.expected_result || '-';
  const description = testCase.description || '';
  const estimatedHeight = 78
    + doc.heightOfString(description, { width, lineGap: 2 })
    + doc.heightOfString(expected, { width, lineGap: 2 });
  ensureSpace(doc, Math.min(estimatedHeight, 360));

  const startY = doc.y;
  doc.fillColor('#f8fafc').rect(left, startY, width, 38).fill();
  doc.fillColor('#9ca3af').fontSize(11).text('□', left + 10, startY + 12, { continued: true });
  doc.fillColor('#111827').fontSize(11).text(` ${testCase.title}`, { continued: true });
  doc.fillColor('#9ca3af').fontSize(9).text(` - ID: ${testCase.id}`);
  doc.fillColor('#6b7280').fontSize(8).text(testCase.folder_path, left + 10, startY + 28);
  doc.y = startY + 54;

  if (description) {
    doc.fillColor('#111827').fontSize(10).text(description, left + 10, doc.y, { width: width - 20, lineGap: 2 });
    doc.moveDown(0.7);
  }

  doc.fillColor('#111827').fontSize(11).text('Expected', left + 10, doc.y);
  doc.moveDown(0.45);
  doc.fillColor('#111827').fontSize(10).text(expected, left + 10, doc.y, { width: width - 20, lineGap: 2 });
  doc.moveDown(1);

  if (includeFindings && testCase.findings.length) {
    ensureSpace(doc, 60);
    doc.fillColor('#111827').fontSize(11).text('İlgili Bulgular', left + 10, doc.y);
    testCase.findings.forEach((finding) => {
      ensureSpace(doc, 42);
      doc.moveDown(0.25);
      doc.fillColor('#991b1b').fontSize(10).text(`${finding.title} - ${finding.status}`, left + 10, doc.y, { width: width - 20 });
      if (finding.description) {
        doc.fillColor('#111827').fontSize(9).text(finding.description, left + 10, doc.y + 13, { width: width - 20, lineGap: 2 });
        doc.moveDown(1.1);
      }
    });
    doc.moveDown(0.5);
  }
}

async function fetchFindings(projectId) {
  const rows = await db.prepare(`
    SELECT f.*, tc.title as test_case_title, c.name as created_by_name, u.name as updated_by_name
    FROM findings f
    LEFT JOIN test_cases tc ON tc.id = f.test_case_id
    LEFT JOIN users c ON c.id = f.created_by
    LEFT JOIN users u ON u.id = f.updated_by
    WHERE f.project_id = ?
    ORDER BY f.updated_at DESC
  `).all(projectId);
  return Promise.all(rows.map(async (finding) => ({
    ...finding,
    attachments: await db.prepare('SELECT * FROM attachments WHERE finding_id = ? ORDER BY created_at DESC').all(finding.id),
    comments: await db.prepare(`
      SELECT comments.*, users.name as created_by_name
      FROM comments LEFT JOIN users ON users.id = comments.created_by
      WHERE finding_id = ?
      ORDER BY comments.created_at ASC
    `).all(finding.id)
  })));
}

export async function findingsExcelExport(res, projectId) {
  const findings = await fetchFindings(projectId);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bulgular');
  sheet.columns = [
    { header: 'Başlık', key: 'title', width: 38 },
    { header: 'Açıklama', key: 'description', width: 48 },
    { header: 'Durum', key: 'status', width: 18 },
    { header: 'Öncelik', key: 'priority', width: 16 },
    { header: 'Test Case', key: 'test_case_title', width: 34 },
    { header: 'Oluşturan', key: 'created_by_name', width: 20 },
    { header: 'Güncelleyen', key: 'updated_by_name', width: 20 },
    { header: 'Oluşturma', key: 'created_at', width: 22 },
    { header: 'Güncelleme', key: 'updated_at', width: 22 },
    { header: 'Görseller', key: 'attachments_text', width: 42 },
    { header: 'Yorumlar', key: 'comments_text', width: 52 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF5' } };
  findings.forEach((finding) => {
    sheet.addRow({
      ...finding,
      priority: finding.priority || '-',
      test_case_title: finding.test_case_title || '-',
      attachments_text: finding.attachments.map((file) => file.url).join('\n'),
      comments_text: finding.comments.map((comment) => `${comment.created_by_name || '-'}: ${comment.body}`).join('\n')
    });
  });
  sheet.eachRow((row) => row.alignment = { vertical: 'top', wrapText: true });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="qa-lite-bulgular.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}

export async function findingsPdfExport(res, projectId) {
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const findings = await fetchFindings(projectId);
  const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
  setupPdf(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="qa-lite-bulgular.pdf"');
  doc.pipe(res);

  drawSessionHeader(doc, project);
  findings.forEach((finding) => drawFindingLogItem(doc, finding));

  if (!findings.length) {
    doc.fontSize(12).fillColor('#4b5563').text('Bu projede bulgu bulunmuyor.', 52, doc.y + 16);
  }

  doc.end();
}

function drawSessionHeader(doc, project) {
  const left = 36;
  const width = doc.page.width - 72;
  doc.rect(0, 0, doc.page.width, 44).fill('#f1f3f5');
  doc.fillColor('#374151').fontSize(10).text('Configure', left, 16);
  doc.fillColor('#0786d8').roundedRect(doc.page.width - 120, 10, 84, 24, 3).fill();
  doc.fillColor('#ffffff').fontSize(10).text('Print & PDF', doc.page.width - 104, 16);

  doc.y = 70;
  doc.rect(left, doc.y, width, 74).stroke('#d9dee5');
  doc.roundedRect(left + 16, doc.y + 16, width - 32, 42, 3).fill('#f7f8fa');
  doc.fillColor('#111827').fontSize(11).text('Template', left + 28, doc.y + 27);
  doc.fillColor('#111827').fontSize(10).text('Keşif Testi Session', left + 28, doc.y + 48);
  doc.fillColor('#6b7280').fontSize(8).text(`${project?.name || 'QA Lite'} • ${dayjs().format('YYYY-MM-DD HH:mm')}`, left + width - 210, doc.y + 28, { width: 180, align: 'right' });
  doc.y += 96;
}

function drawFindingLogItem(doc, finding) {
  ensureSpace(doc, 150);
  const left = 36;
  const contentX = 92;
  const right = doc.page.width - 36;
  const startY = doc.y;
  const name = finding.created_by_name || 'QA';
  const initial = name.slice(0, 1).toUpperCase();

  doc.circle(left + 18, startY + 18, 18).fill('#f5a400');
  doc.fillColor('#ffffff').fontSize(14).text(initial, left + 12, startY + 9, { width: 14, align: 'center' });

  doc.fillColor('#111827').fontSize(11).text(name, contentX, startY);
  doc.fillColor('#8a94a3').fontSize(9).text(formatDate(finding.created_at), contentX + 126, startY + 1);
  drawStatusBadge(doc, finding.status, right - 52, startY - 2);

  doc.fillColor('#111827').fontSize(11).text('Mevcut Durum:', contentX, startY + 30);
  doc.fillColor('#111827').fontSize(10).text(finding.description || finding.title || '-', contentX, startY + 48, {
    width: right - contentX - 20,
    lineGap: 2
  });
  doc.moveDown(0.6);

  doc.y = Math.max(doc.y + 6, startY + 82);
  if (finding.attachments.length) {
    finding.attachments.forEach((file) => drawAttachment(doc, file, contentX));
  } else {
    drawMissingImageBox(doc, contentX);
  }

  if (finding.comments.length) {
    doc.moveDown(0.5);
    finding.comments.forEach((comment) => {
      ensureSpace(doc, 42);
      doc.fillColor('#6b7280').fontSize(9).text(`${comment.created_by_name || '-'} - ${formatDate(comment.created_at)}`, contentX, doc.y);
      doc.fillColor('#111827').fontSize(10).text(comment.body || '-', contentX, doc.y + 14, { width: right - contentX - 20, lineGap: 2 });
      doc.y += 34;
    });
  }

  doc.moveTo(left, doc.y + 16).lineTo(right, doc.y + 16).strokeColor('#d9dee5').stroke();
  doc.y += 36;
}

function drawStatusBadge(doc, status, x, y) {
  const isFailed = status === 'Test Başarısız' || status === 'Failed';
  const label = isFailed ? 'Failed' : status;
  const width = Math.max(50, doc.widthOfString(label) + 14);
  doc.roundedRect(x - width + 52, y, width, 24, 3).fill(isFailed ? '#e83b2e' : '#0786d8');
  doc.fillColor('#ffffff').fontSize(9).text(label, x - width + 59, y + 7, { width: width - 14, align: 'center' });
}

function drawAttachment(doc, file, x) {
  const absolute = path.join(process.cwd(), file.url.replace(/^\//, ''));
  ensureSpace(doc, 260);
  doc.rect(x, doc.y, 300, 24).fill('#eef0f2');
  doc.fillColor('#7b8491').fontSize(9).text('Image', x + 12, doc.y + 8);
  doc.y += 28;

  if (fs.existsSync(absolute)) {
    try {
      doc.image(absolute, x, doc.y, { fit: [300, 210], align: 'left' });
      doc.y += 220;
      return;
    } catch {
      // Fall through to the text placeholder.
    }
  }

  doc.rect(x, doc.y, 300, 36).fill('#f7f8fa');
  doc.fillColor('#8a94a3').fontSize(10).text('Görsel bulunamadı.', x + 12, doc.y + 13);
  doc.y += 46;
}

function drawMissingImageBox(doc, x) {
  ensureSpace(doc, 80);
  doc.rect(x, doc.y, 300, 24).fill('#eef0f2');
  doc.fillColor('#7b8491').fontSize(9).text('Image', x + 12, doc.y + 8);
  doc.rect(x, doc.y + 24, 300, 36).fill('#f7f8fa');
  doc.fillColor('#8a94a3').fontSize(10).text('Görsel eklenmemiş.', x + 12, doc.y + 38);
  doc.y += 74;
}

function formatDate(value) {
  return value ? dayjs(value).format('MM/DD/YYYY HH:mm') : '-';
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > 760) doc.addPage();
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.fontSize(9).fillColor('#6b7280').text(`Sayfa ${i + 1} / ${range.count}`, 48, 790, { align: 'center' });
  }
}

function section(doc, title, body) {
  doc.fontSize(11).fillColor('#374151').text(title, { underline: true });
  doc.moveDown(0.25);
  doc.fontSize(10).fillColor('#111827').text(body || '-', { lineGap: 2 });
  doc.moveDown(0.7);
}
