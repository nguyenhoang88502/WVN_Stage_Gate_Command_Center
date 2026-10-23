// v12.2 server-side checks: project data lives IN the vault.
//   node tests/v12_2/api_vault_data.js <phase> <copyRoot> <port> [<vaultSourceRoot>]
// Phases (each against its own ISOLATED copy, launcher already running on <port>;
// see tests/v12_2/run_vault_data.sh):
//   write   a fresh app on an empty vault: writes land in <vault>\_vault, the
//           Excel copy is produced, the settings snapshot is saved
//   reopen  a NEW app copy on a COPY of that vault (the old app folder is gone):
//           projects and progress are all there, the saved settings are offered
//   legacy  data left in the old app-folder location (tracking\journal\<PC>) is
//           copied into the vault once and not counted twice
// Never point this at the live app: it changes passwords and stops the server.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const PHASE = process.argv[2], ROOT = process.argv[3], BASE = 'http://localhost:' + process.argv[4];
if (!PHASE || !ROOT || !process.argv[4]) { console.error('usage: node api_vault_data.js <phase> <copyRoot> <port>'); process.exit(2); }
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };
class Client {
  constructor() { this.cookie = ''; }
  async req(method, p, body) {
    const h = {}; if (this.cookie) h.Cookie = this.cookie; if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
    const r = await fetch(BASE + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { j = { _text: t.slice(0, 80) }; }
    return { s: r.status, j };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VAULT = path.join(ROOT, 'NPI_EPM_Documents_Control');
const SYS = path.join(ROOT, 'app', 'system');
const dataDir = path.join(VAULT, '_vault');
const listFiles = d => { try { return fs.readdirSync(d); } catch (e) { return []; } };
// the xlsx, read the way Excel would: every sheet's cell text
function xlsxDump(file) {
  const py = 'import sys,zipfile,re,json\nz=zipfile.ZipFile(sys.argv[1])\nwb=z.read("xl/workbook.xml").decode()\n' +
    'names=re.findall(r\'<sheet name="([^"]*)"\',wb)\nout={}\nfor i,n in enumerate(names,1):\n x=z.read("xl/worksheets/sheet%d.xml"%i).decode()\n out[n]=re.findall(r"<t[^>]*>([^<]*)</t>",x)\n' +
    'import openpyxl\nws=openpyxl.load_workbook(sys.argv[1]).sheetnames\nprint(json.dumps({"names":names,"openpyxl":ws,"cells":out}))';
  return JSON.parse(cp.execFileSync('python', ['-I', '-c', py, file], { encoding: 'utf8' }));
}
async function signInAdmin(admin, pw) {
  const PIN = readJson(path.join(SYS, 'config.json')).admin_pin;
  let r = await admin.post('/api/auth/login', { username: 'admin', password: PIN });
  if (r.s !== 200 || !r.j.must_change) return r;
  r = await admin.post('/api/auth/change-password', { current: PIN, new: pw });
  return r;
}

(async () => {
  for (let i = 0; i < 90; i++) { try { const r = await fetch(BASE + '/api/auth/status'); if (r.ok) break; } catch (e) { } await sleep(500); }
  const admin = new Client();
  let r = await signInAdmin(admin, 'Admin-Test-2026');
  check(PHASE + ': admin signs in', r.s === 200, r.j);

  if (PHASE === 'write') {
    check('the vault has a _vault data folder from the start', fs.existsSync(path.join(dataDir, 'journal')), listFiles(VAULT));
    r = await admin.post('/api/projects', { process: 'NPI', family: 'VD1', class_abcde: 'E', prf_date: '2026-01-05', created_by: 'admin', notes: 'vault data test' });
    check('project registered', r.s === 200 && !!r.j.project_id, r.j);
    const pid = r.j.project_id;
    r = await admin.post('/api/action', { store: 'lb_gates', upsertKeys: ['project_id', 'step_key'], row: { project_id: pid, process: 'NPI', step_key: 'NPI-1', step_num: '1', step_name: 'Concept review', status: 'In Progress' } });
    check('step progress written', r.s === 200, r.j);
    r = await admin.post('/api/action', { store: 'lb_deliverables', row: { project_id: pid, step_key: 'NPI-1', doc_code: 'DWG', kind: 'link', link_url: 'https://example.test/drawing', status: 'Filed', uploaded_by: 'admin', uploaded_utc: new Date().toISOString(), description: 'Drawing of the vault test' } });
    check('document record written', r.s === 200, r.j);

    const jd = path.join(dataDir, 'journal', 'PC_A');
    check('journals are written in <vault>\\_vault\\journal\\<PC>', fs.existsSync(path.join(jd, 'lb_projects.csv')) && fs.existsSync(path.join(jd, 'lb_gates.csv')) && fs.existsSync(path.join(jd, 'lb_deliverables.csv')), listFiles(jd));
    const oldJ = path.join(SYS, 'tracking', 'journal', 'PC_A');
    check('nothing is written to the old app-folder location', !fs.existsSync(path.join(oldJ, 'lb_projects.csv')) && !fs.existsSync(path.join(oldJ, 'lb_gates.csv')), listFiles(oldJ));

    const baseline = (await admin.get('/api/data')).j.tracking.lb_projects.length;   // sample rows shipped in tracking\ (base files)
    r = await admin.get('/api/vault/data');
    check('/api/vault/data reports the stores', r.s === 200 && r.j.enabled === true && r.j.stores.lb_projects === baseline && r.j.stores.lb_gates >= 1 && r.j.stores.lb_deliverables >= 1, [baseline, r.j.stores]);
    fs.writeFileSync(path.join(ROOT, 'baseline.txt'), String(baseline));
    check('/api/vault/data lists this writer', (r.j.writers || []).some(w => w.writer === 'PC_A' && w.mine), r.j.writers);

    /* ---- the Excel copy ---- */
    r = await admin.post('/api/vault/data/export', {});
    check('Excel copy written on request', r.s === 200 && /Project_Information\.xlsx$/.test(r.j.path), r.j);
    const xl = path.join(VAULT, 'Project_Information.xlsx');
    check('Project_Information.xlsx sits in the vault folder', fs.existsSync(xl) && fs.statSync(xl).size > 1500);
    let dump = null;
    try { dump = xlsxDump(xl); } catch (e) { check('workbook opens (zip + openpyxl)', false, String(e.message).slice(0, 200)); }
    if (dump) {
      check('workbook opens in a real spreadsheet reader (openpyxl)', JSON.stringify(dump.openpyxl) === JSON.stringify(dump.names), dump);
      check('workbook has the expected sheets', JSON.stringify(dump.names) === JSON.stringify(['Read me', 'Projects', 'Progress by step', 'Documents', 'Approvals', 'Issues', 'Bypasses', 'Comments', 'Activity log']), dump.names);
      check('the project is on the Projects sheet', dump.cells['Projects'].includes(pid) && dump.cells['Projects'].includes('vault data test'), dump.cells['Projects'].slice(0, 30));
      check('the step progress is on its sheet', dump.cells['Progress by step'].includes('Concept review') && dump.cells['Progress by step'].includes('In Progress'));
      check('the document is on its sheet with a vault-relative path', dump.cells['Documents'].includes('Drawing of the vault test') && dump.cells['Documents'].includes('https://example.test/drawing'));
      check('the activity log is included', dump.cells['Activity log'].length > 10);
    }
    const sideA = fs.readFileSync(path.join(dataDir, 'info_workbook.sha256'), 'ascii').trim();
    const mtimeA = fs.statSync(xl).mtimeMs;
    await sleep(1200);
    r = await admin.get('/api/data'); // any request: the throttled export runs after it
    await sleep(500);
    check('an unchanged workbook is not rewritten', fs.statSync(xl).mtimeMs === mtimeA);
    // a change makes it dirty; the throttled export picks it up on a later request
    await admin.post('/api/action', { store: 'lb_gates', upsertKeys: ['project_id', 'step_key'], row: { project_id: pid, process: 'NPI', step_key: 'NPI-1', status: 'Complete' } });
    let changed = false;
    for (let i = 0; i < 40 && !changed; i++) { await sleep(1000); await admin.get('/api/auth/status'); changed = fs.readFileSync(path.join(dataDir, 'info_workbook.sha256'), 'ascii').trim() !== sideA; }
    check('the workbook follows a change by itself (within ~40 s, throttled)', changed);

    /* ---- orphan scan must ignore the data folder and the workbook ---- */
    fs.mkdirSync(path.join(VAULT, 'Stray'), { recursive: true });
    fs.writeFileSync(path.join(VAULT, 'Stray', 'real_orphan.txt'), 'x');
    r = await admin.get('/api/vault/orphans');
    const paths = (r.j.orphans || []).map(o => o.path);
    check('uncategorized scan lists a real stray file', paths.includes('Stray\\real_orphan.txt'), paths);
    check('uncategorized scan ignores _vault and Project_Information.xlsx', !paths.some(p => /^_vault\\/i.test(p) || /Project_Information/i.test(p)), paths);
    r = await admin.get('/api/vault/view/_vault/journal/PC_A/lb_projects.csv');
    check('the data folder is not served as a document', r.s === 404, r.s);
    r = await admin.post('/api/config/folder-structure', { levels: ['_vault', '[DocType]'] });
    check('a folder level cannot be _vault', r.s === 400, r.j);

    /* ---- settings snapshot ---- */
    r = await admin.post('/api/config/folder-structure', { levels: ['[Model]', '[DocType]'] });
    check('admin changes the folder structure', r.s === 200, r.j);
    const snapF = path.join(dataDir, 'config', 'PC_A.json');
    check('the settings are copied into the vault on save', fs.existsSync(snapF));
    if (fs.existsSync(snapF)) {
      const snap = readJson(snapF);
      check('snapshot carries the new folder levels', JSON.stringify(snap.config.deployment_defaults.evidence_folder_levels) === '["[Model]","[DocType]"]', snap.config.deployment_defaults.evidence_folder_levels);
      check('snapshot never holds the old admin PIN or a password', snap.config.admin_pin === undefined && !JSON.stringify(snap).match(/pbkdf2|Admin-Test-2026/));
      check('snapshot records who saved it', snap.by === 'admin' && snap.writer === 'PC_A' && !!snap.app_version, [snap.by, snap.writer, snap.app_version]);
    }
    r = await admin.get('/api/data');
    check('config carries the saved-by stamp', !!r.j.config.settings_saved_utc && r.j.config.settings_saved_by === 'admin');
    r = await admin.get('/api/vault/data');
    check('this app copy does not offer to restore its own settings', r.j.restore_available === false, r.j.restore_from);
    fs.writeFileSync(path.join(ROOT, 'project_id.txt'), pid);
  }

  if (PHASE === 'reopen') {
    const pid = fs.readFileSync(path.join(ROOT, 'project_id.txt'), 'ascii').trim();
    r = await admin.get('/api/data');
    const baseline = Number(fs.readFileSync(path.join(ROOT, 'baseline.txt'), 'ascii'));
    const projs = r.j.tracking.lb_projects;
    check('the project from the old app is here', projs.length === baseline && projs.some(p => p.project_id === pid && p.notes === 'vault data test'), [projs.length, baseline]);
    check('step progress came along', r.j.tracking.lb_gates.some(g => g.project_id === pid && g.step_key === 'NPI-1' && g.status === 'Complete'), r.j.tracking.lb_gates);
    check('the document record came along', r.j.tracking.lb_deliverables.some(d => d.project_id === pid && d.link_url === 'https://example.test/drawing'));
    check('the activity log came along', r.j.tracking.lb_audit.some(a => a.action === 'Config_FolderStructure_Update'));
    check('this new copy is still on factory folder levels', JSON.stringify(r.j.folder_levels) === '["[Model]","[DocType]","[PartID]"]', r.j.folder_levels);
    check('this new copy has no saved-by stamp', !r.j.config.settings_saved_utc);
    r = await admin.get('/api/vault/data');
    check('the vault offers its saved settings', r.j.restore_available === true && r.j.restore_from && r.j.restore_from.writer === 'PC_A' && r.j.restore_from.by === 'admin', r.j.restore_from);
    r = await new Client().post('/api/vault/data/restore', {});
    check('restore needs a session', r.s === 401, r.s);
    r = await admin.post('/api/vault/data/restore', {});
    check('admin restores the settings', r.s === 200 && !!r.j.backup && fs.existsSync(r.j.backup), r.j);
    r = await admin.get('/api/data');
    check('folder levels are the vault\'s after the restore', JSON.stringify(r.j.folder_levels) === '["[Model]","[DocType]"]', r.j.folder_levels);
    check('this PC keeps its own vault location after the restore', !!r.j.paths && r.j.paths.vault.toLowerCase().endsWith('npi_epm_documents_control'), r.j.paths);
    check('no admin PIN appears after the restore', r.j.config.admin_pin === undefined);
    r = await admin.get('/api/vault/data');
    check('nothing left to restore', r.j.restore_available === false, r.j.restore_from);
    // writes from the new copy continue the same journal
    const before = fs.statSync(path.join(dataDir, 'journal', 'PC_A', 'lb_projects.csv')).size;
    r = await admin.post('/api/projects', { process: 'NPI', family: 'VD2', class_abcde: 'E', prf_date: '2026-02-02', created_by: 'admin' });
    check('the new copy registers another project', r.s === 200, r.j);
    check('...and it lands in the same vault journal', fs.statSync(path.join(dataDir, 'journal', 'PC_A', 'lb_projects.csv')).size > before);
    r = await admin.get('/api/data');
    check('both projects are listed', r.j.tracking.lb_projects.length === baseline + 1 && r.j.tracking.lb_projects.some(p => p.family === 'VD2'));
  }

  if (PHASE === 'legacy') {
    r = await admin.get('/api/data');
    const baseline = Number(fs.readFileSync(path.join(ROOT, 'baseline.txt'), 'ascii'));
    const projs = r.j.tracking.lb_projects;
    check('data from the old app-folder location is read', projs.length === baseline && projs.some(p => p.notes === 'vault data test'), [projs.length, baseline]);
    const jd = path.join(dataDir, 'journal', 'PC_OLD');
    const oldD = path.join(SYS, 'tracking', 'journal', 'PC_OLD');
    check('the old journals were copied into the vault', fs.existsSync(path.join(jd, 'lb_projects.csv')) && fs.existsSync(path.join(jd, 'lb_gates.csv')), listFiles(jd));
    check('the copies are byte-identical', listFiles(oldD).every(f => fs.existsSync(path.join(jd, f)) && Buffer.compare(fs.readFileSync(path.join(oldD, f)), fs.readFileSync(path.join(jd, f))) === 0), listFiles(oldD));
    check('the old location is left untouched', listFiles(oldD).length >= 3);
    r = await admin.get('/api/vault/data');
    check('the status counts each project once (not once per location)', r.j.stores.lb_projects === baseline, [r.j.stores, baseline]);
    check('the status says the old files are already in the vault', r.j.old_location_files > 0 && r.j.old_location_in_vault > 0, [r.j.old_location_files, r.j.old_location_in_vault]);
    r = await admin.post('/api/projects', { process: 'NPI', family: 'VD3', class_abcde: 'E', prf_date: '2026-03-02', created_by: 'admin' });
    check('new writes go to the vault, not the old location', r.s === 200 && fs.existsSync(path.join(dataDir, 'journal', 'PC_A', 'lb_projects.csv')) && !fs.existsSync(path.join(SYS, 'tracking', 'journal', 'PC_A', 'lb_projects.csv')));
    r = await admin.get('/api/data');
    check('old and new rows are read together', r.j.tracking.lb_projects.length === baseline + 1 && r.j.tracking.lb_projects.some(p => p.family === 'VD3'));
  }

  try { await admin.post('/api/shutdown', {}); } catch (e) { }
  console.log('\n' + PHASE + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed ' + (e && e.stack || e)); process.exit(1); });
