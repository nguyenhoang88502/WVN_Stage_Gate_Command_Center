// v11 R3 (Vault search) + R4 (pillars) end-to-end check, ISOLATED copy.
//   node tests/v11/e2e_r3r4.js <copyRoot>
// Adds a third pillar (EEM) to the COPY's config.json only - no code change -
// then proves it gets a tab, registration, drawer filing, a dashboard matrix
// with its own responsible-person label, revision history and Vault search.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_r3r4.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8090';
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}
// v12: every /api/* call needs a session. tests/lib/session.js signs in admin
// and intern; a request is sent as the user its body names (admin otherwise),
// which is what `user: '...'` in these calls meant before there was a login.
const session = require('../lib/session');
let SESS = null;
const cookieFor = b => SESS.cookies[String((b && b.user) || 'admin').toLowerCase()] || SESS.cookies.admin;
async function api(p) { const r = await fetch(BASE + p, { headers: { Cookie: SESS.cookies.admin } }); return r.json(); }
async function post(p, body) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieFor(body) }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; }

// ---- config-only change: a third pillar ------------------------------------
const cfgPath = path.join(ROOT, 'app', 'system', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''));
cfg.pillars.push({
  process_id: 'EEM', name: 'EEM', name_vi: 'Quản lý thiết bị', pic_label: 'Owner', pic_label_vi: 'Người phụ trách',
  gate_mode: 'flagged', icon: 'building-factory-2', features: {},
  doc_types: [
    { doctype_id: 'EEM-SPEC', name: 'Equipment specification', owner_dept: 'IE' },
    { doctype_id: 'EEM-FAT', name: 'Factory acceptance test', owner_dept: 'QA' }
  ],
  steps: [
    { step_id: 1, step_name: 'Equipment request', required_evidence_doctypes: ['EEM-SPEC'], conditional_evidence_doctypes: [], gate_clearance_required: true },
    { step_id: 2, step_name: 'Build & install', required_evidence_doctypes: [], conditional_evidence_doctypes: [], gate_clearance_required: false },
    { step_id: 3, step_name: 'Acceptance', required_evidence_doctypes: ['EEM-FAT', 'PFMEA'], conditional_evidence_doctypes: [], gate_clearance_required: true }
  ]
});
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

(async () => {
  const launcher = path.join(ROOT, 'app', 'system', 'launcher.ps1');
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-NoBrowser', '-Port', '8090', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    SESS = await session.clients(BASE, ROOT);

    /* ---- R4 server: registration validates the process ------------------ */
    const bad = await post('/api/projects', { process: 'XYZ', family: 'LINE9', class_abcde: 'C', prf_date: '2026-W38', created_by: 'admin' });
    check('R4 unknown process is rejected, naming the configured pillars', bad.status >= 400 && /NPI, ECN, EEM/.test(bad.json.error || ''), JSON.stringify(bad.json));
    const ok = await post('/api/projects', { process: 'EEM', family: 'line7', class_abcde: 'C', prf_date: '2026-W38', created_by: 'admin' });
    check('R4 project ID is <process_id>-<family> for a config-only pillar', ok.json.project_id === 'EEM-LINE7', JSON.stringify(ok.json).slice(0, 200));

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });
    // v12: the page opens already signed in as admin (it used to pick "admin"
    // in the header and type the PIN).
    await SESS.signInContext(page.context());
    await page.goto(BASE + '/');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });

    /* ---- R4 UI ----------------------------------------------------------- */
    const tabs = await page.locator('#tabs button').allInnerTexts();
    check('R4 NPI and ECN tabs keep their labels', tabs.some(x => /^NPI ·/.test(x.trim())) && tabs.some(x => /^ECN ·/.test(x.trim())), tabs.join(' | '));
    check('R4 the config-only pillar gets its own tab', tabs.some(x => /^EEM · 3 steps$/.test(x.trim())), tabs.join(' | '));
    check('R4 tab order: Dashboard, Claimed, Vault, Input, pillars, Settings', /Dashboard.*Claimed Work.*Document Vault.*Input.*NPI.*ECN.*EEM.*Settings/s.test(tabs.join('|')), tabs.join(' | '));
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();
    const procOpts = await page.locator('#npProc option').allInnerTexts();
    check('R4 registration offers every pillar', procOpts.length === 3 && /EEM/.test(procOpts[2]), procOpts.join(' | '));

    await page.locator('#tabs button', { hasText: /^EEM ·/ }).click();
    await page.waitForTimeout(400);
    const banner = await page.locator('#views .banner').first().innerText();
    check('R4 pillar view: flagged-gate banner names its gated steps', /Only steps 1, 3 are signed/.test(banner), banner);
    await page.locator('#views .card.project-list-row', { hasText: 'EEM-LINE7' }).locator('b').first().click();
    const drawer = page.locator('#drawer');
    await drawer.waitFor();
    const claim = drawer.locator('button', { hasText: /^Claim Task$/ });
    if (await claim.count()) { await claim.first().click(); await page.waitForTimeout(900); }
    const dz = drawer.locator('.dz[data-doc-code="EEM-SPEC"]');
    check('R4 drawer renders a dropzone for the pillar\'s own document type', await dz.count() === 1 && /Equipment specification/.test(await dz.first().innerText()));
    await page.evaluate(() => {
      const d = document.querySelector('#drawer .dz[data-doc-code="EEM-SPEC"]');
      const dt = new DataTransfer();
      dt.items.add(new File(['spec v1 ' + Math.random()], 'line7_spec.pdf', { type: 'application/pdf' }));
      d.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.locator('#uploadQueue', { hasText: 'All 1 saved' }).waitFor({ timeout: 30000 });
    await page.locator('#uploadQueue .uq-clear').click();
    await page.waitForTimeout(1200);
    check('R4 filing on the new pillar works and shows rev 1', await page.locator('#drawer .rev-badge', { hasText: 'rev 1' }).count() >= 1);
    await drawer.locator('button', { hasText: /^Close$/ }).first().click();

    await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
    await page.waitForTimeout(800);
    const eemMatrix = page.locator('.card', { has: page.locator('h3.card-title', { hasText: 'EEM — stage matrix' }) });
    check('R4 dashboard renders a per-step matrix for the new pillar', await eemMatrix.count() === 1);
    const hdrs = await eemMatrix.locator('thead th').allInnerTexts();
    check('R4 the matrix uses the pillar\'s responsible-person label ("Owner", not "PIC")', hdrs[hdrs.length - 1].trim().toLowerCase() === 'owner', hdrs.join(' | '));
    check('R4 NPI and ECN matrices still render', await page.locator('h3.card-title', { hasText: 'NPI — stage matrix' }).count() === 1 && await page.locator('h3.card-title', { hasText: 'ECN — stage matrix' }).count() === 1);
    const ganttRows = await page.locator('.gantt-live-wrap').innerText();
    check('R4 the Gantt includes the new pillar\'s project', /EEM-LINE7/.test(ganttRows));

    /* ---- R3 Vault -------------------------------------------------------- */
    await page.locator('#tabs button', { hasText: /^Document Vault$/ }).click();
    await page.locator('.vault-summary').waitFor({ timeout: 15000 });
    const all = await api('/api/vault/search?size=200');
    check('R3 vault lists documents across all pillars', all.total >= 46 && all.facets.pillars.indexOf('EEM') >= 0 && all.facets.pillars.indexOf('NPI') >= 0 &&
      (await page.locator('#vPillar option').allInnerTexts()).length === 4, 'total=' + all.total + ' pillars=' + all.facets.pillars);
    // v11.1: a (project, step, doc_code) group can hold several independently
    // active documents distinguished by part_id (see e2e_r1r2.js's 108-part
    // drop) - the "no duplicates" invariant is one row per PART, not per
    // doc_code alone.
    check('R3 one row per document, never per revision', new Set(all.rows.map(r => r.project_id + '|' + r.step_key + '|' + r.doc_code + '|' + (r.part_id || ''))).size === all.rows.length);
    await page.locator('#vq').fill('line7');
    await page.waitForTimeout(900);
    const qRows = await page.locator('.vault-table tbody tr').count();
    check('R3 free-text search finds the new pillar\'s document', qRows === 1 && /EEM-SPEC/.test(await page.locator('.vault-table tbody').innerText()));
    await page.locator('#vq').fill('');
    await page.locator('#vPillar').selectOption('EEM');
    await page.waitForTimeout(900);
    check('R3 pillar filter', (await page.locator('.vault-summary').innerText()).startsWith('1 document'));
    const vrow = page.locator('.vault-table tbody tr').first();
    await vrow.locator('button', { hasText: 'History' }).click();
    await page.locator('.modal.history-modal .history-table').waitFor({ timeout: 10000 });
    check('R3 History from a search result reuses the revision modal', await page.locator('.modal.history-modal .history-table tbody tr').count() === 1);
    await page.locator('.modal.history-modal button', { hasText: /^Close$/ }).click();
    const chooserP = page.waitForEvent('filechooser');
    await vrow.locator('button', { hasText: 'New revision' }).click();
    const chooser = await chooserP;
    await chooser.setFiles({ name: 'line7_spec_v2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('spec v2 ' + Date.now()) });
    const reason = page.locator('.modal', { hasText: 'Change reason' });
    await reason.locator('textarea').fill('Vendor revised the motor rating');
    await reason.locator('button', { hasText: 'Upload revision' }).click();
    await page.locator('#uploadQueue', { hasText: 'All 1 saved' }).waitFor({ timeout: 30000 });
    await page.locator('#uploadQueue .uq-clear').click();
    await page.waitForTimeout(1200);
    const after = await api('/api/vault/search?pillar=EEM');
    check('R3 "New revision" from the vault goes through the same revision path (rev 2, reason kept)',
      after.rows[0] && after.rows[0].rev === '2' && after.rows[0].revisions === 2 && after.rows[0].change_reason === 'Vendor revised the motor rating', JSON.stringify(after.rows[0]));
    const byDoc = await api('/api/vault/search?doc=PFMEA&size=5');
    check('R3 doc-type filter + server paging', byDoc.rows.length <= 5 && byDoc.rows.every(r => r.doc_code === 'PFMEA') && byDoc.total >= byDoc.rows.length, 'total=' + byDoc.total);
    const dept = await api('/api/vault/search?dept=IE');
    check('R3 department filter (owner_dept of the document type)', dept.rows.every(r => r.owner_dept === 'IE') && dept.rows.some(r => r.doc_code === 'EEM-SPEC'));
    const dated = await api('/api/vault/search?from=2099-01-01');
    check('R3 date-range filter', dated.total === 0);

    /* ---- R4 Settings editor --------------------------------------------- */
    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
    await page.waitForTimeout(700);
    const card = page.locator('.pillars-card');
    check('R4 Settings lists all three pillars', await card.locator('tbody tr').count() === 3);
    await card.locator('button', { hasText: 'Add pillar' }).click();
    const pm = page.locator('.modal.pillar-modal');
    await pm.locator('#pmId').fill('qms');
    await pm.locator('#pmName').fill('Quality');
    await pm.locator('#pmPic').fill('Lead');
    await pm.locator('.pm-sname').first().fill('Audit');
    await pm.locator('.pm-sreq').first().fill('NOPE');
    await pm.locator('button', { hasText: 'Save pillar' }).click();
    await pm.locator('.pm-err').waitFor({ timeout: 10000 });
    check('R4 editor rejects a step that asks for an undefined document type', /NOPE/.test(await pm.locator('.pm-err').innerText()));
    await pm.locator('.pm-sreq').first().fill('PFMEA');
    await pm.locator('button', { hasText: 'Save pillar' }).click();
    await page.locator('#tabs button', { hasText: /^Quality · 1 steps$/ }).waitFor({ timeout: 15000 });
    check('R4 a pillar added in Settings appears as a tab immediately', true);
    const cfg2 = await api('/api/config');
    check('R4 the new pillar was saved to config.json (id upper-cased)', cfg2.pillars.some(p => p.process_id === 'QMS' && p.pic_label === 'Lead'));
    const del = await post('/api/config/pillars', { user: 'admin', pillars: cfg2.pillars.filter(p => p.process_id !== 'EEM') });
    check('R4 a pillar that still has projects cannot be removed', del.status === 400 && /EEM cannot be removed/.test(del.json.error), JSON.stringify(del.json));
    const noadmin = await post('/api/config/pillars', { user: 'intern', pillars: cfg2.pillars });
    check('R4 only admin may change pillars', noadmin.status === 403);

    // encoding: the browser's own client now sends a charset, but the server
    // must not depend on it - this POST deliberately names none.
    const vi = 'Kiểm tra tiếng Việt — ≤ 15 ngày → xong';
    await post('/api/action', { store: 'lb_doc_comments', row: { project_id: 'EEM-LINE7', step_key: 'EEM-1', doc_code: 'EEM-SPEC', author: 'admin', comment: vi } });
    const dd = await api('/api/data');
    check('encoding: non-ASCII text POSTed without a charset is stored intact', dd.tracking.lb_doc_comments.some(c => c.comment === vi));
    check('encoding: config.json carries no mojibake', !/Ã.|â€|á»/.test(JSON.stringify(dd.config)));
    await page.locator('#langToggleBtn').click();
    await page.waitForTimeout(600);
    const viTabs = await page.locator('#tabs button').allInnerTexts();
    check('R4 Vietnamese: the new pillar tab uses name_vi', viTabs.some(x => /Quản lý thiết bị · 3 bước/.test(x)), viTabs.join(' | '));
    check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  } catch (e) {
    fail++; console.log('FAIL exception: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    try { await fetch(BASE + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { }
    await new Promise(r => setTimeout(r, 1500));
    try { srv.kill(); } catch (e) { }
    console.log('RESULT pass=' + pass + ' fail=' + fail);
    process.exit(fail ? 1 : 0);
  }
})();
