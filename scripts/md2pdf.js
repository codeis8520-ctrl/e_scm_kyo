// 마크다운 → 스타일 HTML → PDF (헤드리스 Chrome/Edge)
// 사용: node scripts/md2pdf.js <input.md> <output.pdf>
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('사용: node scripts/md2pdf.js <input.md> <output.pdf>'); process.exit(1); }

const md = fs.readFileSync(inPath, 'utf8');

// ── 인라인 변환 ──
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) {
  let t = esc(s);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

// ── 블록 파서 ──
const lines = md.replace(/\r\n/g, '\n').split('\n');
let html = '';
let i = 0;
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

while (i < lines.length) {
  let line = lines[i];

  // 빈 줄
  if (/^\s*$/.test(line)) { i++; continue; }

  // 수평선
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { html += '<hr/>\n'; i++; continue; }

  // 제목
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) { const lv = h[1].length; html += `<h${lv}>${inline(h[2])}</h${lv}>\n`; i++; continue; }

  // 표
  if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
    const header = cells(line);
    i += 2; // skip header + separator
    let body = '';
    while (i < lines.length && isTableRow(lines[i])) {
      const c = cells(lines[i]);
      body += '<tr>' + c.map(x => `<td>${inline(x)}</td>`).join('') + '</tr>\n';
      i++;
    }
    html += '<table><thead><tr>' + header.map(x => `<th>${inline(x)}</th>`).join('') + '</tr></thead><tbody>\n' + body + '</tbody></table>\n';
    continue;
  }

  // 인용
  if (/^\s*>\s?/.test(line)) {
    let buf = [];
    while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(inline(lines[i].replace(/^\s*>\s?/, ''))); i++; }
    html += `<blockquote>${buf.join('<br/>')}</blockquote>\n`;
    continue;
  }

  // 순서 목록
  if (/^\s*\d+\.\s+/.test(line)) {
    let buf = '';
    while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>\n`; i++; }
    html += `<ol>${buf}</ol>\n`;
    continue;
  }

  // 비순서 목록
  if (/^\s*[-*]\s+/.test(line)) {
    let buf = '';
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>\n`; i++; }
    html += `<ul>${buf}</ul>\n`;
    continue;
  }

  // 문단 (연속 비어있지 않은 일반 줄)
  let buf = [];
  while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !isTableRow(lines[i]) && !/^\s*>/.test(lines[i]) && !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
    buf.push(inline(lines[i])); i++;
  }
  html += `<p>${buf.join('<br/>')}</p>\n`;
}

const css = `
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif; font-size: 10.3pt; line-height: 1.65; color: #1f2937; margin: 0; }
h1 { font-size: 20pt; text-align: center; margin: 0 0 6px; letter-spacing: -0.5px; }
h1 + p, h1 + h2 { margin-top: 0; }
h2 { font-size: 12.5pt; margin: 22px 0 8px; padding: 6px 0 6px 10px; border-left: 4px solid #2563eb; background: #f1f5f9; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 16px 0 6px; color: #111827; page-break-after: avoid; }
p { margin: 6px 0; }
strong { color: #111827; }
code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-family: Consolas,monospace; font-size: 9.2pt; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
blockquote { margin: 10px 0; padding: 8px 14px; background: #f8fafc; border-left: 3px solid #94a3b8; color: #475569; font-size: 9.6pt; }
ul, ol { margin: 6px 0 6px 4px; padding-left: 20px; }
li { margin: 3px 0; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9.4pt; page-break-inside: avoid; }
th, td { border: 1px solid #d1d5db; padding: 6px 9px; text-align: left; vertical-align: top; }
th { background: #1e293b; color: #fff; font-weight: 600; }
tbody tr:nth-child(even) { background: #f8fafc; }
td:last-child, th:last-child { white-space: normal; }
/* 첫 h1(표지 제목) 강조 */
h1:first-of-type { padding-bottom: 12px; border-bottom: 2px solid #1e293b; }
`;

const fullHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;

const tmpHtml = path.join(os.tmpdir(), `md2pdf_${Date.now()}.html`);
fs.writeFileSync(tmpHtml, fullHtml, 'utf8');

// Chrome → Edge 순으로 탐색
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) { console.error('Chrome/Edge를 찾지 못했습니다.'); process.exit(1); }

const absOut = path.resolve(outPath);
const fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/');
const args = ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${absOut}`, fileUrl];
console.log('브라우저:', browser);
const r = spawnSync(browser, args, { stdio: 'inherit' });
fs.unlinkSync(tmpHtml);
if (r.status === 0 && fs.existsSync(absOut)) {
  console.log('PDF 생성 완료:', absOut, `(${(fs.statSync(absOut).size / 1024).toFixed(0)} KB)`);
} else {
  console.error('PDF 생성 실패. exit:', r.status);
  process.exit(1);
}
