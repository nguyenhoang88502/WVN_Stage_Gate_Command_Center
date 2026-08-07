'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BADGE_CLASS = {
  COMPLETE:'bg-success', DONE:'bg-success', APPROVED:'bg-success', Cleared:'bg-success', Connected:'bg-success',
  IN_PROGRESS:'bg-primary', FILED:'bg-primary', ON_GOING:'bg-primary', Open:'bg-primary',
  AT_RISK:'bg-danger', MISSING:'bg-danger', BLOCKED:'bg-danger', Offline:'bg-danger',
  NOT_STARTED:'bg-warning', Pending:'bg-warning',
  NO_DATA:'bg-secondary', NONE:'bg-secondary', TRACK:'bg-secondary', REMOVED:'bg-secondary',
  BYPASSED:'bg-danger bg-bypassed-dashed'
};
function badgeClass(status) { return 'badge ' + (BADGE_CLASS[status] || 'bg-secondary'); }
const nowLocal = () => new Date().toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

// ISO-8601 week: 'YYYY-Www', week 1 = the week containing the year's first
// Thursday. Computed via the Thursday-of-this-week trick so it's immune to
// year-boundary edge cases (Dec 31 can be week 1 of next year, Jan 1 can be
// week 52/53 of the previous year).
function isoWeek(dateLike) {
  const d = (dateLike instanceof Date) ? new Date(dateLike.getTime()) : new Date(dateLike);
  if (isNaN(d)) return '';
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

function weekToDate(weekStr) {
  const m = String(weekStr || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  const target = new Date(week1Monday);
  target.setDate(week1Monday.getDate() + (week - 1) * 7);
  return target;
}

function addWeeks(weekStr, n) {
  const d = weekToDate(weekStr);
  if (!d) return '';
  d.setDate(d.getDate() + Number(n) * 7);
  return isoWeek(d);
}

function nowWeek() { return isoWeek(new Date()); }

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function weekRangeLabel(weekStr) {
  if (!weekStr) return '(all weeks)';
  var d = weekToDate(weekStr);
  if (!d) return weekStr;
  var mon = d, sun = new Date(d);
  sun.setDate(d.getDate() + 6);
  return weekStr + ' (' + MONTH_NAMES_SHORT[mon.getMonth()] + ' ' + mon.getDate() +
    ' - ' + MONTH_NAMES_SHORT[sun.getMonth()] + ' ' + sun.getDate() + ')';
}

function toWeek(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{4}-W\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return isoWeek(s);
  return '';
}

/* ========================================================================
   API client — every write is one short HTTP round trip triggered by an
   explicit Submit/Save click. Nothing is buffered client-side across
   requests; the server (system\tracking\*.csv) is always the source of
   truth, so a second browser/user sees the same state after any refresh.
   ===================================================================== */
const API = {
  async data() { const r = await fetch('/api/data', { cache: 'no-store' }); if (!r.ok) throw await API.err(r); return r.json(); },
  async createProject(body) { return API.post('/api/projects', body); },
  async action(store, row, opts) { return API.post('/api/action', { store, row, upsertKeys: (opts || {}).upsertKeys, audit: (opts || {}).audit }); },
  async upload(body) { return API.post('/api/upload', body); },
  async family(op, prodFamily, prod_family_id, user) { return API.post('/api/config/family', { op, prodFamily, prod_family_id, user }); },
  async doctype(op, doctype, doctype_id, user) { return API.post('/api/config/doctype', { op, doctype, doctype_id, user }); },
  async templates() { const r = await fetch('/api/templates', { cache: 'no-store' }); if (!r.ok) throw await API.err(r); return r.json(); },
  async previewName(body) { return API.post('/api/filename/preview', body); },
async issueHeaders(headers, user) { return API.post('/api/config/issue-headers', { headers, user }); },
  async lfi(body) { return API.post('/api/lfi', body); },
  async uploadTemplate(body) { return API.post('/api/templates/upload', body); },
  async changeTypes(changeTypes, user) { return API.post('/api/config/changetypes', { change_types: changeTypes, user }); },
  async importIssues(csv, user) { return API.post('/api/issues/import', { csv, user }); },
  async batchProjects(csv, user) { return API.post('/api/projects/batch', { csv, user }); },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw await API.err(r);
    return r.json();
  },
  async err(r) { try { const j = await r.json(); return new Error(j.error || (r.status + ' ' + r.statusText)); } catch (e) { return new Error(r.status + ' ' + r.statusText); } }
};

/* ------------------------------------------------------------- state -- */
let CFG = null;                    // config.json (prod_families, change_types, document_types, npi/ecn workflow, ...)
let TRK = {};                      // tracking store arrays, keyed by store name
let PATHS = {};                    // resolved server-side paths (vault, templates, root)
let TEMPLATES = [];                // blank company forms available for download
const WH_AREAS = ['Assembly', 'Blade', 'Molding (material)', 'Mold storage', 'Fixture storage'];
const UK = 'wvn-epm-user';
function getUser() { try { return localStorage.getItem(UK) || ''; } catch (e) { return ''; } }
function setUser(v) { try { localStorage.setItem(UK, v); } catch (e) { } }
function isAdmin() { return (getUser() || '').toLowerCase() === 'admin'; }
function isModerator() {
  const u = (getUser() || '').toLowerCase();
  return (CFG.moderators || []).some(function(m) { return String(m).toLowerCase() === u; });
}
function isPrivileged() { return isAdmin() || isModerator(); }

async function refresh() {
  const d = await API.data();
  CFG = d.config; TRK = d.tracking; PATHS = d.paths || {};
  try { TEMPLATES = (await API.templates()).templates || []; } catch (e) { TEMPLATES = []; }
}

/* --------------------------------------------------------------- boot -- */
async function boot() {
  try {
    await refresh();
    $('#srvState').textContent = 'connected'; $('#srvState').className = badgeClass('Connected');
    $('#stamp').textContent = CFG.system_info.app_name + ' v' + CFG.system_info.version + '  ·  ' + nowLocal();
    buildTabs(); show(current);
  } catch (e) {
    $('#views').innerHTML = '<div class="err"><b>Could not reach the local server.</b><br>' + esc(e.message) +
      '<br><br>Make sure <code>Open_WVN_NPI_Command_Center.cmd</code> is running, then reload this page.</div>';
    $('#srvState').textContent = 'offline'; $('#srvState').className = badgeClass('Offline');
  }
}

const TABS = [['dash', 'Dashboard'], ['claimed', 'Claimed Work'], ['input', 'Input'], ['npi', 'NPI · 7 steps'], ['ecn', 'ECN · 12 steps + PPAP'],
              ['sp', 'Issue tracker'], ['settings', 'Settings']];
let current = 'dash';
function buildTabs() {
  const n = $('#tabs'); n.innerHTML = '';
  TABS.forEach(([id, label]) => { const b = el('button', id === current ? 'on' : '', label); b.onclick = () => show(id); n.appendChild(b); });
}
function show(id) {
  current = id; buildTabs();
  closeDrawer();
  const v = $('#views'); v.innerHTML = '';
  ({ dash: viewDashboard, claimed: viewClaimed, input: viewInput, npi: viewNpi, ecn: viewEcn, sp: viewSharePoint, settings: viewSettings })[id](v);
  if (justPickedTree) {
    justPickedTree = false;
    requestAnimationFrame(() => {
      const detail = $('#npiActiveHead') || $('#ecnActiveHead');
      if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    window.scrollTo(0, 0);
  }
}
async function redrawAfterWrite() { await refresh(); show(current); }
async function refreshSilently() {
  const d = await API.data();
  CFG = d.config; TRK = d.tracking; PATHS = d.paths || {};
  try { TEMPLATES = (await API.templates()).templates || []; } catch (e) { TEMPLATES = []; }
}

/* ------------------------------------------------------------ helpers -- */
function requireName() {
  const v = ($('#whoInput') && $('#whoInput').value.trim()) || getUser();
  if (!v) { alert('Enter your name in the header first — every approval, bypass and clearance must name a person.'); return null; }
  setUser(v); return v;
}

/* ---- claim button builder (Task 2a) ------------------------------------
   Returns a span container with a claim button plus Owner / Supporter
   badges. Two-tier logic: if the row is unowned the clicker becomes
   Owner; if owned by someone else they become Supporter instead. */
function makeClaimButton(objType, store, row, upsertKeys, onAfterClaim) {
  const currentOwner = row.owner_pic || row.claimed_by || '';
  const currentSupporter = row.supporter_pic || row.supporter_by || '';

  const wrap = el('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap';

  const btn = el('button', currentOwner ? 'claimed-btn' : 'primary',
    currentOwner ? 'Claimed by ' + currentOwner : 'Claim Task');
  wrap.appendChild(btn);

  var ownerBadge = null;
  var supporterBadge = null;

  // Owner/Supporter badges carry an "(Assigned by X)" suffix instead of the
  // plain "Claimed by"/"Supporter:" wording whenever assigned_by is set -
  // i.e. an admin placed this person here rather than them self-claiming.
  function renderBadges() {
    if (ownerBadge) { ownerBadge.remove(); ownerBadge = null; }
    if (supporterBadge) { supporterBadge.remove(); supporterBadge = null; }
    const own = row.owner_pic || row.claimed_by || '';
    const sup = row.supporter_pic || row.supporter_by || '';
    const assignedBy = row.assigned_by || '';
    if (own) {
      const ownerText = assignedBy ? 'Owner: ' + own + ' (Assigned by ' + assignedBy + ')' : 'Owner: ' + own;
      ownerBadge = el('span', 'claim-badge ' + badgeClass('FILED'), ownerText);
      wrap.appendChild(ownerBadge);
    }
    if (sup) {
      const supText = assignedBy ? 'Supporter: ' + sup + ' (Assigned by ' + assignedBy + ')' : 'Supporter: ' + sup;
      supporterBadge = el('span', 'claim-badge badge bg-teal-lt', supText);
      wrap.appendChild(supporterBadge);
    }
  }
  renderBadges();

  btn.onclick = async () => {
    const who = requireName(); if (!who) return;
    const owner = row.owner_pic || row.claimed_by || '';
    const supporter = row.supporter_pic || row.supporter_by || '';

    // No owner yet — claim as Owner
    if (!owner) {
      btn.disabled = true;
      try {
        var rowData = Object.assign({}, row);
        rowData.owner_pic = who;
        rowData.claimed_by = who;
        rowData.claimed_utc = new Date().toISOString();
        if (store === 'lb_gates') {
          if (!rowData.process) rowData.process = '';
          if (!rowData.step_num) rowData.step_num = '';
          if (!rowData.step_name) rowData.step_name = '';
          if (!rowData.status) rowData.status = 'NotStarted';
          rowData.updated_utc = new Date().toISOString();
        }
        await API.action(store, rowData, {
          upsertKeys: upsertKeys,
          audit: { user: who, action: 'Claim_Task', projectId: row.project_id, objType: objType,
            objId: rowData.step_key || rowData.deliverable_id || rowData.sp_id || rowData.raised_utc || '',
            from: owner, to: who, detail: 'Owner claim' }
        });
        row.owner_pic = who;
        row.claimed_by = who;
        row.claimed_utc = rowData.claimed_utc;
        btn.textContent = 'Claimed by ' + who;
        btn.className = 'claimed-btn';
        renderBadges();
        if (onAfterClaim) onAfterClaim(who, 'Owner');
      } catch (e) { alert('Claim failed: ' + e.message); }
      btn.disabled = false;
      return;
    }

    // Already the Owner — no-op
    if (who === owner) return;

    // Already the Supporter — no-op
    if (who === supporter) return;

    // Different user — claim as Supporter
    btn.disabled = true;
    try {
      var rowData2 = Object.assign({}, row);
      rowData2.supporter_pic = who;
      rowData2.supporter_by = who;
      rowData2.supporter_utc = new Date().toISOString();
      if (store === 'lb_gates') {
        if (!rowData2.process) rowData2.process = '';
        if (!rowData2.step_num) rowData2.step_num = '';
        if (!rowData2.step_name) rowData2.step_name = '';
        if (!rowData2.status) rowData2.status = 'NotStarted';
        rowData2.updated_utc = new Date().toISOString();
      }
      await API.action(store, rowData2, {
        upsertKeys: upsertKeys,
        audit: { user: who, action: 'Claim_Task_Supporter', projectId: row.project_id, objType: objType,
          objId: rowData2.step_key || rowData2.deliverable_id || rowData2.sp_id || rowData2.raised_utc || '',
          from: supporter, to: who, detail: 'Supporter claim' }
      });
      row.supporter_pic = who;
      row.supporter_by = who;
      row.supporter_utc = rowData2.supporter_utc;
      renderBadges();
      if (onAfterClaim) onAfterClaim(who, 'Supporter');
    } catch (e) { alert('Claim failed: ' + e.message); }
    btn.disabled = false;
  };
  return wrap;
}
/* ---- admin assign button builder -----------------------------------------
   When isAdmin() is true, renders an "Assign Task" button next to each claim
   button.  On click it prompts for a target user and whether they become
   Primary Owner or Supporter, then writes the assignment via API.action. */
function makeAssignButton(objType, store, row, upsertKeys, onAfterAssign) {
  const btn = el('button', '', 'Assign Task');
  btn.style.cssText = 'margin-left:4px';
  btn.onclick = async function() {
    const admin = requireName(); if (!admin) return;
    const target = prompt('Assign to whom? Enter the target user\'s name:');
    if (!target || !target.trim()) return;
    const targetName = target.trim();
    const isPrimary = confirm('Assign as Primary Owner?\n\nOK = Primary Owner\nCancel = Supporter');
    btn.disabled = true;
    const now = new Date().toISOString();
    try {
      const rowData = Object.assign({}, row);
      if (isPrimary) {
        rowData.owner_pic = targetName;
        rowData.claimed_by = targetName;
        rowData.claimed_utc = now;
      } else {
        rowData.supporter_pic = targetName;
        rowData.supporter_by = targetName;
        rowData.supporter_utc = now;
      }
      rowData.assigned_by = admin;
      rowData.assigned_utc = now;
      if (store === 'lb_gates') {
        if (!rowData.process) rowData.process = '';
        if (!rowData.step_num) rowData.step_num = '';
        if (!rowData.step_name) rowData.step_name = '';
        if (!rowData.status) rowData.status = 'NotStarted';
        rowData.updated_utc = new Date().toISOString();
      }
      await API.action(store, rowData, {
        upsertKeys: upsertKeys,
        audit: { user: admin, action: 'Assign_Task_Admin', projectId: row.project_id, objType: objType,
          objId: rowData.step_key || rowData.deliverable_id || rowData.sp_id || rowData.raised_utc || '',
          from: '', to: targetName, detail: isPrimary ? 'Primary Owner' : 'Supporter' }
      });
      if (isPrimary) {
        row.owner_pic = targetName;
        row.claimed_by = targetName;
        row.claimed_utc = now;
      } else {
        row.supporter_pic = targetName;
        row.supporter_by = targetName;
        row.supporter_utc = now;
      }
      row.assigned_by = admin;
      row.assigned_utc = now;
      if (onAfterAssign) onAfterAssign(targetName, isPrimary, admin);
    } catch (e) { alert('Assignment failed: ' + e.message); }
    btn.disabled = false;
  };
  return btn;
}
const projectsOf = proc => TRK.lb_projects.filter(p => p.process === proc);
const projById = id => TRK.lb_projects.find(p => p.project_id === id);
const allStepsOf = proc => (proc === 'NPI' ? CFG.npi_workflow.steps : CFG.ecn_workflow.steps);
const stepKeyOf = (proc, s) => proc + '-' + s.step_id;
const docTypeById = id => CFG.document_types.find(d => d.doctype_id === id) || { doctype_id: id, name: id };

/* ---- CSV cell quoting (client-side, mirrors launcher.ps1 ConvertTo-CsvCell) ---- */
function csvCell(v) {
  const s = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
  if (s.includes(',') || s.includes('"')) { return '"' + s.replace(/"/g, '""') + '"'; }
  return s;
}
const familyById = id => {
  if (!id) return null;
  const s = String(id).trim();
  const exact = CFG.prod_families.find(f => f.prod_family_id === s);
  if (exact) return exact;
  const lower = s.toLowerCase();
  return CFG.prod_families.find(f => (f.sample_fg_ids || []).some(x => String(x).trim().toLowerCase() === lower));
};
const changeTypes = () => CFG.change_types || [];
const changeTypeById = id => changeTypes().find(t => t.type_id === id);
const certTypes = () => CFG.certification_types || [];
const certById = id => certTypes().find(c => c.cert_id === id);

/* ---- typing-enabled combobox normalisers (Task 1a—1c) -------------------
   Datalist <option> elements show their value attribute to the user, not their
   text content. So each combobox stores a display label ("Family Name (FAMILY_ID)",
   "DOCTYPE_ID — Name", "STEP_ID — Step Name"). These helpers convert typed or
   selected display text back into the canonical ID at submit time, and a strict
   resolver for the closed set of workflow steps. */
function normaliseFamilyInput(val) {
  const s = (val || '').trim();
  if (!s) return '';
  if (CFG.prod_families.some(f => f.prod_family_id === s)) return s;
  const m = s.match(/\(([A-Za-z0-9_-]+)\)\s*$/);
  if (m && CFG.prod_families.some(f => f.prod_family_id === m[1])) return m[1];
  const lower = s.toLowerCase();
  const byName = CFG.prod_families.find(f => f.prod_family_name.toLowerCase() === lower);
  return byName ? byName.prod_family_id : s;
}
function normaliseDoctypeInput(val) {
  const s = (val || '').trim();
  if (!s) return '';
  if (CFG.document_types.some(d => d.doctype_id === s)) return s;
  const m = s.match(/^([A-Za-z0-9_-]+)\s*[-—–]\s*/);
  if (m && CFG.document_types.some(d => d.doctype_id === m[1])) return m[1];
  const byName = CFG.document_types.find(d => d.name === s);
  if (byName) return byName.doctype_id;
  const lower = s.toLowerCase();
  const byNameCI = CFG.document_types.find(d => d.name.toLowerCase() === lower);
  if (byNameCI) return byNameCI.doctype_id;
  const byIdCI = CFG.document_types.find(d => d.doctype_id.toLowerCase() === lower);
  if (byIdCI) return byIdCI.doctype_id;
  return s;
}
function resolveStepInput(val, project) {
  const s = (val || '').trim();
  if (!s) return null;
  const steps = project ? stepsOf(project.process, project) : [];
  const num = Number(s);
  if (steps.some(st => st.step_id === num)) return num;
  const m = s.match(/^(\d{1,2})\s*[-—–]\s*/);
  if (m) {
    const n = Number(m[1]);
    if (steps.some(st => st.step_id === n)) return n;
  }
  const lower = s.toLowerCase();
  const byName = steps.find(st => st.step_name.toLowerCase() === lower);
  return byName ? byName.step_id : null;
}

/* Datalist option builders — separate from the <select>-era helpers so callers
   that still need <option value="ID"> stay unchanged. */
function stepDatalistOptions(project, docCode) {
  if (!project) return '';
  const m = docCode ? stepsRequiringDoc(project, docCode) : { required: [], optional: [] };
  return stepsOf(project.process, project).map(s => {
    let tag = '';
    if (m.required.indexOf(s) >= 0) tag = '  ★ required here';
    else if (m.optional.indexOf(s) >= 0) tag = '  ◦ applicable here';
    return '<option value="' + s.step_id + ' — ' + esc(s.step_name) + tag + '">';
  }).join('');
}
/* Document type datalist ordered by a chosen step's requirements: required
   first, then conditionally applicable, then the rest. Every doctype stays
   available — filing an unexpected document is legitimate. */
function docDatalistOptionsForStep(project, stepId) {
  const def = CFG.document_types.map(d =>
    '<option value="' + esc(d.doctype_id) + ' — ' + esc(d.name) + '">').join('');
  if (!project || !stepId) return def;
  const step = stepsOf(project.process, project).find(s => s.step_id === stepId);
  if (!step) return def;
  const req = step.required_evidence_doctypes || [];
  const cond = step.conditional_evidence_doctypes || [];
  const reqList = [], condList = [], restList = [];
  CFG.document_types.forEach(d => {
    if (req.indexOf(d.doctype_id) >= 0) reqList.push(d);
    else if (cond.indexOf(d.doctype_id) >= 0) condList.push(d);
    else restList.push(d);
  });
  const opt = (d, tag) => '<option value="' + esc(d.doctype_id) + ' — ' + esc(d.name) +
    (tag ? '  ' + tag : '') + '">';
  return reqList.map(d => opt(d, '★ required at this step')).join('') +
    condList.map(d => opt(d, '◦ applicable at this step')).join('') +
    restList.map(d => opt(d, '')).join('');
}

/* Stored pipe-separated on lb_projects so no row ever needs CSV quoting. */
const certsOf = project => String((project && project.certifications) || '').split('|').map(s => s.trim()).filter(Boolean);

/* Chips for the known schemes plus free text, because certification scope
   changes per market faster than any hardcoded list will. */
function certPicker(initial) {
  const chosen = (initial || []).slice();
  const wrap = el('div');
  const box = el('div', 'tagin');
  const input = el('input');
  input.placeholder = 'type a scheme and press Enter';
  const picks = el('div', 'certpick');

  const render = () => {
    box.innerHTML = '';
    chosen.forEach(c => {
      const t = el('span', 'tg');
      const meta = certById(c);
      t.title = meta ? meta.name + ' — ' + meta.scope : 'custom';
      t.appendChild(document.createTextNode(c));
      const x = el('button', null, '×');
      x.onclick = () => { chosen.splice(chosen.indexOf(c), 1); render(); };
      t.appendChild(x);
      box.appendChild(t);
    });
    box.appendChild(input);
    picks.querySelectorAll('button').forEach(b => {
      b.className = chosen.indexOf(b.dataset.cert) >= 0 ? 'on' : '';
    });
  };
  const add = v => {
    const s = String(v || '').trim().toUpperCase();
    if (s && chosen.indexOf(s) < 0) chosen.push(s);
    input.value = '';
    render();
  };
  input.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
    else if (e.key === 'Backspace' && !input.value && chosen.length) { chosen.pop(); render(); }
  };
  input.onblur = () => { if (input.value.trim()) add(input.value); };

  certTypes().forEach(c => {
    const b = el('button', null, c.cert_id);
    b.type = 'button';
    b.dataset.cert = c.cert_id;
    b.title = c.name + ' — ' + c.scope + (c.note ? '\n' + c.note : '');
    b.onclick = () => {
      const i = chosen.indexOf(c.cert_id);
      if (i >= 0) chosen.splice(i, 1); else chosen.push(c.cert_id);
      render();
    };
    picks.appendChild(b);
  });

  wrap.appendChild(box);
  wrap.appendChild(picks);
  render();
  return { node: wrap, value: () => chosen.slice() };
}

function certChips(list) {
  if (!list || !list.length) return '<span class="note">none recorded</span>';
  return list.map(c => {
    const m = certById(c);
    return '<span class="' + badgeClass('TRACK') + '" title="' + esc(m ? m.name + ' — ' + m.scope : 'custom scheme') + '">' + esc(c) + '</span>';
  }).join(' ');
}

/* Which steps a project actually runs (v2.1). A packaging-only change never
   touches mould making, so its workflow is genuinely shorter — the steps that
   do not apply are listed once, not silently dropped. */
function stepsOf(proc, project) {
  const all = allStepsOf(proc);
  const ct = project && changeTypeById(project.class_abcde);
  if (!ct) return all;
  const allowed = proc === 'NPI' ? ct.npi_steps : ct.ecn_steps;
  if (!allowed || !allowed.length) return all;
  return all.filter(s => allowed.indexOf(s.step_id) >= 0);
}
function excludedStepsOf(proc, project) {
  const on = stepsOf(proc, project);
  return allStepsOf(proc).filter(s => on.indexOf(s) < 0);
}

/* Target finish date = request date + the change type's cycle time (converted
   to whole weeks). Type A has no baselined cycle time yet, so it produces nothing. */
function targetDateFor(classId, fromDate) {
  const ct = changeTypeById(classId);
  if (!ct || ct.cycle_time_days == null || !fromDate) return '';
  const fromWeek = toWeek(fromDate);
  if (!fromWeek) return '';
  const weeks = Math.ceil(Number(ct.cycle_time_days) / 7);
  return addWeeks(fromWeek, weeks);
}

function warehouseRequired(proc, step) { return !!step.warehouse_gate_required; }
function isGated(proc, step) { return proc === 'NPI' ? true : !!step.gate_clearance_required; }

/* A step counts as done for downstream progression if it was signed OR if a
   bypass is open against it (v2.1). The bypass record and its justification
   stay visible and stay in the audit log — it clears the road, it does not
   erase the debt. */
/* ---- filename → document type / step guessing (v2.2) --------------------
   Scores each catalogue entry against the dropped filename: an exact form code
   (QA-F-GEN-0010) or doctype id is near-certain; matching words from the
   document's name are weaker evidence. Everything stays overridable — this
   saves typing, it does not decide anything. */
const STOPWORDS = ['the', 'and', 'for', 'of', 'a', 'form', 'report', 'sheet', 'template', 'file', 'doc', 'new', 'product'];
/* Whole-token match for a form_code/doctype_id against the already-normalised
   `hay` (hyphens/underscores/dots -> spaces). The needle is normalised the
   same way before comparing, so a hyphenated code like "QA-F-NPI-0004"
   matches a filename spelled with underscores or spaces instead of its own
   hyphens — a plain hay.indexOf(code) never would, since hay's hyphens are
   already gone by the time this runs. Boundaries are checked against
   [a-z0-9] explicitly, not \b: underscore counts as a \w character, so \b
   would see no boundary at all in "circuit_ir_test" even though the
   underscore IS a real separator there. Without an explicit boundary check a
   short id like "ir" matches inside any word that merely contains those two
   letters in sequence — "hair", "wire", "circuit", "direction" — which is
   not a hypothetical: this company makes hair clippers. */
function matchesAsWord(hay, rawNeedle) {
  const needle = String(rawNeedle || '').toLowerCase().replace(/[_\-.]+/g, ' ').trim();
  if (!needle) return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![a-z0-9])' + esc + '(?![a-z0-9])').test(hay);
}
function guessFromName(fileName) {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const hay = stem.toLowerCase().replace(/[_\-.]+/g, ' ');
  let best = null, bestScore = 0;
  CFG.document_types.forEach(d => {
    let score = 0;
    const code = String(d.form_code || '').toLowerCase();
    const id = String(d.doctype_id || '').toLowerCase();
    if (code && matchesAsWord(hay, code)) score += 100;
    if (id && matchesAsWord(hay, id)) score += 80;
    // a bare form number, e.g. "gen-0010" or "gen 0010" without the QA-F- prefix
    const num = (code.match(/(\d{4})\s*$/) || [])[1];
    if (num && new RegExp('\\b' + num + '\\b').test(hay)) score += 40;
    (d.keywords || []).forEach(k => {
      if (k && hay.indexOf(k.toLowerCase()) >= 0) score += 60;
    });
    String(d.name || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(w => w.length > 3 && STOPWORDS.indexOf(w) < 0)
      .forEach(w => { if (hay.indexOf(w) >= 0) score += 12; });
    if (score > bestScore) { bestScore = score; best = d; }
  });
  const doc = best ? best.doctype_id : (CFG.document_types[0] || {}).doctype_id;

  // step: the first workflow step that actually demands this document
  let step = null;
  ['npi_workflow', 'ecn_workflow'].forEach(wf => {
    if (step != null) return;
    (CFG[wf].steps || []).forEach(s => {
      if (step != null) return;
      const req = (s.required_evidence_doctypes || []).concat(s.conditional_evidence_doctypes || []);
      if (req.indexOf(doc) >= 0) step = s.step_id;
    });
  });
  // an explicit "step 4" / "s4" in the name beats the lookup
  const m = hay.match(/\bs(?:tep)?\s*(\d{1,2})\b/);
  if (m) step = Number(m[1]);

  // The document code goes into the filename as its own segment, so leaving it
  // in the description too produces QA-F-GEN-0010_..._QA_F_GEN_0010_02_...
  // The trailing (?![0-9]) matters: without it the optional revision suffix
  // eats the leading digits of the next word, turning 9649 into 49.
  //
  // Same explicit-alnum-boundary guard as matchesAsWord() above, and for the
  // same reason: raw is still in its original, un-normalised form here (stem,
  // not hay), so a short code like "ir" would otherwise strip out of the
  // middle of an unrelated word — "hair_clipper_9649_photo" losing its "ir"
  // to become "ha clipper 9649 photo" — not just fail to match one, but
  // visibly corrupt the description text. Widened to guard the trailing side
  // too (?![a-z0-9]), not just digits: the old trailing-digit-only guard let
  // a code immediately followed by a letter with no separator match too,
  // e.g. "BOM" inside "BOMdata.pdf".
  let raw = stem;
  if (best) {
    [best.form_code, best.doctype_id].filter(Boolean).forEach(code => {
      const loose = String(code).replace(/[^a-z0-9]+/gi, '[^a-z0-9]*');
      raw = raw.replace(new RegExp('(?<![a-z0-9])' + loose + '(?:[-_]\\d{1,2})?(?![a-z0-9])', 'ig'), ' ');
    });
  }
  let desc = raw.replace(/[_\-]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!desc) desc = stem.replace(/[_\-]+/g, ' ').trim();

  return { doc, step, desc, confident: bestScore >= 40 };
}

/* ---- which step does this document belong to? (v2.4) --------------------
   Driven by the project itself: its process picks the workflow, its change
   class prunes the steps that do not apply, and the config says which steps
   demand which documents. A PFMEA on a Type-D ECN lands somewhere different
   from a PFMEA on a Type-E NPI, and the user should not have to know that. */
function stepsRequiringDoc(project, docCode) {
  const proc = project.process;
  const applicable = stepsOf(proc, project);
  const required = applicable.filter(s => (s.required_evidence_doctypes || []).indexOf(docCode) >= 0);
  const optional = applicable.filter(s => (s.conditional_evidence_doctypes || []).indexOf(docCode) >= 0);
  return { required, optional, any: required.concat(optional) };
}

/* The earliest step that still needs it. Steps already signed or bypassed are
   skipped — filing a control plan against a gate that closed last month is
   almost never what someone means. */
function bestStepForDoc(project, docCode) {
  if (!project || !docCode) return null;
  const m = stepsRequiringDoc(project, docCode);
  if (!m.any.length) return null;
  const openReq = m.required.filter(s => !stepDone(project.project_id, project.process, s));
  if (openReq.length) return { step: openReq[0], why: 'required here and not yet signed' };
  const openAny = m.any.filter(s => !stepDone(project.project_id, project.process, s));
  if (openAny.length) return { step: openAny[0], why: 'listed here as applicable' };
  return { step: m.any[0], why: 'only step that uses it — already closed' };
}

/* The <select>-era step option builder was replaced by stepDatalistOptions()
   when the step pickers became comboboxes in v2.5. Nothing calls it any more,
   so it is gone rather than left to rot next to its replacement. */

function stepDone(pid, proc, step) {
  const sk = stepKeyOf(proc, step);
  if (TRK.lb_approvals.some(a => a.project_id === pid && a.step_key === sk)) return true;
  return TRK.lb_bypasses.some(b => b.project_id === pid && b.step_key === sk && !b.closed_utc);
}

// Checks whether a deliverable has been claimed, supported, or assigned even
// though no file has been filed yet. Also checks the parent gate row.
function isDeliverableClaimed(pid, stepKey, code) {
  var rows = TRK.lb_deliverables.filter(function(r) {
    return r.project_id === pid && r.step_key === stepKey && r.doc_code === code;
  });
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.owner_pic || r.claimed_by || r.supporter_pic || r.supporter_by || r.assigned_by) return true;
  }
  var gate = TRK.lb_gates.find(function(g) {
    return g.project_id === pid && g.step_key === stepKey;
  });
  if (gate && (gate.owner_pic || gate.claimed_by || gate.supporter_pic || gate.supporter_by || gate.assigned_by)) return true;
  return false;
}

function evidenceFor(pid, stepKey, docCode) {
  var rows = TRK.lb_deliverables.filter(function(r) {
    return r.project_id === pid && r.step_key === stepKey && r.doc_code === docCode;
  });
  // A 'Removed' marker row means the requirement was deliberately excluded.
  var removedRow = rows.find(function(r) { return r.status === 'Removed'; });
  if (removedRow) return { level: 'REMOVED', del: removedRow };
  // Skip custom-doc marker rows that carry no actual evidence — those exist
  // only to declare a per-model requirement, not to represent a filed file.
  var realRows = rows.filter(function(r) {
    return r.file_name || r.link_url || r.file_path;
  });
  var del = realRows.length ? realRows[realRows.length - 1] : null;
  if (del && del.approved === 'YES') return { level: 'APPROVED', del };
  if (del) return { level: 'FILED', del };
  // No file — check if someone has claimed, been assigned, or is supporting
  if (isDeliverableClaimed(pid, stepKey, docCode)) return { level: 'ON_GOING', del: null };
  return { level: 'MISSING', del: null };
}
function whRows(pid, stepKey) { return TRK.lb_warehouse.filter(w => w.project_id === pid && w.step_key === stepKey); }
function whReady(pid, stepKey) {
  const rows = whRows(pid, stepKey);
  return WH_AREAS.every(a => rows.some(r => r.area === a && r.status === 'Cleared'));
}
function gateRowOf(pid, stepKey) { return TRK.lb_gates.find(g => g.project_id === pid && g.step_key === stepKey); }

function gateState(project, proc, step) {
  const sk = stepKeyOf(proc, step);
  var req = step.required_evidence_doctypes || [];
  // Union in model-specific custom documents — these are per-project, not global
  var customCodes = [];
  (TRK.lb_deliverables || []).forEach(function(d) {
    if (d.project_id === project.project_id && d.step_key === sk && d.custom_doc === 'YES') {
      if (req.indexOf(d.doc_code) < 0) req.push(d.doc_code);
      customCodes.push(d.doc_code);
    }
  });
  const ev = req.map(code => ({ code, doc: docTypeById(code), ev: evidenceFor(project.project_id, sk, code), custom: customCodes.indexOf(code) >= 0 }));
  const missing = ev.filter(x => x.ev.level === 'MISSING');
  const removed = ev.filter(x => x.ev.level === 'REMOVED');
  const active = ev.filter(x => x.ev.level !== 'REMOVED');
  // Conditional evidence is tracked and shown but never blocks a gate — these
  // are documents the SOP does not actually mandate on every project.
  const cond = (step.conditional_evidence_doctypes || [])
    .map(code => ({ code, doc: docTypeById(code), ev: evidenceFor(project.project_id, sk, code), custom: false }));
  const blocking = TRK.lb_issues.filter(i => i.project_id === project.project_id && i.step_key === sk && i.status !== 'Closed');
  const approval = TRK.lb_approvals.filter(a => a.project_id === project.project_id && a.step_key === sk).slice(-1)[0];
  const bypasses = TRK.lb_bypasses.filter(b => b.project_id === project.project_id && b.step_key === sk && !b.closed_utc);
  const bypass = bypasses[bypasses.length - 1];
  const gate = gateRowOf(project.project_id, sk);
  const needWh = warehouseRequired(proc, step);
  const whOk = !needWh || whReady(project.project_id, sk);
  const gated = isGated(proc, step);

  // Stage gates run in order: a gate cannot be signed while an earlier
  // applicable gate is still open. A bypass on that earlier gate satisfies
  // this — that is the whole point of authorising one.
  const priorOpen = stepsOf(proc, project)
    .filter(s => s.step_id < step.step_id && isGated(proc, s) && !stepDone(project.project_id, proc, s));

  let status = 'NOT_STARTED';
  if (approval) status = 'COMPLETE';
  else if (bypass) status = 'BYPASSED';
  else if (gate && gate.status === 'InProgress') status = 'IN_PROGRESS';
  else if (active.length && missing.length < active.length) status = 'IN_PROGRESS';
  const done = !!(approval || bypass);
  const priorBlocks = priorOpen.length > 0 && !isPrivileged();
  const canApprove = gated && !approval && missing.length === 0 && blocking.length === 0 && whOk && !priorBlocks;
  return { sk, req, ev, cond, missing, removed, blocking, approval, bypass, gate, needWh, whOk, gated, status, done, canApprove, priorOpen, priorBlocks };
}
function progressOf(project) {
  const proc = project.process, steps = stepsOf(proc, project);
  const gated = steps.filter(s => isGated(proc, s));
  const done = gated.filter(s => stepDone(project.project_id, proc, s)).length;
  return { done, total: gated.length, pct: gated.length ? Math.round(100 * done / gated.length) : 0 };
}

/* Single-point classification of a project's overall gate health. "Late"
   reuses the c-AT_RISK chip colour, which already renders red across both
   colour schemes. Extracted from familyFgTree() so the new family transfer
   chart in the Dashboard can reuse the exact same rule without duplicating it. */
function classifyProject(prj) {
  const pr = progressOf(prj);
  const tgt = toWeek(prj.target_date) || targetDateFor(prj.class_abcde, prj.prf_date);
  const late = tgt && tgt < nowWeek() && pr.done < pr.total;
  if (pr.done === pr.total && pr.total > 0) return 'COMPLETE';
  if (pr.done === 0) return 'NOT_STARTED';
  if (late) return 'LATE';
  return 'IN_PROGRESS';
}

/* ===================================================================== */
/* TAB — EXECUTIVE DASHBOARD                                             */
/* ===================================================================== */

/* Who actually touched a step, and with which documents. Cross-references
   deliverables and approvals so the PIC column reads
   "Hoang (PFMEA, BOM) · QA Nga (CONTROL-PLAN)" instead of a bare name. */
function picsFor(pid, stepKey) {
  const by = {};
  TRK.lb_deliverables.filter(d => d.project_id === pid && d.step_key === stepKey).forEach(d => {
    const who = d.uploaded_by || '(unnamed)';
    (by[who] = by[who] || { docs: [], role: 'filed' }).docs.push(d.doc_code);
  });
  TRK.lb_approvals.filter(a => a.project_id === pid && a.step_key === stepKey).forEach(a => {
    const who = a.approved_by || '(unnamed)';
    const e = (by[who] = by[who] || { docs: [], role: '' });
    e.role = 'signed';
  });
  return Object.keys(by).map(n => ({
    name: n,
    docs: by[n].docs.filter((v, i, s) => s.indexOf(v) === i),
    role: by[n].role
  }));
}

function cellStateFor(project, step) {
  const g = gateState(project, project.process, step);
  const done = [], filed = [], ongoing = [], missing = [], removed = [], customSet = new Set();
  g.ev.forEach(x => {
    if (x.custom) customSet.add(x.code);
    if (x.ev.level === 'APPROVED') done.push(x.code);
    else if (x.ev.level === 'FILED') filed.push(x.code);
    else if (x.ev.level === 'REMOVED') removed.push(x.code);
    else if (x.ev.level === 'ON_GOING') ongoing.push(x.code);
    else missing.push(x.code);
  });
  // Removed documents are excluded from BOTH sides of the ratio: marking a
  // requirement as not-applicable should raise completion, not leave a
  // permanent hole that can never be closed. On-going ones ARE counted in
  // the denominator - somebody claiming a document does not make the
  // requirement go away, it just means work has started.
  const countable = done.length + filed.length + ongoing.length + missing.length;
  const percent = countable ? Math.round(100 * (done.length + filed.length) / countable) : null;
  // an approved or bypassed gate promotes everything filed under it to done —
  // a signature is what turns filed paper into an accepted deliverable
  if (g.approval) { done.push.apply(done, filed.splice(0)); }
  return {
    g, done, filed, ongoing, missing, removed, customSet, percent,
    started: !!(done.length || filed.length || ongoing.length || removed.length || g.gate)
  };
}

function matrixCell(project, step) {
  const c = cellStateFor(project, step);
  const td = el('td', 'mcell');
  // No early return here: the percentage line below must render first even
  // for an untouched cell, so every cell in the matrix reads consistently.
  const bits = [];
  // Completion percentage — always rendered as the first line
  if (c.percent !== null) {
    const filedOrApproved = c.done.length + c.filed.length;
    const total = filedOrApproved + c.missing.length;
    bits.push('<div class="matrix-pct"><strong>' + c.percent + '%</strong> <span class="matrix-pct-sub">(' + filedOrApproved + '/' + total + ' docs)</span></div>');
  } else {
    bits.push('<div class="matrix-pct matrix-pct-na">n/a</div>');
  }
  if (!c.started && !c.missing.length && !c.removed.length) { bits.push('<span class="' + badgeClass('NO_DATA') + '">not started</span>'); td.innerHTML = bits.join('<br>'); return { td, c }; }
  if (c.done.length) bits.push('<span class="' + badgeClass('COMPLETE') + '" title="approved">Done: ' + c.done.map(esc).join(', ') + '</span>');
  if (c.filed.length) bits.push('<span class="' + badgeClass('FILED') + '" title="filed, not signed">Filed: ' + c.filed.map(esc).join(', ') + '</span>');
  if (c.ongoing.length) bits.push('<span class="' + badgeClass('ON_GOING') + '" title="claimed or assigned, no file yet">On Going: ' + c.ongoing.map(esc).join(', ') + '</span>');
  if (c.missing.length) bits.push('<span class="' + badgeClass('MISSING') + '" title="required, nothing filed">Missing: ' + c.missing.map(esc).join(', ') + '</span>');
  if (c.removed.length) bits.push('<span class="matrix-removed ' + badgeClass('NO_DATA') + '" title="removed from requirements">Removed: ' + c.removed.map(esc).join(', ') + '</span>');
  // bits always holds the percentage line, so test the real content instead
  if (!c.done.length && !c.filed.length && !c.missing.length && !c.removed.length) bits.push('<span class="' + badgeClass('NO_DATA') + '">not started</span>');
  if (c.g.bypass) bits.push('<span class="' + badgeClass('BYPASSED') + '">bypassed</span>');
  const nc = cellNoteCount(project, stepKeyOf(project.process, step));
  if (nc) bits.push('<span class="matrix-note-indicator" title="' + nc + ' note(s)">💬 ' + nc + '</span>');
  td.innerHTML = bits.join('<br>');
  return { td, c };
}

/* Groups ECN steps into gate-anchored buckets: every non-gated step folds
   into the NEXT gated step's column. E.g. steps 1-3 fold into the step-4
   gate column, 5-10 fold into step-11, nothing folds into step-12 if it
   immediately follows step-11. Driven by isGated()/gate_clearance_required,
   not hardcoded step numbers, so it stays correct if the SOP config changes. */
function ecnGateGroups() {
  const steps = allStepsOf('ECN');
  const groups = [];
  let bucket = [];
  steps.forEach(s => {
    bucket.push(s);
    if (isGated('ECN', s)) { groups.push({ gate: s, steps: bucket }); bucket = []; }
  });
  if (bucket.length && groups.length) groups[groups.length - 1].steps = groups[groups.length - 1].steps.concat(bucket);
  else if (bucket.length) bucket.forEach(s => groups.push({ gate: s, steps: [s] }));
  return groups;
}

/* Aggregates matrixCell's per-step evidence status across every step in a
   gate group, for one project. Same done/filed/missing shape as
   cellStateFor(), merged (deduped by doc code) across all applicable steps in
   the group so a document filed at a folded-in earlier step still shows up
   under the gate column it now lives in. */
function groupCellStateFor(project, group) {
  const proc = project.process;
  const applicableSteps = group.steps.filter(function(s) { return stepsOf(proc, project).indexOf(s) >= 0; });
  const done = [], filed = [], ongoing = [], missing = [], removed = [];
  let anyStarted = false, anyGateObj = null;
  applicableSteps.forEach(function(step) {
    const c = cellStateFor(project, step);
    if (c.started) anyStarted = true;
    if (step === group.gate) anyGateObj = c.g;
    c.done.forEach(function(x) { if (done.indexOf(x) < 0) done.push(x); });
    c.filed.forEach(function(x) { if (filed.indexOf(x) < 0) filed.push(x); });
    c.ongoing.forEach(function(x) { if (ongoing.indexOf(x) < 0) ongoing.push(x); });
    c.missing.forEach(function(x) { if (missing.indexOf(x) < 0) missing.push(x); });
    c.removed.forEach(function(x) { if (removed.indexOf(x) < 0) removed.push(x); });
  });
  const filedFinal = filed.filter(function(x) { return done.indexOf(x) < 0; });
  // Precedence when the same doc code appears at several folded-in steps:
  // done > filed > on-going > removed > missing.
  const ongoingFinal = ongoing.filter(function(x) { return done.indexOf(x) < 0 && filedFinal.indexOf(x) < 0; });
  const missingFinal = missing.filter(function(x) {
    return done.indexOf(x) < 0 && filedFinal.indexOf(x) < 0 && ongoingFinal.indexOf(x) < 0 && removed.indexOf(x) < 0;
  });
  return { done: done, filed: filedFinal, ongoing: ongoingFinal, missing: missingFinal, removed: removed, started: anyStarted, g: anyGateObj, applicableSteps: applicableSteps };
}

function viewDashboard(root) {
  const b = el('div', 'banner');
  b.innerHTML = '<b>Executive summary.</b> Gate completion by process step and product family, with click-through to the full project detail.';
  root.appendChild(b);

  if (!TRK.lb_projects.length) {
    const p = el('div', 'card');
    const pb = el('div', 'card-body'); p.appendChild(pb);
    pb.appendChild(el('p', 'note', 'No project registered yet — use the Input tab.'));
    root.appendChild(p); return;
  }

  /* ---- executive summary print target ---- */
  const execWrap = el('div'); execWrap.id = 'dashExec';

  /* print-only title block — invisible on screen, appears on the printed/PDF page
     so the output reads as a report someone can hand to an executive. */
  const titleBlock = el('div', 'print-only');
  titleBlock.innerHTML = '<h1>' + esc(CFG.system_info.app_name) + ' v' + esc(CFG.system_info.version) + '</h1>' +
    '<p>Prepared by ' + esc(getUser() || '—') + ' &middot; ' + esc(today()) + '</p>';
  execWrap.appendChild(titleBlock);

  /* Toolbar: PDF + Management Report Export. Both kept off the printed page. */
  const toolbar = el('div', 'no-print');
  toolbar.className = 'no-print dash-toolbar';

  const pdfBtn = el('button', 'primary', 'Download PDF');
  pdfBtn.onclick = () => buildPrintPackage();
  toolbar.appendChild(pdfBtn);

  const expBtn = el('button', 'primary', 'Download Management Report');
  expBtn.onclick = () => exportManagementReport();
  toolbar.appendChild(expBtn);

  /* Report template download — pick a pre-made XLSX template, fill it with
     live data respecting the current slicer filters, and download it. */
  const reportSel = el('select'); reportSel.id = 'dashReportSelect';
  reportSel.style.cssText = 'padding:6px 10px;border:1px solid #ccc;border-radius:4px;margin-left:8px;min-width:180px';
  reportSel.innerHTML = '<option value="">— XLSX Report —</option>' +
    '<option value="lfi">Late Found Issue Report</option>' +
    '<option value="transfer">Project Transfer Report</option>' +
    '<option value="kpi">KPI Report</option>';
  toolbar.appendChild(reportSel);

  const rptBtn = el('button', 'primary', 'Download');
  rptBtn.onclick = () => {
    const type = reportSel.value;
    if (!type) { alert('Select a report type first.'); return; }
    const p = new URLSearchParams({ type });
    if (dashFamFilter) p.set('fam', dashFamFilter);
    if (dashModelFilter) p.set('model', dashModelFilter);
    if (dashStartWeekFilter) p.set('start', dashStartWeekFilter);
    if (dashEndWeekFilter) p.set('end', dashEndWeekFilter);
    const a = document.createElement('a');
    a.href = '/api/reports/download?' + p.toString();
    a.download = '';
    a.click();
  };
  toolbar.appendChild(rptBtn);
  execWrap.appendChild(toolbar);

  /* =====================================================================
     Portfolio KPI bar — five small executive-summary cards computed from
     the shared computePortfolioKPIs() so the dashboard and the export
     can never disagree.
     ================================================================== */
  (function() {
    execWrap.appendChild(el('h3', null, 'Portfolio KPIs'));
    const kpis = computePortfolioKPIs();
    const kpiGrid = el('div', 'kpi-grid');
    kpis.forEach(k => {
      const card = el('div', 'kpi-card ' + k.cssClass);
      card.innerHTML = '<div class="kpi-label">' + esc(k.label) + '</div>' +
        '<div class="kpi-value">' + esc(k.value) + '</div>' +
        '<div class="kpi-sub">' + esc(k.sub) + '</div>';
      kpiGrid.appendChild(card);
    });
    execWrap.appendChild(kpiGrid);
  })();

  root.appendChild(execWrap);

  /* =====================================================================
     Dashboard slicer helpers — shared by matrices and stage cards so
     the filter predicate is defined once and used by every section.
     ================================================================== */
  function projectTargetWeek(p) {
    return toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date) || '';
  }

  function buildEndWeekOptions(projects) {
    const weeks = new Set();
    projects.forEach(function(p) { var w = projectTargetWeek(p); if (w) weeks.add(w); });
    return [...weeks].sort();
  }

  function buildStartWeekOptions(projects) {
    const weeks = new Set();
    projects.forEach(function(p) { var w = toWeek(p.prf_date); if (w) weeks.add(w); });
    return [...weeks].sort();
  }

  function distinctModels(projects) {
    const models = new Set();
    projects.forEach(function(p) { if (p.family) models.add(p.family); });
    return [...models].sort();
  }

  function filterDashboardProjects(process) {
    var list = projectsOf(process);
    var any = dashFamFilter.length || dashModelFilter.length || dashStartWeekFilter.length || dashEndWeekFilter.length;
    if (!any) return list;
    return list.filter(function(p) {
      if (dashFamFilter.length && !dashFamFilter.includes(p.prod_family)) return false;
      if (dashModelFilter.length && !dashModelFilter.includes(p.family)) return false;
      if (dashStartWeekFilter.length) { var sw = toWeek(p.prf_date); if (!sw || !dashStartWeekFilter.includes(sw)) return false; }
      if (dashEndWeekFilter.length) { var ew = projectTargetWeek(p); if (!ew || !dashEndWeekFilter.includes(ew)) return false; }
      return true;
    });
  }

  /* ---- slicer bar (rendered once, above the matrices) ------------------- */
  var dashSlicerWrap = el('div'); dashSlicerWrap.id = 'dashSlicerWrap';
  root.appendChild(dashSlicerWrap);

  /* ---- matrix containers (rebuilt when filters change) ------------------ */
  var dashNpiMatrixWrap = el('div'); dashNpiMatrixWrap.id = 'dashNpiMatrixWrap';
  root.appendChild(dashNpiMatrixWrap);
  var dashEcnMatrixWrap = el('div'); dashEcnMatrixWrap.id = 'dashEcnMatrixWrap';
  root.appendChild(dashEcnMatrixWrap);

  // renderAll() is declared inside the IIFE further down that owns `wrap` and
  // renderCards(), so it is NOT in scope for the slicer onChange handlers up
  // here - calling it directly threw "renderAll is not defined" on every
  // slicer interaction, which silently left the matrices unfiltered while the
  // slicer button label happily showed the new selection. The IIFE publishes
  // it here instead.
  var dashRenderAll = null;

  function renderDashboardSlicers() {
    var allNpi = projectsOf('NPI');
    _msOpenPopover = null; // close any stale popover from a prior render

    // Cascade: each slicer derives its options from projects matching the OTHER active filters
    function filteredByOthers(keepFilter) {
      return allNpi.filter(function(p) {
        if (keepFilter !== 'fam' && dashFamFilter.length && !dashFamFilter.includes(p.prod_family)) return false;
        if (keepFilter !== 'model' && dashModelFilter.length && !dashModelFilter.includes(p.family)) return false;
        if (keepFilter !== 'start' && dashStartWeekFilter.length) { var sw = toWeek(p.prf_date); if (!sw || !dashStartWeekFilter.includes(sw)) return false; }
        if (keepFilter !== 'end' && dashEndWeekFilter.length) { var ew = projectTargetWeek(p); if (!ew || !dashEndWeekFilter.includes(ew)) return false; }
        return true;
      });
    }

    function clearStaleFilters() {
      if (dashFamFilter.length) {
        var famSet = new Set(filteredByOthers('fam').map(function(p) { return p.prod_family; }));
        dashFamFilter = dashFamFilter.filter(function(v) { return famSet.has(v); });
      }
      if (dashModelFilter.length) {
        var modelSet = new Set(filteredByOthers('model').map(function(p) { return p.family; }));
        dashModelFilter = dashModelFilter.filter(function(v) { return modelSet.has(v); });
      }
      if (dashStartWeekFilter.length) {
        var startSet = new Set(filteredByOthers('start').map(function(p) { return toWeek(p.prf_date); }).filter(Boolean));
        dashStartWeekFilter = dashStartWeekFilter.filter(function(v) { return startSet.has(v); });
      }
      if (dashEndWeekFilter.length) {
        var endSet = new Set(filteredByOthers('end').map(function(p) { return projectTargetWeek(p); }).filter(Boolean));
        dashEndWeekFilter = dashEndWeekFilter.filter(function(v) { return endSet.has(v); });
      }
    }

    dashSlicerWrap.innerHTML = '';
    var sel = el('div', 'dashboard-slicers');

    // Family — static list from config (not cascaded from other filters)
    var famOptions = CFG.prod_families.map(function(f) {
      return { value: f.prod_family_id, label: f.prod_family_name + ' (' + f.prod_family_id + ')' };
    });
    sel.appendChild(createMultiSelect({
      label: 'Family', options: famOptions, value: dashFamFilter,
      placeholder: 'All Families',
      onChange: function() { clearStaleFilters(); if (dashRenderAll) dashRenderAll(); }
    }));

    // Model — derived from distinct p.family values of currently-visible projects
    var modelOptions = distinctModels(filteredByOthers('model')).map(function(m) {
      return { value: m, label: m };
    });
    sel.appendChild(createMultiSelect({
      label: 'Model', options: modelOptions, value: dashModelFilter,
      placeholder: 'All Models',
      onChange: function() { clearStaleFilters(); if (dashRenderAll) dashRenderAll(); }
    }));

    // Start Week (prf_date)
    var startOptions = buildStartWeekOptions(filteredByOthers('start')).map(function(w) {
      return { value: w, label: weekRangeLabel(w) };
    });
    sel.appendChild(createMultiSelect({
      label: 'Start Week', options: startOptions, value: dashStartWeekFilter,
      placeholder: 'All Start Weeks',
      onChange: function() { clearStaleFilters(); if (dashRenderAll) dashRenderAll(); }
    }));

    // End Week (target_date)
    var endOptions = buildEndWeekOptions(filteredByOthers('end')).map(function(w) {
      return { value: w, label: weekRangeLabel(w) };
    });
    sel.appendChild(createMultiSelect({
      label: 'End Week', options: endOptions, value: dashEndWeekFilter,
      placeholder: 'All End Weeks',
      onChange: function() { clearStaleFilters(); if (dashRenderAll) dashRenderAll(); }
    }));

    dashSlicerWrap.appendChild(sel);
  }

  /* =====================================================================
     STAGE MATRICES — primary workspace. NPI first, then ECN.
     Each matrix scrolls horizontally inside its own container; the page
     body never scrolls sideways.
     ================================================================== */

  // ---- NPI matrix --------------------------------------------------------
  function renderDashboardNpiMatrix() {
    dashNpiMatrixWrap.innerHTML = '';
    const list = filterDashboardProjects('NPI');
    // Only skip the panel entirely when NO NPI projects are registered at all.
    // When filters hide all of them we still render the panel with a hint.
    if (!projectsOf('NPI').length) return;
    const steps = allStepsOf('NPI');
    const proc = 'NPI';

    const panel = el('div', 'card');
    const panelHdr = el('div', 'card-header');
    panelHdr.appendChild(el('h3', 'card-title', 'NPI — stage matrix'));
    panel.appendChild(panelHdr);
    const panelBody = el('div', 'card-body');

    const wrap = el('div', 'scroll');
    const t = el('table', 'matrix');

    t.innerHTML = '<thead><tr><th>Project</th>' +
      steps.map(s => '<th title="' + esc(s.step_name) + '">' + s.step_id + '. ' + esc(s.step_name) + '</th>').join('') +
      '<th>PIC</th></tr></thead>';
    const tb = el('tbody');

    if (!list.length) {
      const emptyTr = el('tr'); const emptyTd = el('td');
      emptyTd.colSpan = 2 + steps.length;
      emptyTd.textContent = (dashFamFilter.length || dashModelFilter.length || dashStartWeekFilter.length || dashEndWeekFilter.length)
        ? 'No NPI projects match the current filter.'
        : 'No NPI projects registered yet.';
      emptyTr.appendChild(emptyTd); tb.appendChild(emptyTr);
    } else {
      list.forEach(project => {
        const on = stepsOf(proc, project);
        const pr = progressOf(project);
        const cls = classifyProject(project);
        const tgt = toWeek(project.target_date) || targetDateFor(project.class_abcde, project.prf_date);
        const late = tgt && tgt < nowWeek() && pr.done < pr.total;
        const fam = familyById(project.prod_family);

        const tr = el('tr');

        // Row header: id, family, status pill, progress bar with fraction,
        // target week (danger-coloured + text hint when overdue), project-level issues.
        const head = el('td');
        let headHTML = '<b>' + esc(project.project_id) + '</b>';
        if (fam) headHTML += '<div class="note">' + esc(fam.prod_family_name) + '</div>';
        headHTML += ' <span class="' + badgeClass(cls) + '">' + esc(cls.replace(/_/g, ' ')) + '</span>';
        headHTML += '<br><span class="bar bar-sm"><i style="width:' + pr.pct + '%"></i></span>' +
          ' <span class="note">' + pr.done + '/' + pr.total + '</span>';
        if (tgt) {
          const overdueTitle = late ? ' title="Target week is earlier than current week — overdue"' : '';
          const overdueAria = late ? ' aria-label="overdue"' : '';
          const weekTxt = late
            ? '<span style="color:var(--bad);font-weight:700"' + overdueTitle + overdueAria + '>' + esc(tgt) + '</span> <span class="note">(overdue)</span>'
            : esc(tgt);
          headHTML += '<br>' + weekTxt;
        }

        // Project-level open issues (no step_key)
        const projIssues = ((TRK.lb_issues || []).concat(TRK.lb_sp_issues || []))
          .filter(i => i.project_id === project.project_id && !i.step_key && i.status !== 'Closed');
        if (projIssues.length) {
          headHTML += ' <span class="matrix-issue-badge" title="' +
            projIssues.map(i => esc(i.title || i.issue_title || '(untitled)')).join('&#10;') +
            '">⚠ ' + projIssues.length + '</span>';
        }
        head.innerHTML = headHTML;
        tr.appendChild(head);

        const allPics = {};
        steps.forEach(step => {
          if (on.indexOf(step) < 0) {
            const na = el('td', 'mcell');
            na.innerHTML = '<span class="note">n/a for type ' + esc(project.class_abcde || '?') + '</span>';
            tr.appendChild(na);
          } else {
            const { td } = matrixCell(project, step);
            td.style.cursor = 'pointer';
            td.onclick = () => { openDrawer(project, step); };

            // Step-level issue badge
            const sk = stepKeyOf(proc, step);
            const stepIssues = ((TRK.lb_issues || []).concat(TRK.lb_sp_issues || []))
              .filter(i => i.project_id === project.project_id && i.step_key === sk && i.status !== 'Closed');
            if (stepIssues.length) {
              const badge = el('span', 'matrix-issue-badge', '⚠ ' + stepIssues.length);
              badge.title = stepIssues.map(i => esc(i.title || i.issue_title || '(untitled)')).join('\n');
              td.appendChild(el('br'));
              td.appendChild(badge);
            }
            tr.appendChild(td);

            picsFor(project.project_id, sk).forEach(p => {
              const e = (allPics[p.name] = allPics[p.name] || []);
              p.docs.forEach(d => { if (e.indexOf(d) < 0) e.push(d); });
            });
          }
        });

        const ptd = el('td');
        const names = Object.keys(allPics);
        ptd.innerHTML = names.length
          ? names.map(n => esc(n) + ' <span class="note">(' + allPics[n].map(esc).join(', ') + ')</span>').join('<br>')
          : '<span class="note">nobody yet</span>';
        tr.appendChild(ptd);
        tb.appendChild(tr);
      });
    }

    t.appendChild(tb); wrap.appendChild(t); panelBody.appendChild(wrap);
    panelBody.appendChild(el('p', 'note', 'Green means a named person signed the gate. Blue means the document is filed but nobody has signed for it. ' +
      'Red means the step requires it and nothing has been filed.'));
    panel.appendChild(panelBody);
    dashNpiMatrixWrap.appendChild(panel);
  }

  // ---- ECN matrix (gate-grouped columns + PPAP) ---------------------------
  function renderDashboardEcnMatrix() {
    dashEcnMatrixWrap.innerHTML = '';
    const list = filterDashboardProjects('ECN');
    // Only skip the panel entirely when NO ECN projects are registered at all.
    if (!projectsOf('ECN').length) return;
    const proc = 'ECN';
    const groups = ecnGateGroups();

    const panel = el('div', 'card');
    const panelHdr = el('div', 'card-header');
    panelHdr.appendChild(el('h3', 'card-title', 'ECN — stage matrix'));
    panel.appendChild(panelHdr);
    const panelBody = el('div', 'card-body');

    const wrap = el('div', 'scroll');
    const t = el('table', 'matrix');

    /* Gate column headers + PPAP column after them */
    const gateHeaders = groups.map(g => '<th title="' + esc(g.gate.step_name) + '">' +
      g.gate.step_id + '. ' + esc(g.gate.step_name) +
      '<div class="note">' + g.steps.map(s => s.step_id).join(', ') + '</div></th>').join('');
    t.innerHTML = '<thead><tr><th>Project</th>' + gateHeaders + '<th>PPAP</th><th>PIC</th></tr></thead>';
    const tb = el('tbody');

    if (!list.length) {
      const emptyTr = el('tr'); const emptyTd = el('td');
      emptyTd.colSpan = 3 + groups.length;
      emptyTd.textContent = (dashFamFilter.length || dashModelFilter.length || dashStartWeekFilter.length || dashEndWeekFilter.length)
        ? 'No ECN projects match the current filter.'
        : 'No ECN projects registered yet.';
      emptyTr.appendChild(emptyTd); tb.appendChild(emptyTr);
    } else {
      list.forEach(project => {
        const on = stepsOf(proc, project);
        const pr = progressOf(project);
        const cls = classifyProject(project);
        const tgt = toWeek(project.target_date) || targetDateFor(project.class_abcde, project.prf_date);
        const late = tgt && tgt < nowWeek() && pr.done < pr.total;
        const fam = familyById(project.prod_family);
        const tr = el('tr');

        // Row header
        const head = el('td');
        let headHTML = '<b>' + esc(project.project_id) + '</b>';
        if (fam) headHTML += '<div class="note">' + esc(fam.prod_family_name) + '</div>';
        headHTML += ' <span class="' + badgeClass(cls) + '">' + esc(cls.replace(/_/g, ' ')) + '</span>';
        headHTML += '<br><span class="bar bar-sm"><i style="width:' + pr.pct + '%"></i></span>' +
          ' <span class="note">' + pr.done + '/' + pr.total + '</span>';
        if (tgt) {
          const overdueTitle = late ? ' title="Target week is earlier than current week — overdue"' : '';
          const overdueAria = late ? ' aria-label="overdue"' : '';
          const weekTxt = late
            ? '<span style="color:var(--bad);font-weight:700"' + overdueTitle + overdueAria + '>' + esc(tgt) + '</span> <span class="note">(overdue)</span>'
            : esc(tgt);
          headHTML += '<br>' + weekTxt;
        }

        // Project-level open issues
        const projIssues = ((TRK.lb_issues || []).concat(TRK.lb_sp_issues || []))
          .filter(i => i.project_id === project.project_id && !i.step_key && i.status !== 'Closed');
        if (projIssues.length) {
          headHTML += ' <span class="matrix-issue-badge" title="' +
            projIssues.map(i => esc(i.title || i.issue_title || '(untitled)')).join('&#10;') +
            '">⚠ ' + projIssues.length + '</span>';
        }
        head.innerHTML = headHTML;
        tr.appendChild(head);

        const allPics = {};

        // Gate columns
        groups.forEach(group => {
          const anyApplicable = group.steps.some(function(s) { return on.indexOf(s) >= 0; });
          if (!anyApplicable) {
            const na = el('td', 'mcell');
            na.innerHTML = '<span class="note">n/a for type ' + esc(project.class_abcde || '?') + '</span>';
            tr.appendChild(na);
          } else {
            const gcs = groupCellStateFor(project, group);
            const td = el('td', 'mcell');
            const bits = [];
            // Percentage across all steps in the gate group. Removed docs are
            // excluded from the total, same rule as the per-step cell.
            const groupTotal = gcs.done.length + gcs.filed.length + gcs.missing.length;
            if (groupTotal) {
              bits.push('<div class="matrix-pct"><strong>' + Math.round(100 * (gcs.done.length + gcs.filed.length) / groupTotal) + '%</strong> <span class="matrix-pct-sub">(' + (gcs.done.length + gcs.filed.length) + '/' + groupTotal + ' docs)</span></div>');
            } else {
              bits.push('<div class="matrix-pct matrix-pct-na">n/a</div>');
            }
            if (!gcs.started && !gcs.missing.length && !gcs.removed.length && !(gcs.ongoing && gcs.ongoing.length)) { bits.push('<span class="' + badgeClass('NO_DATA') + '">not started</span>'); }
            else {
              if (gcs.done.length) bits.push('<span class="' + badgeClass('COMPLETE') + '" title="approved">Done: ' + gcs.done.map(esc).join(', ') + '</span>');
              if (gcs.filed.length) bits.push('<span class="' + badgeClass('FILED') + '" title="filed, not signed">Filed: ' + gcs.filed.map(esc).join(', ') + '</span>');
              if (gcs.ongoing && gcs.ongoing.length) bits.push('<span class="' + badgeClass('ON_GOING') + '" title="claimed or assigned, no file yet">On Going: ' + gcs.ongoing.map(esc).join(', ') + '</span>');
              if (gcs.missing.length) bits.push('<span class="' + badgeClass('MISSING') + '" title="required, nothing filed">Missing: ' + gcs.missing.map(esc).join(', ') + '</span>');
              if (gcs.removed.length) bits.push('<span class="matrix-removed ' + badgeClass('NO_DATA') + '" title="removed from requirements">Removed: ' + gcs.removed.map(esc).join(', ') + '</span>');
              if (!gcs.done.length && !gcs.filed.length && !gcs.missing.length && !gcs.removed.length) bits.push('<span class="' + badgeClass('NO_DATA') + '">not started</span>');
              if (gcs.g && gcs.g.bypass) bits.push('<span class="' + badgeClass('BYPASSED') + '">bypassed</span>');
              let groupNoteCount = 0;
              group.steps.forEach(function(gs) {
                if (on.indexOf(gs) >= 0) {
                  groupNoteCount += cellNoteCount(project, stepKeyOf(proc, gs));
                }
              });
              if (groupNoteCount) bits.push('<span class="matrix-note-indicator" title="' + groupNoteCount + ' note(s)">💬 ' + groupNoteCount + '</span>');
            }
            td.innerHTML = bits.join('<br>');

            // Issue badge for steps within this gate group
            let groupIssueCount = 0;
            const groupIssueTitles = [];
            group.steps.forEach(function(gs) {
              if (on.indexOf(gs) >= 0) {
                const sk = stepKeyOf(proc, gs);
                const stepIssues = ((TRK.lb_issues || []).concat(TRK.lb_sp_issues || []))
                  .filter(i => i.project_id === project.project_id && i.step_key === sk && i.status !== 'Closed');
                groupIssueCount += stepIssues.length;
                stepIssues.forEach(i => groupIssueTitles.push(i.title || i.issue_title || '(untitled)'));
              }
            });
            if (groupIssueCount) {
              const badge = el('span', 'matrix-issue-badge', '⚠ ' + groupIssueCount);
              badge.title = groupIssueTitles.map(esc).join('\n');
              td.appendChild(el('br'));
              td.appendChild(badge);
            }

            td.style.cursor = 'pointer';
            td.onclick = function() { openDrawer(project, group.gate); };
            tr.appendChild(td);
          }

          // Gather PICs from every step in the group
          group.steps.forEach(function(step) {
            if (on.indexOf(step) < 0) return;
            picsFor(project.project_id, stepKeyOf(proc, step)).forEach(function(p) {
              const e = (allPics[p.name] = allPics[p.name] || []);
              p.docs.forEach(function(d) { if (e.indexOf(d) < 0) e.push(d); });
            });
          });
        });

        // PPAP column — submission status from lb_ppap
        (function() {
          const ppapRows = (TRK.lb_ppap || []).filter(r => r.project_id === project.project_id);
          const ppapTd = el('td', 'mcell');
          if (!ppapRows.length) {
            ppapTd.innerHTML = '<span class="note">no items</span>';
          } else {
            const submitted = ppapRows.filter(r => r.submitted_utc).length;
            const approved = ppapRows.filter(r => r.customer_approved && r.customer_approved !== 'NO').length;
            const totalPPAP = ppapRows.length;
            const st = approved >= totalPPAP ? 'COMPLETE' : (submitted > 0 ? 'IN_PROGRESS' : 'NOT_STARTED');
            ppapTd.innerHTML = '<span class="' + badgeClass(st) + '">' +
              (approved >= totalPPAP ? 'Done' : submitted + '/' + totalPPAP + ' filed') + '</span>';
          }
          tr.appendChild(ppapTd);
        })();

        const ptd = el('td');
        const names = Object.keys(allPics);
        ptd.innerHTML = names.length
          ? names.map(function(n) { return esc(n) + ' <span class="note">(' + allPics[n].map(esc).join(', ') + ')</span>'; }).join('<br>')
          : '<span class="note">nobody yet</span>';
        tr.appendChild(ptd);
        tb.appendChild(tr);
      });
    }

    t.appendChild(tb); wrap.appendChild(t); panelBody.appendChild(wrap);
    panelBody.appendChild(el('p', 'note', 'Green means a named person signed the gate. Blue means the document is filed but nobody has signed for it. ' +
      'Red means the step requires it and nothing has been filed. PPAP status shows submitted-vs-total items.'));
    panel.appendChild(panelBody);
    dashEcnMatrixWrap.appendChild(panel);
  }

  /* =====================================================================
     NPI Stage Cards — below the matrices. Reads from the same
     filterDashboardProjects('NPI') the matrices use.
     ================================================================== */
  (function() {
    const NPI_DOCS = {
      1: ['PRF','QUOTE','GANTT','IR','CLASS'],
      2: ['DFM','DWG','WI'],
      3: ['PFMEA','DWG','BOM'],
      4: ['PFMEA','DWG','BOM','CONTROL-PLAN'],
      5: ['INSP-STD','CONTROL-PLAN','SOP','WI','PPAP'],
      6: ['QA-F-GEN-0010','SOP','WI','TRIAL-RPT','PFMEA'],
      7: ['RAMP-UP','KAIZEN','LL-INFO','NPI-CLOSURE','8D-CAPA']
    };
    const npiSteps = allStepsOf('NPI');
    const allNpi = projectsOf('NPI');

    /* container for the stage-cards section — rebuilt on filter change */
    const wrap = el('div'); wrap.id = 'npiStageWrap';
    root.insertBefore(wrap, dashNpiMatrixWrap);

    /* proxy — delegates to the shared filterDashboardProjects at dashboard
       scope so the stage cards and both matrices always use the exact same
       filtered set */
    function filteredProjects() {
      return filterDashboardProjects('NPI');
    }

    function renderCards(container) {
      const filtered = filteredProjects();
      if (!filtered.length) {
        const empty = el('p', 'note');
        empty.textContent = 'No NPI projects match the selected filters.';
        container.appendChild(empty);
        return;
      }

      npiSteps.forEach(step => {
        const snum = step.step_id;
        const sk = 'NPI-' + snum;
        const docs = NPI_DOCS[snum] || [];
        const applicable = filtered.filter(p => stepsOf('NPI', p).some(s => s.step_id === snum));
        const total = applicable.length;
        if (!total) return;

        let done = 0;
        applicable.forEach(p => {
          var activeDocs = docs.filter(function(code) { return evidenceFor(p.project_id, sk, code).level !== 'REMOVED'; });
          if (activeDocs.length && activeDocs.every(function(code) { return evidenceFor(p.project_id, sk, code).level === 'APPROVED'; })) done++;
        });
        const pct = Math.round(100 * done / total);
        const accent = pct === 100 ? 'var(--good)' : (pct === 0 ? 'var(--warn)' : 'var(--blue)');

        const card = el('div', 'card');
        card.style.cssText = 'border-left:4px solid ' + accent + '; cursor:default';

        const hdr = el('div');
        hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 14px';
        hdr.innerHTML = '<b>NPI ' + snum + '. ' + esc(step.step_name) + '</b>' +
          '<span style="font-size:18px;font-weight:700;color:' + accent + '">' + (pct === 100 ? 'Complete' : done + '<span style="font-size:14px;font-weight:500">/' + total + '</span>') + '</span>';
        card.appendChild(hdr);

        const barWrap = el('div');
        barWrap.style.cssText = 'padding:0 14px 2px';
        const bar = el('span', 'bar');
        bar.style.cssText = 'width:100%;height:6px';
        bar.innerHTML = '<i style="width:' + pct + '%;background:' + accent + '"></i>';
        barWrap.appendChild(bar); card.appendChild(barWrap);

        const dd = el('div');
        dd.style.cssText = 'padding:6px 14px 8px;display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--ink2)';
        docs.forEach(code => {
          const dcApproved = applicable.filter(p => evidenceFor(p.project_id, sk, code).level === 'APPROVED').length;
          const dcFiled = applicable.filter(p => evidenceFor(p.project_id, sk, code).level === 'FILED').length;
          const dcTotal = dcApproved + dcFiled;
          const chip = el('span', 'doc-chip');
          const clr = dcApproved === total ? 'var(--good)' : (dcTotal > 0 ? 'var(--blue)' : 'var(--muted)');
          chip.style.cssText = 'cursor:pointer;padding:2px 8px;border-radius:4px;border:1px solid ' + clr + ';white-space:nowrap;transition:background .12s';
          chip.innerHTML = esc(code) + ' <b style="color:' + clr + '">' + dcApproved + '/' + total + '</b>';
          chip.title = dcApproved + ' approved, ' + dcFiled + ' filed of ' + total + ' — click to inspect';
          chip.onmouseenter = function() { this.style.background = 'var(--blue2)'; };
          chip.onmouseleave = function() { this.style.background = ''; };
          chip.onclick = () => {
            const target = applicable.find(p => evidenceFor(p.project_id, sk, code).del) || applicable[0];
            if (target) openDrawerForDoc(target, step, code);
          };
          dd.appendChild(chip);
        });
        card.appendChild(dd);
        container.appendChild(card);
      });
    }

    function renderAll() {
      // Re-render the slicer bar — always at the top
      renderDashboardSlicers();

      // Rebuild both matrices with the current filter state
      renderDashboardNpiMatrix();
      renderDashboardEcnMatrix();

      // Rebuild stage cards
      wrap.innerHTML = '';
      const h3 = el('h3', null, 'NPI Stage Completion');
      wrap.appendChild(h3);
      const cardHost = el('div', 'stage-grid'); cardHost.id = 'npiStageCards';
      renderCards(cardHost);
      wrap.appendChild(cardHost);
    }

    dashRenderAll = renderAll;
    renderAll();
  })();
}

/* ---- computePortfolioKPIs — shared between the KPI bar and the management
       export so the printed report and the downloaded CSV can never disagree. ---- */
function computePortfolioKPIs() {
  const allP = TRK.lb_projects;
  const thisYear = String(new Date().getFullYear());

  /* 1. FG Transfers (this year) */
  const fgTotal = allP.filter(p => { const w = toWeek(p.prf_date); return w && w.slice(0, 4) === thisYear; });
  const fgDone = fgTotal.filter(p => classifyProject(p) === 'COMPLETE');

  /* 2. % On-Time Completion */
  const completed = allP.filter(p => classifyProject(p) === 'COMPLETE');
  let onTimePct = '—';
  if (completed.length) {
    let onTime = 0;
    completed.forEach(p => {
      const approvals = TRK.lb_approvals.filter(a => a.project_id === p.project_id);
      let actualWeek = '';
      if (approvals.length) {
        const maxApproved = approvals.reduce((a, b) => (a.approved_utc || '') > (b.approved_utc || '') ? a : b);
        actualWeek = toWeek(maxApproved.approved_utc);
      }
      const targetWeek = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date);
      if (actualWeek && targetWeek && actualWeek <= targetWeek) onTime++;
    });
    onTimePct = Math.round(100 * onTime / completed.length) + '%';
  }

  /* 3. Total Issues Resolved */
  const allIssues = (TRK.lb_issues || []).concat(TRK.lb_sp_issues || []);
  const resolved = allIssues.filter(i => i.status === 'Closed').length;

  /* 4. LFIs Identified */
  const lfis = TRK.lb_issues.length;

  /* 5. Shipment Delays (LFI-linked) */
  const delayCount = allP.filter(p => {
    if (classifyProject(p) !== 'LATE') return false;
    return TRK.lb_issues.some(i => i.project_id === p.project_id && i.status !== 'Closed');
  }).length;

  return [
    { label: 'FG transfers', value: fgDone.length + '/' + fgTotal.length,
      sub: 'Completed vs registered in ' + thisYear, cssClass: 'k-good' },
    { label: 'On-time completion', value: onTimePct,
      sub: 'Approved on or before target week', cssClass: 'k-blue' },
    { label: 'Issues resolved', value: String(resolved),
      sub: 'Closed across tracker and SharePoint', cssClass: 'k-good' },
    { label: 'LFIs identified', value: String(lfis),
      sub: 'Lessons-from-issues raised to date', cssClass: 'k-warn' },
    { label: 'Shipment delays', value: String(delayCount),
      sub: 'Late projects with an open LFI', cssClass: 'k-bad' }
  ];
}

/* ---- exportManagementReport — downloads a single CSV with three clearly-titled
       sections (Gantt schedule, KPI summary, stage matrix summary). Pure
       client-side Blob download, same pattern as the issue tracker export.
       UTF-8 BOM prefix so Excel reads Vietnamese text correctly. ---- */
function exportManagementReport() {
  const lines = [];
  const allP = TRK.lb_projects;

  /* SECTION 1 — GANTT SCHEDULE, one row per project */
  lines.push('GANTT SCHEDULE');
  lines.push('Project ID,Process,Family,Class,Start Week,Target Week,Cycle Duration (weeks),Progress %,Status');
  allP.forEach(p => {
    const startWeek = toWeek(p.prf_date);
    const targetWeek = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date);
    let cycle = '';
    if (startWeek && targetWeek) {
      const sw = weekToDate(startWeek);
      const tw = weekToDate(targetWeek);
      if (sw && tw) cycle = String(Math.round((tw - sw) / (7 * 86400000)));
    }
    const fam = familyById(p.prod_family);
    const pr = progressOf(p);
    const cls = classifyProject(p);
    lines.push(csvCell(p.project_id) + ',' + csvCell(p.process) + ',' +
      csvCell(fam ? fam.prod_family_name : (p.prod_family || '')) + ',' +
      csvCell(p.class_abcde || '') + ',' + csvCell(startWeek) + ',' + csvCell(targetWeek) + ',' +
      csvCell(cycle) + ',' + csvCell(pr.pct + '%') + ',' + csvCell(cls));
  });

  lines.push(''); // blank separator

  /* SECTION 2 — PORTFOLIO KPI SUMMARY, computed from the same code path as
     the dashboard bar so the export and the on-screen report never disagree. */
  lines.push('PORTFOLIO KPI SUMMARY');
  lines.push('Metric,Value,Basis');
  computePortfolioKPIs().forEach(k => {
    lines.push(csvCell(k.label) + ',' + csvCell(k.value) + ',' + csvCell(k.sub));
  });

  lines.push(''); // blank separator

  /* SECTION 3 — STAGE MATRIX SUMMARY, one row per project with a short
     status word per step/gate column derived from cellStateFor() /
     groupCellStateFor(). */

  lines.push('STAGE MATRIX SUMMARY');

  // NPI rows
  const npiProjs = allP.filter(p => p.process === 'NPI');
  if (npiProjs.length) {
    const npiSteps = allStepsOf('NPI');
    const npiHdrs = ['Project ID','Process'];
    npiSteps.forEach(s => npiHdrs.push(s.step_id + '. ' + s.step_name));
    lines.push(npiHdrs.map(h => csvCell(h)).join(','));
    npiProjs.forEach(p => {
      const on = stepsOf('NPI', p);
      const row = [p.project_id, 'NPI'];
      npiSteps.forEach(s => {
        if (on.indexOf(s) < 0) { row.push('n/a'); return; }
        const c = cellStateFor(p, s);
        if (c.g.bypass) row.push('bypassed');
        else if (c.done.length && !c.missing.length && !c.filed.length) row.push('done');
        else if (c.filed.length || c.done.length) row.push('filed');
        else if (c.missing.length) row.push('missing');
        else if (c.removed.length) row.push('removed');
        else row.push('not-started');
      });
      lines.push(row.map(v => csvCell(v)).join(','));
    });
  }

  // ECN rows (gate-grouped + PPAP)
  const ecnProjs = allP.filter(p => p.process === 'ECN');
  if (ecnProjs.length) {
    const groups = ecnGateGroups();
    const ecnHdrs = ['Project ID','Process'];
    groups.forEach(g => ecnHdrs.push(g.gate.step_id + '. ' + g.gate.step_name));
    ecnHdrs.push('PPAP');
    lines.push(ecnHdrs.map(h => csvCell(h)).join(','));
    ecnProjs.forEach(p => {
      const on = stepsOf('ECN', p);
      const row = [p.project_id, 'ECN'];
      groups.forEach(g => {
        const anyApplicable = g.steps.some(function(s) { return on.indexOf(s) >= 0; });
        if (!anyApplicable) { row.push('n/a'); return; }
        const gcs = groupCellStateFor(p, g);
        if (gcs.g && gcs.g.bypass) row.push('bypassed');
        else if (gcs.done.length && !gcs.missing.length && !gcs.filed.length) row.push('done');
        else if (gcs.filed.length || gcs.done.length) row.push('filed');
        else if (gcs.missing.length) row.push('missing');
        else if (gcs.removed.length) row.push('removed');
        else row.push('not-started');
      });
      // PPAP status word
      const ppapRows = (TRK.lb_ppap || []).filter(r => r.project_id === p.project_id);
      if (!ppapRows.length) row.push('no-items');
      else {
        const approved = ppapRows.filter(r => r.customer_approved && r.customer_approved !== 'NO').length;
        row.push(approved >= ppapRows.length ? 'done' : (ppapRows.some(r => r.submitted_utc) ? 'filed' : 'not-started'));
      }
      lines.push(row.map(v => csvCell(v)).join(','));
    });
  }

  const csv = '﻿' + lines.join('\r\n');   // UTF-8 BOM so Excel decodes Vietnamese text correctly
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'wvn_management_report_' + today() + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
/* ---- buildPrintPackage — 3-page A4 executive PDF (v4.1 Task 2) ---------
   Populates the hidden #dashPrintPackage container from the CURRENTLY
   FILTERED project set (respects the dashboard slicers), then calls
   window.print(). Called by the Dashboard "Download PDF" button.  --------- */
function buildPrintPackage() {
  /* Re-implement the filter logic inline (global dash*Filter vars are
     already set by the dashboard slicers; this mirrors the closure inside
     viewDashboard exactly so the printed report matches the screen. */
  function filteredByProcess(process) {
    var list = projectsOf(process);
    var any = dashFamFilter || dashModelFilter || dashStartWeekFilter || dashEndWeekFilter;
    if (!any) return list;
    return list.filter(function(p) {
      if (dashFamFilter && p.prod_family !== dashFamFilter) return false;
      if (dashModelFilter && p.family !== dashModelFilter) return false;
      if (dashStartWeekFilter) { var sw = toWeek(p.prf_date); if (!sw || sw !== dashStartWeekFilter) return false; }
      if (dashEndWeekFilter) {
        var ew = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date) || '';
        if (!ew || ew !== dashEndWeekFilter) return false;
      }
      return true;
    });
  }

  var filteredNpi = filteredByProcess('NPI');
  var filteredEcn = filteredByProcess('ECN');
  var allFiltered = filteredNpi.concat(filteredEcn);

  var container = document.getElementById('dashPrintPackage');
  if (!container) { container = document.createElement('div'); container.id = 'dashPrintPackage'; document.body.appendChild(container); }
  container.innerHTML = '';

  if (!allFiltered.length) { container.innerHTML = '<p style="padding:20px;font-size:12pt">No projects match the current filters.</p>'; var de = document.getElementById('dashExec'); if (de) de.style.display = 'none'; window.print(); if (de) de.style.display = ''; return; }

  var now = new Date().toLocaleString();
  var user = getUser() || '—';
  var appName = CFG && CFG.system_info ? CFG.system_info.app_name : 'WAHL Vietnam NPI & ECN Stage Gate Command Center';
  var appVer = CFG && CFG.system_info ? 'v' + CFG.system_info.version : '';

  /* --- filter summary tag line --- */
  var filterParts = [];
  if (dashFamFilter) { var ff = familyById(dashFamFilter); filterParts.push('Family: ' + (ff ? ff.prod_family_name : dashFamFilter)); }
  if (dashModelFilter) filterParts.push('Model: ' + dashModelFilter);
  if (dashStartWeekFilter) filterParts.push('Start: ' + dashStartWeekFilter);
  if (dashEndWeekFilter) filterParts.push('End: ' + dashEndWeekFilter);
  var filterTag = filterParts.length
    ? filterParts.map(function(f) { return '<span class="print-filter-tag">' + esc(f) + '</span>'; }).join(' ')
    : '<span class="print-filter-tag">All projects</span>';

  /* ====================================================================
     PAGE 1 — Executive header, KPI tiles, SVG Gantt
     ================================================================== */
  var page1 = document.createElement('div'); page1.className = 'print-page';

  var p1Banner = '<div class="print-banner">' +
    '<h1>' + esc(appName) + ' ' + esc(appVer) + '</h1>' +
    '<p>Generated: ' + esc(now) + ' &middot; Prepared by: ' + esc(user) + ' &middot; ' + filterTag + '</p></div>';

  var kpis = computePortfolioKPIs();
  var accentMap = { 'k-good': '#16703c', 'k-blue': '#14589f', 'k-warn': '#8a5800', 'k-bad': '#b02318' };
  var kpiHtml = '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">';
  kpis.forEach(function(k) {
    var accent = accentMap[k.cssClass] || '#62748a';
    kpiHtml += '<div style="flex:1;min-width:110px;background:#f5f8fb;border-top:3px solid ' + accent +
      ';padding:6px 10px;border-radius:4px;border:1px solid #d7e0e9">' +
      '<div style="font-size:7pt;font-weight:700;color:#5d6e83;text-transform:uppercase;letter-spacing:.05em">' + esc(k.label) + '</div>' +
      '<div style="font-size:15pt;font-weight:700;color:#14202c;line-height:1.1">' + esc(k.value) + '</div>' +
      '<div style="font-size:7pt;color:#5d6e83">' + esc(k.sub) + '</div></div>';
  });
  kpiHtml += '</div>';
  page1.innerHTML = p1Banner + kpiHtml + '<div class="print-gantt-wrap"><h3>Project Schedule (Gantt)</h3>' + _buildSvgGantt(allFiltered) + '</div>';
  container.appendChild(page1);

  /* ====================================================================
     PAGE 2 — NPI & ECN stage matrices with per-cell completion %
     ================================================================== */
  var page2 = document.createElement('div'); page2.className = 'print-page';

  /* --- NPI matrix --- */
  if (filteredNpi.length) {
    var npiSteps = allStepsOf('NPI');
    var npiH = '<div class="print-matrix"><h3>NPI Stage Matrix — Completion %</h3><table><thead><tr><th>Project</th>' +
      npiSteps.map(function(s) { return '<th>' + esc(s.step_id) + '. ' + esc(s.step_name) + '</th>'; }).join('') +
      '</tr></thead><tbody>';

    filteredNpi.forEach(function(prj) {
      var on = stepsOf('NPI', prj);
      var fam = familyById(prj.prod_family);
      var label = esc(prj.project_id) + (fam ? ' (' + esc(fam.prod_family_name) + ')' : '');
      npiH += '<tr><td>' + label + '</td>';
      npiSteps.forEach(function(step) {
        if (on.indexOf(step) < 0) { npiH += '<td class="pct-na">n/a</td>'; return; }
        var c = cellStateFor(prj, step);
        var reqCount = c.done.length + c.filed.length + c.missing.length;
        var doneCount = c.done.length + c.filed.length;
        var pct = reqCount ? Math.round(100 * doneCount / reqCount) : 0;
        var cls = pct === 100 ? 'pct-done' : (pct > 0 ? 'pct-partial' : 'pct-none');
        npiH += '<td class="' + cls + '">' + pct + '%</td>';
      });
      npiH += '</tr>';
    });
    npiH += '</tbody></table></div>';
    page2.innerHTML += npiH;
  }

  /* --- ECN matrix (gate-grouped + PPAP) --- */
  if (filteredEcn.length) {
    var groups = ecnGateGroups();
    var ecnH = '<div class="print-matrix"><h3>ECN Stage Matrix — Completion %</h3><table><thead><tr><th>Project</th>' +
      groups.map(function(g) { return '<th>' + esc(g.gate.step_id) + '. ' + esc(g.gate.step_name) + '</th>'; }).join('') +
      '<th>PPAP</th></tr></thead><tbody>';

    filteredEcn.forEach(function(prj) {
      var on = stepsOf('ECN', prj);
      var fam = familyById(prj.prod_family);
      var label = esc(prj.project_id) + (fam ? ' (' + esc(fam.prod_family_name) + ')' : '');
      ecnH += '<tr><td>' + label + '</td>';
      groups.forEach(function(g) {
        var anyApplicable = g.steps.some(function(s) { return on.indexOf(s) >= 0; });
        if (!anyApplicable) { ecnH += '<td class="pct-na">n/a</td>'; return; }
        var gc = groupCellStateFor(prj, g);
        var reqCount = gc.done.length + gc.filed.length + gc.missing.length;
        var doneCount = gc.done.length + gc.filed.length;
        var pct = reqCount ? Math.round(100 * doneCount / reqCount) : 0;
        var cls = pct === 100 ? 'pct-done' : (pct > 0 ? 'pct-partial' : 'pct-none');
        ecnH += '<td class="' + cls + '">' + pct + '%</td>';
      });
      /* PPAP */
      var ppapRows = (TRK.lb_ppap || []).filter(function(r) { return r.project_id === prj.project_id; });
      var ppapApproved = ppapRows.filter(function(r) { return r.customer_approved && r.customer_approved !== 'NO'; }).length;
      var ppapPct = ppapRows.length ? Math.round(100 * ppapApproved / ppapRows.length) : 0;
      var ppapCls = ppapRows.length ? (ppapPct === 100 ? 'pct-done' : (ppapPct > 0 ? 'pct-partial' : 'pct-none')) : 'pct-na';
      ecnH += '<td class="' + ppapCls + '">' + (ppapRows.length ? ppapPct + '%' : 'n/a') + '</td>';
      ecnH += '</tr>';
    });
    ecnH += '</tbody></table></div>';
    page2.innerHTML += ecnH;
  }

  if (!page2.innerHTML) page2.innerHTML = '<p style="padding:10px;color:#999">No filtered projects to display.</p>';
  container.appendChild(page2);

  /* ====================================================================
     PAGE 3 — Project overview table
     ================================================================== */
  var page3 = document.createElement('div'); page3.className = 'print-page';
  var ovH = '<div class="print-overview"><h3>Project Overview</h3>' +
    '<table><thead><tr><th>Project ID</th><th>Model / Family</th><th>Prod. Family</th><th>Change Type</th>' +
    '<th>PIC / Market Mgr</th><th>Start Week</th><th>Target Week</th><th>Completion</th><th>Open Issues</th></tr></thead><tbody>';

  var allSorted = allFiltered.slice().sort(function(a, b) {
    var sa = toWeek(a.prf_date); var sb = toWeek(b.prf_date);
    if (!sa && !sb) return 0; if (!sa) return 1; if (!sb) return -1;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  allSorted.forEach(function(prj) {
    var fam = familyById(prj.prod_family);
    var ct = changeTypeById(prj.class_abcde);
    var pr = progressOf(prj);
    var cls = classifyProject(prj);
    var openCount = ((TRK.lb_issues || []).concat(TRK.lb_sp_issues || []))
      .filter(function(i) { return i.project_id === prj.project_id && i.status !== 'Closed'; }).length;
    var startW = toWeek(prj.prf_date) || '—';
    var targetW = toWeek(prj.target_date) || targetDateFor(prj.class_abcde, prj.prf_date) || '—';

    var rowCls = '';
    if (cls === 'LATE') rowCls = ' style="background:#fdeceb"';
    else if (cls === 'COMPLETE') rowCls = ' style="background:#e5f3ea"';

    ovH += '<tr' + rowCls + '>' +
      '<td><b>' + esc(prj.project_id) + '</b></td>' +
      '<td>' + esc(prj.family || '—') + '</td>' +
      '<td>' + esc(fam ? fam.prod_family_name + ' (' + fam.prod_family_id + ')' : (prj.prod_family || '—')) + '</td>' +
      '<td>' + esc(ct ? ct.type_id + ' — ' + ct.name : (prj.class_abcde || '—')) + '</td>' +
      '<td>' + esc(prj.market_manager || '—') + '</td>' +
      '<td class="num">' + esc(startW) + '</td>' +
      '<td class="num">' + esc(targetW) + '</td>' +
      '<td class="num"><b>' + pr.pct + '%</b> <span style="font-size:7pt;color:#5d6e83">(' + pr.done + '/' + pr.total + ')</span></td>' +
      '<td class="num">' + (openCount ? '<b style="color:#b02318">' + openCount + '</b>' : '0') + '</td>' +
      '</tr>';
  });
  ovH += '</tbody></table></div>';
  page3.innerHTML = ovH;
  container.appendChild(page3);

  /* Suppress the interactive #dashExec content during the print package
     print so it does not overlay or bleed into the 3-page PDF. Restore
     after the print dialog closes (window.print is blocking). */
  var dashExec = document.getElementById('dashExec');
  if (dashExec) dashExec.style.display = 'none';
  window.print();
  if (dashExec) dashExec.style.display = '';
}

/* ---- inline SVG Gantt chart (air-gapped — no Chart.js) ---------------
   One bar per project: prf_date (start) → target_date (end). Week axis
   on top, project-id labels on the left, bars coloured by status.  ----- */
function _buildSvgGantt(projects) {
  if (!projects.length) return '<p style="color:#999">No projects to chart.</p>';

  /* Collect all [startDate, endDate] pairs in real dates */
  var pairs = [];
  projects.forEach(function(p) {
    var sw = toWeek(p.prf_date);
    var ew = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date) || '';
    var sd = weekToDate(sw);
    var ed = weekToDate(ew);
    if (sd && ed) {
      /* end date inclusive — add 7 days so the bar spans the full target week */
      ed = new Date(ed); ed.setDate(ed.getDate() + 6);
      pairs.push({ project: p, startDate: sd, endDate: ed });
    }
  });
  if (!pairs.length) return '<p style="color:#999">No projects with valid week ranges to chart.</p>';

  /* Overall time span with small padding */
  var allStarts = pairs.map(function(x) { return x.startDate.getTime(); });
  var allEnds = pairs.map(function(x) { return x.endDate.getTime(); });
  var minT = Math.min.apply(null, allStarts);
  var maxT = Math.max.apply(null, allEnds);
  var pad = 7 * 86400000; /* 1-week padding on each side */
  minT -= pad; maxT += pad;
  var spanMs = maxT - minT;

  /* Build a sorted list of unique week labels for the axis */
  var weekSet = new Map();
  var cursor = new Date(minT);
  while (cursor.getTime() <= maxT) {
    var wk = isoWeek(cursor);
    if (wk && !weekSet.has(wk)) {
      var wd = weekToDate(wk);
      if (wd) weekSet.set(wk, wd);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  var weekEntries = [];
  weekSet.forEach(function(d, w) { weekEntries.push({ week: w, date: d }); });
  weekEntries.sort(function(a, b) { return a.date - b.date; });

  var leftMargin = 155;
  var rightMargin = 12;
  var topMargin = 48;
  var rowH = 22;
  var barH = 14;
  var barYOff = Math.round((rowH - barH) / 2);
  var chartW = 940 - leftMargin - rightMargin;
  var totalH = topMargin + pairs.length * rowH + 8;

  function xForDate(d) { return leftMargin + Math.round((d.getTime() - minT) / spanMs * chartW); }

  var statusColors = { COMPLETE: '#16703c', IN_PROGRESS: '#14589f', LATE: '#b02318', NOT_STARTED: '#8a5800' };

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 ' + totalH + '" style="width:100%;height:auto;font-family:sans-serif">';

  /* Axis grid — vertical lines and week labels */
  var labelInterval = Math.max(1, Math.ceil(weekEntries.length / 26));
  weekEntries.forEach(function(entry, i) {
    var x = xForDate(entry.date);
    var tickH = (i % labelInterval === 0) ? 12 : 6;
    svg += '<line x1="' + x + '" y1="' + (topMargin - tickH) + '" x2="' + x + '" y2="' + (totalH - 4) + '" stroke="#d7e0e9" stroke-width="0.5"/>';
  });

  /* Week labels (only every labelInterval) */
  weekEntries.forEach(function(entry, i) {
    if (i % labelInterval !== 0) return;
    var x = xForDate(entry.date);
    svg += '<text x="' + x + '" y="' + (topMargin - 16) + '" text-anchor="middle" font-size="7" fill="#42556a">' + esc(entry.week) + '</text>';
  });

  /* Project bars */
  pairs.forEach(function(pair, idx) {
    var cls = classifyProject(pair.project);
    var color = statusColors[cls] || '#62748a';
    var x = xForDate(pair.startDate);
    var w = Math.max(3, xForDate(pair.endDate) - x);
    var y = topMargin + idx * rowH + barYOff;

    svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + barH + '" rx="3" ry="3" fill="' + color + '"/>';

    /* Project label on the left */
    svg += '<text x="' + (leftMargin - 6) + '" y="' + (y + barH - 2) + '" text-anchor="end" font-size="7.5" fill="#14202c" font-weight="600">' + esc(pair.project.project_id) + '</text>';
  });

  svg += '</svg>';
  return svg;
}

/* ---- sidebar evidence upload helper ------------------------------------ */
async function uploadEvidence(project, stepKey, docCode, file) {
  const who = requireName() || '(unnamed)';
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const b64 = dataUrl.split(',')[1];
  const up = await API.upload({
    fileName: file.name, contentBase64: b64, docType: docCode,
    family: project.family,
    wvnId: project.family, wnbId: project.customer_number || '',
    description: docCode, partId: ''
  });
  await API.action('lb_deliverables', {
    project_id: project.project_id, step_key: stepKey, doc_code: docCode,
    file_name: up.fileName, file_path: up.path, sha256: up.sha256, status: 'Filed',
    approved: '', suspect_template: '', uploaded_by: who,
    uploaded_utc: new Date().toISOString(), notes: '', kind: 'file',
    original_name: up.originalName, wvn_id: project.family || '',
    wnb_id: project.customer_number || '', description: docCode, link_url: ''
  }, { audit: { user: who, action: 'Upload_Evidence_Sidebar', projectId: project.project_id, objType: 'Deliverable', objId: '', from: 'MISSING', to: 'Filed', detail: docCode } });
}

/* ---- evidence viewer URL builder ---------------------------------------- */
function evidenceViewerUrl(filePath) {
  if (!filePath || !PATHS.vault) return null;
  var abs = filePath.replace(/\\/g, '/');
  var vault = PATHS.vault.replace(/\\/g, '/');
  if (abs.indexOf(vault) !== 0) return null;
  var rel = abs.slice(vault.length).replace(/^\//, '');
  var encoded = rel.split('/').map(function(s) { return encodeURIComponent(s); }).join('/');
  return '/api/vault/view/' + encoded;
}

/* ---- executive inspection drawer ---------------------------------------- */
function closeDrawer() {
  const d = $('#drawer'); if (d) d.remove();
  const s = $('#scrim'); if (s) s.remove();
}
function openDrawerForDoc(project, step, docCode) {
  openDrawer(project, step, docCode);
}
function openDrawer(project, step, focusDocCode) {
  closeDrawer();
  const proc = project.process;
  const sk = stepKeyOf(proc, step);
  const c = cellStateFor(project, step);
  const g = c.g;

  const scrim = el('div'); scrim.id = 'scrim'; scrim.className = 'scrim'; scrim.onclick = closeDrawer;
  document.body.appendChild(scrim);
  const d = el('div', 'drawer'); d.id = 'drawer';

  const close = el('button', '', 'Close'); close.style.float = 'right'; close.onclick = closeDrawer;
  d.appendChild(close);
  d.appendChild(el('h2', null, project.project_id + ' · step ' + step.step_id + ' — ' + step.step_name));
  const sub = el('p', 'note');
  const ct = changeTypeById(project.class_abcde);
  sub.innerHTML = (ct ? 'Type ' + esc(ct.type_id) + ' ' + esc(ct.name) + ' · ' : '') +
    (project.market_manager ? 'owner ' + esc(project.market_manager) : '') +
    '<br>Certifications: ' + certChips(certsOf(project)) +
    '<br>Status: <span class="' + badgeClass(g.status) + '">' + g.status.replace(/_/g, ' ') + '</span>' +
    (g.approval ? ' signed by <b>' + esc(g.approval.approved_by) + '</b> on ' + esc((g.approval.approved_utc || '').slice(0, 10)) : '') +
    (g.needWh ? ' · warehouse ' + (g.whOk ? 'cleared' : '<b style="color:var(--bad)">outstanding</b>') : '');
  d.appendChild(sub);
  // Stage/gate claim — the gate row may not exist yet if nobody has touched this step
  var gateRow = gateRowOf(project.project_id, sk) || { project_id: project.project_id, step_key: sk };
  var stageClaimWrap = el('div', 'claim-row');
  stageClaimWrap.appendChild(makeClaimButton('Gate', 'lb_gates', gateRow, ['project_id', 'step_key'], function(who, role) {
    // Badges are already rendered by makeClaimButton; no manual update needed
  }));
  if (isPrivileged()) {
    // makeAssignButton mutates gateRow in place but has no DOM of its own to
    // refresh - makeClaimButton's badges are a closure-private renderBadges()
    // it doesn't expose, so the simplest correct refresh is to reopen this
    // same drawer, which rebuilds everything (including the button above)
    // from the now-updated gateRow/project state.
    stageClaimWrap.appendChild(makeAssignButton('Gate', 'lb_gates', gateRow, ['project_id', 'step_key'], function() {
      openDrawer(project, step, focusDocCode);
    }));
  }
  d.appendChild(stageClaimWrap);

  // LFI button — visible on every step in the drawer
  var lfiBtn = el('button', 'lfi-drawer-btn', '+ Late Found Issue (LFI)');
  lfiBtn.onclick = function() { openLfiModal(project, step); };
  d.appendChild(lfiBtn);

  if (step.source_note) {
    const sn = el('p', 'note'); sn.innerHTML = '<b>Source note:</b> ' + esc(step.source_note); d.appendChild(sn);
  }

  /* ---- project search — real-time filtering inside the drawer ------------- */
  if (!project) {
    d.appendChild(el('h3', null, 'Find a project'));
    const fgSearch = el('input');
    fgSearch.id = 'sidebarFgSearch';
    fgSearch.placeholder = 'Type project ID, family, or PIC…';
    fgSearch.style.cssText = 'width:100%;margin-bottom:8px;height:' + 'var(--ctl-h-sm);min-height:var(--ctl-h-sm);font-size:12px';
    d.appendChild(fgSearch);

    const projList = el('div');
    projList.className = 'sidebar-project-list';
    d.appendChild(projList);

    function renderSidebarProjectList(query) {
      const q = (query || '').toLowerCase().trim();
      const npiProjects = projectsOf('NPI');
      const filtered = q
        ? npiProjects.filter(p => {
            const fam = familyById(p.prod_family);
            const tw = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date) || '';
            return (p.project_id || '').toLowerCase().includes(q) ||
              (p.family || '').toLowerCase().includes(q) ||
              (fam ? fam.prod_family_name.toLowerCase() : '').includes(q) ||
              (fam ? fam.prod_family_id.toLowerCase() : '').includes(q) ||
              (p.market_manager || '').toLowerCase().includes(q) ||
              tw.toLowerCase().includes(q);
          }).slice(0, 15)
        : npiProjects.slice(0, 5);

      projList.innerHTML = '';
      if (!filtered.length) {
        projList.appendChild(el('p', 'note', 'No matching projects.'));
        return;
      }
      filtered.forEach(prj => {
        const fam = familyById(prj.prod_family);
        const tw = toWeek(prj.target_date) || targetDateFor(prj.class_abcde, prj.prf_date) || '';
        const item = el('div', 'sidebar-project-item');
        item.style.cssText = 'padding:6px 8px;border:1px solid var(--line);border-radius:4px;margin-bottom:4px;cursor:pointer';
        item.innerHTML = '<b>' + esc(prj.project_id) + '</b>' +
          '<div class="sidebar-project-meta">' +
          esc(fam ? fam.prod_family_name + ' (' + fam.prod_family_id + ')' : 'No family') + ' · ' + esc(tw) +
          (prj.market_manager ? ' · ' + esc(prj.market_manager) : '') +
          '</div>';
        item.onclick = () => {
          const bestStep = bestStepForDoc(prj, focusDocCode);
          const landing = bestStep ? bestStep.step : step;
          openDrawer(prj, landing, focusDocCode);
          const newSearch = $('#sidebarFgSearch');
          if (newSearch) newSearch.value = fgSearch.value;
        };
        item.onmouseenter = function() { this.style.background = 'var(--soft)'; };
        item.onmouseleave = function() { this.style.background = ''; };
        projList.appendChild(item);
      });
    }

    fgSearch.oninput = () => renderSidebarProjectList(fgSearch.value);
    renderSidebarProjectList('');

  }
  /* ---- documents, with hashes ---- */
  d.appendChild(el('h3', null, 'Documents filed at this step'));
  // Show only rows that carry actual evidence (file, link, or path), not custom-doc markers
  const dels = TRK.lb_deliverables.filter(function(x) {
    return x.project_id === project.project_id && x.step_key === sk &&
      (x.file_name || x.link_url || x.file_path || x.approved === 'YES') &&
      x.status !== 'Removed';
  });
  if (!dels.length) d.appendChild(el('p', 'note', 'Nothing filed here yet.'));
  else {
    const t = el('table');
    t.innerHTML = '<thead><tr><th>Type</th><th>File</th><th>Filed by</th><th>SHA-256</th><th></th></tr></thead>';
    const tb = el('tbody');
    dels.forEach(x => {
      const tr = el('tr');
      if (focusDocCode && x.doc_code === focusDocCode) {
        tr.style.cssText = 'background:var(--blue2);outline:2px solid var(--blue);outline-offset:-1px';
      }
      const isDelRemoved = x.status === 'Removed';
      const isLink = x.kind === 'link';
      const path = x.link_url || x.file_path || '';
      const dcEl = '<a class="doc-link" style="cursor:pointer;font-weight:700;color:var(--blue)" title="Click to focus — ' + esc(x.doc_code) + '">' + esc(x.doc_code) + '</a>';
      const pathHtml = path
        ? (isLink ? '<a href="' + esc(path) + '" target="_blank" class="note">' + esc(path) + '</a>'
                  : '<span class="note">' + esc(x.file_name) + '</span><br><a href="file:///' + esc(path.replace(/\\/g, '/')) + '" class="note" style="font-size:10px;word-break:break-all">📂 ' + esc(path) + '</a>')
        : '<span class="note">—</span>';
      var removedMark = isDelRemoved ? ' <span class="badge bg-secondary" style="text-decoration:line-through;opacity:0.7">Removed</span>' : '';
      tr.innerHTML = '<td>' + dcEl + removedMark + (x.custom_doc === 'YES' ? ' <span class="note custom-mark">model custom</span>' : '') + (isLink ? ' <span class="note">cited</span>' : '') + '</td>' +
        '<td><code>' + esc(x.file_name) + '</code><div class="note">' + pathHtml + '</div></td>' +
        '<td>' + esc(x.uploaded_by) + '<div class="note">' + esc((x.uploaded_utc || '').slice(0, 10)) + '</div></td>' +
        '<td class="note" style="word-break:break-all;max-width:180px">' + (x.sha256 ? esc(x.sha256) : '<i>no hash — cited in place</i>') + '</td><td></td>';
      if (isDelRemoved) tr.style.opacity = '0.65';
      // doc_code click → re-open drawer focused on this doc
      const dcLink = tr.querySelector('.doc-link');
      if (dcLink) dcLink.onclick = () => openDrawerForDoc(project, step, x.doc_code);
      const cp = el('button', '', 'Copy path');
      cp.onclick = async () => {
        const ok = await copyText(path);
        cp.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => { cp.textContent = 'Copy path'; }, 1500);
      };
      tr.lastChild.appendChild(cp);
      // Claim button per deliverable — writes owner_pic/claimed_by on the existing row
      var delClaimBtn = makeClaimButton('Deliverable', 'lb_deliverables', x, ['deliverable_id'], function(who) {});
      tr.lastChild.appendChild(delClaimBtn);
      if (isPrivileged()) {
        var delAssignBtn = makeAssignButton('Deliverable', 'lb_deliverables', x, ['deliverable_id'], function(target, isPrimary, admin) {
          if (isPrimary) {
            delClaimBtn.textContent = 'Owner: ' + target + ' (Assigned by ' + admin + ')';
            delClaimBtn.className = 'claimed-btn';
          }
        });
        tr.lastChild.appendChild(delAssignBtn);
      }
      // Remove / Restore control
      var rmBtn = el('button', '', isDelRemoved ? 'Restore' : 'Remove');
      rmBtn.style.cssText = 'margin-left:4px;color:' + (isDelRemoved ? 'var(--good)' : 'var(--bad)');
      rmBtn.onclick = async function() {
        var who = requireName(); if (!who) return;
        if (isDelRemoved) {
          confirmModal('Restore ' + esc(x.doc_code),
            'Return this document to its normal state — it will count toward completion again.',
            'Restore', async function() {
              await API.action('lb_deliverables', {
                project_id: project.project_id, step_key: sk, doc_code: x.doc_code,
                deliverable_id: x.deliverable_id, status: ''
              }, { upsertKeys: ['deliverable_id'], audit: { user: who, action: 'Restore_Document', projectId: project.project_id, objType: 'Deliverable', objId: x.doc_code, from: 'Removed', to: 'Restored', detail: x.doc_code } });
              await refreshSilently();
              var pageY = window.scrollY;
              var drawerEl = $('#drawer');
              var drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
              openDrawer(project, step, focusDocCode);
              window.scrollTo(0, pageY);
              var newDrawer = $('#drawer');
              if (newDrawer) newDrawer.scrollTop = drawerScroll;
            });
        } else {
          confirmModal('Remove ' + esc(x.doc_code),
            'Mark <b>' + esc(x.doc_code) + '</b> as not applicable. The file on disk is untouched but the requirement will be excluded from completion counts.',
            'Remove', async function() {
              await API.action('lb_deliverables', {
                project_id: project.project_id, step_key: sk, doc_code: x.doc_code,
                deliverable_id: x.deliverable_id, status: 'Removed'
              }, { upsertKeys: ['deliverable_id'], audit: { user: who, action: 'Remove_Document', projectId: project.project_id, objType: 'Deliverable', objId: x.doc_code, from: x.status || 'Filed', to: 'Removed', detail: x.doc_code } });
              await refreshSilently();
              var pageY = window.scrollY;
              var drawerEl = $('#drawer');
              var drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
              openDrawer(project, step, focusDocCode);
              window.scrollTo(0, pageY);
              var newDrawer = $('#drawer');
              if (newDrawer) newDrawer.scrollTop = drawerScroll;
            });
        }
      };
      tr.lastChild.appendChild(rmBtn);
      tb.appendChild(tr);
      // Preview card for filed evidence (non-link rows only)
      var viewerUrl = evidenceViewerUrl(x.file_path);
      if (viewerUrl) {
        var ext = (x.file_name || x.original_name || '').split('.').pop().toLowerCase();
        var imgExts = { jpg: 1, jpeg: 1, png: 1, webp: 1, gif: 1 };
        var pr = el('tr');
        var ptd = el('td');
        ptd.colSpan = 5;
        ptd.style.padding = '6px 0 10px 0';
        if (imgExts[ext]) {
          var aLink = el('a', 'evidence-thumb');
          aLink.href = viewerUrl; aLink.target = '_blank'; aLink.rel = 'noopener';
          var img = el('img');
          img.src = viewerUrl;
          img.style.cssText = 'max-width:100%;max-height:180px;object-fit:contain;display:block';
          img.alt = x.file_name || 'evidence';
          aLink.appendChild(img);
          ptd.appendChild(aLink);
        } else {
          var fLink = el('a', 'evidence-filecard');
          fLink.href = viewerUrl; fLink.target = '_blank'; fLink.rel = 'noopener';
          fLink.innerHTML = '<span class="evidence-filecard-ext">' + esc(ext.toUpperCase() || 'FILE') + '</span>' +
            '<span class="evidence-filecard-name">' + esc(x.file_name || x.original_name || '') + '</span>' +
            '<span class="evidence-filecard-type">' + esc(x.doc_code) + '</span>';
          ptd.appendChild(fLink);
        }
        pr.appendChild(ptd);
        tb.appendChild(pr);
      }
      const notes = commentsFor(project.project_id, x.deliverable_id);
      if (notes.length) {
        const nr = el('tr');
        nr.innerHTML = '<td></td><td colspan="4" class="note">' +
          notes.map(n => '<b>' + esc(n.author) + '</b> ' + esc((n.created_utc || '').slice(0, 10)) + ': ' + esc(n.comment)).join('<br>') + '</td>';
        tb.appendChild(nr);
      }
    });
    t.appendChild(tb); d.appendChild(t);
  }

  /* ---- what is still missing ---- */
  if (c.missing.length) {
    const mb = el('div', 'banner bad');
    mb.innerHTML = '<b>Required but not filed:</b> ' + c.missing.map(function(x) { return esc(docTypeById(x).name) + (c.customSet.has(x) ? ' <span class="note">(model custom)</span>' : ''); }).join(', ');
    d.appendChild(mb);

    // Inline drag-drop zone for each missing document type
    d.appendChild(el('h3', null, 'Drop evidence here'));
    c.missing.forEach(code => {
      const dz = el('div', 'dz');
      dz.style.cssText = 'margin-bottom:8px;padding:12px';
      dz.innerHTML = '<b>' + esc(docTypeById(code).name) + ' (' + esc(code) + ')</b>' + (c.customSet.has(code) ? ' <span class="note custom-mark">model custom</span>' : '') + '<br><span class="note">Drop a file or click to browse</span>';
      var dzRow = TRK.lb_deliverables.find(function(d) { return d.project_id === project.project_id && d.step_key === sk && d.doc_code === code; }) || { project_id: project.project_id, step_key: sk, doc_code: code };
      dz.appendChild(el('br'));
      dz.appendChild(makeClaimButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function(who, role) {}));
      if (isPrivileged()) {
        dz.appendChild(makeAssignButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function() {
          openDrawer(project, step, code);
        }));
      }
      var dt = docTypeById(code);
      if (dt.template_file) {
        var dlBtn = el('a');
        dlBtn.textContent = 'Download Blank Template';
        dlBtn.href = '/api/templates/' + encodeURIComponent(dt.template_file);
        dlBtn.download = dt.template_file;
        dlBtn.className = 'btn btn-sm dz-template-btn';
        dz.appendChild(dlBtn);
      }
      // "Mark as not applicable" button for missing docs
      dz.appendChild(el('br'));
      var naBtn = el('button', '', 'Mark as not applicable');
      naBtn.style.color = 'var(--bad)';
      naBtn.onclick = function(e) {
        e.stopPropagation();
        var who = requireName(); if (!who) return;
        confirmModal('Remove ' + esc(code),
          'Mark <b>' + esc(docTypeById(code).name) + '</b> as not applicable. This is a soft delete — the requirement will be excluded from completion counts.',
          'Remove', async function() {
            var rowData = { project_id: project.project_id, step_key: sk, doc_code: code, status: 'Removed', uploaded_by: who, uploaded_utc: new Date().toISOString() };
            var keys = dzRow.deliverable_id ? ['deliverable_id'] : ['project_id','step_key','doc_code'];
            if (dzRow.deliverable_id) rowData.deliverable_id = dzRow.deliverable_id;
            await API.action('lb_deliverables', rowData, { upsertKeys: keys, audit: { user: who, action: 'Remove_Document', projectId: project.project_id, objType: 'Deliverable', objId: code, from: 'Missing', to: 'Removed', detail: docTypeById(code).name } });
            await refreshSilently();
            var pageY = window.scrollY;
            var drawerEl = $('#drawer');
            var drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
            openDrawer(project, step, code);
            window.scrollTo(0, pageY);
            var newDrawer = $('#drawer');
            if (newDrawer) newDrawer.scrollTop = drawerScroll;
          });
      };
      dz.appendChild(naBtn);

      dz.ondragover = e => { e.preventDefault(); dz.style.borderColor = 'var(--good)'; dz.style.background = 'var(--good2)'; };
      dz.ondragleave = () => { dz.style.borderColor = ''; dz.style.background = ''; };
      dz.ondrop = async e => {
        e.preventDefault();
        dz.style.borderColor = ''; dz.style.background = '';
        const files = e.dataTransfer.files;
        if (!files.length) return;
        await uploadEvidence(project, sk, code, files[0]);
        const pageY = window.scrollY;
        const drawerEl = $('#drawer');
        const drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
        await refreshSilently();
        openDrawer(project, step, code);
        window.scrollTo(0, pageY);
        const newDrawer = $('#drawer');
        if (newDrawer) newDrawer.scrollTop = drawerScroll;
      };
      dz.onclick = () => {
        const inp = el('input'); inp.type = 'file'; inp.style.display = 'none';
        inp.onchange = async () => {
          if (!inp.files[0]) return;
          await uploadEvidence(project, sk, code, inp.files[0]);
          const pageY = window.scrollY;
          const drawerEl = $('#drawer');
          const drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
          await refreshSilently();
          openDrawer(project, step, code);
          window.scrollTo(0, pageY);
          const newDrawer = $('#drawer');
          if (newDrawer) newDrawer.scrollTop = drawerScroll;
        };
        document.body.appendChild(inp); inp.click(); document.body.removeChild(inp);
      };
      d.appendChild(dz);
    });
  }

  /* ---- documents marked as not applicable (soft-deleted) ---- */
  if (c.removed.length) {
    var rb = el('div', 'banner');
    rb.innerHTML = '<b>Removed from requirements:</b> ' + c.removed.map(function(x) { return esc(docTypeById(x).name) + (c.customSet.has(x) ? ' <span class="note">(model custom)</span>' : ''); }).join(', ');
    rb.style.opacity = '0.7';
    d.appendChild(rb);
    c.removed.forEach(function(code) {
      var remRow = TRK.lb_deliverables.find(function(r) { return r.project_id === project.project_id && r.step_key === sk && r.doc_code === code && r.status === 'Removed'; });
      if (!remRow) return;
      var re = el('div', 'dz');
      re.style.cssText = 'margin-bottom:8px;padding:8px 12px;opacity:0.65;border-left:3px solid var(--muted)';
      re.innerHTML = '<span style="text-decoration:line-through">' + esc(docTypeById(code).name) + ' (' + esc(code) + ')</span>' + (c.customSet.has(code) ? ' <span class="note custom-mark">model custom</span>' : '') + ' <span class="badge bg-secondary" style="text-decoration:line-through">Removed</span>';
      re.appendChild(el('br'));
      var rstBtn = el('button', '', 'Restore');
      rstBtn.style.color = 'var(--good)';
      rstBtn.onclick = async function() {
        var who = requireName(); if (!who) return;
        confirmModal('Restore ' + esc(code),
          'Return ' + esc(docTypeById(code).name) + ' to its normal state — it will count toward completion again.',
          'Restore', async function() {
            var rowData = { project_id: project.project_id, step_key: sk, doc_code: code, status: '' };
            if (remRow.deliverable_id) rowData.deliverable_id = remRow.deliverable_id;
            var keys = remRow.deliverable_id ? ['deliverable_id'] : ['project_id','step_key','doc_code'];
            await API.action('lb_deliverables', rowData, { upsertKeys: keys, audit: { user: who, action: 'Restore_Document', projectId: project.project_id, objType: 'Deliverable', objId: code, from: 'Removed', to: 'Restored', detail: docTypeById(code).name } });
            await refreshSilently();
            var pageY = window.scrollY;
            var drawerEl = $('#drawer');
            var drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
            openDrawer(project, step, code);
            window.scrollTo(0, pageY);
            var newDrawer = $('#drawer');
            if (newDrawer) newDrawer.scrollTop = drawerScroll;
          });
      };
      re.appendChild(rstBtn);
      d.appendChild(re);
    });
  }

  /* ---- add model-specific custom document (Task 3) ------------------------- */
  var customDocWrap = el('div', 'custom-doc-section');
  var addCustomBtn = el('button', '', '+ Add Model Custom Document');
  addCustomBtn.onclick = async function() {
    var who = requireName(); if (!who) return;
    var code = prompt('Document code (e.g. SPECIAL-TEST-01):', '');
    if (!code) return;
    code = code.trim().toUpperCase();
    if (!code) { alert('Document code cannot be empty.'); return; }
    // Must not collide with a global doctype id
    if (CFG.document_types.some(function(d) { return d.doctype_id === code; })) {
      alert('"' + code + '" is already a global document type. Custom documents must use a new code.');
      return;
    }
    // Must not duplicate an existing custom doc on this project+step
    if (TRK.lb_deliverables.some(function(d) {
      return d.project_id === project.project_id && d.step_key === sk && d.doc_code === code && d.custom_doc === 'YES';
    })) {
      alert('"' + code + '" is already a custom document at this step for this project.');
      return;
    }
    var desc = prompt('Short description:', '') || '';
    addCustomBtn.disabled = true;
    try {
      await API.action('lb_deliverables', {
        project_id: project.project_id, step_key: sk, doc_code: code,
        custom_doc: 'YES', description: desc,
        uploaded_by: who, uploaded_utc: new Date().toISOString(),
        file_name: '', file_path: '', sha256: '', kind: '', link_url: '', approved: ''
      }, { audit: { user: who, action: 'Add_Custom_Document', projectId: project.project_id, objType: 'Deliverable', objId: code, from: '', to: 'Custom doc added', detail: desc } });
      // Reopen the drawer in-place so the new doc appears in the gate-state lists
      var pageY = window.scrollY;
      var drawerEl = $('#drawer');
      var drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
      await refreshSilently();
      openDrawer(project, step, null);
      window.scrollTo(0, pageY);
      var newDrawer = $('#drawer');
      if (newDrawer) newDrawer.scrollTop = drawerScroll;
    } catch (e) { alert('Could not add custom document: ' + e.message); }
    addCustomBtn.disabled = false;
  };
  customDocWrap.appendChild(addCustomBtn);
  d.appendChild(customDocWrap);

  /* ---- department / PIC breakdown ---- */
  d.appendChild(el('h3', null, 'Who did what'));
  const pics = picsFor(project.project_id, sk);
  if (!pics.length) d.appendChild(el('p', 'note', 'Nobody has filed or signed anything at this step.'));
  else {
    const pt = el('table');
    pt.innerHTML = '<thead><tr><th>Person</th><th>Documents</th><th>Role</th></tr></thead>';
    const ptb = el('tbody');
    pics.forEach(p => {
      const tr = el('tr');
      tr.innerHTML = '<td><b>' + esc(p.name) + '</b></td><td>' + (p.docs.map(esc).join(', ') || '<span class="note">—</span>') + '</td>' +
        '<td>' + (p.role === 'signed' ? '<span class="' + badgeClass('COMPLETE') + '">signed the gate</span>' : '<span class="note">filed evidence</span>') + '</td>';
      ptb.appendChild(tr);
    });
    pt.appendChild(ptb); d.appendChild(pt);
    d.appendChild(el('p', 'note', 'Responsible department per the model: ' + esc(step.responsible_dept || step.mandatory_approver || 'not stated')));
  }

  /* ---- open issues and tickets ---- */
  const iss = TRK.lb_issues.filter(i => i.project_id === project.project_id && i.step_key === sk && i.status !== 'Closed');
  const tks = (TRK.lb_tickets || []).filter(k => k.project_id === project.project_id && k.step_key === sk && k.status !== 'Closed');
  if (iss.length || tks.length) {
    d.appendChild(el('h3', null, 'Open against this step'));
    const ul = el('div');
    iss.forEach(function(i) {
      var div = el('div', 'note claim-issue-row');
      div.innerHTML = '• <b>Issue</b> ' + esc(i.description) + (i.owner ? ' — ' + esc(i.owner) : '');
      var issueClaimBtn = makeClaimButton('Issue', 'lb_issues', i, ['issue_id'], function(who) {});
      div.appendChild(issueClaimBtn);
      if (isPrivileged()) {
        div.appendChild(makeAssignButton('Issue', 'lb_issues', i, ['issue_id'], function(target, isPrimary, admin) {
          if (isPrimary) {
            issueClaimBtn.textContent = 'Owner: ' + target + ' (Assigned by ' + admin + ')';
            issueClaimBtn.className = 'claimed-btn';
          }
        }));
      }
      ul.appendChild(div);
    });
    tks.forEach(k => ul.insertAdjacentHTML('beforeend', '<div class="note">• <b>Ticket ' + esc(k.ticket_id) + '</b> ' + esc(k.title) + ' — ' + esc(k.assigned_dept || 'unassigned') + ' (' + esc(k.status) + ')</div>'));
    d.appendChild(ul);
  }

  /* ---- executive note ---- */
  d.appendChild(el('h3', null, 'Executive note'));
  d.appendChild(el('p', 'note', 'Recorded in the audit log against this project and step. Use it for the decision you took and why — ' +
    'it does not change the gate status.'));
  const ta = el('textarea'); ta.id = 'exNote'; ta.placeholder = 'e.g. accepted the risk on the missing control plan pending the 12 Aug trial';
  d.appendChild(ta);
  const save = el('button', 'primary', 'Record note'); save.style.marginTop = '6px';
  save.onclick = async () => {
    const who = requireName(); if (!who) return;
    const txt = ta.value.trim();
    if (!txt) { alert('Nothing to record.'); return; }
    save.disabled = true;
    try {
      await API.action('lb_audit', {
        timestamp_utc: new Date().toISOString(), user: who, action: 'Executive_Note',
        project_id: project.project_id, object_type: 'Step', object_id: sk,
        change_from: '', change_to: '', detail: txt, result: 'Success'
      });
      ta.value = '';
      save.textContent = 'Recorded';
      await refresh();
      setTimeout(() => { save.textContent = 'Record note'; save.disabled = false; }, 1500);
    } catch (e) { alert('Could not record: ' + e.message); save.disabled = false; }
  };
  d.appendChild(save);

  const prev = TRK.lb_audit.filter(a => a.action === 'Executive_Note' && a.project_id === project.project_id && a.object_id === sk);
  if (prev.length) {
    d.appendChild(el('h3', null, 'Earlier notes'));
    prev.slice().reverse().forEach(a => {
      d.insertAdjacentHTML('beforeend', '<p class="note"><b>' + esc(a.user) + '</b> ' + esc((a.timestamp_utc || '').slice(0, 16).replace('T', ' ')) + '<br>' + esc(a.detail) + '</p>');
    });
  }

  document.body.appendChild(d);
}

/* ===================================================================== */
/* TAB — CLAIMED WORK (Task 2b)                                          */
/* ===================================================================== */
var PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function viewClaimed(root) {
  var who = getUser();
  var b = el('div', 'banner');
  if (!who) {
    b.innerHTML = '<b>Enter your name in the header first.</b> The Claimed Work view shows tasks assigned to you — it needs a name to match against.';
    root.appendChild(b);
    return;
  }
  b.innerHTML = '<b>Tasks claimed by or assigned to ' + esc(who) + '.</b> Only open items appear here — approved or closed items drop off the list.';
  root.appendChild(b);

  var nw = nowWeek();
  var items = [];

  // Open gates claimed by the user (status not Approved)
  (TRK.lb_gates || []).forEach(function(g) {
    if (g.status === 'Approved') return;
    if (g.owner_pic !== who && g.claimed_by !== who) return;
    var prj = projById(g.project_id);
    if (!prj) return;
    var step = null;
    var allStepList = allStepsOf(prj.process);
    // Find the step by matching step_key
    for (var si = 0; si < allStepList.length; si++) {
      if (stepKeyOf(prj.process, allStepList[si]) === g.step_key) { step = allStepList[si]; break; }
    }
    var tw = toWeek(prj.target_date) || targetDateFor(prj.class_abcde, prj.prf_date) || '';
    items.push({
      projectId: g.project_id,
      type: 'Stage',
      label: (step ? 'Step ' + step.step_id + ' — ' + step.step_name : g.step_key || ''),
      targetWeek: tw,
      priority: 'Medium',
      priorityOrder: 2,
      status: g.status || 'NotStarted',
      step: step || { step_id: 0, step_name: '' },
      project: prj,
      assignedBy: g.assigned_by || ''
    });
  });

  // Open deliverables (not approved) claimed by the user
  (TRK.lb_deliverables || []).forEach(function(d) {
    if (d.approved === 'YES') return;
    if (d.owner_pic !== who && d.claimed_by !== who) return;
    if (!d.doc_code) return;
    var prj = projById(d.project_id);
    if (!prj) return;
    var allStepList = allStepsOf(prj.process);
    var step = null;
    for (var si = 0; si < allStepList.length; si++) {
      if (stepKeyOf(prj.process, allStepList[si]) === d.step_key) { step = allStepList[si]; break; }
    }
    var tw = toWeek(prj.target_date) || targetDateFor(prj.class_abcde, prj.prf_date) || '';
    var doctype = docTypeById(d.doc_code);
    items.push({
      projectId: d.project_id,
      type: d.custom_doc === 'YES' ? 'Doc (custom)' : 'Document',
      label: (doctype.name || d.doc_code) + (d.custom_doc === 'YES' ? ' (custom)' : ''),
      targetWeek: tw,
      priority: 'Medium',
      priorityOrder: 2,
      status: d.approved === 'YES' ? 'APPROVED' : 'FILED',
      step: step || { step_id: 0, step_name: '' },
      project: prj,
      assignedBy: d.assigned_by || ''
    });
  });

  // Open SP issues claimed by the user
  (TRK.lb_sp_issues || []).forEach(function(i) {
    if (i.status === 'Closed') return;
    if (i.owner_pic !== who && i.claimed_by !== who) return;
    var prj = projById(i.project_id);
    var tw = i.due_date ? toWeek(i.due_date) : (prj ? (toWeek(prj.target_date) || targetDateFor(prj.class_abcde, prj.prf_date) || '') : '');
    var prio = i.priority || 'Medium';
    items.push({
      projectId: i.project_id || '',
      type: 'SP Issue',
      label: i.title || i.description || '',
      targetWeek: tw,
      priority: prio,
      priorityOrder: PRIORITY_ORDER[prio] != null ? PRIORITY_ORDER[prio] : 4,
      status: i.status || 'Open',
      step: null,
      project: prj || null,
      assignedBy: i.assigned_by || ''
    });
  });

  // Open lb_issues claimed by the user
  (TRK.lb_issues || []).forEach(function(i) {
    if (i.status === 'Closed') return;
    if (i.owner_pic !== who && i.claimed_by !== who) return;
    var prj = projById(i.project_id);
    var tw = i.due_date ? toWeek(i.due_date) : (prj ? (toWeek(prj.target_date) || targetDateFor(prj.class_abcde, prj.prf_date) || '') : '');
    var prio = i.priority || 'Medium';
    var allStepList = prj ? allStepsOf(prj.process) : [];
    var step = null;
    if (prj) {
      for (var si = 0; si < allStepList.length; si++) {
        if (stepKeyOf(prj.process, allStepList[si]) === i.step_key) { step = allStepList[si]; break; }
      }
    }
    items.push({
      projectId: i.project_id || '',
      type: 'Issue',
      label: i.description || '',
      targetWeek: tw,
      priority: prio,
      priorityOrder: PRIORITY_ORDER[prio] != null ? PRIORITY_ORDER[prio] : 4,
      status: i.status || 'Open',
      step: step || null,
      project: prj || null,
      assignedBy: i.assigned_by || ''
    });
  });

  if (!items.length) {
    root.appendChild(el('p', 'note', 'You have nothing claimed or assigned right now. Use the inspection drawer in the NPI or ECN tab to claim tasks.'));
    return;
  }

  // Sort: overdue first, then by target week ascending, then by priority order
  items.sort(function(a, b) {
    var aOverdue = a.targetWeek && a.targetWeek < nw ? 0 : 1;
    var bOverdue = b.targetWeek && b.targetWeek < nw ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    if (a.targetWeek !== b.targetWeek) {
      if (!a.targetWeek) return 1;
      if (!b.targetWeek) return -1;
      return a.targetWeek < b.targetWeek ? -1 : 1;
    }
    return a.priorityOrder - b.priorityOrder;
  });

  // Build table
  var card = el('div', 'card');
  var body = el('div', 'card-body');
  var t = el('table');
  t.innerHTML = '<thead><tr><th>Project</th><th>What</th><th>Item</th><th>Target week</th><th>Priority</th><th>Status</th></tr></thead>';
  var tb = el('tbody');
  items.forEach(function(item) {
    var tr = el('tr', 'claimed-row');
    tr.style.cursor = 'pointer';
    var overdue = item.targetWeek && item.targetWeek < nw;
    var twDisplay = item.targetWeek || '—';
    if (overdue) twDisplay = '⚠ Overdue: ' + twDisplay;

    tr.innerHTML = '<td><b>' + esc(item.projectId) + '</b></td>' +
      '<td><span class="note">' + esc(item.type) + '</span></td>' +
      '<td>' + esc(item.label) + (item.assignedBy ? ' <span class="badge bg-primary" style="font-size:10px">Assigned by Admin</span>' : '') + '</td>' +
      '<td class="' + (overdue ? 'claimed-overdue' : '') + '">' + esc(twDisplay) + '</td>' +
      '<td>' + esc(item.priority) + '</td>' +
      '<td><span class="' + badgeClass(item.status) + '">' + esc(item.status.replace(/_/g, ' ')) + '</span></td>';

    tr.onclick = function() {
      if (item.project && item.step) {
        openDrawer(item.project, item.step, null);
      } else if (item.project && item.project.process) {
        // For items without a specific step, open at step 1
        var steps = stepsOf(item.project.process, item.project);
        if (steps.length) openDrawer(item.project, steps[0], null);
      }
    };
    tr.onmouseenter = function() { this.style.background = 'var(--row-hover)'; };
    tr.onmouseleave = function() { this.style.background = ''; };
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  body.appendChild(t);
  card.appendChild(body);
  root.appendChild(card);
}

/* ===================================================================== */
/* TAB — SHAREPOINT ISSUE TRACKER                                        */
/* ===================================================================== */
function viewSharePoint(root) {
  const b = el('div', 'banner');
  b.innerHTML = '<b>Issues raised against projects, held in the local tracking CSVs.</b> ' +
    'CSV import and export are the bridge to anything outside this tool — use them to exchange issue logs with other systems or stakeholders.';
  root.appendChild(b);

  const listPanel = el('div', 'card');
  const listHdr = el('div', 'card-header'); listHdr.appendChild(el('h3', 'card-title', 'Issue log')); listPanel.appendChild(listHdr);
  const listBody = el('div', 'card-body');
  const listHost = el('div'); listBody.appendChild(listHost);
  listPanel.appendChild(listBody); root.appendChild(listPanel);

  /* ---- template download / export / import buttons ---- */
  const tplPanel = el('div', 'card');
  const tplBody = el('div', 'card-body'); tplPanel.appendChild(tplBody);
  tplBody.innerHTML = '<b>CSV tools</b> &nbsp; ';
  const dlBtn = el('button', '', 'Download issue CSV template');
  dlBtn.onclick = () => { window.location.href = '/api/issues/template.csv'; };
  tplBody.appendChild(dlBtn);
  const expBtn = el('button', '', 'Export issues to CSV');
  expBtn.onclick = () => {
    const hdrs = CFG.issue_tracker_headers || {};
    const keys = Object.keys(hdrs);
    const lines = [keys.map(k => csvCell(hdrs[k])).join(',')];
    (TRK.lb_sp_issues || []).forEach(r => {
      lines.push(keys.map(k => csvCell(k === 'due_date' ? toWeek(r[k]) : r[k])).join(','));
    });
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'issues_export_' + today() + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  tplBody.appendChild(expBtn);
  const impInput = el('input'); impInput.type = 'file'; impInput.accept = '.csv'; impInput.style.display = 'none';
  tplBody.appendChild(impInput);
  const impBtn = el('button', '', 'Import CSV');
  impBtn.onclick = () => { impInput.click(); };
  impInput.onchange = async () => {
    const f = impInput.files[0];
    if (!f) return;
    const who = requireName(); if (!who) { impInput.value = ''; return; }
    impBtn.disabled = true;
    try {
      const text = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(rd.result);
        rd.onerror = reject; rd.readAsText(f);
      });
      const r = await API.importIssues(text, who);
      let msg = r.accepted + ' issue(s) imported.';
      if (r.rejected && r.rejected.length) {
        msg += '\n' + r.rejected.length + ' row(s) rejected:';
        r.rejected.forEach(rj => { msg += '\n  Row ' + rj.row + ': ' + rj.reason; });
      }
      alert(msg);
      await redrawAfterWrite();
    } catch (e) { alert('Import failed: ' + e.message); }
    impBtn.disabled = false; impInput.value = '';
  };
  tplBody.appendChild(impBtn);
  root.appendChild(tplPanel);


  /* ---- raise an issue ---- */
  const nf = el('div', 'sub');
  nf.appendChild(el('h3', null, 'Raise an issue'));
  const g = el('div', 'grid2');
  const projOpts = TRK.lb_projects.map(p => '<option>' + esc(p.project_id) + '</option>').join('');
  g.innerHTML = '<div class="fld"><span>Project</span><select id="spProj">' + (projOpts || '<option value="">register a project first</option>') + '</select></div>' +
    '<div class="fld"><span>Title *</span><input id="spTitle" placeholder="VM coating peeling on housing"></div>' +
    '<div class="fld"><span>Owner department</span><select id="spDept">' + Object.keys(CFG.departments || {}).map(k => '<option>' + esc(k) + '</option>').join('') + '</select></div>' +
    '<div class="fld"><span>Owner (PIC)</span><input id="spPic"></div>' +
    '<div class="fld"><span>Due date</span><input id="spDue" type="week"></div>' +
    '<div class="fld"><span>Priority</span><select id="spPriority"><option>Medium</option><option>Low</option><option>High</option><option>Critical</option></select></div>' +
    '<div class="fld"><span>Assigned dept</span><input id="spAssignedDept" placeholder="free text — may name an external vendor"></div>';
  nf.appendChild(g);
  const dsc = el('div', 'fld'); dsc.innerHTML = '<span>Description</span><textarea id="spDesc"></textarea>';
  nf.appendChild(dsc);
  const add = el('button', 'primary mt-s2', 'Raise issue');
  nf.appendChild(add);
  listBody.insertBefore(nf, listHost);

  add.onclick = async () => {
    const who = requireName(); if (!who) return;
    const title = $('#spTitle', nf).value.trim();
    if (!title) { alert('Give the issue a title.'); return; }
    add.disabled = true;
    try {
      await API.action('lb_sp_issues', {
        project_id: $('#spProj', nf).value, title, description: $('#spDesc', nf).value.trim(),
        raised_by: who, raised_utc: new Date().toISOString(), owner_dept: $('#spDept', nf).value,
        owner_pic: $('#spPic', nf).value.trim(), due_date: $('#spDue', nf).value, status: 'Open',
        action_taken: '', remarks: '', attachment_name: '', attachment_path: '',
        last_message_by: who, last_message_utc: new Date().toISOString(), last_message: 'raised',
        priority: $('#spPriority', nf).value, assigned_dept: $('#spAssignedDept', nf).value.trim()
      }, { audit: { user: who, action: 'Raise_SP_Issue', projectId: $('#spProj', nf).value, objType: 'SPIssue', objId: title, from: '', to: 'Open', detail: '' } });
      $('#spTitle', nf).value = ''; $('#spDesc', nf).value = ''; $('#spPic', nf).value = ''; $('#spAssignedDept', nf).value = '';
      await redrawAfterWrite();
    } catch (e) { alert('Could not raise the issue: ' + e.message); }
    add.disabled = false;
  };

  /* ---- the log ---- */
  const rawRows = (TRK.lb_sp_issues || []).slice().reverse();
  if (!rawRows.length) { listHost.appendChild(el('p', 'note', 'No issue raised yet.')); return; }

  const filt = el('div', 'filters');
  filt.innerHTML = '<label><input type="checkbox" id="issueShowClosed"> Show closed issues</label>' +
    '<input id="issueSearchInp" placeholder="Search project, title, owner, department…" style="min-width:260px;margin-left:12px">';
  listHost.appendChild(filt);
  const tblHost = el('div'); listHost.appendChild(tblHost);

  const drawList = () => {
    tblHost.innerHTML = '';
    const showClosed = $('#issueShowClosed', listBody).checked;
    const q = ($('#issueSearchInp', listBody) || {}).value || '';
    const ql = q.toLowerCase().trim();
    let rows = rawRows;
    if (!showClosed) rows = rows.filter(r => r.status !== 'Closed');
    if (ql) {
      rows = rows.filter(r => {
        const hay = ((r.project_id || '') + '\0' + (r.title || '') + '\0' + (r.owner_pic || '') + '\0' + (r.owner_dept || '') + '\0' + (r.description || '')).toLowerCase();
        return hay.indexOf(ql) !== -1;
      });
    }
    if (!rows.length) {
      if (ql) {
        tblHost.appendChild(el('p', 'note', 'No issues match "' + esc(q) + '". ' + rawRows.length + ' hidden by current filters.'));
      } else {
        tblHost.appendChild(el('p', 'note', 'All ' + rawRows.length + ' issue(s) are closed — tick "Show closed issues" to see them.'));
      }
      return;
    }
    const t = el('table');
    t.innerHTML = '<thead><tr><th>Project</th><th>Issue</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th>' +
      '<th>Action / remarks</th><th>Attachment</th><th>Last message</th><th></th></tr></thead>';
    const tb = el('tbody');
    rows.forEach(r => {
      const overdue = r.due_date && r.status !== 'Closed' && toWeek(r.due_date) < nowWeek();
      const tr = el('tr');
      tr.innerHTML = '<td>' + esc(r.project_id) + '</td>' +
        '<td><b>' + esc(r.title) + '</b><div class="note">' + esc(r.description) + '</div></td>' +
        '<td>' + esc(r.owner_pic || '—') + '<div class="note">' + esc(r.owner_dept || '') + '</div></td>' +
        '<td>' + (r.due_date ? (overdue ? '<b style="color:var(--bad)">' + esc(toWeek(r.due_date)) + '</b>' : esc(toWeek(r.due_date))) : '<span class="note">—</span>') + '</td>' +
        '<td>' + (r.priority ? (() => { const p = r.priority; const cls = (p === 'Critical' || p === 'High') ? 'AT_RISK' : p === 'Medium' ? 'NOT_STARTED' : 'TRACK'; return '<span class="' + badgeClass(cls) + '">' + esc(p) + '</span>'; })() : '<span class="note">—</span>') + '</td>' +
        '<td><span class="' + badgeClass(r.status === 'Closed' ? 'COMPLETE' : 'Open') + '">' + esc(r.status) + '</span></td>' +
        '<td class="note">' + esc(r.action_taken || '') + (r.remarks ? '<br>' + esc(r.remarks) : '') + '</td>' +
        '<td class="note">' + (r.attachment_name ? '<code>' + esc(r.attachment_name) + '</code>' : '—') + '</td>' +
        '<td class="note">' + esc(r.last_message_by || '') + ' ' + esc((r.last_message_utc || '').slice(0, 16).replace('T', ' ')) +
          (r.last_message ? '<br>' + esc(r.last_message) : '') + '</td><td></td>';
      const act = tr.lastChild;
      if (r.attachment_path) {
        const cp = el('button', '', 'Copy path');
        cp.onclick = async () => {
          const ok = await copyText(r.attachment_path);
          cp.textContent = ok ? 'Copied' : 'Copy failed';
          setTimeout(() => { cp.textContent = 'Copy path'; }, 1500);
        };
        act.appendChild(cp);
      }
      const upd = el('button', '', 'Update…');
      upd.onclick = async () => {
        const who = requireName() || '(unnamed)';
        const msg = prompt('What happened? (logged with your name and the time)', r.action_taken || '');
        if (msg === null) return;
        const st = prompt('Status: Open / In progress / Closed', r.status) || r.status;
        await API.action('lb_sp_issues', {
          sp_id: r.sp_id, project_id: r.project_id, title: r.title, description: r.description,
          raised_by: r.raised_by, raised_utc: r.raised_utc, owner_dept: r.owner_dept, owner_pic: r.owner_pic,
          due_date: r.due_date, status: st, action_taken: msg, remarks: r.remarks,
          attachment_name: r.attachment_name, attachment_path: r.attachment_path,
          last_message_by: who, last_message_utc: new Date().toISOString(), last_message: msg,
          priority: r.priority, assigned_dept: r.assigned_dept
        }, { upsertKeys: ['sp_id'], audit: { user: who, action: 'Update_SP_Issue', projectId: r.project_id, objType: 'SPIssue', objId: r.sp_id, from: r.status, to: st, detail: msg } });
        await redrawAfterWrite();
      };
      act.appendChild(upd);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    const sc = el('div', 'scroll'); sc.appendChild(t); tblHost.appendChild(sc);
  };

  $('#issueShowClosed', listBody).onchange = drawList;
  $('#issueSearchInp', listBody).oninput = drawList;
  drawList();
}

/* ===================================================================== */
/* TAB — INPUT                                                           */
/* ===================================================================== */
function viewInput(root) {
  const b = el('div', 'banner');
  b.innerHTML = '<b>What this tool is.</b> It tracks the NPI and ECN stage-gate workflow defined in ' +
    esc(CFG.system_info.compiled_from.slice(0, 2).join(' and ')) + ' so a team can see whether a project is really ready ' +
    'before decisions are locked in. <b>It never reads or writes D365</b> — Finance, SRC and Production enter the finalised ' +
    'result afterwards, and you log that entry below so the trail is complete.';
  root.appendChild(b);

  /* ---- A. register a project ---- */
  const reg = el('div', 'card');
  const regHdr = el('div', 'card-header'); regHdr.appendChild(el('h3', 'card-title', 'A. Register a project')); reg.appendChild(regHdr);
  const regBody = el('div', 'card-body');
  regBody.appendChild(el('p', 'note', 'The Family ID you type becomes the project ID — NPI-9649LP, ECN-5612. ' +
    'The change type sets the cycle time and decides which process steps this project actually has to run.'));
  const g = el('div', 'grid2');
  const fld = (label, html) => { const d = el('div', 'fld'); d.appendChild(el('span', null, label)); d.insertAdjacentHTML('beforeend', html); return d; };
  // combobox: datalist shows "Category Name (PROD_FAMILY_ID)", normalised back to prod_family_id at submit
  const famDlOpts = CFG.prod_families.map(f => '<option value="' + esc(f.prod_family_name) + ' (' + esc(f.prod_family_id) + ')">').join('');
  // every FG number we already know about, offered as suggestions but not enforced
  const known = [];
  CFG.prod_families.forEach(f => (f.sample_fg_ids || []).forEach(x => known.indexOf(x) < 0 && known.push(x)));
  const ctOpts = changeTypes().map(t => '<option value="' + esc(t.type_id) + '">Type ' + esc(t.type_id) + ' — ' + esc(t.name) +
    (t.cycle_time_days == null ? ' (cycle TBD)' : ' (' + t.cycle_time_days + ' d)') + '</option>').join('');

  g.appendChild(fld('Process', '<select id="npProc"><option>NPI</option><option>ECN</option></select>'));
  g.appendChild(fld('Family ID *', '<input id="npFamId" list="fgList" placeholder="9649LP, 5612, …">' +
    '<datalist id="fgList">' + known.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>'));
  g.appendChild(fld('Change / project type *', '<select id="npClass"><option value="">— pick —</option>' + ctOpts + '</select>'));
  g.appendChild(fld('Product family', '<input id="npFam" list="famList" placeholder="— optional, groups the evidence folder —" style="width:100%">' +
    '<datalist id="famList">' + famDlOpts + '</datalist>'));
  g.appendChild(fld('Customer number', '<input id="npCust">'));
  g.appendChild(fld('PRF / request date', '<input id="npPrf" type="week" value="' + nowWeek() + '">'));
  // The hint belongs inside the field, not as a sibling: .grid2 is a CSS grid,
  // so a bare <p> here would claim a whole column and shove the next field down.
  g.appendChild(fld('Target finish date (override)',
    '<input id="npTargetDate" type="week">' +
    '<span class="note">Blank = calculated from the change type\'s cycle time. Set it only when this project\'s schedule differs.</span>'));
  g.appendChild(fld('Market manager / originator', '<input id="npMm">'));
  g.appendChild(fld('Country', '<input id="npCountry">'));
  g.appendChild(fld('Scope / reason', '<input id="npNotes">'));
  regBody.appendChild(g);

  // certifications — the long-lead item nobody remembers until it blocks a launch
  const certFld = el('div', 'fld'); certFld.style.marginTop = '8px';
  certFld.appendChild(el('span', null, 'Certifications required'));
  const certUI = certPicker(CFG.deployment_defaults.default_certifications || []);
  certFld.appendChild(certUI.node);
  regBody.appendChild(certFld);
  regBody.appendChild(el('p', 'note', 'Click a scheme or type your own. Certification is usually the longest ' +
    'lead time on the project — recording it at registration is what makes it visible on the dashboard later.'));
  const ctNote = el('div', 'banner'); ctNote.style.display = 'none'; regBody.appendChild(ctNote);
  const regBtn = el('button', 'primary', 'Register project'); regBtn.style.marginTop = '8px';
  regBody.appendChild(regBtn);
  regBody.appendChild(el('p', 'note', 'Every registered project — searchable and filterable — is on the NPI and ECN tabs.'));
  reg.appendChild(regBody); root.appendChild(reg);

  let _npFamEdited = false, _npClassEdited = false;
  const upd = () => {
    const t = changeTypeById($('#npClass').value);
    const proc = $('#npProc').value;
    if (!t) { ctNote.style.display = 'none'; return; }
    const override = $('#npTargetDate').value;
    const tgt = override || targetDateFor(t.type_id, $('#npPrf').value);
    const runs = proc === 'NPI' ? t.npi_steps : t.ecn_steps;
    const all = allStepsOf(proc);
    const skipped = all.filter(s => (runs || []).indexOf(s.step_id) < 0);
    const fam = familyById($('#npFamId').value.trim());
    ctNote.style.display = '';
    ctNote.innerHTML = '<b>Type ' + esc(t.type_id) + ' — ' + esc(t.name) + '.</b> ' + esc(t.description) +
      '<br>Cycle time: ' + (t.cycle_time_days == null ? '<b>TBD</b> — ' + esc(t.cycle_time_note) + ' No target date will be set.'
        : '<b>' + t.cycle_time_days + ' days</b> → target finish <b>' + esc(tgt || '—') + '</b>' + (override ? ' <span class="note">(manual override)</span>' : '')) +
      '<br>Runs ' + (runs || all.map(s => s.step_id)).length + ' of ' + all.length + ' ' + esc(proc) + ' steps.' +
      (skipped.length ? ' Not applicable: ' + skipped.map(s => 'step ' + s.step_id + ' ' + esc(s.step_name)).join(', ') +
        (t.excluded_step_reason ? ' — ' + esc(t.excluded_step_reason) : '') : '') +
      (fam ? '<br>Family: <b>' + esc(fam.prod_family_name) + '</b> (' + esc(fam.prod_family_id) + ')' +
        (fam.typical_lead_time_days ? ' · typical lead time <b>' + fam.typical_lead_time_days + ' days</b>' : '') : '');
  };
  $('#npClass', reg).onchange = (e) => { _npClassEdited = true; upd(); };
  $('#npProc', reg).onchange = upd;
  $('#npPrf', reg).onchange = upd;
  $('#npTargetDate', reg).onchange = upd;
  $('#npFam', reg).oninput = () => { _npFamEdited = true; };

  // Family ID → auto-fill product family and change type (Task 2)
  let _lastFamId = '';
  const onFamId = () => {
    const val = $('#npFamId').value.trim();
    if (val === _lastFamId) return;
    _lastFamId = val;
    const fam = familyById(val);
    // Assigning .value does not fire oninput, so the "user has edited this"
    // flags stay false and a later keystroke in Family ID can still refresh an
    // auto-filled field. That is intended: only a human touching the box locks it.
    if (fam) {
      if (!_npFamEdited) $('#npFam').value = fam.prod_family_name + ' (' + fam.prod_family_id + ')';
      if (!_npClassEdited && fam.complexity_class) {
        const ct = changeTypes().find(t => t.type_id === fam.complexity_class);
        if (ct) $('#npClass').value = ct.type_id;
      }
    }
    // Redraw the banner either way — it names the resolved family, so it has to
    // drop that line again when the typed value stops matching one.
    upd();
  };
  $('#npFamId').oninput = onFamId;
  $('#npFamId').onchange = onFamId;

  regBtn.onclick = async () => {
    const who = requireName(); if (!who) return;
    const famId = $('#npFamId').value.trim();
    const cls = $('#npClass').value;
    if (!famId) { alert('Family ID is required — it forms the project ID.'); return; }
    if (!cls) { alert('Pick a change / project type. It decides the cycle time and which steps apply.'); return; }
    const ov = $('#npTargetDate').value;
    if (ov && $('#npPrf').value && ov < $('#npPrf').value) {
      if (!confirm('Target finish is before the request date — register anyway?')) return;
    }
    regBtn.disabled = true;
    try {
      const saved = await API.createProject({
        process: $('#npProc').value, family: famId, prod_family: normaliseFamilyInput($('#npFam').value),
        class_abcde: cls,
        target_date: ov || targetDateFor(cls, $('#npPrf').value),
        prf_date: $('#npPrf').value, market_manager: $('#npMm').value.trim(), country: $('#npCountry').value.trim(),
        customer_number: $('#npCust').value.trim(), notes: $('#npNotes').value.trim(), created_by: who,
        certifications: certUI.value()
      });
      alert('Registered as ' + saved.project_id + '.');
      await redrawAfterWrite();
    } catch (e) { alert('Could not register: ' + e.message); } finally { regBtn.disabled = false; }
  };

  /* ---- A2. Batch Project Registration (v3.1) ----
     Registers many projects from one CSV. Deliberately sits directly under the
     single-project form: it is the same operation at volume, and the server
     applies the same ID rule and the same validation to both. */
  const bat = el('div', 'card');
  const batHdr = el('div', 'card-header');
  batHdr.appendChild(el('h3', 'card-title', 'A2. Batch Project Registration'));
  bat.appendChild(batHdr);
  const batBody = el('div', 'card-body');
  batBody.appendChild(el('p', 'note',
    'Register many projects at once from a CSV — useful when a transfer plan or a quarter of ECNs ' +
    'arrives as a spreadsheet. Every row is validated before anything is written: valid rows are ' +
    'created, invalid rows are reported with the reason and the row number, and a project that ' +
    'already exists is never overwritten.'));

  const batActs = el('div', 'filters');
  const tplBtn = el('button', 'btn btn-outline-primary btn-sm', '⬇ Download CSV Template');
  batActs.appendChild(tplBtn);
  batBody.appendChild(batActs);

  // Template is generated in the browser — no server round trip, so it works
  // exactly the same on an air-gapped machine.
  const BATCH_HEADERS = ['process', 'family', 'class_abcde', 'prod_family', 'prf_date',
    'target_date', 'market_manager', 'country', 'customer_number', 'notes', 'certifications'];
  tplBtn.onclick = () => {
    const famExample = (CFG.prod_families[0] || {}).prod_family_id || 'CL-CORDED';
    const clsExample = ((changeTypes()[0] || {}).type_id) || 'E';
    // The sample row is commented out with a leading '#'. The server skips any
    // row whose process cell starts with '#', so "download the template, add
    // your rows, upload it" cannot accidentally register the example itself.
    const lines = [
      BATCH_HEADERS.join(','),
      '# EXAMPLE ROW - delete this line or leave it, rows starting with # are ignored',
      ['#NPI', '9649LP', clsExample, famExample, nowWeek(), '',
        'Market manager name', 'VN', 'CUST-001', 'Scope or reason', 'CB|CE-EMC'].join(',')
    ];
    const help = [
      '# process       NPI or ECN (required)',
      '# family        forms the project ID, e.g. 9649LP -> NPI-9649LP (required)',
      '# class_abcde   change type: ' + changeTypes().map(t => t.type_id).join(' / ') + ' (required)',
      '# prod_family   one of: ' + CFG.prod_families.map(f => f.prod_family_id).join(' / ') + ' (optional)',
      '# prf_date      ISO week 2026-W32 or date 2026-08-06 (optional)',
      '# target_date   blank = calculated from the change type cycle time (optional)',
      '# certifications  separate several with | e.g. CB|CE-EMC'
    ];
    const csv = lines.concat(help).join('\r\n') + '\r\n';
    // BOM so Excel opens UTF-8 accented text correctly instead of mojibake.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'project_batch_template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const batDz = el('div', 'dz');
  batDz.setAttribute('tabindex', '0');
  batDz.setAttribute('role', 'button');
  batDz.setAttribute('aria-label', 'Choose or drop a CSV file of projects to register');
  const batDzIcon = el('div', 'dz-icon');
  batDzIcon.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M14 3v4a1 1 0 0 0 1 1h4"/>' +
    '<path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>' +
    '<path d="M12 17v-6"/><path d="M9.5 13.5 12 11l2.5 2.5"/></svg>';
  batDz.appendChild(batDzIcon);
  batDz.appendChild(el('div', 'dz-main', 'Drop a project CSV here, or click to choose'));
  batDz.appendChild(el('div', 'dz-sub', 'One row per project. Use the template above for the correct columns.'));
  const batIn = el('input'); batIn.type = 'file'; batIn.accept = '.csv,text/csv'; batIn.className = 'hide';
  batBody.appendChild(batDz); batBody.appendChild(batIn);

  const batPick = el('div', 'batch-file hide');
  const batImport = el('button', 'btn btn-primary', 'Import Batch CSV');
  batImport.disabled = true;
  const batResult = el('div', 'import-result hide');
  batBody.appendChild(batPick);
  batBody.appendChild(batImport);
  batBody.appendChild(batResult);
  bat.appendChild(batBody); root.appendChild(bat);

  // A successful import calls redrawAfterWrite(), which rebuilds this whole
  // view — so a result rendered into the freshly-created node would vanish the
  // instant it appeared. The last result is kept at module scope and re-rendered
  // on build, which is what makes it survive until the user dismisses it.
  let batFile = null, batBusy = false;
  if (lastBatchResult) renderBatchResult(lastBatchResult);
  const kb = n => n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
  function setBatFile(f) {
    batFile = f || null;
    batPick.className = batFile ? 'batch-file' : 'batch-file hide';
    batImport.disabled = !batFile;
    if (!batFile) return;
    batPick.innerHTML = '';
    const nm = el('span', 'batch-file-name');
    nm.textContent = batFile.name + ' · ' + kb(batFile.size);
    const clr = el('button', 'btn btn-ghost btn-sm', 'Clear');
    clr.onclick = () => { setBatFile(null); batIn.value = ''; };
    batPick.appendChild(nm); batPick.appendChild(clr);
  }
  const acceptCsv = f => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { alert('Please choose a .csv file. Save the spreadsheet as CSV first.'); return; }
    setBatFile(f);
  };
  batDz.onclick = () => batIn.click();
  batDz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); batIn.click(); } };
  batDz.ondragover = e => { e.preventDefault(); batDz.classList.add('on'); };
  batDz.ondragleave = () => batDz.classList.remove('on');
  batDz.ondrop = e => { e.preventDefault(); batDz.classList.remove('on'); acceptCsv(e.dataTransfer.files[0]); };
  batIn.onchange = () => acceptCsv(batIn.files[0]);

  batImport.onclick = async () => {
    if (!batFile || batBusy) return;          // guards a double-click
    const who = requireName(); if (!who) return;
    batBusy = true;
    batImport.disabled = true; batImport.textContent = 'Importing…';
    batResult.className = 'import-result hide';
    try {
      const text = await batFile.text();
      const r = await API.batchProjects(text, who);
      lastBatchResult = r;
      renderBatchResult(r);
      // redrawAfterWrite rebuilds this view; viewInput re-renders
      // lastBatchResult on the way back up, so the summary persists.
      if (r.accepted) await redrawAfterWrite();
    } catch (e) {
      lastBatchResult = null;
      batResult.className = 'import-result bad';
      batResult.innerHTML = '<b>Import failed.</b><p class="note">' + esc(e.message) + '</p>';
    } finally {
      batBusy = false;
      batImport.disabled = !batFile; batImport.textContent = 'Import Batch CSV';
    }
  };

  function renderBatchResult(r) {
    const okAll = r.rejected === 0 && r.accepted > 0;
    batResult.className = 'import-result ' + (okAll ? 'good' : (r.accepted ? 'warn' : 'bad'));
    let h = '<div class="import-result-head">' +
      '<b>' + (r.accepted ? r.accepted + ' project' + (r.accepted === 1 ? '' : 's') + ' registered' : 'Nothing was registered') + '</b>' +
      '<span class="note">' + r.accepted + ' accepted · ' + r.rejected + ' rejected · ' + r.total + ' row' +
      (r.total === 1 ? '' : 's') + ' read</span></div>';
    if (r.created_project_ids && r.created_project_ids.length) {
      h += '<div class="taglist">' + r.created_project_ids.map(id =>
        '<span class="badge bg-success">' + esc(id) + '</span>').join('') + '</div>';
    }
    if (r.rejections && r.rejections.length) {
      h += '<div class="scroll"><table><thead><tr><th class="num">CSV row</th><th>Why it was rejected</th></tr></thead><tbody>' +
        r.rejections.map(x => '<tr><td class="num">' + esc(x.row) + '</td><td>' + esc(x.reason) + '</td></tr>').join('') +
        '</tbody></table></div>' +
        '<p class="note">Fix those rows and import again — the projects that succeeded are already saved ' +
        'and will not be duplicated.</p>';
    }
    batResult.innerHTML = h;
    const dis = el('button', 'btn btn-ghost btn-sm', 'Dismiss');
    dis.onclick = () => { lastBatchResult = null; batResult.className = 'import-result hide'; };
    batResult.appendChild(dis);
  }

  /* ---- B. file evidence ---- */
  const fi = el('div', 'card');
  const fiHdr = el('div', 'card-header'); fiHdr.appendChild(el('h3', 'card-title', 'B. File evidence')); fi.appendChild(fiHdr);
  const fiBody = el('div', 'card-body');
  fiBody.appendChild(el('p', 'note', 'Files are uploaded straight to this machine\'s server and saved under ' +
    (PATHS.vault ? PATHS.vault : 'the document vault') + '\\[Family]\\[Document type]\\[Part]\\. ' +
    'A byte-identical file already filed is skipped; a same-name file with different content is kept alongside with a timestamp.'));

  /* -- blank company forms, so nobody hunts the share for the right template -- */
  const tmpl = el('div', 'filters');
  if (TEMPLATES.length) {
    tmpl.innerHTML = '<label>Download blank template</label><select id="tmplSel" style="min-width:320px">' +
      '<option value="">— pick a form —</option>' +
      TEMPLATES.map(t => '<option value="' + esc(t.name) + '">' + esc(t.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ')) +
        '  (' + Math.round(t.bytes / 1024) + ' KB)</option>').join('') + '</select>' +
      '<button id="tmplGo" class="primary">Download</button>';
    fiBody.appendChild(tmpl);
    const go = () => {
      const n = $('#tmplSel', tmpl).value;
      if (!n) { alert('Pick a form first.'); return; }
      window.location.href = '/api/templates/' + encodeURIComponent(n);
    };
    $('#tmplGo', tmpl).onclick = go;
  } else {
    tmpl.innerHTML = '<span class="note">No blank templates staged in <code>system\\templates\\</code> yet.</span>';
    fiBody.appendChild(tmpl);
  }

  const dz = el('div', 'dz', 'Drop files here — several at once is fine — or click to choose');
  fiBody.appendChild(dz);
  const fin = el('input'); fin.type = 'file'; fin.multiple = true; fin.className = 'hide'; fiBody.appendChild(fin);
  const form = el('div', 'hide'); fiBody.appendChild(form);

  /* ---- cite a document that lives somewhere else ---- */
  const lk = el('div', 'sub');
  lk.appendChild(el('h3', null, 'Or cite a network path / link'));
  lk.appendChild(el('p', 'note', 'Some documents cannot be copied here — a controlled master on the DESIGN share, ' +
    'a SharePoint page. Cite it instead: the gate counts it as filed, but nothing is copied and there is no hash to verify it against later.'));
  const lkF = el('div', 'filters');
  lkF.innerHTML = '<label>Project</label><select id="lkProj" style="min-width:150px"></select>' +
    '<label>Step</label><input id="lkStep" list="stepList" style="min-width:130px" placeholder="— pick step —">' +
    '<datalist id="stepList"></datalist>' +
    '<label>Document</label><input id="lkDoc" list="docList" style="min-width:180px" placeholder="— pick document type —">' +
    '<datalist id="docList"></datalist>' +
    '<input id="lkUrl" style="min-width:290px" placeholder="\\\\wvn-fs01\\DESIGN\\... or https://...">' +
    '<button id="lkGo" class="primary">Cite link</button>' +
    '<div id="lkStepWarn" class="note" style="color:var(--warn);display:none"></div>';
  lk.appendChild(lkF);
  fiBody.appendChild(lk);
  fi.appendChild(fiBody); root.appendChild(fi);

  /* No re-entry guard is needed here, and one would be actively harmful: the
     two handlers below only ever assign .value programmatically, and that does
     not fire onchange in any browser, so doc→step→doc cannot loop. A flag set
     around the call would just short-circuit the call itself. */
  const fillLinkPickers = (keepDoc) => {
    if (!keepDoc) {
      const curProj = $('#lkProj', lkF).value;
      $('#lkProj', lkF).innerHTML = TRK.lb_projects.map(r => '<option>' + esc(r.project_id) + '</option>').join('') ||
        '<option value="">register a project first</option>';
      if (curProj && $$('option', $('#lkProj', lkF)).some(o => o.value === curProj)) $('#lkProj', lkF).value = curProj;
    }
    const p = projById($('#lkProj', lkF).value);
    const doc = normaliseDoctypeInput($('#lkDoc', lkF).value);
    // The document list is only narrowed once a step is chosen; until then every
    // doctype is a legitimate suggestion, so seed it with the full catalogue.
    // Leaving it empty would present a combobox that suggests nothing at all.
    const stepNow = resolveStepInput($('#lkStep', lkF).value, p);
    $('#docList', lkF).innerHTML = docDatalistOptionsForStep(p, stepNow);
    // step: save current value, rebuild datalist, restore if still a valid option
    const curStepVal = $('#lkStep', lkF).value;
    $('#stepList', lkF).innerHTML = stepDatalistOptions(p, doc);
    if (curStepVal && $$('option', $('#stepList', lkF)).some(o => o.value === curStepVal)) {
      $('#lkStep', lkF).value = curStepVal;
    }
    if (!doc) return; // blank initial state — do not guess
    const best = p ? bestStepForDoc(p, doc) : null;
    if (best && !$('#lkStep', lkF).value.trim()) {
      const label = best.step.step_id + ' — ' + best.step.step_name;
      $('#lkStep', lkF).value = label;
    }
  };
  fillLinkPickers();
  $('#lkProj', lkF).onchange = () => fillLinkPickers(false);

  // step chosen first → reorder document datalist (Task 4c)
  $('#lkStep', lkF).onchange = () => {
    const p = projById($('#lkProj', lkF).value);
    const raw = $('#lkStep', lkF).value.trim();
    const stepId = resolveStepInput(raw, p);
    if (stepId == null) {
      // Strict resolution failed. Leave whatever the user typed on screen so
      // they can correct it, but say plainly that it will not be accepted.
      // A cleared box is not an error — it is just back to the initial state.
      $('#lkStepWarn', lkF).style.display = raw ? '' : 'none';
      if (raw) $('#lkStepWarn', lkF).textContent = 'Step "' + raw + '" not recognised — pick one from the list.';
      return;
    }
    $('#lkStepWarn', lkF).style.display = 'none';
    const curDocVal = $('#lkDoc', lkF).value;
    $('#docList', lkF).innerHTML = docDatalistOptionsForStep(p, stepId);
    if (curDocVal) $('#lkDoc', lkF).value = curDocVal;
  };

  // doc chosen first → auto-select step (existing behaviour, kept)
  $('#lkDoc', lkF).onchange = () => fillLinkPickers(true);

  $('#lkGo', lkF).onclick = async () => {
    const who = requireName(); if (!who) return;
    const p = projById($('#lkProj', lkF).value);
    const url = $('#lkUrl', lkF).value.trim();
    if (!p) { alert('Register a project first.'); return; }
    if (!url) { alert('Paste the UNC path or URL.'); return; }
    const stepId = resolveStepInput($('#lkStep', lkF).value, p);
    const doc = normaliseDoctypeInput($('#lkDoc', lkF).value);
    if (!doc) { alert('Pick a document type first — blank is not valid here.'); return; }
    if (stepId == null) { alert('Pick a valid step first — the typed value was not recognised.'); return; }
    const step = stepsOf(p.process, p).find(s => s.step_id === stepId);
    await API.action('lb_deliverables', {
      project_id: p.project_id, step_key: stepKeyOf(p.process, step), doc_code: doc,
      file_name: url.split(/[\\/]/).pop() || url, file_path: url, link_url: url, kind: 'link',
      sha256: '', status: 'Cited', approved: 'NO', suspect_template: 'NO',
      uploaded_by: who, uploaded_utc: new Date().toISOString(), notes: 'cited in place, not copied into the vault'
    }, { audit: { user: who, action: 'Cite_Link', projectId: p.project_id, objType: 'Deliverable', objId: doc, from: '', to: 'Cited', detail: url } });
    $('#lkUrl', lkF).value = '';
    await redrawAfterWrite();
  };

  dz.onclick = () => fin.click();
  dz.ondragover = e => { e.preventDefault(); dz.style.borderColor = 'var(--blue)'; };
  dz.ondragleave = () => dz.style.borderColor = '';
  dz.ondrop = e => { e.preventDefault(); dz.style.borderColor = ''; if (e.dataTransfer.files.length) pick([...e.dataTransfer.files]); };
  fin.onchange = () => { if (fin.files.length) pick([...fin.files]); };

  /* Batch confirm table: one row per dropped file, each pre-filled by guessing
     from the filename, each individually overridable. Nothing is uploaded
     until File all is clicked. */
  function pick(files) {
    if (!TRK.lb_projects.length) { alert('Register a project first.'); return; }
    const projOpts = TRK.lb_projects.map(r => '<option value="' + esc(r.project_id) + '">' + esc(r.project_id) +
      (r.prod_family ? ' — ' + esc((familyById(r.prod_family) || {}).prod_family_name || r.prod_family) : '') + '</option>').join('');
    // combobox format: value shown to user is "DOCTYPE_ID — Name", normalised at read time
    const docDlOpts = CFG.document_types.map(d => '<option value="' + esc(d.doctype_id) + ' — ' + esc(d.name) + '">').join('');

    form.className = '';
    form.innerHTML = '<h3>Confirm before filing — ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '</h3>' +
      '<div class="filters">' +
      '<label>Project (all)</label><select id="bProj">' + projOpts + '</select>' +
      '<label>WVN code</label><input id="bWvn" style="width:100px" placeholder="1010523">' +
      '<label>WNB code</label><input id="bWnb" style="width:100px" placeholder="3025015">' +
      '<label>Part ID</label><input id="bPart" style="width:90px">' +
      '</div>' +
      '<p class="note">Document type and step are guessed from each filename — check them. ' +
      'The WVN and WNB codes apply to every file in this batch and feed the standardised name.</p>' +
      '<div class="scroll"><table><thead><tr><th>Dropped file</th><th>Document type</th><th>Step</th>' +
      '<th>Description</th><th>Will be saved as</th><th>Skip</th></tr></thead><tbody id="bRows"></tbody></table></div>' +
      '<button id="bGo" class="primary" style="margin-top:8px">File all</button> ' +
      '<button id="bCancel" style="margin-top:8px">Cancel</button>' +
      '<div id="bLog" class="note"></div>';

    const rowsHost = $('#bRows', form);
    /* An unconfident guess is discarded outright rather than carried in state.
       Blanking only the visible input would leave st.doc holding the guess, and
       the pre-flight check below would wave the row through with a document the
       user never saw, let alone chose — the exact failure Task 4b exists to
       prevent. Blank state and a blank box are the same fact. */
    const state = files.map((f, i) => {
      const guess = guessFromName(f.name);
      return {
        file: f, idx: i, desc: guess.desc, skip: false, confident: guess.confident,
        doc: guess.confident ? guess.doc : '', step: guess.confident ? guess.step : null
      };
    });

    /* Rows are redrawn whenever Skip or the project changes, so every draw
       repopulates the inputs from `state` — which onchange keeps current. Reading
       the old DOM values back instead would lose anything typed into a row the
       filename guesser was unsure about. */
    const drawRows = () => {
      const p = projById($('#bProj', form).value);
      rowsHost.innerHTML = '';
      state.forEach(st => {
        const tr = el('tr');
        if (st.skip) tr.style.opacity = '.45';
        tr.innerHTML =
          '<td><code>' + esc(st.file.name) + '</code><div class="note">' + Math.round(st.file.size / 1024) + ' KB' +
            (st.confident ? '' : ' · <b>guess uncertain</b>') + '</div></td>' +
          '<td><input list="docList' + st.idx + '" data-k="doc" data-i="' + st.idx + '" style="max-width:210px" placeholder="— pick —">' +
            '<datalist id="docList' + st.idx + '">' + docDlOpts + '</datalist></td>' +
          '<td><input list="stepList' + st.idx + '" data-k="step" data-i="' + st.idx + '" style="max-width:230px" placeholder="— pick —">' +
            '<datalist id="stepList' + st.idx + '"></datalist>' +
            '<div class="note" data-why="' + st.idx + '"></div></td>' +
          '<td><input data-k="desc" data-i="' + st.idx + '" style="width:150px" value="' + esc(st.desc) + '"></td>' +
          '<td class="note" data-name="' + st.idx + '">…</td>' +
          '<td><input type="checkbox" data-k="skip" data-i="' + st.idx + '"' + (st.skip ? ' checked' : '') + '></td>';
        rowsHost.appendChild(tr);
        const ds = tr.querySelector('[data-k="doc"]');
        if (ds && st.doc) {
          // Only a doctype that is really in the catalogue gets the "ID — Name"
          // label. docTypeById() invents {doctype_id: id, name: id} for unknown
          // codes, so labelling one of those would echo the user's own text back
          // twice — "CP — Control Plan — CP — Control Plan" — and grow on every
          // redraw. A free-typed code is shown exactly as typed.
          const d = CFG.document_types.find(x => x.doctype_id === st.doc);
          ds.value = d ? (d.doctype_id + ' — ' + d.name) : st.doc;
        }
        syncStepSelect(tr, st, p, false);
      });
      rowsHost.querySelectorAll('[data-k]').forEach(node => {
        node.onchange = async () => {
          const st = state[Number(node.dataset.i)];
          if (node.dataset.k === 'skip') { st.skip = node.checked; drawRows(); return; }
          if (node.dataset.k === 'doc') {
            st.doc = normaliseDoctypeInput(node.value);
            syncStepSelect(node.closest('tr'), st, projById($('#bProj', form).value), true);
            await previewNames();
            return;
          }
          if (node.dataset.k === 'step') {
            const p2 = projById($('#bProj', form).value);
            const why = rowsHost.querySelector('[data-why="' + st.idx + '"]');
            const raw = node.value.trim();
            const resolved = resolveStepInput(raw, p2);
            // A cleared box means "no step", and state has to agree with what is
            // on screen — otherwise the pre-flight check sees a step the user
            // has visibly removed. Unrecognised text keeps the last good value
            // but says so, rather than silently filing against the wrong step.
            if (!raw) { st.step = null; }
            else if (resolved != null) { st.step = resolved; }
            else if (why) {
              why.innerHTML = '<span style="color:var(--warn)">step "' + esc(raw) + '" not recognised — pick one from the list</span>';
            }
          } else {
            st[node.dataset.k] = node.value;
          }
          await previewNames();
        };
      });
      previewNames();
    };

    function syncStepSelect(tr, st, p, reselect) {
      const ss = tr.querySelector('[data-k="step"]');
      const why = tr.querySelector('[data-why="' + st.idx + '"]');
      if (!ss || !p) return;
      // fill the step datalist
      const dlId = ss.getAttribute('list');
      const dl = dlId ? $('#' + dlId, form) : null;
      if (dl) dl.innerHTML = stepDatalistOptions(p, st.doc);
      const best = bestStepForDoc(p, st.doc);
      if (reselect || st.step == null) { if (best) st.step = best.step.step_id; }
      // Label from the project's own step list, not from `best` — a step the
      // user picked themselves is usually NOT the suggested one, and falling
      // back to a bare "3" makes the box look half-filled.
      if (st.step == null) { ss.value = ''; }
      else {
        const cur = stepsOf(p.process, p).find(s => s.step_id === st.step);
        ss.value = cur ? (cur.step_id + ' — ' + cur.step_name) : String(st.step);
      }
      if (why) {
        if (!best) why.innerHTML = '<span style="color:var(--warn)">no step lists this document — pick one</span>';
        else if (Number(st.step) === best.step.step_id) why.textContent = best.why;
        else why.innerHTML = 'suggested: step ' + best.step.step_id + ' (' + esc(best.why) + ')';
      }
    }

    /* the server owns the naming convention, so ask it rather than
       reimplementing the rules here and letting the two drift apart */
    const previewNames = async () => {
      const p = projById($('#bProj', form).value);
      for (const st of state) {
        const cell = rowsHost.querySelector('[data-name="' + st.idx + '"]');
        if (!cell) continue;
        if (st.skip) { cell.textContent = '—'; continue; }
        try {
          const r = await API.previewName({
            docType: st.doc, family: p ? p.family : '', wvnId: $('#bWvn', form).value.trim(),
            wnbId: $('#bWnb', form).value.trim(), description: st.desc, fileName: st.file.name
          });
          cell.innerHTML = '<code>' + esc(r.fileName) + '</code>';
        } catch (e) { cell.textContent = st.file.name; }
      }
    };

    $('#bProj', form).onchange = drawRows;
    $('#bWvn', form).onchange = previewNames;
    $('#bWnb', form).onchange = previewNames;
    drawRows();

    $('#bCancel', form).onclick = () => { form.className = 'hide'; form.innerHTML = ''; fin.value = ''; };
    $('#bGo', form).onclick = async () => {
      const who = requireName(); if (!who) return;
      const p = projById($('#bProj', form).value);
      if (!p) { alert('Pick a registered project.'); return; }
      // Nothing is filed until every row it would file has both a document type
      // and a step. st.doc is already a normalised doctype_id by this point —
      // set at construction or through onchange — so a plain emptiness test is
      // the whole check. Name the files, or the user has to hunt for the gap.
      const missing = state.filter(s => !s.skip && (!s.doc || s.step == null));
      if (missing.length) {
        alert('Set a document type and step for these ' + missing.length + ' file(s) first — or tick Skip:\n\n' +
          missing.map(s => '  · ' + s.file.name).join('\n'));
        return;
      }
      const btn = $('#bGo', form); btn.disabled = true;
      const log = $('#bLog', form);
      const todo = state.filter(s => !s.skip);
      let ok = 0, dup = 0, bad = 0;
      for (const st of todo) {
        btn.textContent = 'Filing ' + (ok + dup + bad + 1) + ' of ' + todo.length + '…';
        try {
          const step = stepsOf(p.process, p).find(s => s.step_id === Number(st.step));
          const b64 = await new Promise((resolve, reject) => {
            const rd = new FileReader();
            rd.onload = () => resolve(rd.result.split(',')[1]);
            rd.onerror = reject;
            rd.readAsDataURL(st.file);
          });
          const up = await API.upload({
            docType: st.doc, family: p.family, partId: $('#bPart', form).value.trim(),
            wvnId: $('#bWvn', form).value.trim(), wnbId: $('#bWnb', form).value.trim(), description: st.desc,
            fileName: st.file.name, contentBase64: b64
          });
          await API.action('lb_deliverables', {
            project_id: p.project_id, step_key: stepKeyOf(p.process, step), doc_code: st.doc,
            file_name: up.fileName, file_path: up.path, sha256: up.sha256,
            status: up.duplicate ? 'Already filed' : 'Filed', approved: 'NO', suspect_template: 'NO',
            uploaded_by: who, uploaded_utc: new Date().toISOString(),
            notes: up.duplicate ? 'byte-identical file already present, no copy written' : '',
            kind: 'file', original_name: up.originalName || st.file.name,
            wvn_id: $('#bWvn', form).value.trim(), wnb_id: $('#bWnb', form).value.trim(), description: st.desc, link_url: ''
          }, { audit: { user: who, action: 'File_Evidence', projectId: p.project_id, objType: 'Deliverable', objId: up.fileName, from: st.file.name, to: up.duplicate ? 'Already filed' : 'Filed', detail: up.path } });
          if (up.duplicate) dup++; else ok++;
        } catch (e) {
          bad++;
          log.innerHTML += '<br><b style="color:var(--bad)">' + esc(st.file.name) + '</b>: ' + esc(e.message);
        }
      }
      btn.textContent = 'File all';
      alert(ok + ' filed, ' + dup + ' already present, ' + bad + ' failed.');
      if (!bad) { form.className = 'hide'; form.innerHTML = ''; fin.value = ''; }
      else { btn.disabled = false; }
      await redrawAfterWrite();
    };
  }


}

/* ===================================================================== */
/* SHARED — project picker + step cards                                  */
/* ===================================================================== */
let justPickedTree = false;
let dashMatrixOpen = true;
let dashFamFilter = [];
let dashModelFilter = [];
let dashStartWeekFilter = [];
let dashEndWeekFilter = [];

// Multi-select popover singleton — only one popover open at a time
var _msOpenPopover = null;
(function() {
  document.addEventListener('click', function(e) {
    if (_msOpenPopover && !_msOpenPopover.wrapper.contains(e.target)) {
      _msCommitAndClose(_msOpenPopover);
    }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _msOpenPopover) {
      _msCommitAndClose(_msOpenPopover);
      if (_msOpenPopover && _msOpenPopover.trigger) _msOpenPopover.trigger.focus();
    }
  });
})();
function _msCommitAndClose(ms) {
  if (!ms || !ms.popover) return;
  ms.popover.style.display = 'none';
  var changed = false;
  if (ms.value.length !== ms.selected.length) changed = true;
  else {
    var a = ms.value.slice().sort(), b = ms.selected.slice().sort();
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { changed = true; break; } }
  }
  if (changed) {
    ms.value.length = 0;
    Array.prototype.push.apply(ms.value, ms.selected);
    if (ms.onChange) ms.onChange();
  }
  _msOpenPopover = null;
}

function createMultiSelect(cfg) {
  // cfg: { label, options: [{value,label}], value: [], placeholder, onChange }
  var wrapper = el('div', 'ms-wrapper');
  wrapper.style.position = 'relative';

  var ms = {
    wrapper: wrapper,
    value: cfg.value,
    selected: cfg.value.slice(),
    options: cfg.options,
    onChange: cfg.onChange,
    trigger: null,
    popover: null
  };

  // Label
  var lbl = el('span', 'ms-label');
  lbl.textContent = cfg.label;
  wrapper.appendChild(lbl);

  // Trigger button
  var trigger = el('button', 'ms-trigger');
  trigger.type = 'button';
  ms.trigger = trigger;

  function updateTriggerText() {
    if (ms.selected.length === 0) {
      trigger.textContent = cfg.placeholder;
    } else if (ms.selected.length === 1) {
      var found = cfg.options.find(function(o) { return o.value === ms.selected[0]; });
      trigger.textContent = found ? found.label : ms.selected[0];
    } else {
      trigger.textContent = ms.selected.length + ' selected';
    }
  }
  updateTriggerText();
  wrapper.appendChild(trigger);

  // Popover
  var popover = el('div', 'ms-popover');
  popover.style.display = 'none';
  ms.popover = popover;

  // Search input
  var searchInput = el('input', 'ms-search');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search...';
  popover.appendChild(searchInput);

  // Select All row
  var selectAllRow = el('label', 'ms-option ms-option-all');
  var selectAllCB = el('input');
  selectAllCB.type = 'checkbox';
  selectAllRow.appendChild(selectAllCB);
  selectAllRow.appendChild(document.createTextNode(' Select All'));
  popover.appendChild(selectAllRow);

  // Options list container
  var optionsList = el('div', 'ms-options-list');
  popover.appendChild(optionsList);

  function updateSelectAll() {
    var all = cfg.options.length > 0 && ms.selected.length === cfg.options.length;
    var some = ms.selected.length > 0 && ms.selected.length < cfg.options.length;
    selectAllCB.checked = all;
    selectAllCB.indeterminate = some;
  }

  function rebuildOptionRows() {
    var q = searchInput.value.toLowerCase().trim();
    optionsList.innerHTML = '';
    cfg.options.forEach(function(opt) {
      if (q && opt.label.toLowerCase().indexOf(q) === -1) return;
      var row = el('label', 'ms-option');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.value = opt.value;
      cb.checked = ms.selected.indexOf(opt.value) !== -1;
      cb.addEventListener('change', function() {
        if (cb.checked) {
          if (ms.selected.indexOf(opt.value) === -1) ms.selected.push(opt.value);
        } else {
          var idx = ms.selected.indexOf(opt.value);
          if (idx !== -1) ms.selected.splice(idx, 1);
        }
        updateSelectAll();
        updateTriggerText();
      });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(' ' + opt.label));
      optionsList.appendChild(row);
    });
  }

  searchInput.addEventListener('input', function() { rebuildOptionRows(); });

  selectAllCB.addEventListener('change', function() {
    if (selectAllCB.checked) {
      ms.selected = cfg.options.map(function(o) { return o.value; });
    } else {
      ms.selected = [];
    }
    updateTriggerText();
    rebuildOptionRows();
  });

  function open() {
    // Discard any other open popover without committing (committing would
    // trigger renderAll which tears down this element's DOM).
    if (_msOpenPopover && _msOpenPopover !== ms) {
      _msOpenPopover.popover.style.display = 'none';
      _msOpenPopover = null;
    }
    // Re-sync selected from current external value
    ms.selected = cfg.value.slice();
    ms.options = cfg.options;
    updateTriggerText();
    updateSelectAll();
    searchInput.value = '';
    rebuildOptionRows();
    popover.style.display = 'flex';
    _msOpenPopover = ms;
    setTimeout(function() { searchInput.focus(); }, 50);
  }

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    if (popover.style.display === 'flex') {
      _msCommitAndClose(ms);
    } else {
      open();
    }
  });

  // Prevent popover clicks from bubbling to document close handler
  popover.addEventListener('click', function(e) { e.stopPropagation(); });

  wrapper.appendChild(popover);
  return wrapper;
}
// last batch-import summary, so it survives the redraw a successful import triggers
let lastBatchResult = null;
let npiSel = null, ecnSel = null, ecnMode = 'steps';
let npiTreeState = { q: '', familyFilter: [], statusFilter: '', weekFilter: '', expanded: {}, selected: new Set(), active: null };
let ecnTreeState = { q: '', familyFilter: [], statusFilter: '', weekFilter: '', expanded: {}, selected: new Set(), active: null };
function familyFgTree(root, proc, state, onPick) {
  const list = projectsOf(proc);
  const p = el('div', 'card');
  const pHdr = el('div', 'card-header'); pHdr.appendChild(el('h3', 'card-title', proc + ' projects')); p.appendChild(pHdr);
  const pBody = el('div', 'card-body');
  if (!list.length) { pBody.appendChild(el('p', 'note', 'No ' + proc + ' project registered yet — use the Input tab.')); p.appendChild(pBody); root.appendChild(p); return null; }

  /* Canonical grouping/filter key. familyById() already resolves case drift and
     stale sample-FG values (v2.5), but that normalisation only ever ran on
     hand-typed input at registration time — rows written by the legacy-Excel
     importer never passed through it, so `project.prod_family` on those can be
     a value no current product family matches. Without this, each such value
     spawns its own single-project "family" header instead of collapsing into
     one Unassigned bucket alongside the genuinely-blank rows. */
  const famKeyOf = x => { const f = familyById(x.prod_family); return f ? f.prod_family_id : '__unassigned__'; };

  let debounceTimer = null;

  /* ---- filters row (built once; the tree below it redraws on every change) -- */
  const fRow = el('div', 'filters');

  const searchInp = el('input');
  searchInp.type = 'text'; searchInp.placeholder = 'Search project ID, family, owner…';
  searchInp.style.minWidth = '240px';
  searchInp.value = state.q;
  searchInp.oninput = () => {
    state.q = searchInp.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderTree, 150);
  };
  fRow.appendChild(searchInp);

  // Family pill buttons — same visual as certPicker() so every toggle row
  // in the app reads the same way regardless of whether it is certs or families.
  const famPicks = el('div', 'certpick');
  famPicks.style.marginTop = '0';
  const seenFams = new Set(); list.forEach(x => { const k = famKeyOf(x); if (k !== '__unassigned__') seenFams.add(k); });
  [...seenFams].sort().forEach(famId => {
    const fam = familyById(famId);
    const b = el('button', state.familyFilter.indexOf(famId) >= 0 ? 'on' : '', famId);
    b.type = 'button'; b.dataset.fam = famId;
    b.title = fam ? fam.prod_family_name + (fam.description ? ' — ' + fam.description : '') : famId;
    b.onclick = () => {
      const i = state.familyFilter.indexOf(famId);
      if (i >= 0) state.familyFilter.splice(i, 1); else state.familyFilter.push(famId);
      renderTree();
    };
    famPicks.appendChild(b);
  });
  fRow.appendChild(famPicks);

  const statSel = el('select');
  statSel.innerHTML = '<option value="">(all statuses)</option>' +
    '<option value="NOT_STARTED"' + (state.statusFilter === 'NOT_STARTED' ? ' selected' : '') + '>Not started</option>' +
    '<option value="IN_PROGRESS"' + (state.statusFilter === 'IN_PROGRESS' ? ' selected' : '') + '>In progress</option>' +
    '<option value="COMPLETE"' + (state.statusFilter === 'COMPLETE' ? ' selected' : '') + '>Complete</option>' +
    '<option value="LATE"' + (state.statusFilter === 'LATE' ? ' selected' : '') + '>Late</option>';
  statSel.onchange = () => { state.statusFilter = statSel.value; renderTree(); };
  fRow.appendChild(statSel);

  // Week filter — shows only projects whose target week matches
  const weekSel = el('select');
  const allWeeks = new Set();
  list.forEach(function(p) { var w = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date); if (w) allWeeks.add(w); });
  var sortedWeeks = [...allWeeks].sort();
  weekSel.innerHTML = '<option value="">(all weeks)</option>' +
    sortedWeeks.map(function(w) { return '<option value="' + w + '"' + (state.weekFilter === w ? ' selected' : '') + '>' + weekRangeLabel(w) + '</option>'; }).join('');
  weekSel.style.minWidth = '200px';
  weekSel.onchange = function() { state.weekFilter = weekSel.value; renderTree(); };
  fRow.appendChild(weekSel);
  pBody.appendChild(fRow);

  /* ---- flat project list (redrawn on every filter change) -- */
  function renderTree() {
    // Sync family pill button classes
    $$('button', famPicks).forEach(b => {
      b.className = state.familyFilter.indexOf(b.dataset.fam) >= 0 ? 'on' : '';
    });

    const existing = p.querySelector('.ftree');
    if (existing) existing.remove();
    const tree = el('div', 'ftree');

    // Filter projects
    const q = state.q.toLowerCase();
    let filtered = list;
    if (q) {
      filtered = filtered.filter(x => {
        if ((x.project_id || '').toLowerCase().indexOf(q) >= 0) return true;
        if ((x.prod_family || '').toLowerCase().indexOf(q) >= 0) return true;
        const fam = familyById(x.prod_family) || {};
        if ((fam.prod_family_name || '').toLowerCase().indexOf(q) >= 0) return true;
        if ((x.market_manager || '').toLowerCase().indexOf(q) >= 0) return true;
        return false;
      });
    }
    if (state.familyFilter.length) {
      filtered = filtered.filter(x => state.familyFilter.indexOf(famKeyOf(x)) >= 0);
    }
    if (state.statusFilter) {
      filtered = filtered.filter(x => classifyProject(x) === state.statusFilter);
    }
    if (state.weekFilter) {
      filtered = filtered.filter(function(x) {
        var w = toWeek(x.target_date) || targetDateFor(x.class_abcde, x.prf_date);
        return w === state.weekFilter;
      });
    }

    if (!filtered.length) {
      tree.appendChild(el('p', 'note', 'No project matches the current filters.'));
    }

    // Flat list — no family group headers, no expand/collapse
    filtered.forEach(x => {
      const pr = progressOf(x);
      const ct = changeTypeById(x.class_abcde);
      const cs = certsOf(x);
      const status = classifyProject(x);

      const isActive = state.selected.has(x.project_id) && state.active === x.project_id;
      const isMulti = state.selected.has(x.project_id) && !isActive;

      let cls = 'pcard';
      if (isActive) cls += ' on';
      else if (isMulti) cls += ' multi';

      const chipStatus = status === 'LATE' ? 'AT_RISK' : status;
      const chipLabel = status === 'LATE' ? 'Late' : status.replace(/_/g, ' ');

      const c = el('div', cls);
      c.innerHTML = '<b>' + esc(x.project_id) + '</b>' +
        '<div style="margin-top:5px"><span class="bar"><i style="width:' + pr.pct + '%"></i></span> ' + pr.done + '/' + pr.total + ' gates</div>' +
        '<div class="note">' + esc(x.market_manager || 'no owner') + (ct ? ' · type ' + esc(ct.type_id) + ' ' + esc(ct.name) : ' · no type') +
        (x.target_date ? ' · target ' + esc(toWeek(x.target_date)) : '') + '</div>' +
        '<div><span class="' + badgeClass(chipStatus) + '">' + chipLabel + '</span></div>' +
        (cs.length ? '<div style="margin-top:4px">' + certChips(cs) + '</div>' : '');

      c.onclick = e => {
        if (e.ctrlKey || e.metaKey) {
          if (state.selected.has(x.project_id)) {
            state.selected.delete(x.project_id);
            if (state.active === x.project_id) {
              state.active = state.selected.size ? [...state.selected][0] : null;
            }
          } else {
            state.selected.add(x.project_id);
            state.active = x.project_id;
          }
          onPick(state.active, true);
        } else {
          state.selected = new Set([x.project_id]);
          state.active = x.project_id;
          onPick(x.project_id, false);
        }
      };
      tree.appendChild(c);
    });

    pBody.appendChild(tree);
  }

  // Auto-select the first project when nothing is selected yet (initial render)
  if (!state.active && list.length) {
    state.active = list[0].project_id;
    state.selected = new Set([list[0].project_id]);
  }

  renderTree();
  p.appendChild(pBody); root.appendChild(p);

  return state.active ? list.find(x => x.project_id === state.active) : null;
}

/* Clipboard: the modern API needs a secure context, and http://localhost counts
   on Chrome/Edge but not everywhere — fall back to the old selection trick so
   Copy path works on whatever browser is actually on the shop-floor PC. */
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { }
  try {
    const ta = document.createElement('textarea');
    ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}
function commentsFor(pid, delId) {
  return (TRK.lb_doc_comments || []).filter(c => c.project_id === pid && c.deliverable_id === delId);
}
function cellNoteCount(project, stepKey) {
  if (!TRK.lb_doc_comments || !TRK.lb_doc_comments.length) return 0;
  const dels = (TRK.lb_deliverables || []).filter(d => d.project_id === project.project_id && d.step_key === stepKey);
  let count = 0;
  dels.forEach(d => { count += commentsFor(project.project_id, d.deliverable_id).length; });
  return count;
}

function evidenceTable(g, project, step, redraw) {
  const t = el('table');
  t.innerHTML = '<thead><tr><th>Document</th><th>Need</th><th>Evidence</th><th>Filed by</th><th>Actions</th></tr></thead>';
  const tb = el('tbody');
  const row = (x, required) => {
    const tr = el('tr');
    // a missing conditional document is a blank, not a red flag
    const level = (!required && x.ev.level === 'MISSING') ? 'NONE' : x.ev.level;
    const label = x.ev.level === 'REMOVED' ? 'Removed' : ((!required && x.ev.level === 'MISSING') ? 'not filed' : x.ev.level);
    const d = x.ev.del;
    const isRemoved = x.ev.level === 'REMOVED';
    const isLink = d && d.kind === 'link';
    const badgeStyle = isRemoved ? ' style="text-decoration:line-through;opacity:0.7"' : '';
    tr.innerHTML = '<td><a class="doc-link" style="cursor:pointer;font-weight:600;color:var(--blue)" title="Inspect ' + esc(x.doc.name) + '">' + esc(x.doc.name) + '</a>' + (x.doc.form_code ? ' <span class="note">(' + esc(x.doc.form_code) + ')</span>' : '') + (x.custom ? ' <span class="note custom-mark">(model custom)</span>' : '') + '</td>' +
      '<td>' + (required ? '<b>required</b>' : '<span class="note">if applicable</span>') + '</td>' +
      '<td><span class="' + badgeClass(level) + '"' + badgeStyle + '>' + label + '</span>' + (isLink ? ' <span class="note">cited</span>' : '') + '</td>' +
      '<td class="note">' + (d && !isRemoved ? esc(d.uploaded_by) + '<br>' + esc(d.file_name) : '') + '</td><td></td>';
    const docLink = tr.querySelector('.doc-link');
    if (docLink) docLink.onclick = () => openDrawerForDoc(project, step, x.code);
    const act = tr.lastChild;
    // Remove / Restore control
    var rmBtn = el('button', '', isRemoved ? 'Restore' : 'Remove');
    if (isRemoved) rmBtn.style.color = 'var(--good)'; else rmBtn.style.color = 'var(--bad)';
    rmBtn.onclick = async function() {
      var who = requireName(); if (!who) return;
      var sk = stepKeyOf(project.process, step);
      if (isRemoved) {
        confirmModal('Restore ' + esc(x.code),
          'Return ' + esc(x.doc.name) + ' to its normal state — it will count toward completion again.',
          'Restore', async function() {
            var rowData = { project_id: project.project_id, step_key: sk, doc_code: x.code, status: '' };
            if (d && d.deliverable_id) rowData.deliverable_id = d.deliverable_id;
            var keys = (d && d.deliverable_id) ? ['deliverable_id'] : ['project_id','step_key','doc_code'];
            await API.action('lb_deliverables', rowData, { upsertKeys: keys, audit: { user: who, action: 'Restore_Document', projectId: project.project_id, objType: 'Deliverable', objId: x.code, from: 'Removed', to: 'Restored', detail: x.doc.name } });
            await redraw();
          });
      } else {
        confirmModal('Remove ' + esc(x.code),
          'Mark <b>' + esc(x.doc.name) + '</b> as not applicable. The requirement will be excluded from completion counts (soft delete).',
          'Remove', async function() {
            var rowData = { project_id: project.project_id, step_key: sk, doc_code: x.code, status: 'Removed', uploaded_by: who, uploaded_utc: new Date().toISOString() };
            if (d && d.deliverable_id) rowData.deliverable_id = d.deliverable_id;
            var keys = (d && d.deliverable_id) ? ['deliverable_id'] : ['project_id','step_key','doc_code'];
            await API.action('lb_deliverables', rowData, { upsertKeys: keys, audit: { user: who, action: 'Remove_Document', projectId: project.project_id, objType: 'Deliverable', objId: x.code, from: x.ev.level, to: 'Removed', detail: x.doc.name } });
            await redraw();
          });
      }
    };
    act.appendChild(rmBtn);
    if (d && !isRemoved) {
      const path = d.link_url || d.file_path || '';
      const cp = el('button', '', 'Copy path');
      cp.title = path;
      cp.onclick = async () => {
        const ok = await copyText(path);
        cp.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => { cp.textContent = 'Copy path'; }, 1500);
      };
      act.appendChild(cp);

      const notes = commentsFor(project.project_id, d.deliverable_id);
      const noteWrap = el('div');

      const cb = el('button', 'sm', 'Notes (' + notes.length + ')');
      cb.onclick = () => {
        const existing = noteWrap.querySelector('.comment-thread');
        if (existing) { existing.remove(); cb.textContent = 'Notes (' + notes.length + ')'; return; }

        const thread = el('div', 'comment-thread');

        if (notes.length) {
          notes.forEach(c => {
            const ci = el('div', 'comment-item');
            ci.innerHTML = '<b>' + esc(c.author) + '</b> <span class="note">' + esc((c.created_utc || '').slice(0, 10)) + '</span><br>' + esc(c.comment);
            thread.appendChild(ci);
          });
        } else {
          thread.appendChild(el('p', 'note', 'No notes on this document yet.'));
        }

        const addWrap = el('div', 'comment-add');
        const inp = el('input');
        inp.placeholder = 'Add a note…';
        const save = el('button', 'sm primary', 'Save');
        save.onclick = async () => {
          const txt = inp.value.trim();
          if (!txt) return;
          const who = requireName() || '(unnamed)';
          save.disabled = true; save.textContent = 'Saving…';
          try {
            await API.action('lb_doc_comments', {
              project_id: project.project_id, deliverable_id: d.deliverable_id, doc_code: d.doc_code,
              step_key: d.step_key, author: who, comment: txt, created_utc: new Date().toISOString()
            }, { audit: { user: who, action: 'Comment_Document', projectId: project.project_id, objType: 'Deliverable', objId: d.deliverable_id, from: '', to: '', detail: txt.slice(0, 120) } });
            const ci = el('div', 'comment-item');
            ci.innerHTML = '<b>' + esc(who) + '</b> <span class="note">' + esc(new Date().toISOString().slice(0, 10)) + '</span><br>' + esc(txt);
            thread.insertBefore(ci, addWrap);
            inp.value = '';
            notes.push({ author: who, created_utc: new Date().toISOString(), comment: txt });
            cb.textContent = 'Notes (' + notes.length + ')';
          } catch (e) {
            alert('Could not save the note: ' + e.message);
          }
          save.disabled = false; save.textContent = 'Save';
        };
        addWrap.appendChild(inp);
        addWrap.appendChild(save);
        thread.appendChild(addWrap);
        noteWrap.appendChild(thread);
        cb.textContent = 'Notes (' + notes.length + ') ▲';
      };
      act.appendChild(cb);
      act.appendChild(noteWrap);
    }
    tb.appendChild(tr);
  };
  g.ev.forEach(x => row(x, true));
  (g.cond || []).forEach(x => row(x, false));
  t.appendChild(tb); return t;
}

function gateActions(project, proc, step, g, redraw) {
  const wrap = el('div', 'filters'); wrap.style.marginTop = '8px';
  const sk = g.sk;
  if (g.gated) {
    if (!g.approval) {
      const ap = el('button', g.canApprove ? 'primary' : '', 'Approve step ' + step.step_id);
      ap.disabled = !g.canApprove;
      ap.title = g.canApprove ? 'Sign this gate'
        : g.priorBlocks ? 'step ' + g.priorOpen.map(s => s.step_id).join(', ') + ' must close first'
        : !g.whOk ? 'warehouse clearance outstanding'
        : g.missing.length ? g.missing.length + ' required document(s) missing'
        : 'blocking issue open';
      ap.onclick = async () => {
        const who = requireName(); if (!who) return;
        const note = prompt('Comment (optional):', '') || '';
        await API.action('lb_approvals', {
          project_id: project.project_id, step_key: sk, deliverable_id: '', approved_by: who, approved_utc: new Date().toISOString(),
          approval_type: proc === 'NPI' ? 'Evidence-Based' : 'Milestone', evidence_count: g.ev.length, comments: note
        });
        await API.action('lb_gates', {
          project_id: project.project_id, process: proc, step_key: sk, step_num: step.step_id, step_name: step.step_name,
          status: 'Approved', approved_by: who, approved_utc: new Date().toISOString(),
          evidence_cited: g.ev.map(x => x.code + '=' + x.ev.level).join('; '), updated_utc: new Date().toISOString()
        }, { upsertKeys: ['project_id', 'step_key'], audit: { user: who, action: 'Approve_Gate', projectId: project.project_id, objType: 'Gate', objId: sk, from: 'Open', to: 'Approved', detail: note } });
        await redraw();
      };
      wrap.appendChild(ap);

      const by = el('button', 'danger', 'Authorise bypass…');
      by.onclick = async () => {
        const who = requireName(); if (!who) return;
        const reason = prompt('Business reason for proceeding without complete evidence:', ''); if (!reason) return;
        const mit = prompt('Risk mitigation — what happens until the evidence arrives?', ''); if (!mit) return;
        const sup = prompt('Expected supersede date (yyyy-mm-dd), optional:', '') || '';
        await API.action('lb_bypasses', {
          project_id: project.project_id, step_key: sk, authorised_by: who, authorised_utc: new Date().toISOString(),
          reason, mitigation: mit, supersede_by: sup, closed_utc: '', closed_note: ''
        }, { audit: { user: who, action: 'Authorize_Bypass', projectId: project.project_id, objType: 'Gate', objId: sk, from: 'Blocked', to: 'Bypass authorised', detail: reason } });
        await redraw();
      };
      wrap.appendChild(by);
    }
  } else {
    const row = g.gate;
    const cur = row ? row.status : 'NotStarted';
    const sel = el('select');
    ['NotStarted', 'InProgress', 'Done', 'NotApplicable'].forEach(s => { const o = el('option', null, s); o.value = s; if (s === cur) o.selected = true; sel.appendChild(o); });
    sel.onchange = async () => {
      const who = requireName() || '(unnamed)';
      await API.action('lb_gates', {
        project_id: project.project_id, process: proc, step_key: sk, step_num: step.step_id, step_name: step.step_name,
        status: sel.value, notes: 'set by ' + who, updated_utc: new Date().toISOString()
      }, { upsertKeys: ['project_id', 'step_key'], audit: { user: who, action: 'Set_Step_Status', projectId: project.project_id, objType: 'Step', objId: sk, from: cur, to: sel.value, detail: step.step_name } });
      await redraw();
    };
    wrap.appendChild(el('label', null, 'Status')); wrap.appendChild(sel);
  }
  const iss = el('button', '', 'Raise issue…');
  iss.onclick = async () => {
    const who = requireName() || '(unnamed)';
    const d = prompt('Describe the issue found at ' + sk + ':', ''); if (!d) return;
    const owner = prompt('Owner:', '') || '';
    const due = prompt('Due date (yyyy-mm-dd), optional:', '') || '';
    await API.action('lb_issues', {
      project_id: project.project_id, step_key: sk, raised_utc: new Date().toISOString(), raised_by: who, category: 'LFI',
      description: d, owner, due_date: due, status: 'Open', resolution: '', closed_utc: ''
    }, { audit: { user: who, action: 'Raise_Issue', projectId: project.project_id, objType: 'Issue', objId: sk, from: '', to: 'Open', detail: d } });
    await redraw();
  };
  wrap.appendChild(iss);
  return wrap;
}

function stepCard(project, proc, step, redraw) {
  const g = gateState(project, proc, step);
  const card = el('div', 'stepcard s-' + g.status);
  const h = el('div', 'stephead');
  h.style.cursor = 'pointer';
  h.innerHTML = '<div><b>Step ' + step.step_id + ' — ' + esc(step.step_name) + '</b>' +
    '<div class="note">' + esc(step.description || '') + ' · approver: ' + esc(step.mandatory_approver || step.responsible_dept || '') + '</div></div>' +
    '<div><span class="step-toggle-arrow">&#9660;</span> <span class="' + badgeClass(g.gated ? g.status : 'TRACK') + '">' + (g.gated ? g.status.replace(/_/g, ' ') : 'tracked') + '</span></div>';
  card.appendChild(h);

  const body = el('div', 'stepbody');

  if (g.approval) body.appendChild(el('p', 'note', 'Signed by ' + g.approval.approved_by + ' on ' + (g.approval.approved_utc || '').slice(0, 16).replace('T', ' ') + (g.approval.comments ? ' · ' + g.approval.comments : '')));
  if (g.bypass) {
    const bb = el('div', 'banner bad');
    bb.innerHTML = '<b>Bypass authorised — this step counts as complete for the steps after it.</b><br>' +
      'By ' + esc(g.bypass.authorised_by) + ' on ' + esc((g.bypass.authorised_utc || '').slice(0, 10)) +
      '<br>Reason: ' + esc(g.bypass.reason) + '<br>Mitigation: ' + esc(g.bypass.mitigation) + (g.bypass.supersede_by ? '<br>Expected superseded by ' + esc(g.bypass.supersede_by) : '');
    body.appendChild(bb);
  }
  if (g.priorBlocks) {
    const pb = el('div', 'banner warn');
    pb.innerHTML = '<b>Blocked by an earlier gate.</b> Step ' + g.priorOpen.map(s => s.step_id + ' (' + esc(s.step_name) + ')').join(', ') +
      ' must be signed or bypassed before this one can close.';
    body.appendChild(pb);
  }
  if (g.priorOpen.length && !g.done && !g.priorBlocks) {
    const sw = el('div', 'banner warn');
    sw.innerHTML = '<b>Prior Step Open</b> Step ' + g.priorOpen.map(s => s.step_id + ' (' + esc(s.step_name) + ')').join(', ') +
      ' — approval is still permitted because the user is a moderator/admin.';
    body.appendChild(sw);
  }
  if (g.needWh) {
    const w = el('div', 'banner ' + (g.whOk ? '' : 'warn'));
    w.innerHTML = '<b>Warehouse clearance ' + (g.whOk ? 'complete' : 'outstanding') + '.</b> ' + (g.whOk ? 'All areas cleared.' : 'Record clearance against this gate.');
    body.appendChild(w);
  }
  if (g.req.length || (g.cond && g.cond.length)) body.appendChild(evidenceTable(g, project, step, redraw));
  else body.appendChild(el('p', 'note', 'No mandatory document defined for this step.'));
  if (step.source_note) {
    const sn = el('p', 'note');
    sn.innerHTML = '<b>Source note:</b> ' + esc(step.source_note);
    body.appendChild(sn);
  }
  if (g.blocking.length) {
    const ib = el('div', 'banner warn');
    ib.innerHTML = '<b>' + g.blocking.length + ' open issue(s) against this step.</b> ' + g.blocking.map(i => esc(i.description) + (i.owner ? ' (' + esc(i.owner) + ')' : '')).join(' · ');
    body.appendChild(ib);
  }
  body.appendChild(gateActions(project, proc, step, g, redraw));

  h.onclick = () => {
    body.classList.toggle('collapsed');
    const arrow = h.querySelector('.step-toggle-arrow');
    if (arrow) arrow.innerHTML = body.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
  };

  card.appendChild(body);
  return { card, g, body };
}

/* Trial batch sizes follow product complexity, not a fixed ladder. */
function trialConfig(project, proc, step, redraw) {
  const sk = stepKeyOf(proc, step);
  const g = gateRowOf(project.project_id, sk) || {};
  const box = el('div', 'sub');
  box.appendChild(el('h3', null, 'Trial quantities'));
  const presets = CFG.trial_quantity_presets;
  const keys = Object.keys(presets).filter(k => k !== 'sop_reference');
  const opts = keys.map(k => '<option value="' + esc(k) + '"' + (k === g.complexity ? ' selected' : '') + '>' + esc(k) + ' (' + presets[k].class + ') — ' + presets[k].phase1 + '/' + presets[k].phase2 + '/' + presets[k].phase3 + '</option>').join('');
  const f = el('div', 'filters');
  f.innerHTML = '<label>Complexity</label><select id="tcLvl"><option value="">— pick —</option>' + opts + '</select>' +
    '<label>Batch 1</label><input id="tc1" style="width:76px" value="' + esc(g.batch_1 || '') + '">' +
    '<label>Batch 2</label><input id="tc2" style="width:76px" value="' + esc(g.batch_2 || '') + '">' +
    '<label>Batch 3</label><input id="tc3" style="width:76px" value="' + esc(g.batch_3 || '') + '">' +
    '<label><input type="checkbox" id="tcOv"' + (g.batch_override === 'YES' ? ' checked' : '') + '> override defaults</label>' +
    '<input id="tcJust" style="width:230px" placeholder="justification (required if overriding)" value="' + esc(g.batch_justification || '') + '">' +
    '<button id="tcSave" class="primary">Save</button>';
  box.appendChild(f);
  const ex = el('p', 'note');
  const cur = presets[g.complexity];
  ex.textContent = cur ? cur.description : CFG.trial_quantity_presets.sop_reference;
  box.appendChild(ex);

  const q = s => f.querySelector(s);
  q('#tcLvl').onchange = () => {
    const c = presets[q('#tcLvl').value];
    if (c && !q('#tcOv').checked) { q('#tc1').value = c.phase1; q('#tc2').value = c.phase2; q('#tc3').value = c.phase3; }
  };
  q('#tcSave').onclick = async () => {
    const who = requireName() || '(unnamed)';
    const ov = q('#tcOv').checked;
    if (ov && !q('#tcJust').value.trim()) { alert('An override needs a justification.'); return; }
    await API.action('lb_gates', {
      project_id: project.project_id, process: proc, step_key: sk, step_num: step.step_id, step_name: step.step_name,
      status: g.status || 'InProgress', complexity: q('#tcLvl').value, batch_1: q('#tc1').value.trim(), batch_2: q('#tc2').value.trim(),
      batch_3: q('#tc3').value.trim(), batch_override: ov ? 'YES' : 'NO', batch_justification: q('#tcJust').value.trim(), updated_utc: new Date().toISOString()
    }, { upsertKeys: ['project_id', 'step_key'], audit: { user: who, action: 'Set_Trial_Quantities', projectId: project.project_id, objType: 'Gate', objId: sk, from: '', to: [q('#tc1').value, q('#tc2').value, q('#tc3').value].join('/'), detail: q('#tcLvl').value } });
    await redraw();
  };
  return box;
}

/* ===================================================================== */
/* TAB — NPI (7 steps, strict gates)                                     */
/* ===================================================================== */
function viewNpi(root) {
  npiTreeState.active = npiSel;
  const project = familyFgTree(root, 'NPI', npiTreeState, (id, isMulti) => {
    npiSel = id;
    justPickedTree = true;
    show('npi');
  });
  if (!project) return;
  npiSel = project.project_id;

  const p = el('div', 'card');
  const pBody = el('div', 'card-body');
  const b = el('div', 'banner');
  b.innerHTML = '<b>NPI gates are strict.</b> A step closes only when every required document is filed, no issue is open against it, ' +
    'warehouse clearance is done where required, and a named person signs. Otherwise use <b>Authorise bypass</b> — it is recorded separately and stays visible.';
  pBody.appendChild(b);
  const activeHead = el('div', 'filters', project.project_id + ' · ' + ((familyById(project.prod_family) || {}).prod_family_name || project.prod_family));
  activeHead.id = 'npiActiveHead';
  pBody.appendChild(activeHead);
  const host = el('div'); pBody.appendChild(host);
  p.appendChild(pBody); root.appendChild(p);

  const redraw = async () => {
    host.innerHTML = '';
    host.appendChild(packageBar(project));
    host.appendChild(scopeNote(project,'NPI'));
    const grid = el('div', 'step-grid');
    const steps = stepsOf('NPI', project);
    let firstIncomplete = -1;
    for (let i = 0; i < steps.length; i++) {
      const g = gateState(project, 'NPI', steps[i]);
      if (!g.done) { firstIncomplete = i; break; }
    }
    steps.forEach((step, idx) => {
      const { card, body } = stepCard(project, 'NPI', step, redraw);
      if (step.trial_quantity) body.appendChild(trialConfig(project, 'NPI', step, redraw));
      const shouldExpand = (firstIncomplete >= 0 ? idx === firstIncomplete : idx === 0);
      if (!shouldExpand) body.classList.add('collapsed');
      grid.appendChild(card);
    });
    host.appendChild(grid);
  };
  redraw();
}

/* Everything filed against this project, zipped, with a manifest. Works on an
   incomplete project on purpose — handing over what exists today is the point. */
function packageBar(project) {
  const wrap = el('div', 'filters');
  const dels = TRK.lb_deliverables.filter(d => d.project_id === project.project_id);
  const files = dels.filter(d => d.kind !== 'link').length;
  const links = dels.length - files;
  const b = el('button', 'primary', 'Download transfer package');
  b.disabled = !dels.length;
  b.title = dels.length ? 'Zip every document filed against ' + project.project_id
                        : 'Nothing has been filed against this project yet';
  b.onclick = () => { window.location.href = '/api/package/' + encodeURIComponent(project.project_id); };
  wrap.appendChild(b);
  const cp = el('button', '', 'Copy vault folder');
  cp.onclick = async () => {
    const ok = await copyText(PATHS.vault || '');
    cp.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { cp.textContent = 'Copy vault folder'; }, 1500);
  };
  wrap.appendChild(cp);
  wrap.appendChild(el('span', 'note', files + ' file(s) filed, ' + links + ' link(s) cited' +
    (dels.length ? ' — the zip is a snapshot of what exists, not proof of completeness.' : '')));
  return wrap;
}

/* Says out loud which steps this change type skips, so a shorter workflow
   never looks like missing data. */
function scopeNote(project, proc) {
  const ct = changeTypeById(project.class_abcde);
  const skipped = excludedStepsOf(proc, project);
  const d = el('div', 'banner');
  if (!ct) {
    d.className = 'banner warn';
    d.innerHTML = '<b>No change type set on this project.</b> Every ' + esc(proc) + ' step is shown and the target date cannot be calculated. ' +
      'Re-register it with a type, or edit <code>lb_projects.csv</code>.';
    return d;
  }
  const tgt = project.target_date || targetDateFor(ct.type_id, project.prf_date);
  d.innerHTML = '<b>Type ' + esc(ct.type_id) + ' — ' + esc(ct.name) + '.</b> ' + esc(ct.description) +
    '<br>Cycle time ' + (ct.cycle_time_days == null ? '<b>TBD</b>' : '<b>' + ct.cycle_time_days + ' days</b>') +
    (tgt ? ' · target finish <b>' + esc(tgt) + '</b>' : ' · no target date') +
    (skipped.length ? '<br>Not applicable to this type: ' + skipped.map(s => 'step ' + s.step_id + ' ' + esc(s.step_name)).join(', ') +
      (ct.excluded_step_reason ? ' — ' + esc(ct.excluded_step_reason) : '') : '<br>All ' + allStepsOf(proc).length + ' steps apply.');
  return d;
}

/* ===================================================================== */
/* TAB — ECN (12 steps, lighter gates) + PPAP sub-section                */
/* ===================================================================== */
function viewEcn(root) {
  ecnTreeState.active = ecnSel;
  const project = familyFgTree(root, 'ECN', ecnTreeState, (id, isMulti) => {
    ecnSel = id;
    justPickedTree = true;
    show('ecn');
  });
  if (!project) return;
  ecnSel = project.project_id;

  const p = el('div', 'card');
  const pBody = el('div', 'card-body');
  const seg = el('div', 'seg');
  [['steps', 'Process steps'], ['ppap', 'PPAP package']].forEach(([k, l]) => {
    const bt = el('button', ecnMode === k ? 'on' : '', l); bt.onclick = () => { ecnMode = k; show('ecn'); }; seg.appendChild(bt);
  });
  pBody.appendChild(seg);
  const activeHead = el('div', 'filters', project.project_id + ' · ' + ((familyById(project.prod_family) || {}).prod_family_name || project.prod_family) + (project.customer_number ? ' · customer ' + project.customer_number : ''));
  activeHead.id = 'ecnActiveHead';
  pBody.appendChild(activeHead);
  const host = el('div'); pBody.appendChild(host);
  p.appendChild(pBody); root.appendChild(p);

  const redraw = async () => {
    host.innerHTML = '';
    if (ecnMode === 'ppap') { host.appendChild(ppapSection(project)); return; }
    host.appendChild(packageBar(project));
    host.appendChild(scopeNote(project,'ECN'));
    const b = el('div', 'banner');
    const steps = stepsOf('ECN', project);
    const gatedIds = steps.filter(s => s.gate_clearance_required).map(s => s.step_id).join(', ');
    b.innerHTML = '<b>ECN gates are lighter than NPI.</b> Only steps <b>' + gatedIds + '</b> are signed milestones; the rest are tracked. ' +
      'ECN is driven by outside requests and several steps run close together, so the value here is visibility, not enforcement. ' +
      '<b>Warehouse readiness is mandatory before step 11, Trial Production Execution.</b>';
    host.appendChild(b);
    const grid = el('div', 'step-grid');
    let firstIncomplete = -1;
    for (let i = 0; i < steps.length; i++) {
      const g = gateState(project, 'ECN', steps[i]);
      if (!g.done) { firstIncomplete = i; break; }
    }
    steps.forEach((step, idx) => {
      const { card, body } = stepCard(project, 'ECN', step, redraw);
      if (/mwer/i.test(step.step_name)) body.appendChild(mwerSection(project, step, redraw));
      if (/trial production execution/i.test(step.step_name)) body.appendChild(trialConfig(project, 'ECN', step, redraw));
      const shouldExpand = (firstIncomplete >= 0 ? idx === firstIncomplete : idx === 0);
      if (!shouldExpand) body.classList.add('collapsed');
      grid.appendChild(card);
    });
    host.appendChild(grid);
  };
  redraw();
}

/* MWER — the morning meeting or Zoom call whose summary email from the
   chair is the actual approval record at Wahl. */
function mwerSection(project, step, redraw) {
  const sk = stepKeyOf('ECN', step);
  const existing = TRK.lb_mwer.filter(m => m.project_id === project.project_id && m.step_key === sk).slice(-1)[0];
  const box = el('div', 'sub');
  box.appendChild(el('h3', null, 'MWER approval record'));
  if (existing) {
    const d = el('div');
    d.innerHTML = '<p class="note"><b>' + esc(existing.decision) + '</b> · ' + esc(existing.meeting_type) + ' on ' + esc(toWeek(existing.meeting_date)) +
      '<br>Attendees: ' + esc(existing.attendees) + '<br>Summary: ' + esc(existing.summary) +
      (existing.conditions ? '<br>Conditions: <b>' + esc(existing.conditions) + '</b>' : '') +
      (existing.evidence_file ? '<br>Evidence: <code>' + esc(existing.evidence_file) + '</code>' : '') + '<br>Logged by ' + esc(existing.logged_by) + '</p>';
    box.appendChild(d); return box;
  }
  box.appendChild(el('p', 'note', 'The morning meeting or Zoom call produces a summary email from the chair. That email is the approval record — attach it or paste its body.'));
  const g = el('div', 'grid2');
  g.innerHTML = '<div class="fld"><span>Meeting type</span><select id="mwType"><option>Morning meeting</option><option>Zoom call</option></select></div>' +
    '<div class="fld"><span>Meeting date</span><input id="mwDate" type="week" value="' + nowWeek() + '"></div>' +
    '<div class="fld"><span>Attendees</span><input id="mwAtt" placeholder="PL, QA, Finance, Production"></div>' +
    '<div class="fld"><span>Decision</span><select id="mwDec"><option>Approved</option><option>Approved with conditions</option><option>Rejected</option><option>Pending</option></select></div>' +
    '<div class="fld"><span>Conditions (if any)</span><input id="mwCond" placeholder="supplier trial lot before MP"></div>' +
    '<div class="fld"><span>Approval email file name</span><input id="mwFile" placeholder="2026-08-08_ECN-001_Approval_Email.eml"></div>';
  box.appendChild(g);
  const s = el('div'); s.style.marginTop = '6px';
  s.innerHTML = '<div class="fld"><span>Summary notes / pasted email body</span><textarea id="mwBody"></textarea></div>';
  box.appendChild(s);
  const btn = el('button', 'primary', 'Save MWER record'); btn.style.marginTop = '6px';
  btn.onclick = async () => {
    const who = requireName(); if (!who) return;
    const att = $('#mwAtt', g).value.trim();
    if (!att) { alert('Record who attended — that is what makes this an approval rather than a note.'); return; }
    const body = $('#mwBody', s).value.trim(), file = $('#mwFile', g).value.trim();
    if (!body && !file) { alert('Attach the approval email file name or paste its body — the email is the evidence.'); return; }
    await API.action('lb_mwer', {
      project_id: project.project_id, step_key: sk, meeting_type: $('#mwType', g).value, meeting_date: $('#mwDate', g).value,
      attendees: att, summary: body.slice(0, 500), evidence_file: file, evidence_body: body, decision: $('#mwDec', g).value,
      conditions: $('#mwCond', g).value.trim(), logged_by: who, logged_utc: new Date().toISOString()
    }, { audit: { user: who, action: 'Log_MWER', projectId: project.project_id, objType: 'MWER', objId: sk, from: '', to: $('#mwDec', g).value, detail: att } });
    await redraw();
  };
  box.appendChild(btn);
  return box;
}

const PPAP_ITEMS = [
  ['DESIGN_RECORDS', 'Design records (2D + 3D)'], ['ECN_DOCS', 'Engineering change documents'],
  ['CUST_ENG_APPROVAL', 'Customer engineering approval'], ['PFMEA', 'PFMEA'], ['CONTROL_PLAN', 'Control plan'],
  ['FAI', 'First article inspection'], ['PSW', 'Part submission warrant'], ['SUPPLIER_DOCS', 'Supplier documentation'],
  ['TEST_RESULTS', 'Test results (extended PPAP)']
];
function ppapSection(project) {
  const wrap = el('div');
  const b = el('div', 'banner');
  b.innerHTML = '<b>Submission and customer approval are tracked separately</b> — a document sent is not a document accepted.';
  wrap.appendChild(b);
  const f = el('div', 'filters');
  f.innerHTML = '<label>Part number</label><input id="ppPart" style="width:120px" value="' + esc(project.family) + '">' +
    '<label>Customer</label><input id="ppCust" style="width:120px" value="' + esc(project.customer_number) + '">';
  wrap.appendChild(f);

  const rows = TRK.lb_ppap.filter(r => r.project_id === project.project_id);
  let sub = 0, app = 0;
  const t = el('table');
  t.innerHTML = '<thead><tr><th>PPAP item</th><th>Submitted</th><th>Customer approved</th><th></th></tr></thead>';
  const tb = el('tbody');
  PPAP_ITEMS.forEach(([code, label]) => {
    const rec = rows.filter(r => r.doc_code === code).slice(-1)[0];
    if (rec && rec.submitted_utc) sub++;
    if (rec && rec.customer_approved === 'YES') app++;
    const tr = el('tr');
    tr.innerHTML = '<td>' + esc(label) + '</td>' +
      '<td>' + (rec && rec.submitted_utc ? esc(rec.submitted_utc.slice(0, 10)) : '<span class="note">—</span>') + '</td>' +
      '<td>' + (rec && rec.customer_approved === 'YES' ? '<span class="' + badgeClass('APPROVED') + '">' + esc((rec.customer_approved_utc || '').slice(0, 10)) + '</span>' : '<span class="note">—</span>') + '</td><td></td>';
    const act = tr.lastChild;
    if (!rec || !rec.submitted_utc) {
      const bt = el('button', '', 'Mark submitted');
      bt.onclick = async () => {
        const who = requireName() || '(unnamed)';
        await API.action('lb_ppap', {
          project_id: project.project_id, part_number: $('#ppPart').value.trim(), customer: $('#ppCust').value.trim(), doc_code: code,
          required: 'YES', submitted_utc: new Date().toISOString(), customer_approved: 'NO', customer_approved_utc: '', notes: ''
        }, { audit: { user: who, action: 'PPAP_Submit', projectId: project.project_id, objType: 'PPAP', objId: code, from: '', to: 'Submitted', detail: label } });
        await redrawAfterWrite();
      };
      act.appendChild(bt);
    } else if (rec.customer_approved !== 'YES') {
      const bt = el('button', '', 'Customer approved');
      bt.onclick = async () => {
        const who = requireName() || '(unnamed)';
        await API.action('lb_ppap', {
          project_id: project.project_id, part_number: rec.part_number, customer: rec.customer, doc_code: code, required: 'YES',
          submitted_utc: rec.submitted_utc, customer_approved: 'YES', customer_approved_utc: new Date().toISOString(), notes: ''
        }, { upsertKeys: ['project_id', 'doc_code'], audit: { user: who, action: 'PPAP_Customer_Approve', projectId: project.project_id, objType: 'PPAP', objId: code, from: 'Submitted', to: 'Customer approved', detail: label } });
        await redrawAfterWrite();
      };
      act.appendChild(bt);
    }
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(el('p', 'note', 'Submitted ' + sub + ' / ' + PPAP_ITEMS.length + '   ·   customer-approved ' + app + ' / ' + PPAP_ITEMS.length));
  wrap.appendChild(t);
  return wrap;
}

/* ===================================================================== */
/* TAB — SETTINGS (add / delete product families & document types)      */
/* ===================================================================== */
function viewSettings(root) {
  const b = el('div', 'banner');
  b.innerHTML = '<b>Settings edit system\\config.json directly.</b> Changes apply immediately for every user of this tool — ' +
    'nothing is regenerated from a workbook.';
  root.appendChild(b);

  /* ---- blank form template upload ---- */
  const up = el('div', 'card');
  const upHdr = el('div', 'card-header'); upHdr.appendChild(el('h3', 'card-title', 'Upload blank form template')); up.appendChild(upHdr);
  const upBody = el('div', 'card-body');
  upBody.appendChild(el('p', 'note', 'Drop a blank .xlsx, .docx or .pdf form here to make it available in the Download dropdowns across the app.'));

  const dz = el('div', 'dz');
  dz.setAttribute('tabindex', '0');
  dz.setAttribute('role', 'button');
  dz.setAttribute('aria-label', 'Choose or drop a template file to upload');
  const dzIcon = el('div', 'dz-icon');
  dzIcon.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M14 3v4a1 1 0 0 0 1 1h4"/>' +
    '<path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>' +
    '<path d="M12 17v-6"/><path d="M9.5 13.5 12 11l2.5 2.5"/></svg>';
  dz.appendChild(dzIcon);
  dz.appendChild(el('div', 'dz-main', 'Drop a .xlsx, .docx or .pdf file here, or click to choose'));
  dz.appendChild(el('div', 'dz-sub', 'Only Office documents and PDFs. The filename must be safe — no folders or slashes.'));
  const dzIn = el('input'); dzIn.type = 'file'; dzIn.accept = '.xlsx,.docx,.pdf'; dzIn.className = 'hide';
  dz.onclick = () => dzIn.click();
  dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dzIn.click(); } };
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('on'); };
  dz.ondragleave = () => dz.classList.remove('on');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('on'); processTemplateFile(e.dataTransfer.files[0]); };
  dzIn.onchange = () => processTemplateFile(dzIn.files[0]);

  const dzStatus = el('div', 'note'); dzStatus.style.marginTop = '8px';

  async function processTemplateFile(file) {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.xlsx', '.docx', '.pdf'].includes(ext)) {
      dzStatus.textContent = 'Only .xlsx, .docx and .pdf files are accepted.'; dzStatus.style.color = 'var(--bad)';
      return;
    }
    const who = requireName(); if (!who) return;
    dzStatus.textContent = 'Uploading…'; dzStatus.style.color = '';
    try {
      const reader = new FileReader();
      const b64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });
      const r = await API.uploadTemplate({ fileName: file.name, contentBase64: b64, user: who });
      dzStatus.textContent = 'Uploaded: ' + r.fileName + ' (' + Math.round(r.bytes / 1024) + ' KB)';
      dzStatus.style.color = 'var(--good)';
      dzIn.value = '';
      // Refresh templates so the dropdowns pick it up
      try { TEMPLATES = (await API.templates()).templates || []; } catch (e) { }
    } catch (e) {
      dzStatus.textContent = e.message; dzStatus.style.color = 'var(--bad)';
    }
  }
  upBody.appendChild(dz);
  upBody.appendChild(dzStatus);
  up.appendChild(upBody); root.appendChild(up);

  /* ---- families ---- */
  const fp = el('div', 'card');
  const fpHdr = el('div', 'card-header'); fpHdr.appendChild(el('h3', 'card-title', 'Product families')); fp.appendChild(fpHdr);
  const fpBody = el('div', 'card-body');
  const flist = el('div', 'taglist');
  CFG.prod_families.forEach(f => {
    const t = el('div', 'tagrow');
    t.innerHTML = '<span><b>' + esc(f.prod_family_id) + '</b> — ' + esc(f.prod_family_name) + ' (class ' + esc(f.complexity_class) + ')</span>';
    const edit = el('button', null, '✎');
    edit.title = 'Edit this family';
    edit.style.color = 'var(--blue)';
    edit.onclick = () => {
      $('#sfId').value = f.prod_family_id || ''; $('#sfId').readOnly = true;
      $('#sfName').value = f.prod_family_name || '';
      $('#sfDesc').value = f.description || '';
      $('#sfFg').value = (f.sample_fg_ids || []).join(', ');
      $('#sfClass').value = f.complexity_class || '';
      $('#sfLead').value = f.typical_lead_time_days != null ? f.typical_lead_time_days : '';
      faddBtn.textContent = 'Save family (update)';
      faddBtn.dataset.editing = f.prod_family_id;
      fCancelBtn.className = '';
      fCancelBtn.style.marginLeft = '8px';
    };
    t.appendChild(edit);
    const del = el('button', null, '×');
    del.title = 'Delete this family';
    del.onclick = async () => {
      if (!confirm('Delete product family "' + f.prod_family_id + '"? Projects already registered under it keep their data.')) return;
      try { await API.family('delete', null, f.prod_family_id, requireName() || ''); await redrawAfterWrite(); }
      catch (e) { alert('Could not delete: ' + e.message); }
    };
    t.appendChild(del); flist.appendChild(t);
  });
  fpBody.appendChild(flist);
  const fg = el('div', 'grid2');
  fg.innerHTML = '<div class="fld"><span>Product Family ID *</span><input id="sfId" placeholder="e.g. CL-CORDLESS"></div>' +
    '<div class="fld"><span>Name *</span><input id="sfName" placeholder="e.g. Hair Clipper (Cordless)"></div>' +
    '<div class="fld"><span>Description</span><input id="sfDesc"></div>' +
    '<div class="fld"><span>Sample FG IDs (comma-separated)</span><input id="sfFg"></div>' +
    '<div class="fld"><span>Complexity class</span><input id="sfClass" style="width:60px" placeholder="A–E"></div>' +
    '<div class="fld"><span>Typical lead time (days)</span><input id="sfLead" type="number" style="width:100px"></div>';
  fpBody.appendChild(fg);
  const faddBtn = el('button', 'primary', 'Add family'); faddBtn.style.marginTop = '8px';
  const fCancelBtn = el('button', '', 'Cancel edit'); fCancelBtn.style.marginTop = '8px'; fCancelBtn.style.marginLeft = '8px'; fCancelBtn.className = 'hide';
  function resetFamilyForm() {
    $('#sfId').value = ''; $('#sfId').readOnly = false;
    $('#sfName').value = ''; $('#sfDesc').value = ''; $('#sfFg').value = ''; $('#sfClass').value = ''; $('#sfLead').value = '';
    faddBtn.textContent = 'Add family'; delete faddBtn.dataset.editing;
    fCancelBtn.className = 'hide';
  }
  faddBtn.onclick = async () => {
    const id = $('#sfId').value.trim(), name = $('#sfName').value.trim();
    if (!id || !name) { alert('Product Family ID and name are required.'); return; }
    try {
      await API.family('add', {
        prod_family_id: id, prod_family_name: name, description: $('#sfDesc').value.trim(),
        sample_fg_ids: $('#sfFg').value.split(',').map(s => s.trim()).filter(Boolean),
        complexity_class: $('#sfClass').value.trim(), typical_lead_time_days: Number($('#sfLead').value) || 0
      }, null, requireName() || '');
      await redrawAfterWrite();
    } catch (e) { alert('Could not save: ' + e.message); }
  };
  fCancelBtn.onclick = resetFamilyForm;
  fpBody.appendChild(faddBtn);
  fpBody.appendChild(fCancelBtn);
  fp.appendChild(fpBody); root.appendChild(fp);

  /* ---- document types ---- */
  const dp = el('div', 'card');
  const dpHdr = el('div', 'card-header'); dpHdr.appendChild(el('h3', 'card-title', 'Document types')); dp.appendChild(dpHdr);
  const dpBody = el('div', 'card-body');
  const dlist = el('div', 'taglist');
  CFG.document_types.forEach(d => {
    const t = el('div', 'tagrow');
    t.innerHTML = '<span><b>' + esc(d.doctype_id) + '</b> — ' + esc(d.name) +
      ' <span class="note">· required at: ' + esc(d.stage_required || 'not gated') + '</span></span>';
    if (isPrivileged()) {
      var tmplSel = el('select');
      tmplSel.style.cssText = 'margin-left:8px;font-size:12px;min-width:160px;height:26px';
      tmplSel.innerHTML = '<option value="">(no template)</option>' +
        TEMPLATES.map(function(tm) { return '<option value="' + esc(tm.name) + '"' + (d.template_file === tm.name ? ' selected' : '') + '>' + esc(tm.name) + '</option>'; }).join('');
      tmplSel.onchange = async function() {
        var who = requireName(); if (!who) { tmplSel.value = d.template_file || ''; return; }
        try {
          var updated = Object.assign({}, d, { template_file: tmplSel.value || null });
          await API.doctype('add', updated, null, who);
          await redrawAfterWrite();
        } catch (e) { alert('Could not save: ' + e.message); }
      };
      t.appendChild(tmplSel);
    }
    const edit = el('button', null, '✎');
    edit.title = 'Edit this document type';
    edit.style.color = 'var(--blue)';
    edit.onclick = () => {
      $('#sdId').value = d.doctype_id || ''; $('#sdId').readOnly = true;
      $('#sdName').value = d.name || '';
      $('#sdForm').value = d.form_code || '';
      $('#sdOwner').value = d.owner_dept || '';
      $('#sdStage').value = d.stage_required || '';
      $('#sdSource').value = d.source || '';
      $('#sdDesc').value = d.description || '';
      $('#sdTemplate').value = d.template_file || '';
      daddBtn.textContent = 'Save document type (update)';
      daddBtn.dataset.editing = d.doctype_id;
      dCancelBtn.className = '';
      dCancelBtn.style.marginLeft = '8px';
    };
    t.appendChild(edit);
    const del = el('button', null, '×');
    del.title = 'Delete this document type';
    del.onclick = async () => {
      if (!confirm('Delete document type "' + d.doctype_id + '"? Steps that require it will show it as unresolved.')) return;
      try { await API.doctype('delete', null, d.doctype_id, requireName() || ''); await redrawAfterWrite(); }
      catch (e) { alert('Could not delete: ' + e.message); }
    };
    t.appendChild(del); dlist.appendChild(t);
  });
  dpBody.appendChild(dlist);
  const dg = el('div', 'grid2');
  dg.innerHTML = '<div class="fld"><span>Doctype ID *</span><input id="sdId" list="sdIdList" placeholder="e.g. CAP-STUDY">' +
    '<datalist id="sdIdList">' + CFG.document_types.map(d => '<option value="' + esc(d.doctype_id) + '">').join('') + '</datalist></div>' +
    '<div class="fld"><span>Name *</span><input id="sdName" placeholder="e.g. Process Capability Study"></div>' +
    '<div class="fld"><span>Form code</span><input id="sdForm"></div>' +
    '<div class="fld"><span>Owner dept</span><input id="sdOwner"></div>' +
    '<div class="fld"><span>Stage required</span><input id="sdStage" placeholder="e.g. NPI 3, ECN 10 — or leave blank"></div>' +
    '<div class="fld"><span>Source</span><input id="sdSource"></div>' +
    '<div class="fld"><span>Description</span><input id="sdDesc"></div>' +
    '<div class="fld"><span>Template file</span><select id="sdTemplate" style="min-width:200px">' +
      '<option value="">(none)</option>' +
      TEMPLATES.map(function(t) { return '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>'; }).join('') + '</select></div>';
  dpBody.appendChild(dg);
  dpBody.appendChild(el('p', 'note', 'Stage required is a label, not a rule — what actually gates a step is that step\'s ' +
    'required_evidence_doctypes list in config.json. Adding a doctype here makes it filable; it does not make it mandatory.'));
  const daddBtn = el('button', 'primary', 'Add document type'); daddBtn.style.marginTop = '8px';
  const dCancelBtn = el('button', '', 'Cancel edit'); dCancelBtn.style.marginTop = '8px'; dCancelBtn.style.marginLeft = '8px'; dCancelBtn.className = 'hide';
  function resetDoctypeForm() {
    $('#sdId').value = ''; $('#sdId').readOnly = false;
    $('#sdName').value = ''; $('#sdForm').value = ''; $('#sdOwner').value = ''; $('#sdStage').value = ''; $('#sdSource').value = ''; $('#sdDesc').value = '';
    $('#sdTemplate').value = '';
    daddBtn.textContent = 'Add document type'; delete daddBtn.dataset.editing;
    dCancelBtn.className = 'hide';
  }
  daddBtn.onclick = async () => {
    const id = $('#sdId').value.trim(), name = $('#sdName').value.trim();
    if (!id || !name) { alert('Doctype ID and name are required.'); return; }
    try {
      await API.doctype('add', {
        doctype_id: id, name, form_code: $('#sdForm').value.trim() || null, owner_dept: $('#sdOwner').value.trim(),
        source: $('#sdSource').value.trim(), description: $('#sdDesc').value.trim(),
        stage_required: $('#sdStage').value.trim() || 'not gated',
        template_file: $('#sdTemplate').value || null
      }, null, requireName() || '');
      await redrawAfterWrite();
    } catch (e) { alert('Could not save: ' + e.message); }
  };
  dCancelBtn.onclick = resetDoctypeForm;
  dpBody.appendChild(daddBtn);
  dpBody.appendChild(dCancelBtn);
  dp.appendChild(dpBody); root.appendChild(dp);

  /* ---- moderators ---- */
  const mp = el('div', 'card');
  const mpHdr = el('div', 'card-header'); mpHdr.appendChild(el('h3', 'card-title', 'Moderators')); mp.appendChild(mpHdr);
  const mpBody = el('div', 'card-body');
  mpBody.appendChild(el('p', 'note', 'Moderators inherit admin rights: parallel gate sign-off, task assignment, and settings edits.'));
  var modList = el('div', 'taglist');
  (CFG.moderators || []).forEach(function(m) {
    var row = el('div', 'tagrow');
    row.innerHTML = '<span><b>' + esc(m) + '</b></span>';
    if (isAdmin()) {
      var rmBtn = el('button', null, '×');
      rmBtn.title = 'Remove moderator';
      rmBtn.onclick = function() {
        confirmModal('Remove Moderator', 'Remove <b>' + esc(m) + '</b> from moderators?', 'Remove', async function() {
          var newList = (CFG.moderators || []).filter(function(x) { return x !== m; });
          try {
            var r = await API.post('/api/config/moderators', { user: getUser(), moderators: newList });
            CFG.moderators = r.moderators || [];
            viewSettings(root);
          } catch (e) { alert('Could not save: ' + e.message); }
        });
      };
      row.appendChild(rmBtn);
    }
    modList.appendChild(row);
  });
  mpBody.appendChild(modList);
  if (isAdmin()) {
    var addRow = el('div');
    addRow.style.cssText = 'margin-top:8px;display:flex;gap:6px;';
    var modInput = el('input');
    modInput.placeholder = 'Enter user name';
    modInput.style.cssText = 'flex:1';
    var modAddBtn = el('button', 'primary', 'Add');
    modAddBtn.onclick = async function() {
      var name = modInput.value.trim();
      if (!name) return;
      try {
        var newList = (CFG.moderators || []).concat([name]);
        var r = await API.post('/api/config/moderators', { user: getUser(), moderators: newList });
        CFG.moderators = r.moderators || [];
        viewSettings(root);
      } catch (e) { alert('Could not save: ' + e.message); }
    };
    addRow.appendChild(modInput);
    addRow.appendChild(modAddBtn);
    mpBody.appendChild(addRow);
  }
  mp.appendChild(mpBody); root.appendChild(mp);

  /* ---- issue tracker CSV header labels ---- */
  const hp = el('div', 'card');
  const hpHdr = el('div', 'card-header'); hpHdr.appendChild(el('h3', 'card-title', 'Issue tracker CSV headers')); hp.appendChild(hpHdr);
  const hpBody = el('div', 'card-body');
  hpBody.appendChild(el('p', 'note', 'These labels appear in the CSV template, export, and are used to parse imports. ' +
    'The internal field names are fixed — you can only change how each field is labelled in the CSV.'));
  const hlist = el('div', 'taglist');
  const hdrs = CFG.issue_tracker_headers || {};
  Object.keys(hdrs).forEach(k => {
    const row = el('div', 'tagrow');
    row.innerHTML = '<span><b>' + esc(k) + '</b></span>';
    const inp = el('input'); inp.value = hdrs[k] || ''; inp.style.width = '220px';
    row.appendChild(inp);
    hlist.appendChild(row);
  });
  hpBody.appendChild(hlist);
  const hsaveBtn = el('button', 'primary', 'Save header labels'); hsaveBtn.style.marginTop = '8px';
  hsaveBtn.onclick = async () => {
    const who = requireName(); if (!who) return;
    const obj = {};
    const rows = $$('.tagrow', hlist);
    const keys = Object.keys(hdrs);
    keys.forEach((k, i) => { obj[k] = rows[i].querySelector('input').value.trim(); });
    try {
      await API.issueHeaders(obj, who);
      await redrawAfterWrite();
    } catch (e) { alert('Could not save: ' + e.message); }
  };
  hpBody.appendChild(hsaveBtn);
  hp.appendChild(hpBody); root.appendChild(hp);

  /* ---- change / project types (editable) ---- */
  const cp = el('div', 'card');
  const cpHdr = el('div', 'card-header'); cpHdr.appendChild(el('h3', 'card-title', 'Change / project types')); cp.appendChild(cpHdr);
  const cpBody = el('div', 'card-body');
  cpBody.appendChild(el('p', 'note', 'These drive the target date and which steps a project runs. ' +
    'Changing a cycle time does not re-date existing projects — only new projects and manual target-date recalculations are affected.'));
  const ctTable = el('table');
  ctTable.innerHTML = '<thead><tr><th>Type</th><th>Name</th><th>Description</th><th>Cycle days</th><th>NPI steps</th><th>ECN steps</th><th>Trial preset</th><th></th></tr></thead>';
  const ctBody = el('tbody');
  const ctSaveMsg = el('div', 'note');
  let ctDirty = false;

  function renderCtRows() {
    ctBody.innerHTML = '';
    changeTypes().forEach((t, i) => {
      const tr = el('tr');
      tr.innerHTML =
        '<td><input data-ct="type_id" data-idx="' + i + '" value="' + esc(t.type_id || '') + '" style="width:50px" maxlength="3"></td>' +
        '<td><input data-ct="name" data-idx="' + i + '" value="' + esc(t.name || '') + '" style="width:180px"></td>' +
        '<td><input data-ct="description" data-idx="' + i + '" value="' + esc(t.description || '') + '" style="width:260px"></td>' +
        '<td><input data-ct="cycle_time_days" data-idx="' + i + '" value="' + (t.cycle_time_days != null ? t.cycle_time_days : '') + '" style="width:70px" placeholder="TBD"></td>' +
        '<td><input data-ct="npi_steps" data-idx="' + i + '" value="' + esc((t.npi_steps || []).join(',')) + '" style="width:100px" title="Comma-separated step numbers, e.g. 1,3,5"></td>' +
        '<td><input data-ct="ecn_steps" data-idx="' + i + '" value="' + esc((t.ecn_steps || []).join(',')) + '" style="width:120px" title="Comma-separated step numbers"></td>' +
        '<td><input data-ct="trial_preset" data-idx="' + i + '" value="' + esc(t.trial_preset || '') + '" style="width:80px"></td>' +
        '<td><button class="sm" title="Remove this type">×</button></td>';
      const delBtn = tr.querySelector('button');
      delBtn.onclick = () => {
        if (!confirm('Remove type "' + esc(t.type_id) + '"?')) return;
        const cts = changeTypes();
        cts.splice(i, 1);
        CFG.change_types = cts;
        renderCtRows();
        ctDirty = true;
        ctSaveMsg.textContent = 'One or more types changed — save to apply.';
        ctSaveMsg.style.color = 'var(--warn)';
      };
      ctBody.appendChild(tr);
    });
    // wire change detection on all inputs
    ctBody.querySelectorAll('input').forEach(inp => {
      inp.oninput = () => {
        ctDirty = true;
        ctSaveMsg.textContent = 'Unsaved changes — click Save to persist.';
        ctSaveMsg.style.color = 'var(--warn)';
      };
    });
  }
  renderCtRows();

  // Add button
  const ctAddBtn = el('button', '', '+ Add type'); ctAddBtn.style.marginTop = '8px';
  ctAddBtn.onclick = () => {
    const cts = changeTypes();
    cts.push({ type_id: '', name: '', description: '', cycle_time_days: null, trial_preset: '', npi_steps: [], ecn_steps: [] });
    CFG.change_types = cts;
    renderCtRows();
    ctDirty = true;
    ctSaveMsg.textContent = 'New type added — fill in the fields and save.';
    ctSaveMsg.style.color = 'var(--warn)';
  };

  // Save button
  const ctSaveBtn = el('button', 'primary', 'Save change types'); ctSaveBtn.style.marginTop = '8px'; ctSaveBtn.style.marginLeft = '8px';
  ctSaveBtn.onclick = async () => {
    const who = requireName(); if (!who) return;
    // Read all input values back into change_types
    const cts = [];
    const rows = $$('tr', ctBody);
    rows.forEach(tr => {
      const t = {};
      tr.querySelectorAll('input').forEach(inp => {
        const field = inp.dataset.ct;
        const val = inp.value.trim();
        if (field === 'npi_steps' || field === 'ecn_steps') {
          t[field] = val ? val.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];
        } else if (field === 'cycle_time_days') {
          t[field] = val ? parseInt(val, 10) : null;
        } else {
          t[field] = val;
        }
      });
      cts.push(t);
    });
    try {
      await API.changeTypes(cts, who);
      // Update CFG from server response so it picks up any server-side coercion
      await refresh();
      renderCtRows();
      ctDirty = false;
      ctSaveMsg.textContent = 'Change types saved.';
      ctSaveMsg.style.color = 'var(--good)';
    } catch (e) {
      ctSaveMsg.textContent = 'Save failed: ' + e.message;
      ctSaveMsg.style.color = 'var(--bad)';
    }
  };

  ctTable.appendChild(ctBody); cpBody.appendChild(ctTable);
  cpBody.appendChild(ctAddBtn);
  cpBody.appendChild(ctSaveBtn);
  cpBody.appendChild(ctSaveMsg);
  cp.appendChild(cpBody); root.appendChild(cp);

  /* ---- where things live ---- */
  const pp = el('div', 'card');
  const ppHdr = el('div', 'card-header'); ppHdr.appendChild(el('h3', 'card-title', 'Storage locations')); pp.appendChild(ppHdr);
  const ppBody = el('div', 'card-body');
  const pT = el('table');
  pT.innerHTML = '<thead><tr><th>What</th><th>Where</th></tr></thead><tbody>' +
    '<tr><td>Application root</td><td><code>' + esc(PATHS.root || '?') + '</code></td></tr>' +
    '<tr><td>Document vault (evidence)</td><td><code>' + esc(PATHS.vault || '?') + '</code></td></tr>' +
    '<tr><td>Blank form templates</td><td><code>' + esc(PATHS.templates || '?') + '</code> — ' + TEMPLATES.length + ' staged</td></tr>' +
    '</tbody>';
  ppBody.appendChild(pT);
  ppBody.appendChild(el('p', 'note', 'The vault sits beside the app folder, not inside it, so replacing the tool never touches filed evidence.'));
  pp.appendChild(ppBody); root.appendChild(pp);
}

/* ------------------------------------------------------ stop the server -- */
/* The PowerShell window is minimised and most people will not think to hunt
   for it. This is the supported way to release the port and the CSV locks. */
function confirmModal(title, body, confirmLabel, onConfirm) {
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal');
  // role/aria-modal/aria-labelledby: without these a screen reader (or any
  // assistive/automated client walking the accessibility tree rather than
  // raw pixels) cannot tell this is a dialog at all - it reads as a couple
  // of unlabelled generic divs sitting over the page, and the confirm button
  // inside effectively cannot be found.
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'modalTitle');
  box.innerHTML = '<h2 id="modalTitle">' + esc(title) + '</h2><div>' + body + '</div>';
  const acts = el('div', 'acts');
  const no = el('button', '', 'Cancel');
  const yes = el('button', 'danger', confirmLabel);
  // Every close path shares one teardown so the keydown listener never
  // outlives the modal it was opened for - previously only Escape itself
  // detached it, so Cancel/Yes/click-outside each leaked one onto document.
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = e => { if (e.key === 'Escape') close(); };
  no.onclick = close;
  yes.onclick = () => { close(); onConfirm(); };
  acts.appendChild(no); acts.appendChild(yes);
  box.appendChild(acts);
  scrim.appendChild(box);
  scrim.onclick = e => { if (e.target === scrim) close(); };
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(scrim);
  yes.focus();
}

/* ---- LFI (Late Found Issue) modal ---------------------------------------- */
function openLfiModal(project, step) {
  var proc = project.process;
  var sk = stepKeyOf(proc, step);
  var who = getUser();
  var todayStr = today();

  var scrim = el('div', 'modal-scrim');
  var box = el('div', 'modal lfi-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'lfiModalTitle');

  var h = '<h2 id="lfiModalTitle">+ Late Found Issue</h2>';
  h += '<p class="note">' + esc(project.project_id) + ' · step ' + esc(step.step_id) + ' — ' + esc(step.step_name) + '</p>';

  // Field rows
  var fields = [
    ['Title', 'text', 'lfiTitle', '', true],
    ['Author', 'text', 'lfiAuthor', who, false],
    ['Date', 'date', 'lfiDate', todayStr, false],
    ['Plant', 'text', 'lfiPlant', 'WVN', false],
    ['Impact', 'text', 'lfiImpact', '', false],
    ['Description', 'textarea', 'lfiDesc', '', false],
    ['Root Cause', 'textarea', 'lfiRootCause', '', false],
    ['Remediation', 'textarea', 'lfiRemediation', '', false]
  ];

  fields.forEach(function(f) {
    var isTextarea = f[1] === 'textarea';
    h += '<div class="lfi-field"><label for="' + f[2] + '">' + esc(f[0]) + (f[4] ? ' <span class="lfi-required">*</span>' : '') + '</label>';
    if (isTextarea) {
      h += '<textarea id="' + f[2] + '" class="lfi-input" rows="3">' + esc(f[3]) + '</textarea>';
    } else {
      h += '<input id="' + f[2] + '" class="lfi-input" type="' + f[1] + '" value="' + esc(f[3]) + '">';
    }
    h += '</div>';
  });

  // Image attachment area
  h += '<div class="lfi-field"><label>Attachments (.png, .jpg, .jpeg)</label>';
  h += '<div class="lfi-attach-area">';
  h += '<div id="lfiPreviews" class="lfi-previews"></div>';
  h += '<label class="lfi-attach-btn">Choose files<input type="file" id="lfiFileInput" accept=".png,.jpg,.jpeg" multiple style="display:none"></label>';
  h += '</div>';
  h += '</div>';

  // Error area
  h += '<div id="lfiError" class="lfi-error" style="display:none"></div>';

  // Actions
  h += '<div class="acts"><button id="lfiCancel">Cancel</button><button id="lfiSubmit" class="primary">Submit LFI</button></div>';

  box.innerHTML = h;
  scrim.appendChild(box);

  var imageFiles = [];

  var close = function() {
    scrim.remove();
    document.removeEventListener('keydown', onEsc);
  };

  var onEsc = function(e) { if (e.key === 'Escape') close(); };

  scrim.onclick = function(e) { if (e.target === scrim) close(); };
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(scrim);

  // Wire up buttons and file input
  var cancelBtn = box.querySelector('#lfiCancel');
  cancelBtn.onclick = close;

  var fileInput = box.querySelector('#lfiFileInput');
  fileInput.onchange = function() {
    var previews = box.querySelector('#lfiPreviews');
    for (var i = 0; i < fileInput.files.length; i++) {
      var f = fileInput.files[i];
      imageFiles.push(f);
      var thumb = el('div', 'lfi-thumb');
      var img = el('img');
      img.alt = f.name;
      thumb.appendChild(img);
      var nameSpan = el('span', '', f.name);
      thumb.appendChild(nameSpan);
      var rmBtn = el('button', 'lfi-rm-thumb', 'x');
      (function(idx) {
        rmBtn.onclick = function() {
          imageFiles.splice(idx, 1);
          thumb.remove();
          // re-index remaining thumbs
          var allThumbs = box.querySelectorAll('.lfi-thumb');
          allThumbs.forEach(function(t, j) {
            var b = t.querySelector('.lfi-rm-thumb');
            if (b) {
              b.onclick = function() {
                imageFiles.splice(j, 1);
                t.remove();
              };
            }
          });
        };
      })(imageFiles.length - 1);
      thumb.appendChild(rmBtn);
      previews.appendChild(thumb);
      // Read as data URL for preview
      var reader = new FileReader();
      reader.onload = function(e) { img.src = e.target.result; };
      reader.readAsDataURL(f);
    }
    fileInput.value = '';
  };

  var submitBtn = box.querySelector('#lfiSubmit');
  submitBtn.onclick = async function() {
    var titleVal = (box.querySelector('#lfiTitle').value || '').trim();
    var errDiv = box.querySelector('#lfiError');

    if (!titleVal) {
      errDiv.textContent = 'Title is required.';
      errDiv.style.display = 'block';
      return;
    }

    // Read images as base64
    var imagePayloads = [];
    for (var i = 0; i < imageFiles.length; i++) {
      var buf = await new Promise(function(resolve) {
        var r = new FileReader();
        r.onload = function(e) { resolve(e.target.result); };
        r.readAsDataURL(imageFiles[i]);
      });
      imagePayloads.push({ name: imageFiles[i].name, data: buf });
    }

    var body = {
      project_id: project.project_id,
      family: project.family || '',
      prod_family: project.prod_family || '',
      step_key: sk,
      step_id: step.step_id,
      step_name: step.step_name,
      title: titleVal,
      author: (box.querySelector('#lfiAuthor').value || '').trim(),
      date: (box.querySelector('#lfiDate').value || '').trim(),
      plant: (box.querySelector('#lfiPlant').value || '').trim(),
      impact: (box.querySelector('#lfiImpact').value || '').trim(),
      description: (box.querySelector('#lfiDesc').value || '').trim(),
      root_cause: (box.querySelector('#lfiRootCause').value || '').trim(),
      remediation: (box.querySelector('#lfiRemediation').value || '').trim(),
      raised_by: who,
      images: imagePayloads
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    errDiv.style.display = 'none';

    try {
      var result = await API.lfi(body);
      close();
      // Refresh drawer in-place — no page scroll, no viewport jump
      var pageY = window.scrollY;
      var drawerEl = $('#drawer');
      var drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
      await refreshSilently();
      openDrawer(project, step);
      window.scrollTo(0, pageY);
      var newDrawer = $('#drawer');
      if (newDrawer) newDrawer.scrollTop = drawerScroll;
    } catch (e) {
      errDiv.textContent = 'Submit failed: ' + e.message;
      errDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit LFI';
    }
  };

  // Focus the title field
  var titleInput = box.querySelector('#lfiTitle');
  if (titleInput) titleInput.focus();
}

/* -------------------------------------------------------------- theme -- */
const TK = 'wvn-epm-theme';
function setTheme(t) {
  const v = (t === 'dark') ? 'dark' : 'light';
  document.documentElement.dataset.theme = v;
  // Tabler's own components key off data-bs-theme; keeping both attributes in
  // step means a Tabler dropdown or table never renders light-on-light while
  // the rest of the shell is dark.
  document.documentElement.setAttribute('data-bs-theme', v);
  const btn = $('#themeBtn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(v === 'dark'));
    btn.title = (v === 'dark') ? 'Switch to light theme' : 'Switch to dark theme';
  }
  try { localStorage.setItem(TK, v); } catch (e) { }
}
// Light is the stable default. The OS prefers-color-scheme is deliberately NOT
// consulted: it made the tool open dark on some company laptops and light on
// others with no user action, which read as a rendering bug. Dark is now only
// ever entered by an explicit click, and that choice is what gets persisted.
try { setTheme(localStorage.getItem(TK) === 'dark' ? 'dark' : 'light'); } catch (e) { setTheme('light'); }
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* -------------------------------------------------------------- header name field -- */
(function initWho() {
  const who = el('input'); who.id = 'whoInput'; who.placeholder = 'Your name'; who.style.width = '140px'; who.value = getUser();
  who.onchange = () => setUser(who.value.trim());
  $('#srvState').insertAdjacentElement('afterend', who);
})();

boot();
