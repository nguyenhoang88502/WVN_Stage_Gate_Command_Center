// v12.5: vault files whose full path is over 259 characters, and paths written by another PC.
//   node tests/v12_5/api_long_paths.js <copyRoot>
// <copyRoot> = isolated copy (app\system + empty NPI_EPM_Documents_Control). Port 8127. Never use on the live app.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { adminCookie, waitUp } = require('../lib/session');
const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node api_long_paths.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8127';
const VAULT = path.join(ROOT, 'NPI_EPM_Documents_Control');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };

(async () => {
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'app', 'system', 'launcher.ps1'), '-NoBrowser', '-Port', '8127', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  try {
    await waitUp(BASE);
    const admin = await adminCookie(BASE, ROOT);
    const call = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { Cookie: admin, 'Content-Type': 'application/json; charset=utf-8' }, body: b ? JSON.stringify(b) : undefined }); let j = null; let buf = null; if ((r.headers.get('content-type') || '').includes('json')) { try { j = await r.json(); } catch (e) { } } else { buf = Buffer.from(await r.arrayBuffer()); } return { s: r.status, j, buf }; };

    let r = await call('POST', '/api/projects', { process: 'NPI', family: 'LP1', class_abcde: 'E', prf_date: '2026-W20', target_date: '2026-W40', created_by: 'admin' });
    const pid = r.j.project_id;
    // a file whose absolute path is well over 259 characters, with Chinese and "&" in its names
    const rel = ['LP1', 'PRF', '9655-1517 Cord_Cordless Black & Titanium ' + 'x'.repeat(40), '2024.01.03 罗昌萍邮件 9655-1517 ' + 'y'.repeat(90) + '_v1.xls'].join('\\');
    const full = path.join(VAULT, rel);
    check('the test file really is over 259 characters', full.length > 259, full.length);
    fs.mkdirSync('\\\\?\\' + path.dirname(full), { recursive: true });
    fs.writeFileSync('\\\\?\\' + full, Buffer.from('long path content'));

    r = await call('GET', '/api/vault/view/' + rel.split('\\').map(encodeURIComponent).join('/'));
    check('the viewer serves a file whose path is over 259 characters', r.s === 200 && r.buf && r.buf.toString() === 'long path content', r.s);

    // a row written by another laptop: absolute path under ITS OneDrive root
    const foreign = 'C:\\Users\\intern-vtnm\\OneDrive - Wahl Clipper Corporation (1)\\NPI Information - Documents\\General\\Project Management\\5. Tools for NPI\\NPI_EPM_Documents_Control\\' + rel;
    await call('POST', '/api/action', { store: 'lb_deliverables', row: { project_id: pid, step_key: 'NPI-1', doc_code: 'PRF', file_name: path.basename(rel), file_path: foreign, status: 'Filed', kind: 'file', uploaded_by: 'admin', uploaded_utc: new Date().toISOString() } });
    let d = (await call('GET', '/api/data')).j;
    let row = d.tracking.lb_deliverables.find(x => x.project_id === pid && x.doc_code === 'PRF');
    check("another PC's absolute path is re-rooted onto this PC's vault", row && row.file_path.toLowerCase().endsWith(('\\NPI_EPM_Documents_Control\\' + rel).toLowerCase()) && !/intern-vtnm/.test(row.file_path), row && row.file_path);
    const stored = JSON.stringify(fs.readdirSync(path.join(VAULT, '_vault', 'journal')).flatMap(w => fs.readdirSync(path.join(VAULT, '_vault', 'journal', w)).map(f => fs.readFileSync(path.join(VAULT, '_vault', 'journal', w, f), 'utf8'))).join('\n'));
    check('what is stored is vault-relative, with no PC-specific root', stored.includes('LP1\\\\PRF\\\\9655-1517') && !/intern-vtnm/.test(stored), stored.slice(0, 200));

    r = await call('POST', '/api/open-path', { path: path.join(VAULT, 'LP1', 'PRF', 'nope', 'missing.xls') });
    check('opening a missing file explains why (length, folder)', r.s === 400 && /characters/.test(r.j.error) && /folder/.test(r.j.error), r.j);
  } catch (e) {
    console.log('FAIL crashed ' + (e && e.stack || e)); fail++;
  } finally {
    try { srv.kill(); } catch (e) { }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
