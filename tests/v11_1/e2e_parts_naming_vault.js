// v11.1 end-to-end check against an ISOLATED copy of the app.
//   node tests/v11_1/e2e_parts_naming_vault.js <copyRoot>
// <copyRoot> must contain app\system (a copy of system\, with an EMPTY
// tracking\ folder) and an empty NPI_EPM_Documents_Control vault sibling.
// Starts the launcher from the copy on port 8091 as writer PC_A, drives it
// with Chromium, stops it. Never touches the live tracking data.
// Exit code 1 on any failed check. Pure API-level (no browser needed) — the
// UI wiring for these features (drag-drop, the categorize modal, the naming
// builder) is exercised separately in tests/v11_1/e2e_ui.js.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_parts_naming_vault.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8091';
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}
async function waitUp() {
  for (let i = 0; i < 90; i++) { try { const r = await fetch(BASE + '/api/data'); if (r.ok) return; } catch (e) { } await new Promise(r => setTimeout(r, 500)); }
  throw new Error('server did not start');
}
async function api(p) { const r = await fetch(BASE + p); return r.json(); }
async function post(p, body) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

(async () => {
  const launcher = path.join(ROOT, 'app', 'system', 'launcher.ps1');
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-NoBrowser', '-Port', '8091', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    await waitUp();

    /* ---------------- setup: one project via the raw API ---------------- */
    const proj = await post('/api/projects', { process: 'NPI', family: 'TEST1', class_abcde: 'E', prf_date: '2026-01-05', created_by: 'admin' });
    check('setup: project registered', proj.ok, JSON.stringify(proj.body));
    const projectId = proj.body.project_id;

    /* ---------------- naming: config fields + default rules ------------- */
    const fields = await api('/api/config/naming/fields');
    check('naming: field vocabulary is exposed', Array.isArray(fields.fields) && fields.fields.some(f => f.key === 'part'), JSON.stringify(fields));
    const cfg1 = await api('/api/config');
    check('naming: config.json ships with default rules (drawing + default)', cfg1.naming && cfg1.naming.rules && cfg1.naming.rules.length === 2,
      JSON.stringify(cfg1.naming));

    /* ---------------- naming: generic default rule ----------------------- */
    const n1 = await post('/api/filename/preview', { docType: 'PFMEA', family: 'TEST1', wvnId: '111', wnbId: '222', description: 'My Desc', fileName: 'x.pdf' });
    check('naming: default rule produces the legacy shape', n1.body.fileName === 'PFMEA_TEST1_111_222_My_Desc.pdf', n1.body.fileName);

    /* ---------------- naming: DWG rule keeps spaces in description ------- */
    const n2 = await post('/api/filename/preview', { docType: 'DWG', family: 'TEST1', wvnId: '1010523', wnbId: '3025015', description: 'Motor with PCBA', fileName: 'x.pdf' });
    check('naming: DWG rule reproduces the legacy pattern', n2.body.fileName === 'PD1010523_01 Motor with PCBA_3025015.pdf', n2.body.fileName);

    /* ---------------- naming: admin can edit rules, non-admin cannot ----- */
    const customRules = [
      { id: 'default', label: 'Custom', doc_codes: [], segments: [
        { type: 'field', key: 'project_id' }, { type: 'text', value: '-' }, { type: 'field', key: 'doc_code' }
      ] }
    ];
    const badAuth = await post('/api/config/naming', { user: 'intern', rules: customRules });
    check('naming: only admin can save naming rules', badAuth.status === 403, badAuth.status);
    const okAuth = await post('/api/config/naming', { user: 'admin', rules: customRules });
    check('naming: admin save succeeds', okAuth.ok, JSON.stringify(okAuth.body));
    const n3 = await post('/api/filename/preview', { docType: 'CLASS', family: 'TEST1', fileName: 'x.pdf', projectId: projectId });
    check('naming: a freshly saved custom rule takes effect immediately', n3.body.fileName === projectId + '-CLASS.pdf', n3.body.fileName);
    const badRule = await post('/api/config/naming', { user: 'admin', rules: [{ id: 'x', label: '', doc_codes: [], segments: [] }] });
    check('naming: an empty rule is rejected', badRule.status === 400, JSON.stringify(badRule.body));
    // restore the real default rules so the rest of this test uses them
    await post('/api/config/naming', { user: 'admin', rules: cfg1.naming.rules });

    /* ---------------- parts: two BOM parts under the same doc_code ------- */
    const stepKey = 'NPI-4'; // DWG's usual step
    const b64 = s => Buffer.from(s).toString('base64');
    const upA = await post('/api/upload', { fileName: 'bracket.pdf', contentBase64: b64('bracket bytes'), docType: 'DWG', family: 'TEST1', partId: 'Bracket' });
    check('parts: file A uploads', upA.ok, JSON.stringify(upA.body));
    const upB = await post('/api/upload', { fileName: 'motor.pdf', contentBase64: b64('motor bytes'), docType: 'DWG', family: 'TEST1', partId: 'Motor' });
    check('parts: file B uploads', upB.ok, JSON.stringify(upB.body));
    const rowsBatch = await post('/api/deliverables/batch', {
      user: 'admin', rows: [
        { project_id: projectId, step_key: stepKey, doc_code: 'DWG', part_id: 'Bracket', file_name: upA.body.fileName, file_path: upA.body.path, sha256: upA.body.sha256, status: 'Filed', uploaded_by: 'admin', uploaded_utc: new Date().toISOString(), kind: 'file' },
        { project_id: projectId, step_key: stepKey, doc_code: 'DWG', part_id: 'Motor', file_name: upB.body.fileName, file_path: upB.body.path, sha256: upB.body.sha256, status: 'Filed', uploaded_by: 'admin', uploaded_utc: new Date().toISOString(), kind: 'file' }
      ]
    });
    check('parts: both rows save with no duplicate flag', rowsBatch.ok && rowsBatch.body.results.every(r => r.ok && !r.duplicate), JSON.stringify(rowsBatch.body));

    const data1 = await api('/api/data');
    const dwgRows = data1.tracking.lb_deliverables.filter(r => r.project_id === projectId && r.doc_code === 'DWG');
    const activeDwg = dwgRows.filter(r => r.is_active === 'YES');
    check('parts: BOTH parts are independently active (the core v11.1 fix)', activeDwg.length === 2, JSON.stringify(dwgRows.map(r => [r.part_id, r.is_active, r.revision_no])));
    check('parts: each part has its own revision_no = 1 (no cross-part superseding)', activeDwg.every(r => r.revision_no === '1'), JSON.stringify(activeDwg.map(r => r.revision_no)));

    /* ---------------- parts: a THIRD file under the SAME part supersedes - */
    const upA2 = await post('/api/upload', { fileName: 'bracket_v2.pdf', contentBase64: b64('bracket bytes v2'), docType: 'DWG', family: 'TEST1', partId: 'Bracket' });
    await post('/api/deliverables/batch', {
      user: 'admin', rows: [{ project_id: projectId, step_key: stepKey, doc_code: 'DWG', part_id: 'Bracket', file_name: upA2.body.fileName, file_path: upA2.body.path, sha256: upA2.body.sha256, status: 'Filed', uploaded_by: 'admin', uploaded_utc: new Date().toISOString(), kind: 'file', change_reason: 'fixed a dimension' }]
    });
    const data2 = await api('/api/data');
    const dwgRows2 = data2.tracking.lb_deliverables.filter(r => r.project_id === projectId && r.doc_code === 'DWG');
    const bracketRows = dwgRows2.filter(r => r.part_id === 'Bracket');
    const motorRows = dwgRows2.filter(r => r.part_id === 'Motor');
    check('parts: re-filing the SAME part supersedes only that part (2 revisions)', bracketRows.length === 2 && bracketRows.some(r => r.is_active === 'YES' && r.revision_no === '2'), JSON.stringify(bracketRows));
    check('parts: the OTHER part is untouched by that re-file', motorRows.length === 1 && motorRows[0].is_active === 'YES' && motorRows[0].revision_no === '1', JSON.stringify(motorRows));

    /* ---------------- document-history is part-scoped -------------------- */
    const histBracket = await api('/api/document-history?project_id=' + projectId + '&step_key=' + stepKey + '&doc_code=DWG&part_id=Bracket');
    check('history: scoped to Bracket only shows Bracket revisions', histBracket.revisions.length === 2 && histBracket.revisions.every(r => r.part_id === 'Bracket'), JSON.stringify(histBracket.revisions.map(r => r.part_id)));
    const histMotor = await api('/api/document-history?project_id=' + projectId + '&step_key=' + stepKey + '&doc_code=DWG&part_id=Motor');
    check('history: scoped to Motor only shows Motor revisions', histMotor.revisions.length === 1 && histMotor.revisions[0].part_id === 'Motor', JSON.stringify(histMotor.revisions));

    /* ---------------- vault: status Filed vs Approved, part_id shown ----- */
    const vault1 = await api('/api/vault/search?page=1&page_size=50');
    const vaultDwg = vault1.rows.filter(r => r.project_id === projectId && r.doc_code === 'DWG');
    check('vault: one row per part, not one row per doc_code', vaultDwg.length === 2, JSON.stringify(vaultDwg.map(r => r.part_id)));
    check('vault: status is Filed before any gate is signed', vaultDwg.every(r => r.status === 'Filed'), JSON.stringify(vaultDwg.map(r => r.status)));

    // sign the gate, then the same rows should read Approved
    await post('/api/action', { store: 'lb_approvals', row: { project_id: projectId, step_key: stepKey, approved_by: 'admin', approved_utc: new Date().toISOString(), approval_type: 'Standard' } });
    const vault2 = await api('/api/vault/search?page=1&page_size=50');
    const vaultDwg2 = vault2.rows.filter(r => r.project_id === projectId && r.doc_code === 'DWG');
    check('vault: status promotes to Approved once the gate is signed', vaultDwg2.every(r => r.status === 'Approved'), JSON.stringify(vaultDwg2.map(r => r.status)));

    /* ---------------- orphans: a file pasted straight into the vault ----- */
    const vaultDir = path.join(ROOT, 'NPI_EPM_Documents_Control');
    const strayDir = path.join(vaultDir, 'TEST1', 'STRAY');
    fs.mkdirSync(strayDir, { recursive: true });
    fs.writeFileSync(path.join(strayDir, 'pasted_by_hand.txt'), 'nobody filed this through the app');
    const orph1 = await api('/api/vault/orphans');
    const stray = (orph1.orphans || []).find(o => o.path.replace(/\\/g, '/').endsWith('STRAY/pasted_by_hand.txt'));
    check('orphans: a file dropped straight into the vault is detected', !!stray, JSON.stringify(orph1.orphans));
    check('orphans: carries an owner and a created timestamp', !!(stray && stray.owner && stray.created_utc), JSON.stringify(stray));
    check('orphans: carries a sha256 for small files', !!(stray && stray.sha256 && stray.sha256.length === 64), JSON.stringify(stray));

    const ignore = await post('/api/action', { store: 'lb_vault_ignored', row: { file_path: stray.path, ignored_by: 'admin', ignored_utc: new Date().toISOString(), reason: 'test junk' } });
    check('orphans: Ignore saves', ignore.ok, JSON.stringify(ignore.body));
    const orph2 = await api('/api/vault/orphans');
    check('orphans: an ignored file no longer appears', !(orph2.orphans || []).some(o => o.path === stray.path), JSON.stringify(orph2.orphans));
    check('orphans: the ignored count is reported', orph2.ignored >= 1, orph2.ignored);

    // a second stray file, categorized in place instead of ignored
    fs.writeFileSync(path.join(strayDir, 'also_pasted.txt'), 'also not filed through the app');
    const orph3 = await api('/api/vault/orphans');
    const stray2 = (orph3.orphans || []).find(o => o.path.replace(/\\/g, '/').endsWith('STRAY/also_pasted.txt'));
    check('orphans: a second stray file is also detected', !!stray2, JSON.stringify(orph3.orphans));
    const cat = await post('/api/action', {
      store: 'lb_deliverables',
      row: {
        project_id: projectId, step_key: stepKey, doc_code: 'BOM',
        file_name: 'also_pasted.txt', file_path: path.join(vaultDir, stray2.path), sha256: stray2.sha256 || '',
        status: 'Filed', kind: 'file', uploaded_by: 'admin', uploaded_utc: new Date().toISOString(), notes: 'categorized from an orphan'
      }
    });
    check('orphans: categorizing in place saves a deliverable row', cat.ok, JSON.stringify(cat.body));
    const orph4 = await api('/api/vault/orphans');
    check('orphans: a categorized file is no longer an orphan (its path is now referenced)', !(orph4.orphans || []).some(o => o.path === stray2.path), JSON.stringify(orph4.orphans));
    const vault3 = await api('/api/vault/search?q=also_pasted&page=1&page_size=10');
    check('orphans: the categorized file now shows up in the Vault', vault3.rows.some(r => r.file_name === 'also_pasted.txt'), JSON.stringify(vault3.rows));

    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    if (fail) process.exitCode = 1;
  } catch (e) {
    console.error('FATAL: ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    try { srv.kill(); } catch (e) { }
  }
})();
