// v12.3: stored file names end in a version (<name>_v1, _v2 ...) instead of 8 hex of the SHA-256,
// and old hash-suffixed files can be renamed (with their records) by the admin.
//   node tests/v12_3/api_revision_names.js <copyRoot> <port>
// <copyRoot> = isolated copy (app\system + empty NPI_EPM_Documents_Control) whose launcher
// already runs on <port>. Never use on the live app.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = process.argv[2], BASE = 'http://localhost:' + process.argv[3];
if (!ROOT || !process.argv[3]) { console.error('usage: node api_revision_names.js <copyRoot> <port>'); process.exit(2); }
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };
class Client {
  constructor() { this.cookie = ''; }
  async req(method, p, body) {
    const h = {}; if (this.cookie) h.Cookie = this.cookie; if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
    const r = await fetch(BASE + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = null; try { j = await r.json(); } catch (e) { }
    return { s: r.status, j };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
}
const VAULT = path.join(ROOT, 'NPI_EPM_Documents_Control');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const b64 = s => Buffer.from(s).toString('base64');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(BASE + '/api/auth/status')).ok) break; } catch (e) { } await sleep(500); }
  const admin = new Client(), user = new Client();
  const PIN = readJson(path.join(ROOT, 'app', 'system', 'config.json')).admin_pin;
  let r = await admin.post('/api/auth/login', { username: 'admin', password: PIN });
  r = await admin.post('/api/auth/change-password', { current: PIN, new: 'Admin-Test-2026' });
  check('admin signs in', r.s === 200, r.j);
  r = await admin.post('/api/auth/reset-password', { username: 'Hoang' });
  const tmp = r.j.temp_password;
  await user.post('/api/auth/login', { username: 'Hoang', password: tmp });
  await user.post('/api/auth/change-password', { current: tmp, new: 'hoang-pass-1' });

  /* ---- new uploads: _v1, _v2 ... ---- */
  const up = (name, text) => admin.post('/api/upload', { fileName: name, contentBase64: b64(text), docType: 'DWG', family: 'Model1', partId: '', keepOriginalName: true });
  r = await up('Fresh.txt', 'content A');
  check('a new file is stored as <name>_v1', r.s === 200 && r.j.fileName === 'Fresh_v1.txt' && /Fresh_v1\.txt$/.test(r.j.relPath), r.j);
  r = await up('Fresh.txt', 'content A');
  check('the same bytes again are a duplicate of v1, not a new version', r.j.duplicate === true && r.j.fileName === 'Fresh_v1.txt', r.j);
  r = await up('Fresh.txt', 'content B');
  check('different content under the same name becomes _v2', r.j.duplicate === false && r.j.fileName === 'Fresh_v2.txt', r.j);
  r = await up('Fresh.txt', 'content C');
  check('...and the next one _v3', r.j.fileName === 'Fresh_v3.txt', r.j);
  check('no file name carries a hash code any more', fs.readdirSync(path.join(VAULT, 'Model1', 'DWG')).every(n => !/_[0-9a-f]{8}\./.test(n)), fs.readdirSync(path.join(VAULT, 'Model1', 'DWG')));
  check('every version is a real, separate file with its own content', fs.readFileSync(path.join(VAULT, 'Model1', 'DWG', 'Fresh_v1.txt'), 'utf8') === 'content A' && fs.readFileSync(path.join(VAULT, 'Model1', 'DWG', 'Fresh_v3.txt'), 'utf8') === 'content C');
  // a pre-v12.3 file holding the same bytes still counts as the duplicate
  const oldText = 'old style file', oldHex = sha(oldText).slice(0, 8);
  fs.writeFileSync(path.join(VAULT, 'Model1', 'DWG', 'Legacy_' + oldHex + '.txt'), oldText);
  r = await up('Legacy.txt', oldText);
  check('identical bytes under an old hash-suffixed name are recognised as a duplicate', r.j.duplicate === true && r.j.fileName === 'Legacy_' + oldHex + '.txt', r.j);

  /* ---- plant old-style files: two tracked, one stray, one ignored, one that only looks hashed ---- */
  const dir = path.join(VAULT, 'Model1', 'PRF'); fs.mkdirSync(dir, { recursive: true });
  const mk = (stem, text) => { const h = sha(text); const f = stem + '_' + h.slice(0, 8) + '.txt'; fs.writeFileSync(path.join(dir, f), text); return { f, h }; };
  const t1 = mk('PRF_Model1', 'first revision'), t2 = mk('PRF_Model1', 'second revision'), stray = mk('PRF_Model1', 'third, stray');
  const ign = mk('Ignored_note', 'ignore me');
  fs.writeFileSync(path.join(dir, 'Report_deadbeef.txt'), 'hex-like word only');
  r = await admin.post('/api/projects', { process: 'NPI', family: 'Model1', class_abcde: 'E', prf_date: '2026-01-05', created_by: 'admin' });
  const pid = r.j.project_id;
  const row = (t, when) => ({ project_id: pid, step_key: 'NPI-1', doc_code: 'PRF', file_name: t.f, file_path: path.join(dir, t.f), sha256: t.h, status: 'Filed', kind: 'file', uploaded_by: 'admin', uploaded_utc: when });
  await admin.post('/api/action', { store: 'lb_deliverables', row: row(t2, '2026-01-02T00:00:00.000Z') });
  await admin.post('/api/action', { store: 'lb_deliverables', row: row(t1, '2026-01-01T00:00:00.000Z') });
  await admin.post('/api/action', { store: 'lb_vault_ignored', row: { file_path: 'Model1\\PRF\\' + ign.f, ignored_by: 'admin', ignored_utc: '2026-01-03T00:00:00.000Z', reason: 'test' } });

  /* ---- preview, rights, apply ---- */
  r = await user.get('/api/vault/rename-revisions'); check('a non-admin cannot preview the rename', r.s === 403, r.s);
  r = await user.post('/api/vault/rename-revisions', {}); check('a non-admin cannot rename', r.s === 403, r.s);
  r = await admin.get('/api/vault/rename-revisions');
  check('the preview finds the five hash-suffixed files (3 PRF, the ignored note, the Legacy one) and nothing else', r.s === 200 && r.j.files === 5, r.j);
  check('a name that only looks hashed (not the file\'s own SHA-256) is left out', !JSON.stringify(r.j.sample).includes('deadbeef'));
  r = await admin.post('/api/vault/rename-revisions', {});
  check('the admin renames them', r.s === 200 && r.j.renamed === 5 && r.j.errors.length === 0, r.j);
  const names = fs.readdirSync(dir).sort();
  check('versions follow the order the files were filed: v1 = oldest, the stray one last', fs.readFileSync(path.join(dir, 'PRF_Model1_v1.txt'), 'utf8') === 'first revision' && fs.readFileSync(path.join(dir, 'PRF_Model1_v2.txt'), 'utf8') === 'second revision' && fs.readFileSync(path.join(dir, 'PRF_Model1_v3.txt'), 'utf8') === 'third, stray', names);
  check('the ignored stray file was renamed too', fs.existsSync(path.join(dir, 'Ignored_note_v1.txt')));
  check('the hex-like name was not touched', fs.existsSync(path.join(dir, 'Report_deadbeef.txt')));
  check('no old hash-suffixed name is left', !names.some(n => n.includes(t1.h.slice(0, 8)) || n.includes(t2.h.slice(0, 8)) || n.includes(stray.h.slice(0, 8)) || n.includes(ign.h.slice(0, 8))), names);
  const data = (await admin.get('/api/data')).j;
  const rows = data.tracking.lb_deliverables.filter(d => d.project_id === pid);
  check('the file records point at the new names', rows.length === 2 && rows.some(d => d.file_name === 'PRF_Model1_v1.txt' && d.file_path.endsWith('PRF_Model1_v1.txt')) && rows.some(d => d.file_name === 'PRF_Model1_v2.txt' && d.file_path.endsWith('PRF_Model1_v2.txt')), rows.map(d => [d.file_name, d.file_path]));
  const ig = data.tracking.lb_vault_ignored.filter(i => /Ignored_note/.test(i.file_path));
  check('the "not a deliverable" record follows its file', ig.length === 1 && /Ignored_note_v1\.txt$/.test(ig[0].file_path), ig);
  r = await admin.get('/api/vault/orphans');
  const orph = (r.j.orphans || []).map(o => o.path);
  check('only the renamed stray file is listed as uncategorized (the ignored one stays ignored)', orph.includes('Model1\\PRF\\PRF_Model1_v3.txt') && !orph.some(p => /Ignored_note/.test(p)), orph);
  r = await admin.get('/api/vault/rename-revisions'); check('nothing is left to rename', r.j.files === 0, r.j);
  r = await admin.post('/api/vault/rename-revisions', {}); check('a second run renames nothing', r.j.renamed === 0, r.j);
  r = await admin.get('/api/data');
  check('the rename is in the activity log', r.j.tracking.lb_audit.some(a => a.action === 'Vault_Rename_Revisions'));

  /* ---- a new upload continues after the renamed versions ---- */
  r = await admin.post('/api/upload', { fileName: 'PRF_Model1.txt', contentBase64: b64('fourth revision'), docType: 'PRF', family: 'Model1', partId: '', keepOriginalName: true });
  check('the next upload continues the numbering (_v4)', r.j.fileName === 'PRF_Model1_v4.txt' && r.j.relPath === 'Model1\\PRF\\PRF_Model1_v4.txt', r.j);

  try { await admin.post('/api/shutdown', {}); } catch (e) { }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed ' + (e && e.stack || e)); process.exit(1); });
