// v12 server-side checks: login, sessions, hashed passwords, admin user
// management, the common-vault folder structure and personal vaults.
//   node tests/v12/api_auth_vaults.js <copyRoot> <port>
// <copyRoot> is an ISOLATED copy (app\system + an empty NPI_EPM_Documents_Control)
// whose launcher is already running on <port> with no system\auth folder yet.
// Never point this at the live app: it changes passwords and stops the server.
const fs = require('fs'), path = require('path');
const ROOT = process.argv[2], BASE = 'http://localhost:' + process.argv[3];
if (!ROOT || !process.argv[3]) { console.error('usage: node api_auth_vaults.js <copyRoot> <port>'); process.exit(2); }
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };
class Client {
  constructor() { this.cookie = ''; }
  async req(method, p, body) {
    const h = {}; if (this.cookie) h.Cookie = this.cookie; if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
    const r = await fetch(BASE + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { j = { _text: t.slice(0, 80) }; }
    return { s: r.status, j, loc: r.headers.get('location'), ct: r.headers.get('content-type') };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

(async () => {
  for (let i = 0; i < 90; i++) { try { const r = await fetch(BASE + '/api/auth/status'); if (r.ok) break; } catch (e) { } await new Promise(r => setTimeout(r, 500)); }
  const cfgPath = path.join(ROOT, 'app', 'system', 'config.json');
  const PIN = readJson(cfgPath).admin_pin;
  const authDir = path.join(ROOT, 'app', 'system', 'auth');
  const anon = new Client(), admin = new Client(), hoang = new Client(), qa = new Client();
  let r;

  /* ---- signed out ---- */
  r = await anon.get('/api/auth/status'); check('status when signed out', r.s === 200 && r.j.authenticated === false && !!r.j.app.version, r.j);
  r = await anon.get('/api/data'); check('/api/data needs a session', r.s === 401, r.s);
  r = await anon.get('/'); check('/ redirects to the login page', r.s === 302 && r.loc === '/login.html', [r.s, r.loc]);
  r = await anon.get('/vault.html'); check('/vault.html redirects to the login page', r.s === 302, r.s);
  r = await anon.get('/styles.css'); check('stylesheet is served without a session', r.s === 200, r.s);
  r = await anon.post('/api/action', { store: 'lb_audit', row: {} }); check('a write needs a session', r.s === 401, r.s);
  r = await anon.get('/api/vaults'); check('vault list needs a session', r.s === 401, r.s);

  /* ---- admin first sign-in ---- */
  r = await admin.post('/api/auth/login', { username: 'admin', password: 'nope-nope' }); check('wrong password rejected', r.s === 401 && r.j.tries_left === 4, r.j);
  r = await admin.post('/api/auth/login', { username: 'ADMIN', password: PIN }); check('admin signs in with the old PIN, name is case-insensitive', r.s === 200 && r.j.must_change === true && r.j.user === 'admin', r.j);
  r = await admin.get('/api/data'); check('a temporary-password session cannot read data', r.s === 401, r.s);
  r = await admin.get('/api/auth/users'); check('a temporary-password session cannot manage users', r.s === 403, r.s);
  r = await admin.post('/api/auth/change-password', { current: PIN, new: 'short' }); check('short password refused', r.s === 400, r.j);
  r = await admin.post('/api/auth/change-password', { current: 'wrong', new: 'Admin-Test-2026' }); check('wrong current password refused', r.s === 403, r.j);
  r = await admin.post('/api/auth/change-password', { current: PIN, new: 'Admin-Test-2026' }); check('admin sets a password', r.s === 200, r.j);
  r = await admin.get('/api/data'); check('/api/data after sign-in carries the session', r.s === 200 && r.j.session.user === 'admin' && r.j.session.is_admin === true, r.j && r.j.session);
  check('admin_pin is not sent to the browser', r.j.config.admin_pin === undefined);
  check('admin_pin is removed from config.json', readJson(cfgPath).admin_pin === undefined);
  check('default folder levels reported', JSON.stringify(r.j.folder_levels) === '["[Model]","[DocType]","[PartID]"]', r.j.folder_levels);
  const adminFile = fs.readdirSync(authDir).find(f => f.startsWith('u_admin_'));
  const rec = readJson(path.join(authDir, adminFile));
  check('the password is stored as a PBKDF2 hash only', /^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(rec.password_hash) && !JSON.stringify(rec).includes('Admin-Test-2026') && rec.recovery === undefined, Object.keys(rec));

  /* ---- admin manages users ---- */
  r = await admin.get('/api/auth/users'); const U = r.j.users || [];
  check('users list shows who has a password', r.s === 200 && U.length >= 3 && U.find(u => u.username === 'admin').has_password && !U.find(u => u.username === 'Hoang').has_password && r.j.admin_can_view === false, U.map(u => [u.username, u.has_password]));
  r = await hoang.post('/api/auth/login', { username: 'Hoang', password: 'whatever1' }); check('no sign-in before a password is issued', r.s === 403 && r.j.no_password === true, r.j);
  r = await admin.post('/api/auth/reset-password', { username: 'Hoang' }); const tmpH = r.j.temp_password; check('admin issues a temporary password', r.s === 200 && /^Temp-[a-z2-9]{6}$/.test(tmpH), r.j);
  r = await admin.post('/api/auth/reset-password', { username: 'admin' }); check('the admin password cannot be reset this way', r.s === 400, r.s);
  r = await admin.post('/api/auth/reset-password', { username: 'qa' }); const tmpQ = r.j.temp_password;
  r = await hoang.post('/api/auth/login', { username: 'hoang', password: tmpH }); check('user signs in with the temporary password', r.s === 200 && r.j.must_change && r.j.user === 'Hoang', r.j);
  r = await hoang.post('/api/auth/change-password', { current: tmpH, new: 'hoang-pass-1' }); check('user sets their own password', r.s === 200, r.j);
  r = await hoang.get('/api/auth/users'); check('non-admin cannot list users', r.s === 403, r.s);
  r = await hoang.post('/api/auth/reset-password', { username: 'qa' }); check('non-admin cannot reset passwords', r.s === 403, r.s);

  /* ---- identity comes from the session ---- */
  r = await hoang.post('/api/config/pillars', { user: 'admin', pillars: [] }); check('user=admin in the body does not grant admin', r.s === 403, [r.s, r.j]);
  r = await hoang.post('/api/config/folder-structure', { user: 'admin', levels: ['[DocType]'] }); check('non-admin cannot change the folder structure', r.s === 403, r.s);
  r = await hoang.post('/api/action', { store: 'lb_issues', row: { project_id: 'NPI-9611', title: 'auth smoke', raised_by: 'Hoang' }, audit: { user: 'admin', action: 'Smoke', projectId: 'NPI-9611', objType: 'Issue', objId: '', from: '', to: '', detail: 'spoof test' } });
  check('a signed-in user can write', r.s === 200, r.j);
  r = await admin.get('/api/data'); const au = r.j.tracking.lb_audit.filter(a => a.action === 'Smoke');
  check('the audit line names the session user, not the claimed one', au.length === 1 && au[0].user === 'Hoang', au);
  check('sign-in is audited', r.j.tracking.lb_audit.some(a => a.action === 'Auth_Login' && a.user === 'Hoang'));

  /* ---- common vault folder structure ---- */
  r = await admin.post('/api/config/folder-structure', { levels: ['[Nope]'] }); check('unknown folder token refused', r.s === 400, r.j);
  r = await admin.post('/api/config/folder-structure', { levels: ['plain text'] }); check('a structure with no token refused', r.s === 400, r.j);
  r = await admin.post('/api/config/folder-structure', { levels: ['[ProjectID]', '[Process] docs', '[DocType]', '[PartID]'] }); check('admin sets the folder structure', r.s === 200, r.j);
  check('the structure is written to config.json', readJson(cfgPath).deployment_defaults.evidence_folder_pattern === '[ProjectID]\\[Process] docs\\[DocType]\\[PartID]', readJson(cfgPath).deployment_defaults.evidence_folder_pattern);
  const b64 = Buffer.from('hello v12 ' + Date.now()).toString('base64');
  r = await hoang.post('/api/upload', { fileName: 'note.txt', contentBase64: b64, docType: 'DWG', family: '9611', partId: 'Blade', projectId: 'NPI-9611', stepKey: 'NPI-2', keepOriginalName: true });
  check('an upload follows the new structure', r.s === 200 && /^NPI-9611\\NPI docs\\DWG\\Blade\\note_v1\.txt$/.test(r.j.relPath), r.j && r.j.relPath);
  r = await hoang.post('/api/upload', { fileName: 'note2.txt', contentBase64: b64, docType: 'BOM', family: '9611', partId: '', projectId: 'NPI-9611', keepOriginalName: true });
  check('a blank level is dropped', r.s === 200 && /^NPI-9611\\NPI docs\\BOM\\note2_/.test(r.j.relPath), r.j && r.j.relPath);
  r = await hoang.get('/api/vault/orphans'); const og = (r.j.orphans || []).find(o => /Blade\\note_/.test(o.path));
  check('the uncategorized-file guess reads the configured levels', !!og && !!og.guess && og.guess.project_id === 'NPI-9611' && og.guess.doc_code === 'DWG' && og.guess.part_id === 'Blade', og);

  /* ---- Vietnamese text in a query string (was mojibake before v12) ---- */
  r = await hoang.post('/api/upload', { fileName: 'dao.txt', contentBase64: b64, docType: 'DWG', family: '9611', partId: 'Lưỡi dao', projectId: 'NPI-9611', keepOriginalName: true });
  const upVi = r.j;
  r = await hoang.post('/api/deliverables/batch', { rows: [{ project_id: 'NPI-9611', step_key: 'NPI-2', doc_code: 'DWG', part_id: 'Lưỡi dao', file_name: upVi.fileName, file_path: upVi.path, sha256: upVi.sha256, status: 'Filed', kind: 'file', uploaded_by: 'Hoang', uploaded_utc: new Date().toISOString(), original_name: 'dao.txt' }] });
  check('a document with a Vietnamese part name is filed', r.s === 200 && r.j.results[0].ok === true, r.j);
  r = await hoang.get('/api/document-history?project_id=NPI-9611&step_key=NPI-2&doc_code=DWG&part_id=' + encodeURIComponent('Lưỡi dao'));
  check('document history finds a Vietnamese part name sent in the query string', r.s === 200 && r.j.revisions.length === 1 && r.j.part_id === 'Lưỡi dao', r.j);
  r = await hoang.get('/api/vault/search?q=' + encodeURIComponent('lưỡi'));
  check('Vault search finds a Vietnamese word', r.s === 200 && r.j.total >= 1 && r.j.rows.some(x => x.part_id === 'Lưỡi dao'), r.j && r.j.total);

  /* ---- personal vaults ---- */
  const cfg = {
    fields: [{ label: 'Title', type: 'text', required: true, inList: true }, { label: 'Khu vực', type: 'list', options: ['Line 1', 'Kho'], required: true, inList: true }],
    doctypes: [{ code: 'a3', name: 'A3 report' }, { code: 'PHOTO', name: 'Photos' }],
    processes: [{ name: 'PDCA', steps: [{ name: 'Plan', days: 7, docs: ['A3'] }, { name: 'Do', days: 14, docs: ['PHOTO', 'A3'] }] }],
    folder: ['[Khu vực]', '[Project ID] [Title]', '[Step]', '[DocType]']
  };
  const vdir = path.join(ROOT, 'Personal_Vaults', 'Hoang', 'Kaizen và 5S');
  r = await hoang.get('/api/vaults'); check('the vault list starts with the common vault', r.s === 200 && r.j.vaults.length === 1 && r.j.vaults[0].id === 'common' && r.j.vaults[0].name === 'NPI_EPM_Documents_Control', r.j);
  r = await hoang.post('/api/vaults', { name: 'Bad setup', config: Object.assign({}, cfg, { processes: [] }) }); check('an invalid setup is refused', r.s === 400, r.j);
  r = await hoang.post('/api/vaults', { name: 'Kaizen và 5S', config: cfg }); const vid = r.j.vault && r.j.vault.id; check('personal vault created', r.s === 200 && /^v_[a-z0-9]+$/.test(vid) && r.j.vault.owner === 'Hoang', r.j);
  check('its folder sits beside the common vault', fs.existsSync(path.join(vdir, '_vault', 'vault.json')));
  r = await hoang.post('/api/vaults', { name: 'Kaizen và 5S', config: cfg }); check('a duplicate vault name is refused', r.s === 409, r.s);
  r = await hoang.get('/api/vaults/' + vid); const V = r.j.vault;
  check('the owner can read the vault', r.s === 200 && V.fields.length === 2 && V.doctypes[0].code === 'A3' && V.processes[0].steps.length === 2 && Array.isArray(V.processes[0].steps[0].docs) && Array.isArray(r.j.projects) && r.j.projects.length === 0, r.j);
  await qa.post('/api/auth/login', { username: 'qa', password: tmpQ }); await qa.post('/api/auth/change-password', { current: tmpQ, new: 'qa-pass-123' });
  r = await qa.get('/api/vaults/' + vid); check('another user cannot open it', r.s === 404, r.s);
  r = await qa.get('/api/vaults'); check('another user does not see it listed', r.j.vaults.length === 1, r.j.vaults.map(v => v.name));
  r = await admin.get('/api/vaults'); check('the admin sees every vault', r.j.vaults.length === 2 && r.j.vaults[1].mine === false, r.j.vaults.map(v => v.name));
  const fk = V.fields.map(f => f.key), pid = V.processes[0].id;
  r = await hoang.post('/api/vaults/' + vid + '/projects', { process_id: pid, start: '2026-10-01', values: { [fk[0]]: '' } }); check('required fields are enforced', r.s === 400 && /Title/.test(r.j.error), r.j);
  r = await hoang.post('/api/vaults/' + vid + '/projects', { process_id: pid, start: '2026-10-01', values: { [fk[0]]: 'Giảm thời gian đổi dao', [fk[1]]: 'Nope' } }); check('a list field only takes its own choices', r.s === 400, r.j);
  r = await hoang.post('/api/vaults/' + vid + '/projects', { process_id: pid, start: '2026-10-01', values: { [fk[0]]: 'Giảm thời gian đổi dao', [fk[1]]: 'Line 1' } });
  let P = (r.j.projects || [])[0];
  check('project registered, deadlines counted from the start date', r.s === 200 && r.j.project_id === 'P-001' && P.steps[0].due === '2026-10-08' && P.steps[1].due === '2026-10-22' && P.steps[1].docs.length === 2 && Array.isArray(P.steps[0].docs[0].files), P);
  r = await hoang.post('/api/vaults/' + vid + '/projects', { process_id: pid, start: '2026-11-01', dues: ['2026-11-03', 'bad'], values: { [fk[0]]: 'Second', [fk[1]]: 'Kho' } });
  check('second project with one hand-set deadline', r.s === 200 && r.j.project_id === 'P-002' && r.j.projects.length === 2 && r.j.projects[1].steps[0].due === '2026-11-03' && r.j.projects[1].steps[1].due === '2026-11-22', r.j.projects && r.j.projects[1]);
  r = await hoang.post('/api/vaults/' + vid + '/project-update', { project_id: 'P-001', steps: [{ status: 'done' }, { status: 'doing', due: '2026-10-25' }] });
  P = r.j.projects[0]; check('step status and deadline updated', r.s === 200 && P.steps[0].status === 'done' && !!P.steps[0].done_utc && P.steps[1].status === 'doing' && P.steps[1].due === '2026-10-25' && r.j.projects.length === 2, P);
  const rel = 'Line 1\\P-001 Giảm thời gian đổi dao\\Plan\\A3\\A3 báo cáo.txt';
  r = await hoang.post('/api/vaults/' + vid + '/upload', { project_id: 'P-001', step_index: 0, code: 'A3', fileName: 'A3 báo cáo.txt', contentBase64: b64 });
  check('a document is filed under the vault folder levels', r.s === 200 && r.j.rel_path === rel, r.j.rel_path);
  check('the file is on disk', fs.existsSync(path.join(vdir, rel)));
  r = await hoang.post('/api/vaults/' + vid + '/upload', { project_id: 'P-001', step_index: 0, code: 'A3', fileName: 'A3 báo cáo.txt', contentBase64: b64 });
  check('the same file twice is one entry', r.s === 200 && r.j.duplicate === true && r.j.projects[0].steps[0].docs[0].files.length === 1, r.j.projects[0].steps[0].docs[0]);
  r = await hoang.post('/api/vaults/' + vid + '/upload', { project_id: 'P-001', step_index: 0, code: 'A3', fileName: 'A3 báo cáo.txt', contentBase64: Buffer.from('different').toString('base64') });
  check('a different file with the same name is kept apart', r.s === 200 && /A3 báo cáo_v2\.txt$/.test(r.j.rel_path) && r.j.projects[0].steps[0].docs[0].files.length === 2, r.j.rel_path);
  r = await hoang.post('/api/vaults/' + vid + '/upload', { project_id: 'P-001', step_index: 0, code: 'PHOTO', fileName: 'x.txt', contentBase64: b64 }); check('a document type the step does not expect is refused', r.s === 400, r.j);
  const fileUrl = '/api/vaults/' + vid + '/file?path=' + encodeURIComponent(rel);
  r = await hoang.get(fileUrl); check('the owner can open the file', r.s === 200 && /text\/plain/.test(r.ct), [r.s, r.ct]);
  r = await qa.get(fileUrl); check('another user cannot open the file', r.s === 404, r.s);
  r = await hoang.get('/api/vaults/' + vid + '/file?path=' + encodeURIComponent('_vault\\vault.json')); check('vault internals are not served', r.s === 404, r.s);
  r = await hoang.get('/api/vaults/' + vid + '/file?path=' + encodeURIComponent('..\\..\\..\\app\\system\\config.json')); check('a path outside the vault is refused', r.s === 404, r.s);
  r = await hoang.post('/api/vaults/' + vid + '/unfile', { project_id: 'P-001', step_index: 0, code: 'A3', rel_path: rel });
  check('unlisting a document leaves the file on disk', r.s === 200 && r.j.projects[0].steps[0].docs[0].files.length === 1 && fs.existsSync(path.join(vdir, rel)), r.j.projects[0].steps[0].docs[0]);
  const cfg2 = JSON.parse(JSON.stringify(V)); cfg2.fields.push({ label: 'Owner', type: 'text' }); cfg2.processes[0].steps.push({ name: 'Check', days: 3, docs: [] });
  r = await hoang.post('/api/vaults/' + vid + '/config', cfg2);
  check('setup saved, field keys and process ids kept', r.s === 200 && r.j.vault.fields.length === 3 && r.j.vault.fields[0].key === fk[0] && r.j.vault.processes[0].id === pid && r.j.vault.processes[0].steps.length === 3 && r.j.vault.seq === 2, r.j);
  cfg2.processes = [{ name: 'Other', steps: [{ name: 'S', days: 1, docs: [] }] }];
  r = await hoang.post('/api/vaults/' + vid + '/config', cfg2); check('a process that still has projects cannot be removed', r.s === 400, r.j);
  cfg2.processes = V.processes; cfg2.folder = ['[Missing field]'];
  r = await hoang.post('/api/vaults/' + vid + '/config', cfg2); check('an unknown folder token is refused', r.s === 400, r.j);
  r = await hoang.post('/api/vaults/' + vid + '/project-delete', { project_id: 'P-002' }); check('project deleted', r.s === 200 && r.j.projects.length === 1, r.j);
  r = await hoang.post('/api/vaults/' + vid + '/projects', { process_id: pid, start: '2026-12-01', values: { [fk[0]]: 'Third', [fk[1]]: 'Kho' } }); check('project ids are never reused', r.j.project_id === 'P-003', r.j.project_id);
  r = await admin.post('/api/vaults/' + vid + '/archive', { archived: true }); check('the admin can archive a vault', r.s === 200, r.j);
  r = await hoang.get('/api/vaults'); check('the archived flag is listed', r.j.vaults[1].archived === true, r.j.vaults[1]);
  check('nothing was written to the common tracking stores by the vault', !fs.readdirSync(path.join(ROOT, 'app', 'system', 'tracking')).some(f => /vault|personal/i.test(f)));

  /* ---- optional: admin can view passwords ---- */
  r = await admin.post('/api/auth/recovery', { enable: true, admin_password: 'bad' }); check('switching "view" on needs the admin password', r.s === 403, r.s);
  r = await admin.post('/api/auth/recovery', { enable: true, admin_password: 'Admin-Test-2026' }); check('"admin can view" switched on', r.s === 200 && r.j.admin_can_view === true, r.j);
  r = await admin.post('/api/auth/reveal', { username: 'Hoang', admin_password: 'Admin-Test-2026' }); check('no viewable copy until the user next signs in', r.s === 404, r.j);
  const hoang2 = new Client(); await hoang2.post('/api/auth/login', { username: 'Hoang', password: 'hoang-pass-1' });
  r = await admin.post('/api/auth/reveal', { username: 'Hoang', admin_password: 'wrong' }); check('a reveal needs the admin password', r.s === 403, r.s);
  r = await admin.post('/api/auth/reveal', { username: 'Hoang', admin_password: 'Admin-Test-2026' }); check('the admin reveals a password', r.s === 200 && r.j.password === 'hoang-pass-1', r.s);
  r = await hoang.post('/api/auth/reveal', { username: 'qa', admin_password: 'hoang-pass-1' }); check('a non-admin cannot reveal', r.s === 403, r.s);
  r = await admin.post('/api/auth/change-password', { current: 'Admin-Test-2026', new: 'Admin-Test-2027' }); check('admin changes password while "view" is on', r.s === 200, r.j);
  r = await admin.post('/api/auth/reveal', { username: 'Hoang', admin_password: 'Admin-Test-2027' }); check('reveal still works with the new admin password', r.s === 200 && r.j.password === 'hoang-pass-1', r.s);
  r = await admin.post('/api/auth/reset-password', { username: 'qa' }); const tq2 = r.j.temp_password;
  r = await admin.post('/api/auth/reveal', { username: 'qa', admin_password: 'Admin-Test-2027' }); check('a temporary password is viewable too', r.s === 200 && r.j.password === tq2, r.s);
  r = await qa.get('/api/data'); check('a reset signs that user out', r.s === 401, r.s);
  r = await admin.get('/api/data'); check('each reveal is audited', r.j.tracking.lb_audit.filter(a => a.action === 'Auth_Password_Reveal').length === 3, r.j.tracking.lb_audit.filter(a => /^Auth_/.test(a.action)).map(a => a.action));
  r = await admin.post('/api/auth/recovery', { enable: false, admin_password: 'Admin-Test-2027' }); check('"admin can view" switched off', r.s === 200 && r.j.admin_can_view === false, r.j);
  check('the viewable copies are deleted from disk', !fs.existsSync(path.join(authDir, '_recovery.json')) && fs.readdirSync(authDir).filter(f => f.startsWith('u_')).every(f => !/"recovery"/.test(fs.readFileSync(path.join(authDir, f), 'utf8'))));

  /* ---- roster removal, lockout, sign-out ---- */
  r = await admin.get('/api/data'); const reg = r.j.config.user_registry.filter(u => u.username !== 'qa');
  r = await admin.post('/api/config/user-registry', { registry: reg }); check('registry saved without qa', r.s === 200, r.j);
  check('a removed user loses the password file', !fs.readdirSync(authDir).some(f => f.startsWith('u_qa_')), fs.readdirSync(authDir));
  r = await qa.post('/api/auth/login', { username: 'qa', password: tq2 }); check('a removed user cannot sign in', r.s === 401, r.s);
  const lock = new Client(); let last;
  for (let i = 0; i < 5; i++) last = await lock.post('/api/auth/login', { username: 'Hoang', password: 'wrong' + i });
  check('the fifth wrong password locks the account', last.s === 401 && last.j.locked === true, last.j);
  r = await lock.post('/api/auth/login', { username: 'Hoang', password: 'hoang-pass-1' }); check('a locked account refuses even the right password', r.s === 429, r.s);
  r = await hoang.get('/api/data'); check('a session that is already open survives the lock', r.s === 200, r.s);
  await hoang.post('/api/auth/logout'); r = await hoang.get('/api/data'); check('sign-out ends the session', r.s === 401, r.s);

  /* ---- forgotten admin password: delete the admin file, restart ---- */
  r = await admin.post('/api/auth/recovery', { enable: true, admin_password: 'Admin-Test-2027' });
  check('"view" on again before the restart', r.s === 200 && fs.existsSync(path.join(authDir, '_recovery.json')), r.j);
  r = await anon.post('/api/shutdown', { user: 'smoke' }); check('Stop_Server still works without a session', r.s === 200, r.s);
  await new Promise(res => setTimeout(res, 2500));
  fs.readdirSync(authDir).filter(f => f.startsWith('u_admin_')).forEach(f => fs.unlinkSync(path.join(authDir, f)));
  const { spawn } = require('child_process');
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'app', 'system', 'launcher.ps1'), '-NoBrowser', '-Port', process.argv[3], '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(BASE + '/api/auth/status')).ok; } catch (e) { } if (!up) await new Promise(res => setTimeout(res, 500)); }
  const firstFile = path.join(authDir, 'ADMIN_FIRST_LOGIN.txt');
  const firstTxt = fs.existsSync(firstFile) ? fs.readFileSync(firstFile, 'utf8') : '';
  const firstPw = (/Password\s*:\s*(Temp-[a-z2-9]{6})/.exec(firstTxt) || [])[1];
  check('with no admin account and no PIN, a temporary admin password is written to a file', up && !!firstPw, firstTxt.length);
  check('the viewable copies locked with the lost password are cleared', !fs.existsSync(path.join(authDir, '_recovery.json')) && fs.readdirSync(authDir).filter(f => f.startsWith('u_')).every(f => !/"recovery"/.test(fs.readFileSync(path.join(authDir, f), 'utf8'))));
  const admin2 = new Client();
  r = await admin2.post('/api/auth/login', { username: 'admin', password: firstPw || 'x' }); check('the admin signs in with it and must replace it', r.s === 200 && r.j.must_change === true, r.j);
  r = await admin2.post('/api/auth/change-password', { current: firstPw, new: 'Admin-Test-2028' });
  check('once replaced, the file is deleted', r.s === 200 && !fs.existsSync(firstFile), r.j);
  r = await admin2.get('/api/vaults'); check('nothing else was lost (the personal vault is still there)', r.s === 200 && r.j.vaults.some(v => v.kind === 'personal' && v.owner === 'Hoang'), r.j.vaults && r.j.vaults.length);
  await anon.post('/api/shutdown', { user: 'smoke' });
  setTimeout(() => { try { srv.kill(); } catch (e) { } }, 1500);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
