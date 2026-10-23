'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Renders one sprite icon. Returns an <svg> element; use iconHtml() when
   building a string. The sprite is inlined in index.html, so <use> resolves
   with no network request (the app runs air-gapped). */
function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}
function iconHtml(name, cls) {
  return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' +
    '<use href="#i-' + name + '"/></svg>';
}

/* ---- i18n (v9.2.1) -------------------------------------------------------
   The floor team works in Vietnamese, so 'vi' is the default. Deliberately a
   flat key→string dictionary rather than a library: the app is air-gapped and
   vendoring an i18n runtime for ~40 operational terms would cost more than it
   returns. Only shell chrome and status vocabulary are translated — project
   ids, document codes, personnel names and vault paths are data and stay
   verbatim in both languages.

   i18n(key) returns the active language's string, falling back to English and
   then to the key itself, so a missing entry degrades to readable text rather
   than blank UI. */
const LANG_KEY = 'wvn_lang';
const LOCALES = {
  en: {
    dashboard: 'Dashboard', claimed: 'Claimed Work', input: 'Input',
    npi: 'NPI · 7 steps', ecn: 'ECN · 12 steps + PPAP', settings: 'Settings',
    vault: 'Document Vault', vaultTitle: 'Document Vault',
    vaultSub: 'Every document across every project - one row per document, its active revision inline',
    steps: 'steps', projects: 'Projects',

    dashboardTitle: 'Executive Dashboard',
    dashboardSub: 'Portfolio health, stage matrix and schedule',
    claimedTitle: 'Claimed Work', claimedSub: 'Tasks claimed by or assigned to a person',
    inputTitle: 'Data Input', inputSub: 'Register projects and file evidence',
    npiTitle: 'NPI Projects', npiSub: '7-step new product introduction workflow',
    ecnTitle: 'ECN Projects', ecnSub: '12-step engineering change workflow + PPAP',
    settingsTitle: 'Settings', settingsSub: 'Master data, personnel and system configuration',

    npiStageCompletion: 'NPI Stage Completion',
    startWeek: 'Start Week', targetWeek: 'Target Week', today: 'Today',
    progress: 'Progress',

    COMPLETE: 'Complete', IN_PROGRESS: 'In Progress', NOT_STARTED: 'Not Started',
    BYPASSED: 'Bypassed', LATE: 'Late',

    save: 'Save', close: 'Close', del: 'Delete', approve: 'Approve',
    claimTask: 'Claim Task', assignTask: 'Assign Task',
    openInExplorer: 'Open in Explorer', cancel: 'Cancel',
  },
  vi: {
    dashboard: 'Bảng điều khiển', claimed: 'Công việc đã nhận', input: 'Nhập liệu',
    npi: 'Quy trình NPI · 7 bước', ecn: 'Quy trình ECN · 12 bước + PPAP', settings: 'Cài đặt',
    vault: 'Kho tài liệu', vaultTitle: 'Kho tài liệu',
    vaultSub: 'Mọi tài liệu của mọi dự án - mỗi tài liệu một dòng, kèm phiên bản hiện hành',
    steps: 'bước', projects: 'Dự án',

    dashboardTitle: 'Bảng điều khiển tổng hợp',
    dashboardSub: 'Tình trạng dự án, ma trận giai đoạn và tiến độ',
    claimedTitle: 'Công việc đã nhận', claimedSub: 'Công việc đã nhận hoặc được giao cho từng người',
    inputTitle: 'Nhập liệu', inputSub: 'Đăng ký dự án và nộp hồ sơ',
    npiTitle: 'Dự án NPI', npiSub: 'Quy trình giới thiệu sản phẩm mới 7 bước',
    ecnTitle: 'Dự án ECN', ecnSub: 'Quy trình thay đổi kỹ thuật 12 bước + PPAP',
    settingsTitle: 'Cài đặt', settingsSub: 'Dữ liệu gốc, nhân sự và cấu hình hệ thống',

    npiStageCompletion: 'Sơ đồ giai đoạn NPI',
    startWeek: 'Tuần bắt đầu', targetWeek: 'Tuần mục tiêu', today: 'Hôm nay',
    progress: 'Tiến độ',

    COMPLETE: 'Hoàn thành', IN_PROGRESS: 'Đang thực hiện', NOT_STARTED: 'Chưa bắt đầu',
    BYPASSED: 'Bỏ qua', LATE: 'Trễ hạn',

    save: 'Lưu', close: 'Đóng', del: 'Xóa', approve: 'Phê duyệt',
    claimTask: 'Nhận việc', assignTask: 'Giao việc',
    openInExplorer: 'Mở trong thư mục', cancel: 'Hủy',
  },
};
function getLang() {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'vi'; } catch (e) { return 'vi'; }
}
function setLang(v) { try { localStorage.setItem(LANG_KEY, v); } catch (e) { } }
function i18n(key) {
  const L = LOCALES[getLang()] || LOCALES.en;
  if (L[key] != null) return L[key];
  return LOCALES.en[key] != null ? LOCALES.en[key] : key;
}

function showLoader() {
  let l = document.getElementById('globalLoader');
  if (!l) {
    l = el('div', 'loader hide'); l.id = 'globalLoader';
    l.appendChild(el('div', 'loader-ring'));
    document.body.appendChild(l);
  }
  l.classList.remove('hide');
}
function hideLoader() {
  const l = document.getElementById('globalLoader');
  if (l) l.classList.add('hide');
}
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
/* v12: every /api/* call needs a signed-in session. A 401 means the session
   has ended (the launcher restarted, or 12 idle hours passed), so the browser
   goes back to the login page rather than leaving a screen full of failed
   requests. Wrapped once here because several views call fetch() directly
   instead of going through API.post. */
(function guardSession() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const r = await realFetch(input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    // Not while signing out: a request still in flight then would start a
    // second navigation to the login page and abort the first one.
    if (r.status === 401 && url.indexOf('/api/') !== -1 && url.indexOf('/api/auth/') === -1 && !window._signingOut) location.href = '/login.html';
    return r;
  };
})();

const API = {
  async data() { const r = await fetch('/api/data', { cache: 'no-store' }); if (!r.ok) throw await API.err(r); return r.json(); },
  async get(path) { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw await API.err(r); return r.json(); },
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
  async openPath(path) { return API.post('/api/open-path', { path }); },
  async post(path, body) {
    // charset spelled out: without it the server used to decode as cp1252 (v11 fix).
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
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
/* v12: who is using the app is whoever signed in on login.html. The server
   reports it with every /api/data (session), and overwrites the `user` of
   every request with it, so these are for display and for hiding controls a
   person may not use - never the thing that grants a right. Before v12 this
   was a name picked from a header dropdown and kept in localStorage, with a
   PIN in front of "admin". */
let SESSION = { user: '', role: '', department: '', is_admin: false };
let FOLDER = { levels: [], tokens: [] };   // common vault folder structure (Settings)
function getUser() { return SESSION.user || ''; }
function isAdmin() { return (getUser() || '').toLowerCase() === 'admin'; }
function isModerator() {
  const u = (getUser() || '').toLowerCase();
  return (CFG.moderators || []).some(function(m) { return String(m).toLowerCase() === u; });
}
function isPrivileged() { return isAdmin() || isModerator(); }

function takeData(d) {
  CFG = d.config; TRK = d.tracking; PATHS = d.paths || {};
  if (d.session && d.session.user) SESSION = d.session;
  FOLDER = { levels: d.folder_levels || [], tokens: d.folder_tokens || [] };
}
async function refresh() {
  takeData(await API.data());
  try { TEMPLATES = (await API.templates()).templates || []; } catch (e) { TEMPLATES = []; }
}

/* --------------------------------------------------------------- boot -- */
let reloadInFlight = false;
async function boot() {
  try {
    showLoader();
    await refresh();
    renderUserChip();
    $('#srvState').textContent = 'connected'; $('#srvState').className = badgeClass('Connected');
    $('#stamp').textContent = CFG.system_info.app_name + ' v' + CFG.system_info.version + '  ·  ' + nowLocal();
    buildTabs(); show(current);
    hideLoader();
    wireReloadButton();
    (function wireStopButton() {
      const sb = $('#stopBtn'); if (!sb) return;
      sb.title = getLang() === 'vi' ? 'Tắt máy chủ trên máy này' : 'Stop the server on this PC';
      sb.onclick = stopServerFlow;
    })();
    checkVaultRestoreBanner();
    (function wireSidebarToggle() {
      const btn = $('#sidebarToggle'); if (!btn) return;
      const KEY = 'wvn_sidebar_collapsed';
      const apply = (collapsed) => {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };
      let collapsed = false;
      try { collapsed = localStorage.getItem(KEY) === '1'; } catch (e) { }
      apply(collapsed);
      btn.onclick = () => {
        collapsed = !collapsed;
        apply(collapsed);
        try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) { }
      };
    })();
    /* Language toggle (v9.2.1). Re-renders through show(current, true) rather
       than reloading: preserveScroll keeps the user where they were, and the
       whole view is rebuilt from i18n() anyway, so the new language appears
       without losing the active tab or scroll position. */
    (function wireLangToggle() {
      const btn = $('#langToggleBtn'); if (!btn) return;
      const paint = () => {
        const lang = getLang();
        btn.innerHTML = lang === 'vi'
          ? '<b>VI</b> <span class="lang-dim">| EN</span>'
          : '<span class="lang-dim">VI |</span> <b>EN</b>';
        btn.setAttribute('aria-label', lang === 'vi' ? 'Đang dùng tiếng Việt' : 'English active');
        document.documentElement.setAttribute('lang', lang);
      };
      paint();
      btn.onclick = () => {
        setLang(getLang() === 'vi' ? 'en' : 'vi');
        paint();
        renderUserChip();
        show(current, true);
      };
    })();
    // Auto-reload checkbox — read persisted state, start timer if it was enabled
    (function() {
      var chk = $('#autoReloadChk'); if (!chk) return;
      if (localStorage.getItem('wvn_auto_reload') === '1') { chk.checked = true; startAutoReload(); }
      chk.onchange = function() {
        localStorage.setItem('wvn_auto_reload', chk.checked ? '1' : '0');
        chk.checked ? startAutoReload() : stopAutoReload();
      };
    })();
  } catch (e) {
    hideLoader();
    $('#views').innerHTML = '<div class="err"><b>Could not reach the local server.</b><br>' + esc(e.message) +
      '<br><br>Make sure <code>Open_WVN_NPI_Command_Center.cmd</code> is running, then reload this page.</div>';
    $('#srvState').textContent = 'offline'; $('#srvState').className = badgeClass('Offline');
  }
}

/* [viewId, i18n key, icon, pillarId]. The label is resolved at render time so
   switching language re-labels the rail without a reload. v11 R4: one tab per
   configured pillar (config.pillars[]), between Input and Settings - a new
   pillar gets its tab from config.json alone. */
const FIXED_TAB_IDS = ['dash', 'claimed', 'vault', 'input', 'settings'];
function tabList() {
  const t = [['dash', 'dashboard', 'layout-dashboard'], ['claimed', 'claimed', 'checklist'],
             ['vault', 'vault', 'folder-open'], ['input', 'input', 'file-import']];
  pillarDefs().forEach(pd => t.push([pillarTabId(pd.id), null, pd.icon, pd.id]));
  t.push(['settings', 'settings', 'settings']);
  return t;
}
function tabLabel(tab) { return tab[3] ? pillarTabLabel(pillarDef(tab[3])) : i18n(tab[1]); }
let current = 'dash';
function buildTabs() {
  const n = $('#tabs'); n.innerHTML = '';
  tabList().forEach(tab => {
    const [id, , iconName] = tab;
    const label = tabLabel(tab);
    const b = el('button', id === current ? 'on' : '');
    b.type = 'button';
    b.title = label;
    b.appendChild(icon(iconName));
    b.appendChild(el('span', 'tab-label', label));
    b.onclick = () => show(id);
    n.appendChild(b);
  });
}
function show(id, preserveScroll) {
  // v12.2: leaving the Input tab saves the categorizations staged there
  if (id !== current && current === 'input' && orphanStageCount()) {
    flushOrphanStage().then(function(r) {
      if (r.failed) alert(r.failed + ' categorization(s) could not be saved: ' + r.firstError + '\n\nGo back to Input to fix or undo them.');
    });
  }
  current = id; buildTabs();
  const pt = $('#pageTitle');
  // NB: the find callback is `tab`, not `t` — `t` is the translator and a
  // NB: the find callback is `tab`, not `t` — a bare `t` here would read as
  // the old translator name and invites re-introducing the shadowing bug.
  let activeTab = tabList().find(tab => tab[0] === id);
  // A tab id restored from an older session (or a pillar since removed)
  // falls back to the dashboard instead of rendering nothing.
  if (!activeTab) { id = 'dash'; current = id; buildTabs(); activeTab = tabList()[0]; }
  if (pt) pt.textContent = tabLabel(activeTab);
  closeDrawer();
  const v = $('#views'); v.innerHTML = '';
  // Reveal the loader only if the view build exceeds ~150ms — near-instant
  // tab switches shouldn't flash the full-screen overlay.
  const loaderTimer = setTimeout(showLoader, 150);
  if (activeTab[3]) viewPillar(v, activeTab[3]);
  else ({ dash: viewDashboard, claimed: viewClaimed, vault: viewVault, input: viewInput, settings: viewSettings })[id](v);
  clearTimeout(loaderTimer);
  hideLoader();
  if (preserveScroll) {
    // caller (restoreUiState) owns scroll restoration for this call
  } else if (justPickedTree) {
    justPickedTree = false;
    requestAnimationFrame(() => {
      const detail = $('#npiActiveHead') || $('#ecnActiveHead');
      if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    window.scrollTo(0, 0);
  }
}

/* Standard band at the top of a view: title, optional one-line subtitle,
   and an actions slot on the right. Returns the node; callers append their
   own buttons/controls into `.page-header-actions` via the returned
   `actions` reference. */
function pageHeader(title, subtitle) {
  const wrap = el('div', 'page-header');
  const left = el('div');
  left.appendChild(el('h2', 'page-header-title', title));
  if (subtitle) left.appendChild(el('div', 'page-header-sub', subtitle));
  const actions = el('div', 'page-header-actions');
  wrap.appendChild(left);
  wrap.appendChild(actions);
  wrap.actions = actions;
  return wrap;
}

async function redrawAfterWrite() {
  // v11.1 fix: this used to redraw the WHOLE current view unconditionally
  // (show(current, true)) after every single write anywhere in the app —
  // register a project, cite a link, categorize an orphan, anything. If the
  // user had half-typed something in an unrelated field on the same tab (the
  // next project's Family ID while filing evidence for this one, say), it was
  // silently wiped the moment any write completed. Now goes through the same
  // capture/restore the 15 s auto-reload already used, so typed-but-unsent
  // text, focus and scroll all survive a redraw regardless of what triggered it.
  const state = captureUiState();
  await refresh();
  renderUserChip();
  restoreUiState(state);
}
async function refreshSilently() {
  takeData(await API.data());
  try { TEMPLATES = (await API.templates()).templates || []; } catch (e) { TEMPLATES = []; }
}

/* ---- staged categorizations (v12.2) ----------------------------------------
   Input tab, section C ("Uncategorized files in the vault"). Categorizing used
   to POST at once and then reload the whole list, which made working through a
   pile of files slow: one round trip, one reload, one lost scroll position per
   file. Now each choice is only remembered - in this browser tab's
   sessionStorage, so a page refresh keeps it - and the whole set is posted,
   one file after another, when the person presses "Save changes", moves to
   another tab, signs out or stops the server. Closing the tab with choices
   still pending asks first (beforeunload).
   An entry is { action: 'adopt'|'ignore', label, body|reason, error? }, keyed
   by the file's vault-relative path. */
const ORPHAN_STAGE_KEY = 'wvn_orphan_stage_v1';
let _orphanStage = null;
function orphanStageStorageKey() { return ORPHAN_STAGE_KEY + ':' + getUser() + ':' + (PATHS.vault || ''); }
function orphanStage() {
  if (_orphanStage) return _orphanStage;
  let o = {};
  try { o = JSON.parse(sessionStorage.getItem(orphanStageStorageKey()) || '{}') || {}; } catch (e) { o = {}; }
  _orphanStage = o;
  return o;
}
function saveOrphanStage() {
  try {
    const st = orphanStage();
    if (Object.keys(st).length) sessionStorage.setItem(orphanStageStorageKey(), JSON.stringify(st));
    else sessionStorage.removeItem(orphanStageStorageKey());
  } catch (e) { }
}
function orphanStageCount() { return Object.keys(orphanStage()).length; }
function stageOrphan(path, item) { orphanStage()[path] = item; saveOrphanStage(); }
function unstageOrphan(path) { delete orphanStage()[path]; saveOrphanStage(); }
let orphanFlushing = null;
/* Posts every staged choice, in the order they were made. Each success leaves
   the stage; a failure stays, marked with its error, and the rest carry on.
   Resolves { saved, failed, firstError }. The data is reloaded once at the end,
   and only if something was written. */
async function flushOrphanStage() {
  if (orphanFlushing) return orphanFlushing;
  const st = orphanStage();
  const paths = Object.keys(st);
  if (!paths.length) return { saved: 0, failed: 0, firstError: '' };
  orphanFlushing = (async function() {
    const who = getUser();
    let saved = 0, failed = 0, firstError = '';
    for (const p of paths) {
      const it = st[p];
      try {
        if (it.action === 'adopt') {
          await API.post('/api/vault/orphans/adopt', Object.assign({ user: who }, it.body));
        } else {
          await API.action('lb_vault_ignored', { file_path: p, ignored_by: who, ignored_utc: new Date().toISOString(), reason: it.reason || '' },
            { audit: { user: who, action: 'Vault_Ignore_Orphan', projectId: '', objType: 'VaultFile', objId: p, from: 'Uncategorized', to: 'Ignored', detail: it.reason || '' } });
        }
        delete st[p]; saved++;
      } catch (e) {
        it.error = e.message; failed++;
        if (!firstError) firstError = e.message;
      }
    }
    saveOrphanStage();
    if (saved) { try { await redrawAfterWrite(); } catch (e) { } }
    return { saved: saved, failed: failed, firstError: firstError };
  })();
  try { return await orphanFlushing; } finally { orphanFlushing = null; }
}
window.addEventListener('beforeunload', function(ev) {
  if (orphanStageCount()) { ev.preventDefault(); ev.returnValue = ''; }
});

/* ---- project data in the vault (v12.2) ---------------------------------------
   The register, gate progress and documents live in <vault>\_vault, with a
   readable Project_Information.xlsx beside the documents, and the admin's
   settings are copied there too. A NEW copy of the app pointed at an existing
   vault therefore sees every project at once; only its settings start at the
   factory defaults, and this banner offers the vault's saved ones. */
async function restoreSettingsFromVault(writer) {
  const vi = getLang() === 'vi';
  await API.post('/api/vault/data/restore', { writer: writer || '' });
  alert(vi ? 'Đã khôi phục cài đặt từ kho. Trang sẽ tải lại.' : 'Settings restored from the vault. The page will reload.');
  location.reload();
}
async function checkVaultRestoreBanner() {
  if (!isAdmin()) return;
  let d;
  try { d = await API.get('/api/vault/data'); } catch (e) { return; }
  if (!d.restore_available || !d.restore_from) return;
  const stamp = d.restore_from.saved_utc;
  try { if (sessionStorage.getItem('wvn_restore_banner_off') === stamp) return; } catch (e) { }
  const vi = getLang() === 'vi';
  const b = el('div', 'banner warn vault-restore-banner');
  b.innerHTML = '<b>' + esc(vi ? 'Kho này có cài đặt đã lưu từ trước.' : 'This vault has settings saved earlier.') + '</b> ' +
    esc(vi
      ? 'Cài đặt do ' + (d.restore_from.by || 'admin') + ' lưu lúc ' + fmtStamp(stamp) + (d.restore_from.app_version ? ' (bản ' + d.restore_from.app_version + ')' : '') + ' khác với cài đặt của bản ứng dụng này. Các dự án và tiến độ đã được nạp từ kho; chỉ phần cài đặt (quy trình, loại tài liệu, cấu trúc thư mục...) cần khôi phục.'
      : 'Saved by ' + (d.restore_from.by || 'admin') + ' on ' + fmtStamp(stamp) + (d.restore_from.app_version ? ' (v' + d.restore_from.app_version + ')' : '') + ', they differ from this copy of the app. Projects and progress are already loaded from the vault; only the settings (processes, document types, folder structure ...) need restoring.');
  const acts = el('div'); acts.style.cssText = 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap';
  const go = el('button', 'primary sm', vi ? 'Khôi phục cài đặt từ kho' : 'Restore settings from the vault');
  go.onclick = async function() {
    if (!confirm(vi ? 'Thay cài đặt hiện tại bằng cài đặt đã lưu trong kho? Bản sao config.json hiện tại sẽ được giữ cạnh nó.' : 'Replace this copy\'s settings with the ones saved in the vault? The current config.json is kept beside it.')) return;
    go.disabled = true;
    try { await restoreSettingsFromVault(d.restore_from.writer); } catch (e) { alert(e.message); go.disabled = false; }
  };
  const later = el('button', 'sm', vi ? 'Để sau' : 'Not now');
  later.onclick = function() { try { sessionStorage.setItem('wvn_restore_banner_off', stamp); } catch (e) { } b.remove(); };
  acts.appendChild(go); acts.appendChild(later);
  b.appendChild(acts);
  const pb = document.querySelector('.page-body');
  if (pb) pb.insertBefore(b, pb.firstChild);
}
/* Settings -> "Projects" (admin, v12.4): every project, with Delete and, for a
   deleted one, Restore. Deleting is soft on purpose: the project gets status
   "Deleted" and disappears from every tab, report and the Excel copy, but its
   records and its documents stay in the vault and the admin can bring it back
   here. The reason is asked for and kept in the activity log. */
function projectsAdminCard(root) {
  const card = el('div', 'card');
  const hdr = el('div', 'card-header'); hdr.appendChild(el('h3', 'card-title', 'Projects')); card.appendChild(hdr);
  const body = el('div', 'card-body');
  body.appendChild(el('p', 'note', 'Delete a project registered by mistake or no longer needed. It disappears from every tab, report and Project_Information.xlsx; its documents stay in the vault and it can be restored here. Only the admin sees this list.'));
  const bar = el('div', 'filters');
  const q = el('input'); q.type = 'search'; q.placeholder = 'Filter by project, model, status…'; q.id = 'projAdminFilter'; q.style.minWidth = '260px';
  const showDel = el('label', 'note'); showDel.style.margin = '0';
  showDel.innerHTML = '<input type="checkbox" id="projAdminShowDel"> show deleted projects';
  bar.appendChild(q); bar.appendChild(showDel);
  body.appendChild(bar);
  const out = el('div', 'scroll'); out.innerHTML = '<p class="note" style="padding:8px">Loading…</p>';
  body.appendChild(out);
  card.appendChild(body); root.appendChild(card);
  let all = [];
  const fmtW = w => esc(w || '—');
  const draw = function() {
    const term = q.value.trim().toLowerCase();
    const withDel = $('#projAdminShowDel', bar).checked;
    const rows = all.filter(function(p) {
      if (p.status === 'Deleted' && !withDel) return false;
      if (!term) return true;
      return [p.project_id, p.family, p.prod_family, p.process, p.status, p.created_by].join(' ').toLowerCase().indexOf(term) >= 0;
    });
    const deletedN = all.filter(p => p.status === 'Deleted').length;
    $('#projAdminShowDel', bar).parentNode.lastChild.textContent = ' show deleted projects (' + deletedN + ')';
    if (!rows.length) { out.innerHTML = '<p class="note" style="padding:8px">No project matches.</p>'; return; }
    const t = el('table', 'proj-admin-table');
    t.innerHTML = '<thead><tr><th>Project</th><th>Model</th><th>Status</th><th>PRF → target</th><th class="num">Documents</th><th class="num">Open issues</th><th>Registered</th><th></th></tr></thead>';
    const tb = el('tbody');
    rows.forEach(function(p) {
      const tr = el('tr');
      const del = p.status === 'Deleted';
      if (del) tr.className = 'proj-deleted';
      tr.innerHTML = '<td><b>' + esc(p.project_id) + '</b><div class="note" style="margin:0">' + esc(p.process) + (p.prod_family ? ' · ' + esc(p.prod_family) : '') + '</div></td>' +
        '<td>' + esc(p.family || '—') + '</td>' +
        '<td>' + (del ? '<span class="badge bg-danger-lt">Deleted</span><div class="note" style="margin:0">' + esc(fmtStamp(p.deleted_utc)) + ' by ' + esc(p.deleted_by || '?') + (p.deleted_reason ? ' — ' + esc(p.deleted_reason) : '') + '</div>' : '<span class="badge bg-secondary">' + esc(p.status || 'Active') + '</span>') + '</td>' +
        '<td>' + fmtW(p.prf_date) + ' → ' + fmtW(p.target_date) + '</td>' +
        '<td class="num">' + p.documents + '</td><td class="num">' + (p.open_issues || '') + '</td>' +
        '<td>' + esc(fmtStamp(p.created_utc)) + '<div class="note" style="margin:0">' + esc(p.created_by || '') + '</div></td><td></td>';
      const acts = tr.lastChild; acts.style.whiteSpace = 'nowrap';
      if (del) {
        const rb = el('button', 'sm', 'Restore');
        rb.onclick = async function() {
          rb.disabled = true;
          try { await API.post('/api/projects/restore', { project_id: p.project_id }); await redrawAfterWrite(); }
          catch (e) { alert(e.message); rb.disabled = false; }
        };
        acts.appendChild(rb);
      } else {
        const db = el('button', 'sm danger', 'Delete');
        db.onclick = function() { deleteProjectModal(p); };
        acts.appendChild(db);
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    out.innerHTML = ''; out.appendChild(t);
  };
  q.oninput = draw;
  $('#projAdminShowDel', bar).onchange = draw;
  API.get('/api/projects/admin').then(function(d) { all = d.projects || []; draw(); })
    .catch(function(e) { out.innerHTML = '<p class="note" style="padding:8px;color:var(--bad)">Could not load the projects: ' + esc(e.message) + '</p>'; });
}
function deleteProjectModal(p) {
  formModal({
    title: 'Delete project ' + p.project_id + '?',
    html: '<p class="note">The project disappears from every tab, report and the Excel copy. ' +
      (p.documents ? 'Its ' + p.documents + ' document' + (p.documents === 1 ? '' : 's') + ' stay in the vault folder. ' : '') +
      'You can restore it later from this list.</p>' +
      '<label class="fld" style="margin-top:10px"><span>Reason (kept in the activity log)</span><input name="reason" style="width:100%" maxlength="300"></label>' +
      '<label class="fld" style="margin-top:10px"><span>Type <b>' + esc(p.project_id) + '</b> to confirm</span><input name="confirm" style="width:100%" autocomplete="off"></label>',
    ok: 'Delete project', danger: true,
    onOk: async function(box) {
      const reason = box.elements.reason.value.trim();
      if (!reason) throw new Error('Give a reason.');
      if (box.elements.confirm.value.trim().toUpperCase() !== p.project_id.toUpperCase()) throw new Error('Type the project ID exactly to confirm.');
      await API.post('/api/projects/delete', { project_id: p.project_id, reason: reason });
      await redrawAfterWrite();
    }
  });
}

/* Settings -> "Project data in the vault": what the vault holds, the readable
   Excel copy, and the settings snapshot. */
function vaultDataCard(root) {
  const card = el('div', 'card');
  const hdr = el('div', 'card-header'); hdr.appendChild(el('h3', 'card-title', 'Project data in the vault')); card.appendChild(hdr);
  const body = el('div', 'card-body');
  body.appendChild(el('p', 'note', 'The project register, progress by step, documents, approvals and issues are stored in the vault folder itself (not in the app folder), so a newer copy of the app pointed at this vault — see "Evidence vault location" below — finds all of it, and the app folder can be replaced or deleted. The same information is kept as an Excel file anyone can open.'));
  const out = el('div'); out.innerHTML = '<p class="note">Loading…</p>';
  body.appendChild(out);
  card.appendChild(body); root.appendChild(card);
  const draw = async function() {
    let d;
    try { d = await API.get('/api/vault/data'); }
    catch (e) { out.innerHTML = '<p class="note" style="color:var(--bad)">Could not read the vault data: ' + esc(e.message) + '</p>'; return; }
    out.innerHTML = '';
    if (!d.enabled) {
      const w = el('div', 'banner bad');
      w.innerHTML = '<b>The vault folder is not writable from this PC</b> — project data is still kept in the app folder. Check that the vault folder exists and you have permission to write to it.';
      out.appendChild(w);
    }
    const xl = d.info_workbook || {};
    const x = el('div'); x.style.cssText = 'margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    x.innerHTML = '<b>Project_Information.xlsx</b> <span class="note" style="margin:0">' + (xl.exists ? 'updated ' + esc(fmtStamp(xl.last_write_utc)) + ' · ' + Math.max(1, Math.round(xl.bytes / 1024)) + ' KB' : 'not written yet') + '</span>';
    const openB = el('button', 'primary sm', 'Open in Excel');
    openB.onclick = async function() {
      openB.disabled = true;
      try { await API.post('/api/vault/data/open', {}); } catch (e) { alert(e.message); }
      openB.disabled = false; draw();
    };
    const upB = el('button', 'sm', 'Update now');
    upB.onclick = async function() {
      upB.disabled = true;
      try { await API.post('/api/vault/data/export', {}); } catch (e) { alert(e.message); }
      upB.disabled = false; draw();
    };
    x.appendChild(openB); x.appendChild(upB);
    out.appendChild(x);
    out.appendChild(el('p', 'note', 'Read-only copy, refreshed a few seconds after anything changes. Sheets: Projects, Progress by step, Documents, Approvals, Issues, Bypasses, Comments, Activity log. Edits made in the file are not read back.'));
    // v12.3: old files named <name>_<8 hex> -> <name>_v1, _v2 ...
    if (isAdmin()) {
      const fnBox = el('div'); fnBox.style.cssText = 'margin:10px 0';
      fnBox.innerHTML = '<p class="note">Checking file names…</p>';
      out.appendChild(fnBox);
      API.get('/api/vault/rename-revisions').then(function(rr) {
        fnBox.innerHTML = '';
        if (!rr.files) { fnBox.appendChild(el('p', 'note', 'File names: none of the stored files ends in an old hash code. New files are named <name>_v1, _v2 …')); return; }
        const head = el('p'); head.innerHTML = '<b>' + rr.files + ' file' + (rr.files === 1 ? '' : 's') + '</b> still end in a hash code from an older version (for example <code>' + esc(rr.sample[0].from.split('\\').pop()) + '</code>). They can be renamed to versions — oldest first — and their records are updated with them.';
        fnBox.appendChild(head);
        const ul = el('div', 'note'); ul.style.cssText = 'font-family:monospace;white-space:pre-wrap;margin:4px 0';
        ul.textContent = rr.sample.map(function(s) { return s.from + '  →  ' + s.to.split('\\').pop(); }).join('\n') + (rr.files > rr.sample.length ? '\n… and ' + (rr.files - rr.sample.length) + ' more' : '');
        fnBox.appendChild(ul);
        const go = el('button', 'primary sm', 'Rename to _v1, _v2 …');
        go.onclick = async function() {
          if (!confirm('Rename ' + rr.files + ' file(s) in the vault to version names? Nothing is deleted; the file records are updated to the new names. Close anything that has these files open first.')) return;
          go.disabled = true;
          try {
            const res = await API.post('/api/vault/rename-revisions', {});
            alert('Renamed ' + res.renamed + (res.skipped ? ', skipped ' + res.skipped : '') + (res.errors.length ? '\n\nProblems:\n' + res.errors.join('\n') : '') + '.');
            await redrawAfterWrite();
          } catch (e) { alert(e.message); go.disabled = false; }
        };
        fnBox.appendChild(go);
      }).catch(function(e) { fnBox.innerHTML = '<p class="note" style="color:var(--bad)">Could not check the file names: ' + esc(e.message) + '</p>'; });
    }
    const labels = { lb_projects: 'Projects', lb_gates: 'Step records', lb_deliverables: 'Document records', lb_approvals: 'Approvals', lb_issues: 'Issues', lb_audit: 'Activity log entries' };
    const chips = el('div'); chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
    Object.keys(labels).forEach(function(k) { chips.innerHTML += '<span class="badge bg-secondary">' + esc(labels[k]) + ': ' + (d.stores[k] >= 0 ? d.stores[k] : '?') + '</span>'; });
    out.appendChild(chips);
    out.appendChild(el('p', 'note', 'Data folder: ' + (d.data_dir || '(not available)')));
    if ((d.writers || []).length) {
      const t = el('table');
      t.innerHTML = '<thead><tr><th>Written by (PC_user)</th><th>Files</th><th>Size</th><th>Last write</th></tr></thead>';
      const tb = el('tbody');
      d.writers.forEach(function(w) {
        const tr = el('tr');
        tr.innerHTML = '<td>' + esc(w.writer) + (w.mine ? ' <span class="badge bg-primary-lt">this PC</span>' : '') + '</td><td class="num">' + w.files + '</td><td class="num">' + Math.max(1, Math.round(w.bytes / 1024)) + ' KB</td><td>' + esc(fmtStamp(w.last_write_utc)) + '</td>';
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      const sc = el('div', 'scroll'); sc.appendChild(t); out.appendChild(sc);
    }
    if (d.old_location_files) {
      out.appendChild(el('p', 'note', d.old_location_files + ' journal file(s) from the app folder\'s old location were found; ' + d.old_location_in_vault + ' are already copied into the vault (nothing in the old location is deleted).'));
    }
    // settings
    const sh = el('h4', '', 'Settings saved in the vault'); sh.style.margin = '14px 0 4px'; out.appendChild(sh);
    if ((d.snapshots || []).length) {
      const s0 = d.snapshots[0];
      out.appendChild(el('p', 'note', 'Latest: ' + fmtStamp(s0.saved_utc) + ' by ' + (s0.by || 'the server') + ' on ' + s0.writer + (s0.app_version ? ' (app v' + s0.app_version + ')' : '') + '. ' + (d.settings_saved_utc ? 'This copy of the app last had its settings saved ' + fmtStamp(d.settings_saved_utc) + ' by ' + d.settings_saved_by + '.' : 'Nobody has saved settings in this copy of the app yet (it is on its original settings).')));
    } else {
      out.appendChild(el('p', 'note', 'No settings saved in this vault yet.'));
    }
    if (isAdmin()) {
      const row = el('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px';
      if (d.restore_available) {
        const rb = el('button', 'primary sm', 'Restore settings from the vault');
        rb.onclick = async function() {
          if (!confirm('Replace this copy\'s settings with the ones saved in the vault? The current config.json is kept beside it as config.before_restore_….json.')) return;
          rb.disabled = true;
          try { await restoreSettingsFromVault(d.restore_from.writer); } catch (e) { alert(e.message); rb.disabled = false; }
        };
        row.appendChild(rb);
      }
      const sb = el('button', 'sm', 'Save this copy\'s settings into the vault now');
      sb.onclick = async function() {
        sb.disabled = true;
        try { await API.post('/api/vault/data/snapshot', {}); } catch (e) { alert(e.message); }
        sb.disabled = false; draw();
      };
      row.appendChild(sb);
      out.appendChild(row);
      out.appendChild(el('p', 'note', 'Settings are saved into the vault automatically every time the admin changes them. Restoring keeps this PC\'s own vault location.'));
    }
  };
  draw();
}

/* ---- stop the server (v12.2) ------------------------------------------------
   The server is a background process with no window of its own, so this button
   is how a person ends it without Task Manager or Stop_Server.cmd. */
function stopServerFlow() {
  const vi = getLang() === 'vi';
  confirmModal(
    vi ? 'Tắt máy chủ?' : 'Stop the server?',
    '<p>' + esc(vi
      ? 'Máy chủ của ứng dụng trên máy này sẽ dừng và bạn (cùng bất kỳ ai đang dùng ứng dụng qua máy này) sẽ bị ngắt kết nối. Dữ liệu đã lưu không bị ảnh hưởng.'
      : 'The app\'s server on this PC will stop, and you (and anyone else using the app through this PC) will be disconnected. Saved data is not affected.') + '</p>' +
    '<p class="note">' + esc(vi ? 'Để mở lại, dùng biểu tượng "WVN Stage Gate Command Center" trên màn hình nền.' : 'To start it again, use the "WVN Stage Gate Command Center" icon on the desktop.') + '</p>',
    vi ? 'Tắt máy chủ' : 'Stop server',
    doStopServer);
}
async function doStopServer() {
  const vi = getLang() === 'vi';
  // choices still waiting in the Input tab are saved first
  try {
    const r = await flushOrphanStage();
    if (r.failed && !confirm((vi ? 'Một số lựa chọn chưa lưu được: ' : 'Some choices could not be saved: ') + r.firstError + '\n\n' + (vi ? 'Vẫn tắt máy chủ?' : 'Stop the server anyway?'))) return;
  } catch (e) { }
  stopAutoReload();
  try {
    const r = await fetch('/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{}' });
    if (r.status === 403) { alert(vi ? 'Máy chủ chỉ có thể tắt từ chính máy này.' : 'The server can only be stopped from the PC it runs on.'); return; }
  } catch (e) { /* the connection can drop while it stops - that is the expected outcome */ }
  const wrap = el('div', 'stopped');
  const card = el('div', 'card');
  card.innerHTML = '<div class="mark">⏻</div><div class="big">' + esc(vi ? 'Máy chủ đã tắt' : 'Server stopped') + '</div>' +
    '<p>' + esc(vi ? 'Bạn có thể đóng tab trình duyệt này.' : 'You can close this browser tab.') + '</p>' +
    '<p class="note">' + esc(vi ? 'Để mở lại, dùng biểu tượng "WVN Stage Gate Command Center" trên màn hình nền.' : 'To start it again, use the "WVN Stage Gate Command Center" icon on the desktop.') + '</p>';
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  // nothing is left to ask: no "unsaved changes" prompt on the way out
  _orphanStage = {};
}

/* ---- reload button & state-preserving reload ---- */
function wireReloadButton() {
  var btn = $('#reloadBtn');
  if (btn) btn.onclick = reloadPreservingState;
}

/* ---- drag-in-progress guard: skip auto-reload while a drag is active ----
   Document-level + capture phase so it catches every dropzone (some toggle
   .on, some .dragover, some inline styles). dragover fires repeatedly while
   dragging, so the 400ms timer keeps sliding; dragActive only clears once the
   drag stops — a drop, or the cursor leaving the window with no drop event. */
let dragActive = false;
let dragActiveTimer = null;
// Set true for the duration of any evidence/CSV upload POST (uploadEvidence,
// resolveWithFile, the batch CSV importer, the batch evidence "File all"
// loop) so a 15s background reload can never tear down the view while bytes
// are still in flight over the network.
window._isUploadingEvidence = false;
document.addEventListener('dragover', function(e) {
  dragActive = true;
  clearTimeout(dragActiveTimer);
  dragActiveTimer = setTimeout(function() { dragActive = false; }, 400);
}, true);
document.addEventListener('drop', function() {
  dragActive = false;
  clearTimeout(dragActiveTimer);
}, true);

function captureUiState() {
  var d = $('#drawer');
  return {
    tab: current,
    npiSel: npiSel,
    ecnSel: ecnSel,
    ecnMode: ecnMode,
    dashMatrixOpen: dashMatrixOpen,
    npiStageOpen: npiStageOpen,
    ganttExpanded: ganttExpanded,
    dashFamFilter: dashFamFilter.slice(),
    dashModelFilter: dashModelFilter.slice(),
    dashStartWeekFilter: dashStartWeekFilter.slice(),
    dashEndWeekFilter: dashEndWeekFilter.slice(),
    drawer: drawerContext ? {
      projectId: drawerContext.projectId,
      stepId: drawerContext.stepId,
      docCode: drawerContext.docCode
    } : null,
    pageY: window.scrollY,
    drawerScroll: d ? d.scrollTop : 0,
    // Nth .scroll container before reload = Nth after, because the same view
    // re-renders the same structure.
    containerScroll: $$('.scroll').map(function(node, i) {
      return { index: i, top: node.scrollTop, left: node.scrollLeft };
    }),
    // Typed-but-unsubmitted text. Only elements with a non-empty id are kept —
    // an id is the only safe way to re-find a field after a full re-render.
    inputsBuffer: $$('input[type=text], input[type=number], textarea')
      .filter(function(f) { return f.id; })
      .map(function(f) {
        return {
          id: f.id,
          value: f.value,
          selectionStart: f.selectionStart,
          selectionEnd: f.selectionEnd,
          focused: f === document.activeElement
        };
      })
  };
}

function restoreUiState(state) {
  npiSel = state.npiSel;
  ecnSel = state.ecnSel;
  ecnMode = state.ecnMode;
  dashMatrixOpen = state.dashMatrixOpen;
  npiStageOpen = state.npiStageOpen;
  ganttExpanded = state.ganttExpanded || {};
  dashFamFilter = state.dashFamFilter;
  dashModelFilter = state.dashModelFilter;
  dashStartWeekFilter = state.dashStartWeekFilter;
  dashEndWeekFilter = state.dashEndWeekFilter;
  show(state.tab, true);
  if (state.drawer) {
    var project = projById(state.drawer.projectId);
    if (project) {
      // stepsOf(), not allStepsOf() - the step list is filtered by the
      // project's change type, and reopening on a step this project does not
      // actually run would render a drawer for a gate that is not in its flow.
      var step = stepsOf(project.process, project).find(function(s) {
        return s.step_id === state.drawer.stepId;
      });
      if (step) {
        openDrawer(project, step, state.drawer.docCode);
      }
    }
  }
  // One requestAnimationFrame is not enough. The drawer is re-created by
  // openDrawer() and slides in over .18s, so for the first few frames it has
  // no scrollable height and scrollTop silently clamps back to 0 - the reload
  // looked like it worked and dropped the user at the top of the drawer every
  // time. Re-apply until the value sticks, then stop. Bounded so a genuinely
  // unscrollable drawer (short content) does not spin forever.
  var attempts = 0;
  var buffersApplied = false;
  (function applyScroll() {
    attempts++;
    window.scrollTo(0, state.pageY);
    var d = $('#drawer');
    if (d) d.scrollTop = state.drawerScroll;
    // Restore .scroll container positions by index order. Re-applied every
    // frame for the same reason as the drawer scrollTop above: a container
    // inside the sliding drawer has no scrollable height for its first few
    // frames and silently clamps back to 0. Indices that no longer exist
    // after reload are skipped gracefully.
    var containers = $$('.scroll');
    (state.containerScroll || []).forEach(function(c) {
      var node = containers[c.index];
      if (node) { node.scrollTop = c.top; node.scrollLeft = c.left; }
    });
    // Refill typed-but-unsubmitted text into freshly-rendered empty fields.
    // Applied once, after show()/openDrawer() have synchronously built the
    // DOM, and only when the fresh field is empty — never clobber a value the
    // server data legitimately populated. Only the field that was focused
    // before the reload gets focus + caret restored.
    if (!buffersApplied) {
      buffersApplied = true;
      (state.inputsBuffer || []).forEach(function(entry) {
        var target = document.getElementById(entry.id);
        if (!target || target.value !== '') return;
        target.value = entry.value;
        if (entry.focused) {
          target.focus();
          try {
            target.setSelectionRange(entry.selectionStart, entry.selectionEnd);
          } catch (e) { /* type=number and similar reject selection ranges */ }
        }
      });
    }
    var pageSettled = Math.abs(window.scrollY - state.pageY) < 2;
    var drawerSettled = !d || Math.abs(d.scrollTop - state.drawerScroll) < 2;
    if ((!pageSettled || !drawerSettled) && attempts < 30) requestAnimationFrame(applyScroll);
  })();
}

async function reloadPreservingState() {
  if (reloadInFlight) return;
  var btn = $('#reloadBtn');
  try {
    reloadInFlight = true;
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    var state = captureUiState();
    await refreshSilently();
    if (userIsMidAction()) return;
    restoreUiState(state);
  } finally {
    reloadInFlight = false;
    if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
  }
}

function userIsMidAction() {
  if (document.querySelector('.modal-backdrop, .modal-scrim')) return true;
  if (dragActive) return true;
  var el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
             el.contentEditable === 'true' || el.isContentEditable)) return true;
  // A Batch Project CSV is staged (picked, not yet imported) — .batch-file
  // only loses .hide once a file has been chosen; see setBatFile() in
  // viewInput()'s registration card.
  if (document.querySelector('.batch-file:not(.hide)')) return true;
  // Batch Evidence rows are staged (dropped, not yet filed) — #bRows is the
  // <tbody> the per-file rows render into in viewInput()'s uploader.
  var bRows = document.getElementById('bRows');
  if (bRows && bRows.children.length > 0) return true;
  // An upload POST is actively in flight (sidebar dropzone, issue-resolution
  // dropzone, batch CSV import, or the batch evidence "File all" loop).
  if (window._isUploadingEvidence) return true;
  return false;
}

function startAutoReload() {
  stopAutoReload();
  autoReloadId = setInterval(function() {
    if (reloadInFlight) return;
    if (userIsMidAction()) return;
    reloadPreservingState();
  }, 15000);
}

function stopAutoReload() {
  if (autoReloadId) { clearInterval(autoReloadId); autoReloadId = null; }
}

/* ------------------------------------------------------------ helpers -- */
function requireName() {
  // v12: the name is the signed-in user. It can only be missing if the
  // session ended under an open page, and then the next request sends the
  // browser to the login page anyway.
  const v = getUser();
  if (!v) { alert('Your session has ended. Sign in again.'); location.href = '/login.html'; return null; }
  return v;
}

/* ---- editable target week (Section 3) -----------------------------------
   HTML5 <input type="week"> speaks the same YYYY-Www format this whole app
   already uses (isoWeek()/weekToDate()), so no extra parsing is needed.
   `isDone` is supplied by the caller (gate: !!g.approval; deliverable: is
   this doc_code in c.done/c.filed) rather than re-derived here, since
   working that out generically would need the full cellStateFor() context
   this helper doesn't have. */
function isOverdueWeek(week, isDone) {
  return !!week && !isDone && week < nowWeek();
}
function makeTargetWeekEditor(objType, store, row, upsertKeys, isDone, onAfterSave) {
  const current = row.target_week || '';
  const wrap = el('span', 'target-week-editor');
  wrap.appendChild(el('span', 'note', 'Target week: '));
  const inp = el('input');
  inp.type = 'week';
  inp.value = current;
  inp.className = isOverdueWeek(current, isDone) ? 'target-week-overdue' : '';
  wrap.appendChild(inp);
  const saveBtn = el('button', 'sm', 'Save');
  saveBtn.onclick = async (e) => {
    e.stopPropagation();
    const who = requireName(); if (!who) return;
    saveBtn.disabled = true;
    try {
      const rowData = Object.assign({}, row);
      rowData.target_week = inp.value || '';
      if (store === 'lb_gates') {
        if (!rowData.process) rowData.process = '';
        if (!rowData.step_num) rowData.step_num = '';
        if (!rowData.step_name) rowData.step_name = '';
        if (!rowData.status) rowData.status = 'NotStarted';
        rowData.updated_utc = new Date().toISOString();
      }
      await API.action(store, rowData, {
        upsertKeys: upsertKeys,
        audit: { user: who, action: objType + '_SetTargetWeek', projectId: row.project_id, objType: objType,
          objId: rowData.step_key || rowData.deliverable_id || '', from: current, to: rowData.target_week, detail: '' }
      });
      // Every sibling button (Edit Assignment, Remove Owner, ...) refreshes
      // TRK before invoking its onAfter callback — this one didn't, so
      // onAfterSave's openDrawer() rebuilt from the stale pre-save row and
      // the just-saved target week appeared to vanish (still on disk, just
      // not yet reflected in memory).
      await refreshSilently();
      if (onAfterSave) onAfterSave();
      else await redrawAfterWrite();
    } catch (err) { alert('Could not save target week: ' + err.message); }
    saveBtn.disabled = false;
  };
  wrap.appendChild(saveBtn);
  if (isOverdueWeek(current, isDone)) wrap.appendChild(el('span', 'badge bg-danger target-week-badge', 'OVERDUE'));
  return wrap;
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

  // "Claimed by X" implies X self-claimed the task. When an admin/moderator
  // placed them here instead (row.assigned_by is set), the button must say
  // so - the badge below already gets this right via renderBadges(), but the
  // main button label did not until now.
  const btn = el('button', currentOwner ? 'claimed-btn' : 'primary',
    currentOwner ? (row.assigned_by ? 'Assigned to ' : 'Claimed by ') + currentOwner : 'Claim Task');
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

  btn.onclick = async (e) => {
    e.stopPropagation();
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
  btn.onclick = (e) => {
    e.stopPropagation();
    const admin = requireName(); if (!admin) return;
    const registry = (CFG && CFG.user_registry) || [];
    if (!registry.length) { alert('No registered users — add personnel in Settings → User Registry first.'); return; }

    const scrim = el('div', 'modal-scrim');
    const box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'assignModalTitle');
    box.innerHTML = '<h2 id="assignModalTitle">Assign Task</h2>';
    const body = el('div');
    const sel = el('select');
    registry.forEach(function(u) {
      const opt = el('option'); opt.value = u.username; opt.textContent = u.username + (u.role ? ' (' + u.role + ')' : '');
      sel.appendChild(opt);
    });
    const roleWrap = el('div');
    roleWrap.style.cssText = 'margin-top:8px;display:flex;gap:14px;align-items:center';
    const ownerLabel = el('label'); ownerLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-weight:400';
    const ownerRadio = el('input'); ownerRadio.type = 'radio'; ownerRadio.name = 'assignRole'; ownerRadio.value = 'owner'; ownerRadio.checked = true;
    ownerLabel.appendChild(ownerRadio); ownerLabel.appendChild(document.createTextNode('Primary Owner'));
    const supLabel = el('label'); supLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-weight:400';
    const supRadio = el('input'); supRadio.type = 'radio'; supRadio.name = 'assignRole'; supRadio.value = 'supporter';
    supLabel.appendChild(supRadio); supLabel.appendChild(document.createTextNode('Supporter'));
    roleWrap.appendChild(ownerLabel); roleWrap.appendChild(supLabel);
    body.appendChild(sel); body.appendChild(roleWrap);
    box.appendChild(body);

    const acts = el('div', 'acts');
    const no = el('button', '', 'Cancel');
    const yes = el('button', 'primary', 'Assign');
    // Same close/cleanup pattern as confirmModal - every close path shares
    // one teardown so the keydown listener never outlives the modal.
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    no.onclick = close;
    yes.onclick = () => { close(); doAssign(sel.value, ownerRadio.checked); };
    acts.appendChild(no); acts.appendChild(yes);
    box.appendChild(acts);
    scrim.appendChild(box);
    scrim.onclick = (ev) => { if (ev.target === scrim) close(); };
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(scrim);
  };

  async function doAssign(targetName, isPrimary) {
    const admin = getUser();
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
  }
  return btn;
}
/* ---- task lifecycle buttons ----------------------------------------------
   Four small actions wired next to Claim/Assign wherever a task row renders.
   Each returns a <button>, or null when the action does not apply to this
   row/viewer, so call sites append them unconditionally. All writes go
   through the same generic API.action(store, row, { upsertKeys, audit })
   endpoint used by claim/assign. */
/* ---- shared user_registry-backed picker modal --------------------------
   Replaces prompt() for every "type a name" input in the app. `fields` is
   [{ key, label, value, allowBlank }]; resolves to { key: username, ... }
   on Save, or null on Cancel/Escape/click-outside. Same scrim/box/keydown-
   cleanup structure as confirmModal. */
function userRegistrySelectModal(title, fields) {
  return new Promise(function(resolve) {
    const registry = (CFG && CFG.user_registry) || [];
    const scrim = el('div', 'modal-scrim');
    const box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'pickerModalTitle');
    box.innerHTML = '<h2 id="pickerModalTitle">' + esc(title) + '</h2>';
    const body = el('div');
    const selects = {};
    fields.forEach(function(f) {
      const fwrap = el('div');
      fwrap.style.cssText = 'margin-top:8px';
      const lab = el('label', null, f.label);
      lab.style.cssText = 'display:block;font-size:12px;font-weight:600;margin-bottom:4px';
      fwrap.appendChild(lab);
      const sel = el('select');
      sel.style.cssText = 'width:100%';
      if (f.allowBlank || !f.value) {
        const blankOpt = el('option', null, '(none)'); blankOpt.value = '';
        sel.appendChild(blankOpt);
      }
      registry.forEach(function(u) {
        const opt = el('option', null, u.username + (u.role ? ' (' + u.role + ')' : ''));
        opt.value = u.username;
        if (u.username === f.value) opt.selected = true;
        sel.appendChild(opt);
      });
      fwrap.appendChild(sel);
      body.appendChild(fwrap);
      selects[f.key] = sel;
    });
    box.appendChild(body);

    const acts = el('div', 'acts');
    const no = el('button', '', 'Cancel');
    const yes = el('button', 'primary', 'Save');
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
    const onEsc = (ev) => { if (ev.key === 'Escape') { close(); resolve(null); } };
    no.onclick = () => { close(); resolve(null); };
    yes.onclick = () => {
      const result = {};
      fields.forEach(function(f) { result[f.key] = selects[f.key].value; });
      close(); resolve(result);
    };
    acts.appendChild(no); acts.appendChild(yes);
    box.appendChild(acts);
    scrim.appendChild(box);
    scrim.onclick = (ev) => { if (ev.target === scrim) { close(); resolve(null); } };
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(scrim);
  });
}
/* ---- v12 account dialogs -------------------------------------------------
   formModal is the one dialog shell for everything account-related: change
   my password, re-enter the admin password, show a temporary password. Same
   scrim / Escape / click-outside behaviour as confirmModal; the difference
   is a real <form>, so Enter submits and the browser treats the password
   boxes as password boxes. onOk may throw (the message is shown in the
   dialog and it stays open) or return false (stay open, no message). */
function formModal(opts) {
  const scrim = el('div', 'modal-scrim');
  const box = el('form', 'modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'formModalTitle');
  box.autocomplete = 'off';
  box.innerHTML = '<h2 id="formModalTitle">' + esc(opts.title) + '</h2>' + (opts.html || '');
  const err = el('p', 'note'); err.style.color = 'var(--bad)'; err.setAttribute('role', 'alert');
  box.appendChild(err);
  const acts = el('div', 'acts');
  const no = el('button', '', opts.cancel || 'Cancel'); no.type = 'button';
  const yes = el('button', opts.danger ? 'danger' : 'primary', opts.ok || 'Save'); yes.type = 'submit';
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); if (opts.onClose) opts.onClose(); };
  const onEsc = ev => { if (ev.key === 'Escape') close(); };
  no.onclick = close;
  box.onsubmit = async ev => {
    ev.preventDefault();
    err.textContent = ''; yes.disabled = true;
    try {
      const r = opts.onOk ? await opts.onOk(box) : undefined;
      if (r === false) { yes.disabled = false; return; }
      close();
    } catch (e) { err.textContent = e.message; yes.disabled = false; }
  };
  if (!opts.noCancel) acts.appendChild(no);
  acts.appendChild(yes);
  box.appendChild(acts);
  scrim.appendChild(box);
  scrim.onclick = ev => { if (ev.target === scrim) close(); };
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(scrim);
  const first = box.querySelector('input,select,textarea') || yes;
  requestAnimationFrame(() => first.focus());
}
const pwField = (name, label) => '<label class="fld" style="margin-top:10px"><span>' + esc(label) + '</span><input type="password" name="' + name + '" style="width:100%"></label>';

function changePasswordModal() {
  formModal({
    title: 'Change my password',
    html: pwField('cur', 'Current password') + pwField('new1', 'New password (at least 8 characters)') + pwField('new2', 'Type it again'),
    ok: 'Save',
    onOk: async box => {
      const cur = box.elements.cur.value, a = box.elements.new1.value, b = box.elements.new2.value;
      if (a.length < 8) throw new Error('Use at least 8 characters.');
      if (a !== b) throw new Error('The two passwords are different.');
      await API.post('/api/auth/change-password', { current: cur, new: a });
      await redrawAfterWrite();
    }
  });
}
/* Resolves the admin password typed in the dialog, or null on Cancel. The
   caller sends it with the one request that needs it; it is not kept. */
function askAdminPassword(title, message) {
  return new Promise(resolve => {
    let answered = false;
    formModal({
      title: title, html: '<p class="note">' + esc(message) + '</p>' + pwField('pw', 'Admin password'), ok: 'Continue',
      onOk: box => { answered = true; resolve(box.elements.pw.value); },
      onClose: () => { if (!answered) resolve(null); }
    });
  });
}
/* A temporary password is shown exactly once: the server keeps only its hash. */
function tempPasswordModal(username, pw, issued) {
  formModal({
    title: 'Temporary password for ' + username,
    html: '<p class="note">Shown once. Give it to the user in person. They must choose their own password at their next sign-in.</p>' +
          '<div class="temp-pw" id="tempPwBox">' + esc(pw) + '</div>' +
          '<p class="note">' + (issued ? 'This account had no password until now.' : 'Their old password has stopped working and any open session of theirs has been signed out.') + '</p>',
    ok: 'Done', noCancel: true
  });
}
async function signOut() {
  try { await flushOrphanStage(); } catch (e) { }
  window._signingOut = true;
  stopAutoReload();
  try { await API.post('/api/auth/logout', {}); } catch (e) { }
  location.href = '/login.html';
}
function makeEditAssignmentButton(objType, store, row, upsertKeys, onAfterEdit) {
  const currentOwner = row.owner_pic || row.claimed_by || '';
  const currentSupporter = row.supporter_pic || row.supporter_by || '';
  if (!isPrivileged() && (!currentOwner || getUser() !== currentOwner)) return null;

  const btn = el('button', 'sm', 'Edit Assignment');
  btn.style.cssText = 'margin-left:4px';
  btn.onclick = async (e) => {
    e.stopPropagation();
    const who = requireName(); if (!who) return;
    const picked = await userRegistrySelectModal('Edit Assignment', [
      { key: 'owner', label: 'Owner', value: currentOwner, allowBlank: true },
      { key: 'supporter', label: 'Supporter', value: currentSupporter, allowBlank: true }
    ]);
    if (!picked) return;
    const newOwner = picked.owner;
    const newSupporter = picked.supporter;
    btn.disabled = true;
    try {
      const now = new Date().toISOString();
      const rowData = Object.assign({}, row);
      rowData.owner_pic = newOwner;
      rowData.claimed_by = newOwner;
      rowData.supporter_pic = newSupporter;
      rowData.supporter_by = newSupporter;
      if (newOwner !== currentOwner) rowData.claimed_utc = newOwner ? now : '';
      if (newSupporter !== currentSupporter) rowData.supporter_utc = newSupporter ? now : '';
      if (store === 'lb_gates') {
        if (!rowData.process) rowData.process = '';
        if (!rowData.step_num) rowData.step_num = '';
        if (!rowData.step_name) rowData.step_name = '';
        if (!rowData.status) rowData.status = 'NotStarted';
        rowData.updated_utc = now;
      }
      await API.action(store, rowData, {
        upsertKeys: upsertKeys,
        audit: { user: who, action: objType + '_EditAssignment', projectId: row.project_id, objType: objType,
          objId: rowData.step_key || rowData.deliverable_id || rowData.sp_id || rowData.raised_utc || '',
          from: currentOwner + '/' + currentSupporter, to: newOwner + '/' + newSupporter, detail: '' }
      });
      await redrawAfterWrite();
      if (onAfterEdit) onAfterEdit(newOwner, newSupporter);
    } catch (e) { alert('Edit assignment failed: ' + e.message); }
    btn.disabled = false;
  };
  return btn;
}
function makeRemoveOwnerButton(objType, store, row, upsertKeys, onAfterRemove) {
  const currentOwner = row.owner_pic || row.claimed_by || '';
  if (!currentOwner) return null;
  if (!isPrivileged() && getUser() !== currentOwner) return null;
  const currentSupporter = row.supporter_pic || row.supporter_by || '';

  const btn = el('button', 'sm', 'Remove Owner');
  btn.style.cssText = 'margin-left:4px';
  btn.onclick = (e) => {
    e.stopPropagation();
    const who = requireName(); if (!who) return;
    const promote = !!currentSupporter;
    confirmModal('Remove Owner',
      promote
        ? 'Remove <b>' + esc(currentOwner) + '</b> as owner? <b>' + esc(currentSupporter) + '</b> will be promoted to owner.'
        : 'Remove <b>' + esc(currentOwner) + '</b> as owner?',
      'Remove', async () => {
        btn.disabled = true;
        try {
          const now = new Date().toISOString();
          const rowData = Object.assign({}, row);
          if (promote) {
            rowData.owner_pic = currentSupporter;
            rowData.claimed_by = currentSupporter;
            rowData.claimed_utc = row.supporter_utc || now;
            rowData.supporter_pic = '';
            rowData.supporter_by = '';
            rowData.supporter_utc = '';
          } else {
            rowData.owner_pic = '';
            rowData.claimed_by = '';
            rowData.claimed_utc = '';
          }
          // Neither path is an assignment event - a promoted supporter was
          // never assigned by anyone, and an unowned task has no one left to
          // attribute an assignment to. Without this, the badge kept showing
          // "(Assigned by admin)" against whoever ended up here next, which
          // wrongly implied admin placed them.
          rowData.assigned_by = '';
          rowData.assigned_utc = '';
          await API.action(store, rowData, {
            upsertKeys: upsertKeys,
            audit: { user: who, action: objType + '_RemoveOwner', projectId: row.project_id, objType: objType,
              objId: rowData.step_key || rowData.deliverable_id || rowData.sp_id || rowData.raised_utc || '',
              from: currentOwner, to: currentSupporter, detail: promote ? 'Supporter promoted to owner' : 'Owner removed' }
          });
          await redrawAfterWrite();
          if (onAfterRemove) onAfterRemove();
        } catch (e) { alert('Remove owner failed: ' + e.message); }
        btn.disabled = false;
      });
  };
  return btn;
}
function makeRemoveSupporterButton(objType, store, row, upsertKeys, onAfterRemove) {
  const currentOwner = row.owner_pic || row.claimed_by || '';
  const currentSupporter = row.supporter_pic || row.supporter_by || '';
  if (!currentSupporter) return null;
  const me = getUser();
  if (!isPrivileged() && me !== currentOwner && me !== currentSupporter) return null;

  const btn = el('button', 'sm', 'Remove Supporter');
  btn.style.cssText = 'margin-left:4px';
  btn.onclick = (e) => {
    e.stopPropagation();
    const who = requireName(); if (!who) return;
    confirmModal('Remove Supporter',
      'Remove <b>' + esc(currentSupporter) + '</b> as supporter?',
      'Remove', async () => {
        btn.disabled = true;
        try {
          const rowData = Object.assign({}, row);
          rowData.supporter_pic = '';
          rowData.supporter_by = '';
          rowData.supporter_utc = '';
          await API.action(store, rowData, {
            upsertKeys: upsertKeys,
            audit: { user: who, action: objType + '_RemoveSupporter', projectId: row.project_id, objType: objType,
              objId: rowData.step_key || rowData.deliverable_id || rowData.sp_id || rowData.raised_utc || '',
              from: currentSupporter, to: '', detail: '' }
          });
          await redrawAfterWrite();
          if (onAfterRemove) onAfterRemove();
        } catch (e) { alert('Remove supporter failed: ' + e.message); }
        btn.disabled = false;
      });
  };
  return btn;
}
function makeDeleteTaskButton(objType, store, row, upsertKeys, onAfterDelete) {
  if (store !== 'lb_deliverables' && store !== 'lb_issues') return null;
  const currentOwner = row.owner_pic || row.claimed_by || '';
  if (!isPrivileged() && (!currentOwner || getUser() !== currentOwner)) return null;

  const btn = el('button', 'sm danger', 'Delete Task');
  btn.style.cssText = 'margin-left:4px';
  btn.onclick = (e) => {
    e.stopPropagation();
    const who = requireName(); if (!who) return;
    const oldStatus = row.status || '';
    const newStatus = store === 'lb_issues' ? 'Closed' : 'Removed';
    confirmModal('Delete Task',
      'This removes the task from active tracking. It stays in history.<br><br>' +
      'Status: <b>' + esc(oldStatus || 'not set') + '</b> ' + iconHtml('arrow-right') + ' <b>' + esc(newStatus) + '</b>',
      'Delete', async () => {
        btn.disabled = true;
        try {
          const rowData = Object.assign({}, row);
          rowData.status = newStatus;
          if (store === 'lb_issues' && rowData.closed_utc !== undefined) {
            rowData.closed_utc = new Date().toISOString();
          }
          await API.action(store, rowData, {
            upsertKeys: upsertKeys,
            audit: { user: who, action: objType + '_Delete', projectId: row.project_id, objType: objType,
              objId: rowData.step_key || rowData.deliverable_id || rowData.sp_id || rowData.raised_utc || '',
              from: oldStatus, to: newStatus, detail: '' }
          });
          await redrawAfterWrite();
          if (onAfterDelete) onAfterDelete();
        } catch (e) { alert('Delete task failed: ' + e.message); }
        btn.disabled = false;
      });
  };
  return btn;
}

/* ---- issue resolution dropzone (v8.3 Section 3) --------------------------
   A claimed/assigned open issue gets its own upload target: drop or pick a
   file and the issue closes itself with that file as the evidence, instead
   of requiring a separate "close this issue" action after filing something
   elsewhere. Unclaimed issues get no dropzone — same reasoning as the
   deliverable dropzones (uploadEvidence/dz.onclick above): resolving
   something nobody has taken ownership of is not a click anyone should be
   one drag-and-drop away from doing by accident. */
function issueResolveDropzone(project, onAfterResolve, issueRow) {
  const currentOwner = issueRow.owner_pic || issueRow.claimed_by || '';
  if (!currentOwner) return null;

  const dz = el('div', 'dz dz-issue-resolve');
  dz.innerHTML = '<b>Resolve this issue</b><br><span class="note">Drop resolution evidence or click to browse</span>';

  async function resolveWithFile(file) {
    window._isUploadingEvidence = true;
    try {
      const who = requireName(); if (!who) return;
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const b64 = dataUrl.split(',')[1];
      try {
        const up = await API.upload({
          fileName: file.name, contentBase64: b64, docType: 'ISSUE-RESOLUTION',
          family: project.family, wvnId: project.family, wnbId: project.customer_number || '',
          description: 'Issue Resolution', partId: '',
          // v12: lets the admin's folder structure use [ProjectID] / [Process]
          projectId: project.project_id
        });
        const rowData = Object.assign({}, issueRow);
        rowData.evidence_path = up.path;
        rowData.status = 'Closed';
        rowData.resolution = 'Resolved via uploaded evidence';
        rowData.closed_utc = new Date().toISOString();
        await API.action('lb_issues', rowData, {
          upsertKeys: ['issue_id'],
          audit: { user: who, action: 'Issue_Resolve', projectId: project.project_id, objType: 'Issue',
            objId: issueRow.issue_id, from: 'Open', to: 'Closed', detail: up.fileName }
        });
        // The ⚠ N badge on matrix cells counts lb_issues rows with
        // status !== 'Closed' — refreshing TRK before the redraw is what
        // actually makes it disappear, same as every other write in this file.
        await refreshSilently();
        if (onAfterResolve) onAfterResolve();
      } catch (err) { alert('Could not resolve the issue: ' + err.message); }
    } finally {
      window._isUploadingEvidence = false;
    }
  }

  dz.ondragover = e => { e.preventDefault(); dz.style.borderColor = 'var(--good)'; dz.style.background = 'var(--good2)'; };
  dz.ondragleave = () => { dz.style.borderColor = ''; dz.style.background = ''; };
  dz.ondrop = async e => {
    e.preventDefault();
    dz.style.borderColor = ''; dz.style.background = '';
    const files = e.dataTransfer.files;
    if (!files.length) return;
    await resolveWithFile(files[0]);
  };
  dz.onclick = (e) => {
    if (e.target.closest('button, a, input, select, label')) return;
    const inp = el('input'); inp.type = 'file'; inp.style.display = 'none';
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      await resolveWithFile(inp.files[0]);
    };
    document.body.appendChild(inp); inp.click(); document.body.removeChild(inp);
  };
  return dz;
}
const projectsOf = proc => TRK.lb_projects.filter(p => p.process === proc);
const projById = id => TRK.lb_projects.find(p => p.project_id === id);
const allStepsOf = proc => { const pd = pillarDef(proc); return pd ? pd.steps : []; };
const stepKeyOf = (proc, s) => proc + '-' + s.step_id;
const docTypeById = id => allDocTypes().find(d => d.doctype_id === id) || { doctype_id: id, name: id };

/* ===================================================================== */
/* v11 R4 - pillars: every process the app runs, from config.pillars[]   */
/* ===================================================================== */
/* Each pillar: process_id, name (+ _vi), EITHER its own ordered steps OR a
   'workflow' reference to a legacy workflow object (NPI -> npi_workflow,
   ECN -> ecn_workflow, so their definitions did not move), gate_mode
   ('all' = every step is a signed gate, 'flagged' = only steps with
   gate_clearance_required), pic_label (+ _vi), icon, approval_type, its own
   doc_types (added to the shared document_types catalogue), and feature
   flags for the process-specific extras: ppap, mwer, trial_by_step_name,
   gate_grouped_matrix, stage_completion. A config without pillars[] behaves
   exactly as before v11 (the fallback below is the old hardcoded pair). */
const LEGACY_PILLARS = [
  { process_id: 'NPI', workflow: 'npi_workflow', gate_mode: 'all', i18n: 'npi', icon: 'rocket', approval_type: 'Evidence-Based', features: { stage_completion: true } },
  { process_id: 'ECN', workflow: 'ecn_workflow', gate_mode: 'flagged', i18n: 'ecn', icon: 'git-branch', approval_type: 'Milestone',
    features: { ppap: true, mwer: true, trial_by_step_name: true, gate_grouped_matrix: true } }
];
const PILLAR_ICONS = ['rocket', 'git-branch', 'clipboard-check', 'building-factory-2', 'settings', 'shield-lock', 'chart-bar', 'files', 'table', 'users', 'calendar-event', 'star'];
let _pillarMemo = { cfg: null, list: [] };
function pillarDefs() {
  if (_pillarMemo.cfg === CFG && CFG) return _pillarMemo.list;
  const src = (CFG && CFG.pillars && CFG.pillars.length) ? CFG.pillars : LEGACY_PILLARS;
  const list = src.map(function(p) {
    const id = String(p.process_id || '').trim();
    const wf = p.workflow && CFG ? CFG[p.workflow] : null;
    return {
      id: id, raw: p, name: p.name || id, name_vi: p.name_vi || '',
      steps: (wf && wf.steps) || p.steps || [],
      workflow: p.workflow || '',
      gate_mode: p.gate_mode === 'flagged' ? 'flagged' : 'all',
      pic_label: p.pic_label || 'PIC', pic_label_vi: p.pic_label_vi || '',
      icon: PILLAR_ICONS.indexOf(p.icon) >= 0 ? p.icon : 'clipboard-check',
      i18n: p.i18n || '', approval_type: p.approval_type || '',
      features: p.features || {}, doc_types: p.doc_types || [],
      tab_label: p.tab_label || '', tab_label_vi: p.tab_label_vi || '',
      title: p.title || '', title_vi: p.title_vi || '', subtitle: p.subtitle || '', subtitle_vi: p.subtitle_vi || '',
      banner: p.banner || ''
    };
  }).filter(function(pd) { return pd.id; });
  _pillarMemo = { cfg: CFG, list: list };
  return list;
}
function pillarDef(pid) { return pillarDefs().find(function(pd) { return pd.id === pid; }) || null; }
function hasFeature(pid, f) { const pd = pillarDef(pid); return !!(pd && pd.features[f]); }
function pickLang(en, vi) { return (getLang() === 'vi' && vi) ? vi : en; }
function pillarName(pid) { const pd = pillarDef(pid); return pd ? pickLang(pd.name, pd.name_vi) : pid; }
function picLabel(pid) { const pd = pillarDef(pid); return pd ? pickLang(pd.pic_label, pd.pic_label_vi) : 'PIC'; }
/* Stable tab ids: the pillar id in lower case ('npi', 'ecn' - what saved UI
   state and the test suite already use), prefixed only if it would collide
   with a fixed tab. */
function pillarTabId(pid) {
  const low = String(pid).toLowerCase();
  return FIXED_TAB_IDS.indexOf(low) >= 0 ? 'p_' + low : low;
}
function pillarTabLabel(pd) {
  if (!pd) return '';
  if (pd.i18n) return i18n(pd.i18n);
  return pickLang(pd.tab_label, pd.tab_label_vi) || (pickLang(pd.name, pd.name_vi) + ' · ' + pd.steps.length + ' ' + i18n('steps'));
}
function pillarTitle(pd) { return pd.i18n ? i18n(pd.i18n + 'Title') : (pickLang(pd.title, pd.title_vi) || pickLang(pd.name, pd.name_vi) + ' ' + i18n('projects')); }
function pillarSubtitle(pd) {
  if (pd.i18n) return i18n(pd.i18n + 'Sub');
  return pickLang(pd.subtitle, pd.subtitle_vi) || (pd.steps.length + '-step ' + pickLang(pd.name, pd.name_vi) + ' workflow');
}
/* Shared catalogue + every pillar's own document types (first definition wins). */
let _docMemo = { cfg: null, list: [] };
function allDocTypes() {
  if (_docMemo.cfg === CFG && CFG) return _docMemo.list;
  const seen = {}, out = [];
  // Bracket access on purpose: every other allDocTypes() read outside
  // Settings is rewritten to allDocTypes(), and this one must stay the source.
  let src = ((CFG && CFG['document_types']) || []).slice();
  pillarDefs().forEach(function(pd) { src = src.concat(pd.doc_types); });
  src.forEach(function(d) { if (d && d.doctype_id && !seen[d.doctype_id]) { seen[d.doctype_id] = true; out.push(d); } });
  _docMemo = { cfg: CFG, list: out };
  return out;
}
/* Which steps a change type runs for a pillar: steps_by_process[pid] if the
   type defines it, else the legacy per-process fields, else all steps. */
function ctStepsFor(ct, pid) {
  if (!ct) return null;
  if (ct.steps_by_process && ct.steps_by_process[pid]) return ct.steps_by_process[pid];
  const legacy = ct[String(pid).toLowerCase() + '_steps'];
  return Array.isArray(legacy) ? legacy : null;
}
/* Gate columns for gate_grouped_matrix pillars: every non-gated step folds
   into the NEXT gated step's column (see groupCellStateFor). */
function gateGroupsOf(pid) {
  const steps = allStepsOf(pid);
  const groups = [];
  let bucket = [];
  steps.forEach(s => {
    bucket.push(s);
    if (isGated(pid, s)) { groups.push({ gate: s, steps: bucket }); bucket = []; }
  });
  if (bucket.length && groups.length) groups[groups.length - 1].steps = groups[groups.length - 1].steps.concat(bucket);
  else if (bucket.length) bucket.forEach(s => groups.push({ gate: s, steps: [s] }));
  return groups;
}

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
  if (allDocTypes().some(d => d.doctype_id === s)) return s;
  const m = s.match(/^([A-Za-z0-9_-]+)\s*[-—–]\s*/);
  if (m && allDocTypes().some(d => d.doctype_id === m[1])) return m[1];
  const byName = allDocTypes().find(d => d.name === s);
  if (byName) return byName.doctype_id;
  const lower = s.toLowerCase();
  const byNameCI = allDocTypes().find(d => d.name.toLowerCase() === lower);
  if (byNameCI) return byNameCI.doctype_id;
  const byIdCI = allDocTypes().find(d => d.doctype_id.toLowerCase() === lower);
  if (byIdCI) return byIdCI.doctype_id;
  return s;
}
function normaliseChangeTypeInput(val) {
  const s = (val || '').trim();
  if (!s) return '';
  if (changeTypes().some(t => t.type_id === s)) return s;
  // Datalist options read "Type <id> — <name> (…)" — the same "Type " prefix
  // the user is free to type themselves, e.g. "Type E - ECN".
  const m = s.match(/^Type\s+([A-Za-z0-9_-]+)\b/i);
  if (m && changeTypes().some(t => t.type_id === m[1])) return m[1];
  const lower = s.toLowerCase();
  const byName = changeTypes().find(t => t.name.toLowerCase() === lower);
  if (byName) return byName.type_id;
  const byIdCI = changeTypes().find(t => t.type_id.toLowerCase() === lower);
  if (byIdCI) return byIdCI.type_id;
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
  const def = allDocTypes().map(d =>
    '<option value="' + esc(d.doctype_id) + ' — ' + esc(d.name) + '">').join('');
  if (!project || !stepId) return def;
  const step = stepsOf(project.process, project).find(s => s.step_id === stepId);
  if (!step) return def;
  const req = step.required_evidence_doctypes || [];
  const cond = step.conditional_evidence_doctypes || [];
  const reqList = [], condList = [], restList = [];
  allDocTypes().forEach(d => {
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
  const allowed = ctStepsFor(ct, proc);
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

function isGated(proc, step) {
  const pd = pillarDef(proc);
  return pd && pd.gate_mode === 'flagged' ? !!step.gate_clearance_required : true;
}

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
  allDocTypes().forEach(d => {
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
  const doc = best ? best.doctype_id : (allDocTypes()[0] || {}).doctype_id;

  // step: the first workflow step that actually demands this document
  let step = null;
  pillarDefs().forEach(pd => {
    if (step != null) return;
    (pd.steps || []).forEach(s => {
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
  if (removedRow) return { level: 'REMOVED', del: removedRow, parts: [] };
  // Skip custom-doc marker rows that carry no actual evidence — those exist
  // only to declare a per-model requirement, not to represent a filed file.
  var realRows = rows.filter(function(r) {
    return r.file_name || r.link_url || r.file_path;
  });
  // v11 R1: the ACTIVE revision (is_active is derived by the server on every
  // read). Rows from an older server carry no flag - fall back to the last
  // row, which is exactly what the active revision was defined to reproduce.
  // v11.1: a doc_code can have MORE THAN ONE active row at once — one per BOM
  // part (part_id), each its own independent revision chain server-side (see
  // Set-DerivedRevisions). `del` stays a single row for every caller that only
  // ever wanted "the" evidence (a matrix cell, the PDF, a badge); `parts`
  // carries every active row for the places that need to show all of them —
  // the drawer's filed table and the Vault.
  var activeRows = realRows.filter(function(r) { return r.is_active === 'YES'; });
  if (!activeRows.length && realRows.length) activeRows = [realRows[realRows.length - 1]];
  var del = activeRows.length
    ? activeRows.slice().sort(function(a, b) { return (Date.parse(a.uploaded_utc) || 0) - (Date.parse(b.uploaded_utc) || 0); })[activeRows.length - 1]
    : null;
  if (del && del.approved === 'YES') return { level: 'APPROVED', del: del, parts: activeRows };
  if (del) return { level: 'FILED', del: del, parts: activeRows };
  // No file — check if someone has claimed, been assigned, or is supporting
  if (isDeliverableClaimed(pid, stepKey, docCode)) return { level: 'ON_GOING', del: null, parts: [] };
  return { level: 'MISSING', del: null, parts: [] };
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
  const canApprove = gated && !approval && missing.length === 0 && blocking.length === 0 && !priorBlocks;
  const stale = staleApprovalOf(project.project_id, sk, req, approval);
  return { sk, req, ev, cond, missing, removed, blocking, approval, bypass, gate, gated, status, done, canApprove, priorOpen, priorBlocks, stale };
}

/* v11 R1 - a signed gate is STALE when an active revision of one of its
   required documents (config-required or per-model custom) was filed after
   the signature. Derived and read-only: the approval row is history and is
   never edited or deleted. Mirrors Get-StaleApprovalMap in launcher.ps1,
   which feeds the XLSX exports - keep the two rules identical. */
function staleApprovalOf(pid, sk, reqCodes, approval) {
  if (!approval || !approval.approved_utc) return null;
  var when = Date.parse(approval.approved_utc);
  if (isNaN(when)) return null;
  var late = [];
  (TRK.lb_deliverables || []).forEach(function(d) {
    if (d.project_id !== pid || d.step_key !== sk || d.is_active !== 'YES') return;
    if (reqCodes.indexOf(d.doc_code) < 0) return;
    var tm = Date.parse(d.uploaded_utc);
    if (!isNaN(tm) && tm > when && late.indexOf(d.doc_code) < 0) late.push(d.doc_code);
  });
  return late.length ? { docs: late, approved_utc: approval.approved_utc } : null;
}
function staleText(stale) {
  return 'Signed ' + fmtStamp(stale.approved_utc) + ', but ' + stale.docs.join(', ') +
    (stale.docs.length > 1 ? ' were' : ' was') + ' revised afterwards - the signature no longer covers the current file(s).';
}
function staleBadgeHtml(stale) {
  if (!stale) return '';
  return '<span class="badge bg-warning stale-badge" title="' + esc(staleText(stale)) + '">' + iconHtml('alert-triangle') + ' approval stale</span>';
}
/* Local date + time for a stored ISO stamp; the raw value if it will not parse. */
function fmtStamp(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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

/* Who is on the hook for a step, and for which documents. Cross-references
   deliverables and approvals so the PIC column reads
   "Hoang (PFMEA, BOM) · QA Nga (CONTROL-PLAN)" instead of a bare name.
   Claimed and assigned work counts too, not just filed work — somebody who
   has taken PRF but not uploaded it yet is still the person to ask, so the
   column must name them rather than reading "nobody yet". */
function picsFor(pid, stepKey) {
  const by = {};
  function entry(who) {
    return (by[who] = by[who] || { docs: [], role: '', gateRoles: [] });
  }
  TRK.lb_deliverables.filter(d => d.project_id === pid && d.step_key === stepKey).forEach(d => {
    if (d.status === 'Removed') return;
    // A row can carry both a filer and a claimant, and they need not be the
    // same person — credit each separately against the same doc code.
    if (d.uploaded_by) { entry(d.uploaded_by).docs.push(d.doc_code); entry(d.uploaded_by).role = 'filed'; }
    const owner = d.owner_pic || d.claimed_by || '';
    if (owner) entry(owner).docs.push(d.doc_code);
    const supporter = d.supporter_pic || d.supporter_by || '';
    if (supporter) entry(supporter).docs.push(d.doc_code);
  });
  TRK.lb_approvals.filter(a => a.project_id === pid && a.step_key === stepKey).forEach(a => {
    const who = a.approved_by || '(unnamed)';
    entry(who).role = 'signed';
  });
  // Gate-level claims have no doc code of their own — the person owns the
  // whole step — so they get a role label instead of a document list.
  (TRK.lb_gates || []).filter(g => g.project_id === pid && g.step_key === stepKey).forEach(g => {
    const owner = g.owner_pic || g.claimed_by || '';
    if (owner) entry(owner).gateRoles.push('Owner');
    const supporter = g.supporter_pic || g.supporter_by || '';
    if (supporter) entry(supporter).gateRoles.push('Supporter');
  });
  return Object.keys(by).map(n => ({
    name: n,
    docs: by[n].docs.filter((v, i, s) => v && s.indexOf(v) === i),
    gateRoles: by[n].gateRoles.filter((v, i, s) => s.indexOf(v) === i),
    role: by[n].role
  }));
}

/* Folds one step's PICs into a project-row accumulator shared by the NPI and
   ECN matrices: name -> the labels shown in its parentheses. Gate roles and a
   bare signature land in the same list as document codes so a person reads as
   "Hoang (PFMEA, BOM)" or "M. Weber (Owner)" either way. */
function mergePicsInto(allPics, pid, stepKey) {
  picsFor(pid, stepKey).forEach(function(p) {
    const e = (allPics[p.name] = allPics[p.name] || []);
    p.docs.forEach(function(d) { if (e.indexOf(d) < 0) e.push(d); });
    p.gateRoles.forEach(function(r) { if (e.indexOf(r) < 0) e.push(r); });
    if (!e.length && p.role === 'signed' && e.indexOf('signed') < 0) e.push('signed');
  });
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
  // One badge per document, each on its own line, rather than one badge per
  // status with every doc code crammed into it — a status with 5 docs used
  // to render as a single unreadable comma-joined line.
  c.done.forEach(code => bits.push('<span class="' + badgeClass('COMPLETE') + '" title="approved">Done: ' + esc(code) + '</span>'));
  c.filed.forEach(code => bits.push('<span class="' + badgeClass('FILED') + '" title="filed, not signed">Filed: ' + esc(code) + '</span>'));
  c.ongoing.forEach(code => bits.push('<span class="' + badgeClass('ON_GOING') + ' mcell-doc-badge" data-doc-code="' + esc(code) + '" title="claimed or assigned, no file yet — click to open">On Going: ' + esc(code) + '</span>'));
  c.missing.forEach(code => bits.push('<span class="' + badgeClass('MISSING') + ' mcell-doc-badge" data-doc-code="' + esc(code) + '" title="required, nothing filed — click to open">Missing: ' + esc(code) + '</span>'));
  c.removed.forEach(code => bits.push('<span class="matrix-removed ' + badgeClass('NO_DATA') + '" title="removed from requirements">Removed: ' + esc(code) + '</span>'));
  // bits always holds the percentage line, so test the real content instead
  if (!c.done.length && !c.filed.length && !c.missing.length && !c.removed.length) bits.push('<span class="' + badgeClass('NO_DATA') + '">not started</span>');
  if (c.g.bypass) bits.push('<span class="' + badgeClass('BYPASSED') + '">bypassed</span>');
  if (c.g.stale) bits.push(staleBadgeHtml(c.g.stale));
  const nc = cellNoteCount(project, stepKeyOf(project.process, step));
  if (nc) bits.push('<span class="matrix-note-indicator" title="' + nc + ' note(s)">' + iconHtml('message-circle') + ' ' + nc + '</span>');
  // Overdue = a target_week is set, is in the past, and the thing it's on
  // still isn't done — a signed gate or a filed/approved doc clears it.
  var sk2 = stepKeyOf(project.process, step);
  var overdueCount = 0;
  if (isOverdueWeek(c.g.gate && c.g.gate.target_week, !!c.g.approval)) overdueCount++;
  c.missing.concat(c.ongoing).forEach(function(code) {
    var delRow = (TRK.lb_deliverables || []).find(function(x) { return x.project_id === project.project_id && x.step_key === sk2 && x.doc_code === code; });
    if (delRow && isOverdueWeek(delRow.target_week, false)) overdueCount++;
  });
  if (overdueCount) bits.push('<span class="badge bg-danger matrix-overdue-indicator" title="' + overdueCount + ' overdue">⏰ ' + overdueCount + ' overdue</span>');
  td.innerHTML = bits.join('<br>');
  td.querySelectorAll('.mcell-doc-badge').forEach(function(badge) {
    badge.style.cursor = 'pointer';
    badge.onclick = function(e) {
      e.stopPropagation();
      openDrawer(project, step, badge.getAttribute('data-doc-code'));
    };
  });
  return { td, c };
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
  root.appendChild(pageHeader(i18n('dashboardTitle'), i18n('dashboardSub')));
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

  /* Toolbar: PDF download, XLSX report selector, and download button. All kept off the printed page. */
  const toolbar = el('div', 'no-print');
  toolbar.className = 'no-print dash-toolbar';

  const pdfBtn = el('button', 'primary', 'Download PDF');
  pdfBtn.onclick = () => buildPrintPackage();
  toolbar.appendChild(pdfBtn);

  /* Report template download — pick a pre-made XLSX template, fill it with
     live data respecting the current slicer filters, and download it. */
  const reportSel = el('select'); reportSel.id = 'dashReportSelect';
  reportSel.className = 'dash-report-select';
  reportSel.innerHTML = '<option value="">— XLSX Report —</option>' +
    '<option value="lfi">Late Found Issue Analytics</option>' +
    '<option value="transfer">Project Transfer Report</option>' +
    '<option value="kpi">KPI Report</option>' +
    '<option value="ll">Lessons Learnt / LL Info Log</option>' +
    '<option value="trial">NPI Trial Production Report</option>';
  toolbar.appendChild(reportSel);

  const rptBtn = el('button', 'primary', 'Download');
  rptBtn.onclick = () => {
    const type = reportSel.value;
    if (!type) { alert('Select a report type first.'); return; }
    const p = new URLSearchParams({ type });
    // .length, not truthiness - these are arrays since the slicers went
    // multi-select, and an empty array is truthy, so every download was
    // sending fam=&model=&start=&end= regardless of what was selected.
    if (dashFamFilter.length) p.set('fam', dashFamFilter.join(','));
    if (dashModelFilter.length) p.set('model', dashModelFilter.join(','));
    if (dashStartWeekFilter.length) p.set('start', dashStartWeekFilter.join(','));
    if (dashEndWeekFilter.length) p.set('end', dashEndWeekFilter.join(','));
    // Cache buster. The server sends no-store now, but a stable download URL
    // is exactly the shape browsers are most eager to re-serve, and a stale
    // workbook is indistinguishable from a report that ignored your edits.
    p.set('_ts', String(Date.now()));
    const a = document.createElement('a');
    a.href = '/api/reports/download?' + p.toString();
    a.download = '';
    showLoader();
    a.click();
    setTimeout(hideLoader, 1500);
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
  // v11 R4: one matrix per pillar. Ids stay dashNpiMatrixWrap /
  // dashEcnMatrixWrap for the two original pillars.
  var matrixWraps = pillarDefs().map(function(pd) {
    var w = el('div'); w.id = 'dash' + pd.id.charAt(0) + pd.id.slice(1).toLowerCase() + 'MatrixWrap';
    root.appendChild(w);
    return { pd: pd, host: w };
  });
  var dashNpiMatrixWrap = matrixWraps.length ? matrixWraps[0].host : el('div');
  function renderPillarMatrices() {
    matrixWraps.forEach(function(m) {
      if (m.pd.features.gate_grouped_matrix) renderDashboardEcnMatrix(m.pd.id, m.host);
      else renderDashboardNpiMatrix(m.pd.id, m.host);
    });
  }

  // renderAll() is declared inside the IIFE further down that owns `wrap` and
  // renderCards(), so it is NOT in scope for the slicer onChange handlers up
  // here - calling it directly threw "renderAll is not defined" on every
  // slicer interaction, which silently left the matrices unfiltered while the
  // slicer button label happily showed the new selection. The IIFE publishes
  // it here instead.
  var dashRenderAll = null;

  function renderDashboardSlicers() {
    // Every pillar's projects - before v11 this read NPI projects only, so an
    // ECN project's family / model never appeared in the slicers at all.
    var allNpi = TRK.lb_projects.slice();
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
  function renderDashboardNpiMatrix(pid, host) {
    host.innerHTML = '';
    const list = filterDashboardProjects(pid);
    // Only skip the panel entirely when NO projects of this pillar are
    // registered at all. When filters hide all of them we still render the
    // panel with a hint.
    if (!projectsOf(pid).length) return;
    const steps = allStepsOf(pid);
    const proc = pid;

    const panel = el('div', 'card');
    const panelHdr = el('div', 'card-header');
    panelHdr.appendChild(el('h3', 'card-title', pillarName(pid) + ' — stage matrix'));
    panel.appendChild(panelHdr);
    const panelBody = el('div', 'card-body');

    const wrap = el('div', 'scroll');
    const t = el('table', 'matrix');

    t.innerHTML = '<thead><tr><th>Project</th>' +
      steps.map(s => '<th title="' + esc(s.step_name) + '">' + s.step_id + '. ' + esc(s.step_name) + '</th>').join('') +
      '<th>' + esc(picLabel(pid)) + '</th></tr></thead>';
    const tb = el('tbody');

    if (!list.length) {
      const emptyTr = el('tr'); const emptyTd = el('td');
      emptyTd.colSpan = 2 + steps.length;
      emptyTd.textContent = (dashFamFilter.length || dashModelFilter.length || dashStartWeekFilter.length || dashEndWeekFilter.length)
        ? 'No ' + pillarName(pid) + ' projects match the current filter.'
        : 'No ' + pillarName(pid) + ' projects registered yet.';
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
            '">' + iconHtml('alert-triangle') + ' ' + projIssues.length + '</span>';
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
              const badge = el('span', 'matrix-issue-badge');
              badge.appendChild(icon('alert-triangle'));
              badge.appendChild(document.createTextNode(' ' + stepIssues.length));
              badge.title = stepIssues.map(i => esc(i.title || i.issue_title || '(untitled)')).join('\n');
              td.appendChild(el('br'));
              td.appendChild(badge);
            }
            tr.appendChild(td);

            mergePicsInto(allPics, project.project_id, sk);
          }
        });

        const ptd = el('td');
        const names = Object.keys(allPics);
        ptd.innerHTML = names.length
          ? names.map(n => esc(n) + (allPics[n].length ? ' <span class="note">(' + allPics[n].map(esc).join(', ') + ')</span>' : '')).join('<br>')
          : '<span class="note">nobody yet</span>';
        tr.appendChild(ptd);
        tb.appendChild(tr);
      });
    }

    t.appendChild(tb); wrap.appendChild(t); panelBody.appendChild(wrap);
    panelBody.appendChild(el('p', 'note', 'Green means a named person signed the gate. Blue means the document is filed but nobody has signed for it. ' +
      'Red means the step requires it and nothing has been filed.'));
    panel.appendChild(panelBody);
    host.appendChild(panel);
  }

  // ---- ECN matrix (gate-grouped columns + PPAP) ---------------------------
  function renderDashboardEcnMatrix(pid, host) {
    host.innerHTML = '';
    const list = filterDashboardProjects(pid);
    // Only skip the panel entirely when NO projects of this pillar are registered at all.
    if (!projectsOf(pid).length) return;
    const proc = pid;
    const groups = gateGroupsOf(pid);
    const withPpap = hasFeature(pid, 'ppap');

    const panel = el('div', 'card');
    const panelHdr = el('div', 'card-header');
    panelHdr.appendChild(el('h3', 'card-title', pillarName(pid) + ' — stage matrix'));
    panel.appendChild(panelHdr);
    const panelBody = el('div', 'card-body');

    const wrap = el('div', 'scroll');
    const t = el('table', 'matrix');

    /* Gate column headers + PPAP column after them */
    const gateHeaders = groups.map(g => '<th title="' + esc(g.gate.step_name) + '">' +
      g.gate.step_id + '. ' + esc(g.gate.step_name) +
      '<div class="note">' + g.steps.map(s => s.step_id).join(', ') + '</div></th>').join('');
    t.innerHTML = '<thead><tr><th>Project</th>' + gateHeaders + (withPpap ? '<th>PPAP</th>' : '') + '<th>' + esc(picLabel(pid)) + '</th></tr></thead>';
    const tb = el('tbody');

    if (!list.length) {
      const emptyTr = el('tr'); const emptyTd = el('td');
      emptyTd.colSpan = (withPpap ? 3 : 2) + groups.length;
      emptyTd.textContent = (dashFamFilter.length || dashModelFilter.length || dashStartWeekFilter.length || dashEndWeekFilter.length)
        ? 'No ' + pillarName(pid) + ' projects match the current filter.'
        : 'No ' + pillarName(pid) + ' projects registered yet.';
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
            '">' + iconHtml('alert-triangle') + ' ' + projIssues.length + '</span>';
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
              if (gcs.g && gcs.g.stale) bits.push(staleBadgeHtml(gcs.g.stale));
              let groupNoteCount = 0;
              group.steps.forEach(function(gs) {
                if (on.indexOf(gs) >= 0) {
                  groupNoteCount += cellNoteCount(project, stepKeyOf(proc, gs));
                }
              });
              if (groupNoteCount) bits.push('<span class="matrix-note-indicator" title="' + groupNoteCount + ' note(s)">' + iconHtml('message-circle') + ' ' + groupNoteCount + '</span>');
              let groupOverdueCount = 0;
              group.steps.forEach(function(gs) {
                if (on.indexOf(gs) < 0) return;
                var gsk = stepKeyOf(proc, gs);
                var gateRow2 = gateRowOf(project.project_id, gsk);
                var gateApproved = !!(TRK.lb_approvals || []).filter(function(a) { return a.project_id === project.project_id && a.step_key === gsk; }).length;
                if (isOverdueWeek(gateRow2 && gateRow2.target_week, gateApproved)) groupOverdueCount++;
                (TRK.lb_deliverables || []).filter(function(x) { return x.project_id === project.project_id && x.step_key === gsk; }).forEach(function(delRow) {
                  var lvl = evidenceFor(project.project_id, gsk, delRow.doc_code).level;
                  var delDone = lvl === 'APPROVED' || lvl === 'FILED';
                  if (isOverdueWeek(delRow.target_week, delDone)) groupOverdueCount++;
                });
              });
              if (groupOverdueCount) bits.push('<span class="badge bg-danger matrix-overdue-indicator" title="' + groupOverdueCount + ' overdue">⏰ ' + groupOverdueCount + ' overdue</span>');
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
              const badge = el('span', 'matrix-issue-badge');
              badge.appendChild(icon('alert-triangle'));
              badge.appendChild(document.createTextNode(' ' + groupIssueCount));
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
            mergePicsInto(allPics, project.project_id, stepKeyOf(proc, step));
          });
        });

        // PPAP column — submission status from lb_ppap (pillars with the ppap feature)
        if (withPpap) (function() {
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
          ? names.map(function(n) { return esc(n) + (allPics[n].length ? ' <span class="note">(' + allPics[n].map(esc).join(', ') + ')</span>' : ''); }).join('<br>')
          : '<span class="note">nobody yet</span>';
        tr.appendChild(ptd);
        tb.appendChild(tr);
      });
    }

    t.appendChild(tb); wrap.appendChild(t); panelBody.appendChild(wrap);
    panelBody.appendChild(el('p', 'note', 'Green means a named person signed the gate. Blue means the document is filed but nobody has signed for it. ' +
      'Red means the step requires it and nothing has been filed. PPAP status shows submitted-vs-total items.'));
    panel.appendChild(panelBody);
    host.appendChild(panel);
  }

  /* =====================================================================
     NPI Stage Cards — below the matrices. Reads from the same
     filterDashboardProjects('NPI') the matrices use.
     ================================================================== */
  (function() {
    // v11 R4: the pillar flagged stage_completion (NPI by default). The doc
    // lists come from the pillar's own step definitions - they used to be a
    // hardcoded copy of npi_workflow's required documents.
    const scPid = ((pillarDefs().find(function(pd) { return pd.features.stage_completion; })) || {}).id || '';
    const npiSteps = allStepsOf(scPid);
    const NPI_DOCS = {};
    npiSteps.forEach(function(s) { NPI_DOCS[s.step_id] = (s.required_evidence_doctypes || []).slice(); });
    const allNpi = projectsOf(scPid);

    /* container for the stage-cards section — rebuilt on filter change */
    const wrap = el('div'); wrap.id = 'npiStageWrap';
    root.insertBefore(wrap, dashNpiMatrixWrap);

    /* proxy — delegates to the shared filterDashboardProjects at dashboard
       scope so the stage cards and both matrices always use the exact same
       filtered set */
    function filteredProjects() {
      return filterDashboardProjects(scPid);
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
        const sk = stepKeyOf(scPid, { step_id: snum });
        const docs = NPI_DOCS[snum] || [];
        const applicable = filtered.filter(p => stepsOf(scPid, p).some(s => s.step_id === snum));
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
          // Wrap chip + its missing-model bullet so the flex row above still
          // lines chips up, not their bullet lists.
          const chipWrap = el('div');
          chipWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px';
          chipWrap.appendChild(chip);
          const missingProjects = applicable.filter(p => {
            const lvl = evidenceFor(p.project_id, sk, code).level;
            return lvl !== 'APPROVED' && lvl !== 'FILED';
          });
          if (missingProjects.length) {
            chipWrap.appendChild(el('div', 'note doc-chip-missing', 'Missing: ' + missingProjects.map(p => p.project_id).join(', ')));
          }
          dd.appendChild(chipWrap);
        });
        card.appendChild(dd);
        container.appendChild(card);
      });
    }

    function renderAll() {
      // Re-render the slicer bar — always at the top
      renderDashboardSlicers();

      // Rebuild every pillar's matrix with the current filter state
      renderPillarMatrices();

      // Rebuild stage cards — collapsed by default (v9.2.1). The whole header
      // is the hit target, not just the chevron, so it behaves like the step
      // cards elsewhere in the app.
      wrap.innerHTML = '';
      if (!scPid) return;
      const head = el('button', 'section-toggle');
      head.type = 'button';
      head.setAttribute('aria-expanded', npiStageOpen ? 'true' : 'false');
      const cardHost = el('div', 'stage-grid'); cardHost.id = 'npiStageCards';
      cardHost.id = 'npiStageCards';

      function paintHead() {
        head.innerHTML = '';
        head.appendChild(icon(npiStageOpen ? 'chevron-down' : 'chevron-right'));
        head.appendChild(el('h3', null, scPid === 'NPI' ? i18n('npiStageCompletion') : pillarName(scPid) + ' Stage Completion'));
        head.setAttribute('aria-expanded', npiStageOpen ? 'true' : 'false');
        cardHost.className = npiStageOpen ? 'stage-grid' : 'stage-grid hide';
      }
      head.onclick = () => { npiStageOpen = !npiStageOpen; paintHead(); };

      wrap.appendChild(head);
      renderCards(cardHost);
      wrap.appendChild(cardHost);
      paintHead();
    }

    dashRenderAll = renderAll;
    renderAll();
  })();

  /* =====================================================================
     Work Matrix — Admin/Moderator only. One row per claimed/assigned piece
     of work (gate, deliverable, or issue) across every project, so a
     privileged user can see who owns what and when it's due without
     opening every project individually.
     ================================================================== */
  if (isPrivileged()) (function() {
    execWrap.appendChild(el('h3', null, 'Work Matrix'));
    const wmWrap = el('div', 'card');
    const wmBody = el('div', 'card-body');

    function targetWeekOf(project) {
      return toWeek(project.target_date) || targetDateFor(project.class_abcde, project.prf_date) || '';
    }

    function buildRows() {
      const rows = [];
      (TRK.lb_gates || []).forEach(g => {
        const owner = g.owner_pic || g.claimed_by || '';
        if (!owner) return; // unclaimed gates are not "someone's work" yet
        const project = projById(g.project_id);
        if (!project) return;
        rows.push({
          project_id: g.project_id, kind: 'Stage', item: g.step_name || g.step_key,
          owner, supporter: g.supporter_pic || g.supporter_by || '',
          week: targetWeekOf(project), status: g.status || 'NotStarted'
        });
      });
      (TRK.lb_deliverables || []).forEach(d => {
        const owner = d.owner_pic || d.claimed_by || '';
        if (!owner || d.status === 'Removed') return;
        const project = projById(d.project_id);
        if (!project) return;
        const status = d.approved === 'YES' ? 'Approved' : (d.file_name || d.link_url) ? 'Filed' : 'Claimed';
        rows.push({
          project_id: d.project_id, kind: 'Deliverable', item: d.doc_code,
          owner, supporter: d.supporter_pic || d.supporter_by || '',
          week: targetWeekOf(project), status
        });
      });
      (TRK.lb_issues || []).forEach(i => {
        const owner = i.owner || '';
        if (!owner || i.status === 'Closed') return;
        const project = projById(i.project_id);
        if (!project) return;
        rows.push({
          project_id: i.project_id, kind: 'Issue', item: i.description || i.category || 'Issue',
          owner, supporter: '',
          week: toWeek(i.due_date) || targetWeekOf(project), status: i.status || 'Open'
        });
      });
      return rows;
    }

    const allRows = buildRows();
    const owners = Array.from(new Set(allRows.map(r => r.owner))).sort();

    const filterBar = el('div', 'filters');
    filterBar.innerHTML = '<label>Owner</label>';
    const ownerSel = el('select');
    ownerSel.innerHTML = '<option value="">— all users (' + allRows.length + ' item(s)) —</option>' +
      owners.map(o => '<option value="' + esc(o) + '">' + esc(o) + ' (' + allRows.filter(r => r.owner === o).length + ')</option>').join('');
    filterBar.appendChild(ownerSel);
    wmBody.appendChild(filterBar);

    const tblHost = el('div', 'scroll');
    wmBody.appendChild(tblHost);

    function renderTable() {
      tblHost.innerHTML = '';
      const rows = ownerSel.value ? allRows.filter(r => r.owner === ownerSel.value) : allRows;
      if (!rows.length) { tblHost.appendChild(el('p', 'note', 'Nothing claimed or assigned yet.')); return; }
      const t = el('table');
      t.innerHTML = '<thead><tr><th>Project</th><th>Type</th><th>Item</th><th>Owner</th><th>Supporter</th><th>Target week</th><th>Status</th></tr></thead>';
      const tb = el('tbody');
      rows.forEach(r => {
        const tr = el('tr');
        tr.innerHTML = '<td>' + esc(r.project_id) + '</td>' +
          '<td>' + esc(r.kind) + '</td>' +
          '<td>' + esc(r.item) + '</td>' +
          '<td>' + esc(r.owner) + '</td>' +
          '<td>' + (r.supporter ? esc(r.supporter) : '<span class="note">—</span>') + '</td>' +
          '<td>' + (r.week ? esc(r.week) : '<span class="note">—</span>') + '</td>' +
          '<td><span class="' + badgeClass(r.status.toUpperCase().replace(/ /g, '_')) + '">' + esc(r.status.replace(/_/g, ' ')) + '</span></td>';
        tr.style.cursor = 'pointer';
        tr.onclick = () => {
          const project = projById(r.project_id);
          if (!project) return;
          const steps = stepsOf(project.process, project);
          const step = (r.kind === 'Stage' ? steps.find(s => s.step_name === r.item) : null) || steps[0];
          if (step) openDrawer(project, step, r.kind === 'Deliverable' ? r.item : null);
        };
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      tblHost.appendChild(t);
    }

    ownerSel.onchange = renderTable;
    renderTable();
    wmWrap.appendChild(wmBody);
    execWrap.appendChild(wmWrap);
  })();

  execWrap.appendChild(buildLiveGanttSection());
}

/* ---- Section 5: interactive Dashboard Gantt (planned vs actual) --------
   HTML/CSS bars, not the static print SVG (_buildSvgGantt) — this one needs
   real hover tooltips and click-to-open-drawer, which a raw SVG string
   built for a print snapshot has no use for. Respects the same dashboard
   slicers as buildPrintPackage, re-implemented inline for the same reason
   that function documents: the closure vars aren't exported. */
/* Per-segment start/end dates for a project's gated steps. A step with an
   explicit target_week anchors its segment's end there; steps without one
   interpolate evenly across the gap between the nearest anchors on either
   side (falling back to the project start/end), so the old equal-width
   behaviour survives only where no real dates exist. */
function segmentDateRanges(proc, project, steps, startDate, endDate) {
  var n = steps.length;
  if (!n) return [];
  var B = new Array(n + 1);
  B[0] = startDate.getTime();
  B[n] = endDate.getTime();
  steps.forEach(function(s, i) {
    var gate = gateRowOf(project.project_id, stepKeyOf(proc, s));
    if (gate && gate.target_week) {
      var d = weekToDate(gate.target_week);
      if (d) B[i + 1] = d.getTime();
    }
  });
  function boundaryT(m) {
    if (B[m] != null) return B[m];
    var lo = m - 1, hi = m + 1;
    while (lo > 0 && B[lo] == null) lo--;
    while (hi < n && B[hi] == null) hi++;
    return B[lo] + (B[hi] - B[lo]) * (m - lo) / (hi - lo);
  }
  var ranges = [];
  for (var i = 0; i < n; i++) {
    var s = new Date(boundaryT(i));
    var e = new Date(boundaryT(i + 1));
    if (e.getTime() < s.getTime()) e = new Date(s.getTime() + 86400000);
    ranges.push({ start: s, end: e });
  }
  return ranges;
}

/* Which department or role carries a step. The two workflows describe this
   differently and neither carries the other's field: ECN steps name a
   responsible_dept outright, NPI steps name the mandatory_approver whose
   sign-off closes the gate, and fall back to the phase label. */
function stepDeptOf(step) {
  return step.responsible_dept || step.mandatory_approver || step.phase || '—';
}

/* Who to chase on a step, condensed to one Gantt cell. picsFor() returns
   everyone who has touched the step with their document lists; the column is
   ~110px, so this takes the gate owner where one exists (they are the
   accountable party) and otherwise the first contributor, marking the rest
   as an overflow count rather than truncating a name mid-word. */
function ganttPicLabel(pid, stepKey) {
  var pics = picsFor(pid, stepKey);
  if (!pics.length) return '—';
  var owner = pics.filter(function(x) { return x.gateRoles.indexOf('Owner') >= 0; })[0];
  var lead = owner || pics[0];
  var extra = pics.length - 1;
  return lead.name + (extra > 0 ? ' +' + extra : '');
}

/* v12.4 Gantt look: a time-window switch (all / 12 / 6 months around today),
   a legend, a progress column, the planned window as a soft pill with the
   stage blocks inside it, a target diamond, a labelled "today" marker, arrows
   for a project that lies outside the window, and the projects that cannot be
   drawn yet (no PRF / target week) listed under the chart instead of silently
   missing. Class names the tests read are unchanged. */
let ganttRange = (function() { try { return localStorage.getItem('wvn_gantt_range') || 'all'; } catch (e) { return 'all'; } })();
function buildLiveGanttSection() {
  function filteredByProcess(process) {
    // dashFamFilter et al. are multi-select arrays, not scalars — see the
    // identical fix in buildPrintPackage's own copy of this closure for why
    // the naive `!==` comparison used here originally silently zeroed out
    // every project the instant any slicer array existed at all.
    var list = projectsOf(process);
    var any = dashFamFilter.length || dashModelFilter.length || dashStartWeekFilter.length || dashEndWeekFilter.length;
    if (!any) return list;
    return list.filter(function(p) {
      if (dashFamFilter.length && !dashFamFilter.includes(p.prod_family)) return false;
      if (dashModelFilter.length && !dashModelFilter.includes(p.family)) return false;
      if (dashStartWeekFilter.length) { var sw = toWeek(p.prf_date); if (!sw || !dashStartWeekFilter.includes(sw)) return false; }
      if (dashEndWeekFilter.length) {
        var ew = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date) || '';
        if (!ew || !dashEndWeekFilter.includes(ew)) return false;
      }
      return true;
    });
  }
  var projects = [];
  pillarDefs().forEach(function(pd) { projects = projects.concat(filteredByProcess(pd.id)); });

  var wrap = el('div', 'card gantt-live-wrap');
  var hdr = el('div', 'card-header gantt-head');
  hdr.appendChild(el('h3', 'card-title', 'Project Schedule (Gantt) — Planned vs Actual'));
  var rangeBox = el('div', 'gantt-range');
  rangeBox.setAttribute('role', 'group');
  rangeBox.setAttribute('aria-label', 'Time window');
  [['all', 'All'], ['12m', '12 months'], ['6m', '6 months']].forEach(function(opt) {
    var b = el('button', opt[0] === ganttRange ? 'on' : '', opt[1]);
    b.type = 'button';
    b.setAttribute('aria-pressed', opt[0] === ganttRange ? 'true' : 'false');
    b.onclick = function() {
      ganttRange = opt[0];
      try { localStorage.setItem('wvn_gantt_range', ganttRange); } catch (e) { }
      var host = wrap.parentNode;
      if (host) host.replaceChild(buildLiveGanttSection(), wrap);
    };
    rangeBox.appendChild(b);
  });
  hdr.appendChild(rangeBox);
  wrap.appendChild(hdr);
  var body = el('div', 'card-body');
  wrap.appendChild(body);

  var legend = el('div', 'gantt-legend');
  [['complete', 'Complete'], ['in_progress', 'In progress'], ['not_started', 'Not started'], ['late', 'Late'], ['bypassed', 'Bypassed']].forEach(function(l) {
    legend.insertAdjacentHTML('beforeend', '<span><i class="gantt-key gantt-stage-seg-' + l[0] + '"></i>' + l[1] + '</span>');
  });
  legend.insertAdjacentHTML('beforeend', '<span><i class="gantt-key gantt-key-planned"></i>Planned window</span>' +
    '<span><i class="gantt-key gantt-key-target"></i>Target</span><span><i class="gantt-key gantt-key-today"></i>' + esc(i18n('today')) + '</span>');
  body.appendChild(legend);

  var pairs = [], undated = [];
  projects.forEach(function(p) {
    var sw = toWeek(p.prf_date);
    var ew = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date) || '';
    var sd = weekToDate(sw);
    var ed = weekToDate(ew);
    if (sd && ed) {
      ed = new Date(ed); ed.setDate(ed.getDate() + 6);
      var proc = p.process;
      var allSteps = stepsOf(proc, p);
      var gated = allSteps.filter(function(s) { return isGated(proc, s); });
      pairs.push({
        project: p, startDate: sd, endDate: ed, targetWeek: ew,
        steps: allSteps, gatedSteps: gated,
        stepRanges: segmentDateRanges(proc, p, allSteps, sd, ed),
        gatedRanges: segmentDateRanges(proc, p, gated, sd, ed)
      });
    } else {
      undated.push(p);
    }
  });

  function undatedNote() {
    if (!undated.length) return null;
    var box = el('div', 'gantt-undated');
    box.appendChild(el('span', 'gantt-undated-title', 'Not on the chart yet — no PRF / target week (' + undated.length + '):'));
    undated.forEach(function(p) {
      var c = el('button', 'gantt-chip', p.project_id);
      c.type = 'button';
      c.title = 'Open ' + p.project_id + ' to set its PRF / target week';
      c.onclick = function() { var s = stepsOf(p.process, p)[0]; if (s) openDrawer(p, s, null); };
      box.appendChild(c);
    });
    return box;
  }

  if (!pairs.length) {
    body.appendChild(el('p', 'note', 'No projects with valid PRF/target weeks to chart' + (projects.length ? '' : ' for the current filters') + '.'));
    var un0 = undatedNote(); if (un0) body.appendChild(un0);
    return wrap;
  }

  /* The axis spans the segments, not just the projects: a gate's target week
     can sit past its project's own target — that is what a slipped gate looks
     like. In the 12 / 6 month views the axis is a fixed window around today
     instead, and whatever falls outside it is clipped by the track. */
  var DAY = 86400000;
  var minT, maxT;
  if (ganttRange === '12m' || ganttRange === '6m') {
    var nowT = new Date(); nowT.setHours(0, 0, 0, 0);
    var before = ganttRange === '12m' ? 13 : 8, after = ganttRange === '12m' ? 39 : 18;
    minT = nowT.getTime() - before * 7 * DAY;
    maxT = nowT.getTime() + after * 7 * DAY;
  } else {
    var bounds = [];
    pairs.forEach(function(x) {
      bounds.push(x.startDate.getTime(), x.endDate.getTime());
      x.stepRanges.concat(x.gatedRanges).forEach(function(r) { bounds.push(r.start.getTime(), r.end.getTime()); });
    });
    minT = Math.min.apply(null, bounds) - 7 * DAY;
    maxT = Math.max.apply(null, bounds) + 7 * DAY;
  }
  var spanMs = maxT - minT;

  var weekSet = new Map();
  var cursor = new Date(minT);
  while (cursor.getTime() <= maxT) {
    var wk = isoWeek(cursor);
    if (wk && !weekSet.has(wk)) { var wd = weekToDate(wk); if (wd) weekSet.set(wk, wd); }
    cursor.setDate(cursor.getDate() + 1);
  }
  var weekEntries = [];
  weekSet.forEach(function(d, w) { weekEntries.push({ week: w, date: d }); });
  weekEntries.sort(function(a, b) { return a.date - b.date; });

  function pctForDate(d) { return (d.getTime() - minT) / spanMs * 100; }
  function clampPct(v) { return Math.max(0, Math.min(100, v)); }

  var todayPct = pctForDate(new Date());
  var showTodayLine = todayPct >= 0 && todayPct <= 100;
  function todayLine() {
    var l = el('div', 'gantt-today-line');
    l.style.left = todayPct + '%';
    return l;
  }
  function meta(text, cls) {
    var c = el('div', 'gantt-live-meta-cell' + (cls ? ' ' + cls : ''), text);
    if (text && text !== '—') c.title = text;
    return c;
  }

  var weekPct = 7 * DAY / spanMs * 100;
  var firstWeekPct = weekEntries.length ? pctForDate(weekEntries[0].date) : 0;

  var grid = el('div', 'gantt-live-grid');
  body.appendChild(grid);

  /* Vertical week rules as one repeating gradient per track (see
     .gantt-live-track::before) — a div per week per row would allocate
     thousands of nodes on every 15 s auto-reload. */
  var ruleStep = Math.max(1, Math.ceil(1.7 / weekPct));
  var ruleSpan = 100 - firstWeekPct;
  grid.style.setProperty('--gantt-rule-offset', Math.max(0, firstWeekPct) + '%');
  grid.style.setProperty('--gantt-rule-period',
    (ruleSpan > 0 ? weekPct * ruleStep / ruleSpan * 100 : 100) + '%');

  /* Upper axis tier: month bands (the year only where it changes) and the
     labelled today marker. */
  var headTop = el('div', 'gantt-live-row gantt-live-header gantt-live-header-top');
  ['', '', '', '', '', ''].forEach(function(h) { headTop.appendChild(meta(h)); });
  var trackBand = el('div', 'gantt-live-track gantt-live-track-band');
  /* Band size follows the zoom: months when a month is wide enough to carry
     its name (~640 px track assumed), else quarters, else years — over a
     two-year portfolio every month label used to be clipped away. */
  var monthPct = weekPct * 4.35;
  var unit = monthPct * 6.4 >= 34 ? 'month' : (monthPct * 3 * 6.4 >= 40 ? 'quarter' : 'year');
  var bands = [];
  weekEntries.forEach(function(entry) {
    var y = entry.date.getFullYear(), m = entry.date.getMonth();
    var k = unit === 'month' ? m : (unit === 'quarter' ? Math.floor(m / 3) : 0);
    var last = bands[bands.length - 1];
    if (last && last.year === y && last.k === k) last.last = entry;
    else bands.push({ year: y, k: k, month: m, first: entry, last: entry });
  });
  bands.forEach(function(g, i) {
    var left = clampPct(pctForDate(g.first.date));
    var right = clampPct(pctForDate(g.last.date) + weekPct);
    var yearStart = unit === 'year' || g.k === 0;
    var band = el('div', 'gantt-band' + (yearStart ? ' gantt-band-year' : ''));
    band.style.left = left + '%';
    band.style.width = Math.max(0, right - left) + '%';
    var showYear = i === 0 || yearStart;
    var name = unit === 'month' ? MONTH_NAMES_SHORT[g.month] : (unit === 'quarter' ? 'Q' + (g.k + 1) : '');
    var label = unit === 'year' ? String(g.year) : (showYear ? name + (unit === 'month' ? " '" + String(g.year).slice(2) : ' ' + g.year) : name);
    // a band too narrow for its label drops it (container query in CSS); the tooltip keeps the date
    band.appendChild(el('span', 'gantt-band-label', label));
    band.title = unit === 'month' ? MONTH_NAMES_SHORT[g.month] + ' ' + g.year : label + (showYear ? '' : ' ' + g.year);
    trackBand.appendChild(band);
  });
  if (showTodayLine) {
    var pill = el('div', 'gantt-today-pill' + (todayPct > 94 ? ' at-right' : (todayPct < 6 ? ' at-left' : '')), i18n('today'));
    pill.style.left = todayPct + '%';
    pill.title = i18n('today') + ' (' + isoWeek(new Date()) + ')';
    trackBand.appendChild(pill);
  }
  headTop.appendChild(trackBand);
  grid.appendChild(headTop);

  /* Lower axis tier: bare week numbers, centred over the week they name. */
  var headerRow = el('div', 'gantt-live-row gantt-live-header');
  ['Project', 'Model · Process', 'Owner PIC', 'Progress', 'Issues', 'Notes'].forEach(function(h) { headerRow.appendChild(meta(h)); });
  var trackHeader = el('div', 'gantt-live-track gantt-live-track-header');
  var labelInterval = Math.max(1, Math.ceil(4.6 / weekPct));
  weekEntries.forEach(function(entry, i) {
    if (i % labelInterval !== 0) return;
    var mid = pctForDate(entry.date) + weekPct / 2;
    if (mid < 1 || mid > 99) return;
    var lbl = el('span', 'gantt-week-label', 'W' + entry.week.slice(-2));
    lbl.style.left = mid + '%';
    lbl.title = entry.week;
    trackHeader.appendChild(lbl);
  });
  if (showTodayLine) {
    var todayLineHeader = todayLine();
    todayLineHeader.title = i18n('today') + ' (' + isoWeek(new Date()) + ')';
    trackHeader.appendChild(todayLineHeader);
  }
  headerRow.appendChild(trackHeader);
  grid.appendChild(headerRow);

  function edgeHint(track, pair) {
    // a project entirely outside the current window says where it is
    if (pair.endDate.getTime() < minT) {
      track.appendChild(el('span', 'gantt-edge gantt-edge-left', '◀ ended ' + isoWeek(pair.endDate)));
    } else if (pair.startDate.getTime() > maxT) {
      track.appendChild(el('span', 'gantt-edge gantt-edge-right', 'starts ' + isoWeek(pair.startDate) + ' ▶'));
    }
  }
  function statusOf(p, proc, s) {
    var gs = gateState(p, proc, s);
    var st = gs.status;
    if (st !== 'COMPLETE' && st !== 'BYPASSED' && isOverdueWeek(gs.gate && gs.gate.target_week, gs.done)) st = 'LATE';
    return { gs: gs, st: st };
  }

  pairs.forEach(function(pair, rowIdx) {
    var p = pair.project;
    var proc = p.process;
    var pr = progressOf(p);
    var openCount = ((TRK.lb_issues || []).concat(TRK.lb_sp_issues || []))
      .filter(function(i) { return i.project_id === p.project_id && i.status !== 'Closed'; }).length;
    var commentCount = stepsOf(proc, p).reduce(function(sum, s) { return sum + cellNoteCount(p, stepKeyOf(proc, s)); }, 0);
    var expanded = !!ganttExpanded[p.project_id];

    var row = el('div', 'gantt-live-row gantt-proj-row' + (expanded ? ' is-open' : ''));
    row.style.cursor = 'pointer';
    /* The project id stays the cell's only text — the toggle is icon-only so
       that reading a row's identity off .gantt-live-meta-cell:first-child
       still yields a bare project id. */
    var projCell = el('div', 'gantt-live-meta-cell gantt-proj-cell');
    var toggle = el('button', 'gantt-expand');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.title = (expanded ? 'Hide' : 'Show') + ' the step breakdown for ' + p.project_id;
    toggle.appendChild(icon('chevron-right'));
    toggle.onclick = function(e) {
      e.stopPropagation();
      if (ganttExpanded[p.project_id]) delete ganttExpanded[p.project_id];
      else ganttExpanded[p.project_id] = true;
      var host = wrap.parentNode;
      if (host) host.replaceChild(buildLiveGanttSection(), wrap);
      else show(current, true);
    };
    projCell.appendChild(toggle);
    projCell.appendChild(el('span', 'gantt-proj-id', p.project_id));
    row.appendChild(projCell);
    var model = meta((p.family || '—') + ' · ' + proc, 'gantt-model');
    model.title = (p.family || '') + (p.prod_family ? ' — ' + p.prod_family : '') + ' (' + proc + ')';
    row.appendChild(model);
    row.appendChild(meta(p.market_manager || '—'));
    var progCell = el('div', 'gantt-live-meta-cell gantt-progress-cell');
    progCell.innerHTML = '<span class="gantt-progress"><i style="width:' + Math.max(0, Math.min(100, pr.pct)) + '%"></i></span><b>' + pr.pct + '%</b>';
    progCell.title = pr.done + ' of ' + pr.total + ' gates done';
    row.appendChild(progCell);
    var issuesCell = el('div', 'gantt-live-meta-cell');
    if (openCount) issuesCell.innerHTML = '<span class="matrix-issue-badge">' + iconHtml('alert-triangle') + ' ' + openCount + '</span>';
    row.appendChild(issuesCell);
    var commentsCell = el('div', 'gantt-live-meta-cell');
    if (commentCount) commentsCell.innerHTML = '<span class="matrix-note-indicator">' + iconHtml('message-circle') + ' ' + commentCount + '</span>';
    row.appendChild(commentsCell);

    var track = el('div', 'gantt-live-track');
    var plannedLeft = pctForDate(pair.startDate);
    var plannedWidth = Math.max(0.5, pctForDate(pair.endDate) - plannedLeft);
    var plannedBar = el('div', 'gantt-bar gantt-bar-planned');
    plannedBar.style.left = plannedLeft + '%';
    plannedBar.style.width = plannedWidth + '%';
    track.appendChild(plannedBar);

    pair.gatedSteps.forEach(function(s, idx) {
      var so = statusOf(p, proc, s), gs = so.gs, segStatus = so.st;
      var r = pair.gatedRanges[idx];
      var segLeft = pctForDate(r.start);
      var seg = el('div', 'gantt-bar gantt-bar-actual gantt-stage-seg gantt-stage-seg-' + segStatus.toLowerCase());
      seg.style.left = segLeft + '%';
      seg.style.width = Math.max(0.4, pctForDate(r.end) - segLeft) + '%';
      seg.appendChild(el('span', 'gantt-stage-label', 'S' + s.step_id));
      seg.title = p.project_id + ' — Step ' + s.step_id + ': ' + s.step_name + ' (S' + s.step_id + ')\n' +
        'Start: ' + isoWeek(r.start) + ' | End: ' + isoWeek(r.end) + '\n' +
        'Status: ' + segStatus.replace(/_/g, ' ') + ' (' + (gs.req.length - gs.missing.length) + '/' + gs.req.length + ' docs filed)' +
        (gs.stale ? '\nAPPROVAL STALE - ' + staleText(gs.stale) : '');
      if (gs.stale) seg.classList.add('gantt-stale');
      seg.onclick = function(e) { e.stopPropagation(); openDrawer(p, s, null); };
      track.appendChild(seg);
      if (idx > 0) {
        var sep = el('div', 'gantt-stage-separator');
        sep.style.left = segLeft + '%';
        track.appendChild(sep);
      }
    });
    var tgtPct = pctForDate(pair.endDate);
    if (tgtPct >= 0 && tgtPct <= 100) {
      var dia = el('div', 'gantt-milestone');
      dia.style.left = tgtPct + '%';
      dia.title = 'Target ' + pair.targetWeek + (p.target_date ? '' : ' (computed from the change type)');
      track.appendChild(dia);
    }
    edgeHint(track, pair);
    if (showTodayLine) track.appendChild(todayLine());

    track.title = p.project_id + ' (' + proc + ')\n' +
      'Planned: ' + isoWeek(pair.startDate) + ' → ' + isoWeek(pair.endDate) + '\n' +
      'Actual progress: ' + pr.pct + '% (' + pr.done + '/' + pr.total + ' gates)\n' +
      'Open issues: ' + openCount + ' · Comments: ' + commentCount;
    row.title = track.title;
    row.appendChild(track);
    row.onclick = function() {
      var target = firstIncompleteStepOf(p, proc) || stepsOf(proc, p)[0];
      if (target) openDrawer(p, target, null);
    };
    grid.appendChild(row);

    if (!expanded) return;

    /* One sub-row per step on the shared time axis — every applicable step,
       not only the gated ones the parent row segments. */
    pair.steps.forEach(function(s, idx) {
      var sk = stepKeyOf(proc, s);
      var so = statusOf(p, proc, s), gs = so.gs, st = so.st;
      var r = pair.stepRanges[idx];
      var stepIssues = ((TRK.lb_issues || []).concat(TRK.lb_sp_issues || []))
        .filter(function(i) { return i.project_id === p.project_id && i.step_key === sk && i.status !== 'Closed'; }).length;
      var stepNotes = cellNoteCount(p, sk);

      var sub = el('div', 'gantt-sub-row');
      sub.style.cursor = 'pointer';
      sub.appendChild(meta('Step ' + s.step_id + ': ' + s.step_name, 'gantt-sub-name'));
      sub.appendChild(meta(stepDeptOf(s)));
      sub.appendChild(meta(ganttPicLabel(p.project_id, sk)));
      var docs = el('div', 'gantt-live-meta-cell gantt-sub-docs');
      docs.textContent = gs.req.length ? (gs.req.length - gs.missing.length) + '/' + gs.req.length + ' docs' : '';
      sub.appendChild(docs);
      var subIssues = el('div', 'gantt-live-meta-cell');
      if (stepIssues) subIssues.innerHTML = '<span class="matrix-issue-badge">' + iconHtml('alert-triangle') + ' ' + stepIssues + '</span>';
      sub.appendChild(subIssues);
      var subNotes = el('div', 'gantt-live-meta-cell');
      if (stepNotes) subNotes.innerHTML = '<span class="matrix-note-indicator">' + iconHtml('message-circle') + ' ' + stepNotes + '</span>';
      sub.appendChild(subNotes);

      var subTrack = el('div', 'gantt-live-track gantt-sub-track');
      var subLeft = pctForDate(r.start);
      /* Colour comes from the same .gantt-stage-seg-<status> classes the
         parent segments use; the geometry class differs because the tests
         count .gantt-stage-seg as the parent's segments only. */
      var bar = el('div', 'gantt-bar gantt-sub-bar gantt-stage-seg-' + st.toLowerCase());
      bar.style.left = subLeft + '%';
      bar.style.width = Math.max(0.4, pctForDate(r.end) - subLeft) + '%';
      bar.appendChild(el('span', 'gantt-stage-label', 'S' + s.step_id));
      var tw = gs.gate && gs.gate.target_week;
      bar.title = p.project_id + ' — Step ' + s.step_id + ': ' + s.step_name + '\n' +
        'Start: ' + isoWeek(r.start) + ' | End: ' + isoWeek(r.end) +
        (tw ? ' (target ' + tw + ')' : ' (no target week set — interpolated)') + '\n' +
        'Status: ' + st.replace(/_/g, ' ') +
        ' (' + (gs.req.length - gs.missing.length) + '/' + gs.req.length + ' docs filed)' +
        (stepIssues ? '\nOpen issues: ' + stepIssues : '') +
        (isGated(proc, s) ? '' : '\nNo gate clearance required on this step') +
        (gs.stale ? '\nAPPROVAL STALE - ' + staleText(gs.stale) : '');
      if (gs.stale) bar.classList.add('gantt-stale');
      bar.onclick = function(e) { e.stopPropagation(); openDrawer(p, s, null); };
      subTrack.appendChild(bar);
      if (tw) {
        var twPct = pctForDate(r.end);
        if (twPct >= 0 && twPct <= 100) { var d2 = el('div', 'gantt-milestone gantt-milestone-sm'); d2.style.left = twPct + '%'; d2.title = 'Step target ' + tw; subTrack.appendChild(d2); }
      }
      if (showTodayLine) subTrack.appendChild(todayLine());
      sub.appendChild(subTrack);
      sub.onclick = function() { openDrawer(p, s, null); };
      grid.appendChild(sub);
    });
  });

  var un = undatedNote(); if (un) body.appendChild(un);
  return wrap;
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

/* ---- buildPrintPackage — 3-page A4 executive PDF (v4.1 Task 2) ---------
   Populates the hidden #dashPrintPackage container from the CURRENTLY
   FILTERED project set (respects the dashboard slicers), then calls
   window.print(). Called by the Dashboard "Download PDF" button.  --------- */
function buildPrintPackage() {
  showLoader();
  /* Re-implement the filter logic inline (global dash*Filter vars are
     already set by the dashboard slicers; this mirrors the closure inside
     viewDashboard exactly so the printed report matches the screen. */
  function filteredByProcess(process) {
    // dashFamFilter et al. are multi-select arrays (see viewDashboard's own
    // filtering around line 1598, the source of truth for this pattern) -
    // this closure used to compare them as scalars, which silently returned
    // zero projects the moment any slicer array existed at all, empty or
    // not, since even [] is truthy and !== against any string is always
    // true. Fixed to match viewDashboard's .length/.includes() convention.
    var list = projectsOf(process);
    var any = dashFamFilter.length || dashModelFilter.length || dashStartWeekFilter.length || dashEndWeekFilter.length;
    if (!any) return list;
    return list.filter(function(p) {
      if (dashFamFilter.length && !dashFamFilter.includes(p.prod_family)) return false;
      if (dashModelFilter.length && !dashModelFilter.includes(p.family)) return false;
      if (dashStartWeekFilter.length) { var sw = toWeek(p.prf_date); if (!sw || !dashStartWeekFilter.includes(sw)) return false; }
      if (dashEndWeekFilter.length) {
        var ew = toWeek(p.target_date) || targetDateFor(p.class_abcde, p.prf_date) || '';
        if (!ew || !dashEndWeekFilter.includes(ew)) return false;
      }
      return true;
    });
  }

  var allFiltered = [];
  pillarDefs().forEach(function(pd) { allFiltered = allFiltered.concat(filteredByProcess(pd.id)); });

  var container = document.getElementById('dashPrintPackage');
  if (!container) { container = document.createElement('div'); container.id = 'dashPrintPackage'; document.body.appendChild(container); }
  container.innerHTML = '';

  if (!allFiltered.length) { container.innerHTML = '<p style="padding:20px;font-size:12pt">No projects match the current filters.</p>'; var de = document.getElementById('dashExec'); if (de) de.style.display = 'none'; window.print(); if (de) de.style.display = ''; hideLoader(); return; }

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

  /* v11 R4: one matrix per pillar - per-step columns, or gate-grouped
     columns (+ PPAP where enabled) for gate_grouped_matrix pillars. */
  pillarDefs().forEach(function(pd) {
  var grouped = !!pd.features.gate_grouped_matrix;
  var filteredNpi = grouped ? [] : filteredByProcess(pd.id);
  var filteredEcn = grouped ? filteredByProcess(pd.id) : [];
  /* --- per-step matrix --- */
  if (filteredNpi.length) {
    var npiSteps = allStepsOf(pd.id);
    var npiH = '<div class="print-matrix"><h3>' + esc(pillarName(pd.id)) + ' Stage Matrix — Completion %</h3><table><thead><tr><th>Project</th>' +
      npiSteps.map(function(s) { return '<th>' + esc(s.step_id) + '. ' + esc(s.step_name) + '</th>'; }).join('') +
      '</tr></thead><tbody>';

    filteredNpi.forEach(function(prj) {
      var on = stepsOf(pd.id, prj);
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
        npiH += '<td class="' + cls + '">' + pct + '%' + (c.g.stale ? ' <b class="print-stale">(stale)</b>' : '') + '</td>';
      });
      npiH += '</tr>';
    });
    npiH += '</tbody></table></div>';
    page2.innerHTML += npiH;
  }

  /* --- gate-grouped matrix (+ PPAP) --- */
  if (filteredEcn.length) {
    var groups = gateGroupsOf(pd.id);
    var withPpap = !!pd.features.ppap;
    var ecnH = '<div class="print-matrix"><h3>' + esc(pillarName(pd.id)) + ' Stage Matrix — Completion %</h3><table><thead><tr><th>Project</th>' +
      groups.map(function(g) { return '<th>' + esc(g.gate.step_id) + '. ' + esc(g.gate.step_name) + '</th>'; }).join('') +
      (withPpap ? '<th>PPAP</th>' : '') + '</tr></thead><tbody>';

    filteredEcn.forEach(function(prj) {
      var on = stepsOf(pd.id, prj);
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
        ecnH += '<td class="' + cls + '">' + pct + '%' + (gc.g && gc.g.stale ? ' <b class="print-stale">(stale)</b>' : '') + '</td>';
      });
      /* PPAP */
      if (withPpap) {
        var ppapRows = (TRK.lb_ppap || []).filter(function(r) { return r.project_id === prj.project_id; });
        var ppapApproved = ppapRows.filter(function(r) { return r.customer_approved && r.customer_approved !== 'NO'; }).length;
        var ppapPct = ppapRows.length ? Math.round(100 * ppapApproved / ppapRows.length) : 0;
        var ppapCls = ppapRows.length ? (ppapPct === 100 ? 'pct-done' : (ppapPct > 0 ? 'pct-partial' : 'pct-none')) : 'pct-na';
        ecnH += '<td class="' + ppapCls + '">' + (ppapRows.length ? ppapPct + '%' : 'n/a') + '</td>';
      }
      ecnH += '</tr>';
    });
    ecnH += '</tbody></table></div>';
    page2.innerHTML += ecnH;
  }
  });

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
  hideLoader();
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

  /* Per-step bars — one coloured rect per gated step, positioned by real
     target-week anchors where available (interpolating only the gaps). */
  pairs.forEach(function(pair, idx) {
    var p = pair.project;
    var proc = p.process;
    var y = topMargin + idx * rowH + barYOff;
    var gatedSteps = stepsOf(proc, p).filter(function(s) { return isGated(proc, s); });
    var ranges = segmentDateRanges(proc, p, gatedSteps, pair.startDate, pair.endDate);

    gatedSteps.forEach(function(s, si) {
      var gs = gateState(p, proc, s);
      var segStatus = gs.status;
      if (segStatus !== 'COMPLETE' && segStatus !== 'BYPASSED' && isOverdueWeek(gs.gate && gs.gate.target_week, gs.done)) segStatus = 'LATE';
      var color = statusColors[segStatus] || '#62748a';
      var r = ranges[si];
      var x = xForDate(r.start);
      var w = Math.max(3, xForDate(r.end) - x);
      svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + barH + '" rx="1" ry="1" fill="' + color + '"/>';
    });

    /* Project label on the left */
    svg += '<text x="' + (leftMargin - 6) + '" y="' + (y + barH - 2) + '" text-anchor="end" font-size="7.5" fill="#14202c" font-weight="600">' + esc(pair.project.project_id) + '</text>';
  });

  /* Current-week marker (v9.2.1) — drawn last so it sits above the bars, and
     only when today actually falls inside the charted span; a project set
     entirely in the past or future would otherwise pin the line to an edge
     and imply a date the chart does not cover. Matches the live Gantt's
     --today-line red so the printed page and the screen agree. */
  var todayT = new Date().getTime();
  if (todayT >= minT && todayT <= maxT) {
    var xToday = xForDate(new Date());
    svg += '<line x1="' + xToday + '" y1="' + (topMargin - 6) + '" x2="' + xToday + '" y2="' + (totalH - 4) +
      '" stroke="#ff0000" stroke-width="2.5" stroke-linecap="round"/>';
    svg += '<text x="' + xToday + '" y="' + (topMargin - 8) + '" text-anchor="middle" font-size="7.5" fill="#ff0000" font-weight="700">' +
      esc(i18n('today') + ' (' + nowWeek() + ')') + '</text>';
  }

  svg += '</svg>';
  return svg;
}

/* ---- sidebar evidence upload helper ------------------------------------ */
async function uploadEvidence(project, stepKey, docCode, file, changeReason) {
  window._isUploadingEvidence = true;
  try {
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
      description: docCode, partId: '',
      projectId: project.project_id, stepKey: stepKey
    });
    await API.action('lb_deliverables', {
      project_id: project.project_id, step_key: stepKey, doc_code: docCode,
      file_name: up.fileName, file_path: up.path, sha256: up.sha256, status: 'Filed',
      approved: '', suspect_template: '', uploaded_by: who,
      uploaded_utc: new Date().toISOString(), notes: '', kind: 'file',
      original_name: up.originalName, wvn_id: project.family || '',
      wnb_id: project.customer_number || '', description: docCode, link_url: '',
      change_reason: changeReason || ''
    }, { audit: { user: who, action: changeReason ? 'Upload_New_Revision' : 'Upload_Evidence_Sidebar', projectId: project.project_id, objType: 'Deliverable', objId: '', from: changeReason ? 'Revised' : 'MISSING', to: 'Filed', detail: docCode + (changeReason ? ' - ' + changeReason : '') } });
  } finally {
    window._isUploadingEvidence = false;
  }
}

/* ===================================================================== */
/* v11 R2 - one sequential upload queue for every evidence upload        */
/* ===================================================================== */
/* Why: each file is two requests - the bytes (/api/upload) and its tracking
   row. Before v11 a failure between them left the file in the vault with no
   row (an orphan) and nothing retried it; one bad file also interrupted the
   batch with an alert. Now every file goes through here:
     1. bytes, one file at a time (the server is single-threaded - more in
        flight only queue there), retried with backoff. Safe to retry: stored
        names are content-addressed, so a repeat lands on the same file.
     2. rows, in chunks of up to 20 through /api/deliverables/batch, retried
        separately. A file whose bytes saved but whose row did not is shown as
        "Failed (row)" and Retry re-sends ONLY the row - the file is not
        uploaded again and is never silently orphaned.
   The panel hangs off <body>, so redraws of #views / #drawer never wipe it,
   and auto-reload pauses while it runs (window._isUploadingEvidence). */
var UPQ = { items: [], running: false, seq: 0, callbacks: [], collapsed: false };
var UPQ_ROW_CHUNK = 20;

function enqueueUploads(items, onDone) {
  var who = requireName(); if (!who) return [];
  var added = items.map(function(it) {
    var q = { id: ++UPQ.seq, who: who, it: it, name: it.file.name, status: 'Pending', phase: '', error: '', up: null, rowId: '', duplicate: false, utc: '' };
    UPQ.items.push(q);
    return q;
  });
  if (onDone) UPQ.callbacks.push(function() { onDone(added); });
  renderUploadPanel();
  runUploadQueue();
  return added;
}

function uqSleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
async function uqRetry(fn, attempts) {
  var last;
  for (var i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { last = e; if (i < attempts - 1) await uqSleep(500 * Math.pow(2, i) + Math.floor(Math.random() * 250)); }
  }
  throw last;
}
function uqReadBase64(file) {
  return new Promise(function(resolve, reject) {
    var rd = new FileReader();
    rd.onload = function() { resolve(String(rd.result).split(',')[1]); };
    rd.onerror = function() { reject(rd.error || new Error('could not read the file')); };
    rd.readAsDataURL(file);
  });
}
async function uqSendBytes(q) {
  var it = q.it;
  var b64 = await uqReadBase64(it.file);
  var body = {
    fileName: it.file.name, contentBase64: b64, docType: it.docCode,
    family: it.project.family, wvnId: it.project.family, wnbId: it.project.customer_number || '',
    description: it.docCode, partId: '', projectId: it.project.project_id, stepKey: it.stepKey || ''
  };
  if (it.uploadExtra) Object.keys(it.uploadExtra).forEach(function(k) { body[k] = it.uploadExtra[k]; });
  return API.upload(body);
}
function uqRow(q) {
  var it = q.it, up = q.up;
  var row = {
    project_id: it.project.project_id, step_key: it.stepKey, doc_code: it.docCode,
    file_name: up.fileName, file_path: up.path, sha256: up.sha256, status: 'Filed',
    approved: '', suspect_template: '', uploaded_by: q.who, uploaded_utc: q.utc,
    notes: '', kind: 'file', original_name: up.originalName || it.file.name,
    wvn_id: it.project.family || '', wnb_id: it.project.customer_number || '',
    description: it.docCode, link_url: '', change_reason: it.changeReason || ''
  };
  var extra = typeof it.rowExtra === 'function' ? it.rowExtra(up) : it.rowExtra;
  if (extra) Object.keys(extra).forEach(function(k) { row[k] = extra[k]; });
  return row;
}
async function uqFlushRows(batch) {
  try {
    var res = await uqRetry(function() {
      return API.post('/api/deliverables/batch', { user: batch[0].who, rows: batch.map(uqRow) });
    }, 6);
    (res.results || []).forEach(function(r, i) {
      var q = batch[i]; if (!q) return;
      if (r.ok) { q.status = 'Saved'; q.phase = ''; q.error = ''; q.rowId = r.id || ''; q.duplicate = !!r.duplicate; }
      else { q.status = 'Failed'; q.phase = 'row'; q.error = r.error || 'row rejected'; }
    });
  } catch (e) {
    batch.forEach(function(q) { q.status = 'Failed'; q.phase = 'row'; q.error = e.message; });
  }
  renderUploadPanel();
}
async function runUploadQueue() {
  if (UPQ.running) return;
  UPQ.running = true;
  window._isUploadingEvidence = true;
  try {
    for (;;) {
      var q = UPQ.items.find(function(x) { return x.status === 'Pending'; });
      if (q) {
        q.status = 'Uploading'; renderUploadPanel();
        try {
          q.up = await uqRetry(function() { return uqSendBytes(q); }, 4);
          q.utc = new Date().toISOString();
          q.status = 'Saving';
        } catch (e) { q.status = 'Failed'; q.phase = 'file'; q.error = e.message; }
        renderUploadPanel();
      }
      var ready = UPQ.items.filter(function(x) { return x.status === 'Saving'; });
      var morePending = UPQ.items.some(function(x) { return x.status === 'Pending'; });
      if (ready.length && (ready.length >= UPQ_ROW_CHUNK || !morePending)) { await uqFlushRows(ready.slice(0, UPQ_ROW_CHUNK)); continue; }
      if (!q) break;
    }
  } finally {
    UPQ.running = false;
    window._isUploadingEvidence = false;
    renderUploadPanel();
    var cbs = UPQ.callbacks.splice(0);
    try { await refreshSilently(); } catch (e) { }
    cbs.forEach(function(fn) { try { fn(); } catch (e) { } });
  }
}
function uqRetryFailed() {
  UPQ.items.forEach(function(q) {
    if (q.status !== 'Failed') return;
    // A saved file keeps its upload result: only the row is re-sent.
    q.status = q.phase === 'row' && q.up ? 'Saving' : 'Pending';
    q.error = '';
  });
  renderUploadPanel();
  runUploadQueue();
}
function renderUploadPanel() {
  var panel = document.getElementById('uploadQueue');
  if (!UPQ.items.length) { if (panel) panel.remove(); return; }
  if (!panel) { panel = document.createElement('div'); panel.id = 'uploadQueue'; panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite'); document.body.appendChild(panel); }
  var n = { Pending: 0, Uploading: 0, Saving: 0, Saved: 0, Failed: 0 };
  UPQ.items.forEach(function(q) { n[q.status] = (n[q.status] || 0) + 1; });
  var total = UPQ.items.length;
  var head = UPQ.running
    ? 'Uploading ' + (n.Saved + n.Failed + 1 > total ? total : n.Saved + n.Failed + 1) + ' of ' + total
    : (n.Failed ? n.Failed + ' of ' + total + ' need attention' : 'All ' + total + ' saved');
  var html = '<div class="uq-head"><b>' + esc(head) + '</b><span class="uq-counts">' + n.Saved + ' saved' +
    (n.Failed ? ' · <span class="uq-bad">' + n.Failed + ' failed</span>' : '') + (n.Pending + n.Uploading + n.Saving ? ' · ' + (n.Pending + n.Uploading + n.Saving) + ' to go' : '') + '</span>' +
    '<button class="sm uq-toggle">' + (UPQ.collapsed ? 'Show' : 'Hide') + '</button></div>' +
    '<div class="uq-bar"><div style="width:' + Math.round(100 * (n.Saved + n.Failed) / total) + '%"></div></div>';
  if (!UPQ.collapsed) {
    html += '<ol class="uq-list">' + UPQ.items.map(function(q) {
      var label = q.status === 'Failed' ? 'Failed (' + (q.phase === 'row' ? 'row - file is saved' : 'file') + ')' : (q.status === 'Saved' && q.duplicate ? 'Already filed' : q.status);
      return '<li class="uq-' + q.status.toLowerCase() + '"><span class="uq-name" title="' + esc(q.it.project.project_id + ' · ' + q.it.stepKey + ' · ' + q.it.docCode) + '">' + esc(q.name) + '</span>' +
        '<span class="uq-state">' + esc(label) + '</span>' + (q.error ? '<div class="uq-err">' + esc(q.error) + '</div>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  var acts = '';
  if (n.Failed && !UPQ.running) acts += '<button class="primary sm uq-retry">Retry failed</button>';
  if (!UPQ.running) acts += '<button class="sm uq-clear">' + (n.Failed ? 'Dismiss' : 'Close') + '</button>';
  if (acts) html += '<div class="uq-acts">' + acts + '</div>';
  panel.innerHTML = html;
  panel.querySelector('.uq-toggle').onclick = function() { UPQ.collapsed = !UPQ.collapsed; renderUploadPanel(); };
  var r = panel.querySelector('.uq-retry'); if (r) r.onclick = uqRetryFailed;
  var c = panel.querySelector('.uq-clear'); if (c) c.onclick = function() { UPQ.items = []; renderUploadPanel(); };
}

/* ===================================================================== */
/* v11.1 - folder drop + multi-file "which part is this" categorisation  */
/* ===================================================================== */
/* A folder dropped from Explorer arrives as one DataTransferItem whose
   webkitGetAsEntry() is a directory entry, not a File — dataTransfer.files
   silently has zero entries for it. This walks every dropped item, expanding
   directories (recursively — a project folder is often DocType\file.ext two
   levels deep) into their files, and returns a flat list of
   { file, topFolder } — topFolder is the name of the top-level dropped
   directory a file came from, used to guess which project a whole folder
   belongs to. A plain (non-directory) drop degrades to the DataTransfer's
   own files list, so this is always safe to call. */
function filesFromDataTransfer(dataTransfer) {
  function readAllEntries(reader) {
    return new Promise(function(resolve, reject) {
      var out = [];
      (function next() {
        reader.readEntries(function(batch) {
          if (!batch.length) { resolve(out); return; }
          out = out.concat(batch);
          next();
        }, reject);
      })();
    });
  }
  function walk(entry, topFolder) {
    if (entry.isFile) {
      return new Promise(function(resolve) {
        entry.file(function(file) { resolve([{ file: file, topFolder: topFolder }]); }, function() { resolve([]); });
      });
    }
    if (entry.isDirectory) {
      var reader = entry.createReader();
      return readAllEntries(reader).then(function(entries) {
        return Promise.all(entries.map(function(e) { return walk(e, topFolder); }));
      }).then(function(lists) { return lists.reduce(function(a, b) { return a.concat(b); }, []); });
    }
    return Promise.resolve([]);
  }
  var items = dataTransfer.items;
  if (!items || !items.length || typeof items[0].webkitGetAsEntry !== 'function') {
    return Promise.resolve(Array.prototype.map.call(dataTransfer.files, function(f) { return { file: f, topFolder: '' }; }));
  }
  var roots = [];
  for (var i = 0; i < items.length; i++) {
    var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (entry) roots.push(entry);
  }
  if (!roots.length) {
    return Promise.resolve(Array.prototype.map.call(dataTransfer.files, function(f) { return { file: f, topFolder: '' }; }));
  }
  return Promise.all(roots.map(function(entry) { return walk(entry, entry.isDirectory ? entry.name : ''); }))
    .then(function(lists) { return lists.reduce(function(a, b) { return a.concat(b); }, []); });
}

/* Given a folder name (or any free text) and the project list, guesses the
   one project it names — matched against the project_id and the family code,
   ignoring case and punctuation, since a person's folder is usually named
   "9944" or "NPI-9944" or "NPI_9944", not the exact project_id string. Returns
   null rather than guess when nothing or more than one project matches. */
function guessProjectFromFolderName(name) {
  if (!name) return null;
  var norm = function(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var target = norm(name);
  if (!target) return null;
  var hits = (TRK.lb_projects || []).filter(function(p) {
    return norm(p.project_id) === target || norm(p.family) === target ||
      norm(p.project_id).indexOf(target) >= 0 && target.length >= 3;
  });
  // exact project_id/family match wins outright even if a looser contains-match
  // also matched something else
  var exact = hits.filter(function(p) { return norm(p.project_id) === target || norm(p.family) === target; });
  if (exact.length === 1) return exact[0];
  if (!exact.length && hits.length === 1) return hits[0];
  return null;
}

/* Small modal used whenever more than one file is about to be filed under the
   SAME (project, step, doc_code): each file needs its own "part / category"
   so a DWG-per-BOM-part upload does not turn into 5 revisions of one slot
   with 4 of them silently superseded. A single-file drop skips this entirely
   (part stays blank, exactly the pre-v11.1 behaviour) — this only appears
   when it is actually needed. `existingParts` seeds the autocomplete with
   part names already used for this doc, so people re-use "Bracket" rather
   than minting "bracket", "Bracket ", "BRACKET". Calls onConfirm([{file,
   part}]) or nothing on cancel. */
function openCategorizeFilesModal(files, existingParts, onConfirm) {
  var scrim = el('div', 'modal-scrim');
  var box = el('div', 'modal categorize-modal');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  var dlId = 'cfPartList' + (++_modalSeq);
  box.innerHTML = '<h2>Which part is each file?</h2>' +
    '<p class="note">' + files.length + ' files are about to be filed under the same document. ' +
    'Give each one a part / category (a BOM part number, a component name — anything that tells them apart) ' +
    'so they file as separate documents instead of one replacing another.</p>' +
    '<datalist id="' + dlId + '">' + existingParts.map(function(p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>' +
    '<div class="filters" style="margin-bottom:8px"><input id="cfAll" list="' + dlId + '" placeholder="Same part for all…" style="min-width:220px">' +
    '<button id="cfApplyAll" class="sm">Apply to all</button></div>' +
    '<div class="scroll"><table><thead><tr><th>File</th><th>Part / category</th></tr></thead><tbody id="cfRows"></tbody></table></div>' +
    '<div class="acts"><button id="cfGo" class="primary">File ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '</button>' +
    '<button id="cfCancel">Cancel</button></div>';
  var rows = $('#cfRows', box);
  files.forEach(function(f, i) {
    var tr = el('tr');
    // v11.1: pre-filled from the file's own name, not blank — most files are
    // already named after the part they show ("Bracket.pdf"), so this is
    // usually a confirm rather than a typing task, and it can never come out
    // blank-and-colliding with another file in the same batch by accident.
    tr.innerHTML = '<td><code>' + esc(f.name) + '</code></td>' +
      '<td><input data-i="' + i + '" list="' + dlId + '" style="width:100%" placeholder="e.g. Bracket, Motor, Handle…" value="' + esc(partLabelFromFileName(f.name)) + '"></td>';
    rows.appendChild(tr);
  });
  scrim.appendChild(box); document.body.appendChild(scrim);
  $('#cfApplyAll', box).onclick = function() {
    var v = $('#cfAll', box).value;
    rows.querySelectorAll('input').forEach(function(inp) { inp.value = v; });
  };
  var close = function() { scrim.remove(); };
  $('#cfCancel', box).onclick = close;
  $('#cfGo', box).onclick = function() {
    var out = files.map(function(f, i) {
      var inp = rows.querySelector('input[data-i="' + i + '"]');
      return { file: f, part: (inp ? inp.value : '').trim() };
    });
    var seen = {}, dupes = [];
    out.forEach(function(o) {
      var k = o.part.toLowerCase();
      if (seen[k]) dupes.push(o.part || '(blank)'); else seen[k] = true;
    });
    if (dupes.length && !confirm(
      'More than one file has the same part ("' + dupes.join('", "') + '") — the later one will supersede the earlier one ' +
      'as a new revision of the same slot, rather than filing separately. Continue anyway?')) return;
    close();
    onConfirm(out);
  };
}
var _modalSeq = 0;

/* Existing part / category labels already used for one document at one
   project+step, offered as autocomplete suggestions so a second BOM part
   doesn't get filed under a slightly different spelling of the first one's
   name. */
function existingPartsFor(pid, stepKey, docCode) {
  var seen = {}, out = [];
  (TRK.lb_deliverables || []).forEach(function(r) {
    if (r.project_id === pid && r.step_key === stepKey && r.doc_code === docCode && r.part_id && !seen[r.part_id]) {
      seen[r.part_id] = true; out.push(r.part_id);
    }
  });
  return out;
}

/* Native multi-file picker for "+ Add part" (drawer) — always routes through
   the categorize modal so each file's suggested part is easy to check before
   it files, since the whole reason to call this instead of enqueueUploads
   directly is that each file needs its own part label. */
function pickFilesForDoc(project, stepKey, docCode, onDone) {
  var inp = el('input'); inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
  inp.onchange = function() {
    if (!inp.files.length) return;
    openCategorizeFilesModal(Array.prototype.slice.call(inp.files), existingPartsFor(project.project_id, stepKey, docCode), function(picked) {
      enqueueUploads(picked.map(function(p) {
        return { project: project, stepKey: stepKey, docCode: docCode, file: p.file, uploadExtra: { partId: p.part }, rowExtra: { part_id: p.part } };
      }), onDone);
    });
  };
  document.body.appendChild(inp); inp.click(); document.body.removeChild(inp);
}

/* A sensible default part / category from a file's own name — "Bracket.pdf"
   -> "Bracket" — so several files dropped for one document come out as
   several independently-active documents by default (this is the actual
   v11.1 fix: before, the LAST of several files dropped at once silently
   superseded all the others). A single file dropped alone still gets a
   blank part, unchanged from pre-v11.1 behaviour — see callers. */
function partLabelFromFileName(name) {
  var stem = String(name || '').replace(/\.[^.]*$/, '');
  return stem.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60);
}

/* Renames a part across its WHOLE history (every revision, not just the
   active one) — a part label is metadata about the slot, not about one
   file, so renaming only the active row would silently orphan its
   superseded revisions into a stale "part" of their own and make them
   reappear as active. Lets someone fix "bracket" to "Bracket - Left Hinge"
   after the fact, per the BOM, without re-uploading anything. */
async function renamePart(project, stepKey, docCode, oldPart, onDone) {
  var who = requireName(); if (!who) return;
  var next = prompt('Rename part "' + (oldPart || '(none)') + '" to:', oldPart || '');
  if (next === null) return;
  next = next.trim();
  if (next === (oldPart || '')) return;
  var rows = (TRK.lb_deliverables || []).filter(function(r) {
    return r.project_id === project.project_id && r.step_key === stepKey && r.doc_code === docCode && (r.part_id || '') === (oldPart || '');
  });
  if (!rows.length) return;
  for (var i = 0; i < rows.length; i++) {
    await API.action('lb_deliverables', { deliverable_id: rows[i].deliverable_id, part_id: next }, {
      upsertKeys: ['deliverable_id'],
      audit: { user: who, action: 'Rename_Part', projectId: project.project_id, objType: 'Deliverable', objId: docCode, from: oldPart || '(none)', to: next, detail: rows[i].deliverable_id }
    });
  }
  await redrawAfterWrite();
  if (onDone) onDone();
}

/* Renders a filed document's location two ways: a link that streams it from
   the vault endpoint, and the literal on-disk path. The path is what people
   paste into Explorer or an email, so it is shown in full rather than
   abbreviated. Returns null when there is no path to show. */
function vaultPathLine(filePath, label) {
  if (!filePath) return null;
  var wrap = el('div', 'vault-path');
  var viewUrl = evidenceViewerUrl(filePath);
  var head = el('div');
  head.innerHTML = '<b>' + esc(label || 'Saved to vault') + '</b>';
  wrap.appendChild(head);
  if (viewUrl) {
    var a = el('a', 'vault-path-link');
    a.href = viewUrl;
    a.target = '_blank';
    a.textContent = 'Open ' + filePath.split(/[\\/]/).pop();
    wrap.appendChild(a);
  }
  var p = el('div', 'vault-path-text');
  p.textContent = filePath;
  p.title = 'Full path — click to select, then copy';
  wrap.appendChild(p);
  var openBtn = el('button', 'primary', 'Open in Explorer');
  openBtn.onclick = async function(e) {
    e.preventDefault();
    try { await API.openPath(filePath); } catch (err) { alert('Could not open: ' + err.message); }
  };
  wrap.appendChild(openBtn);
  return wrap;
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

let drawerContext = null;
let autoReloadId = null;

/* ---- executive inspection drawer ---------------------------------------- */
function closeDrawer() {
  drawerContext = null;
  const d = $('#drawer'); if (d) d.remove();
  const s = $('#scrim'); if (s) s.remove();
}
function openDrawerForDoc(project, step, docCode) {
  openDrawer(project, step, docCode);
}
function openDrawer(project, step, focusDocCode) {
  closeDrawer();
  drawerContext = { projectId: project.project_id, stepId: step.step_id, docCode: focusDocCode };
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
    (g.approval ? ' signed by <b>' + esc(g.approval.approved_by) + '</b> on ' + esc((g.approval.approved_utc || '').slice(0, 10)) : '');
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
  // Task-lifecycle buttons (Edit Assignment, Remove Owner/Supporter, Delete).
  // Delete returns null for gates, so it never renders here.
  [makeEditAssignmentButton('Gate', 'lb_gates', gateRow, ['project_id', 'step_key'], function() { openDrawer(project, step, focusDocCode); }),
   makeRemoveOwnerButton('Gate', 'lb_gates', gateRow, ['project_id', 'step_key'], function() { openDrawer(project, step, focusDocCode); }),
   makeRemoveSupporterButton('Gate', 'lb_gates', gateRow, ['project_id', 'step_key'], function() { openDrawer(project, step, focusDocCode); }),
   makeDeleteTaskButton('Gate', 'lb_gates', gateRow, ['project_id', 'step_key'], function() { openDrawer(project, step, focusDocCode); })
  ].forEach(function(b) { if (b) stageClaimWrap.appendChild(b); });
  d.appendChild(stageClaimWrap);
  d.appendChild(makeTargetWeekEditor('Gate', 'lb_gates', gateRow, ['project_id', 'step_key'], !!g.approval, function() {
    openDrawer(project, step, focusDocCode);
  }));
  d.appendChild(gateCommentSection(project, sk));

  // Shared reopen-in-place callback for anything below that needs to redraw
  // the drawer after a write (gate sign-off, trial quantities, MWER record).
  function reopenDrawer() {
    const pageY = window.scrollY;
    const drawerEl = $('#drawer');
    const drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
    return refreshSilently().then(function() {
      openDrawer(project, step, focusDocCode);
      window.scrollTo(0, pageY);
      const newDrawer = $('#drawer');
      if (newDrawer) newDrawer.scrollTop = drawerScroll;
    });
  }

  // Gate sign-off — the same Approve/Bypass/Raise-issue controls the NPI/ECN
  // step accordion used to offer, so Admin/Moderator can sign a gate straight
  // from the Dashboard sidebar drawer without navigating to the tab and
  // expanding that step's card.
  d.appendChild(gateActions(project, proc, step, g, reopenDrawer));

  // Trial quantities and MWER records used to live only inside the NPI/ECN
  // step accordion; now that the accordion is gone (flat project list
  // instead), the drawer is the only place left to reach them.
  // NPI keys trial quantities off the step's own config flag; ECN never sets
  // that flag and instead keys off the step name, matching what the old ECN
  // step accordion checked.
  if (step.trial_quantity || (hasFeature(proc, 'trial_by_step_name') && /trial production execution/i.test(step.step_name))) {
    d.appendChild(trialConfig(project, proc, step, reopenDrawer));
  }
  if (hasFeature(proc, 'mwer') && /mwer/i.test(step.step_name)) d.appendChild(mwerSection(project, step, reopenDrawer));

  // LFI accordion — available on every step, expands in place in the drawer
  d.appendChild(lfiSection(project, step));

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
      // Every pillar's projects (was NPI only before v11).
      const npiProjects = TRK.lb_projects.slice();
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
  // Show only rows that carry actual evidence (file, link, or path), not custom-doc markers.
  // v11 R1: one row per DOCUMENT - its active revision. Superseded revisions
  // live in the History modal instead of cluttering the table as peers.
  const dels = TRK.lb_deliverables.filter(function(x) {
    return x.project_id === project.project_id && x.step_key === sk &&
      (x.file_name || x.link_url || x.file_path || x.approved === 'YES') &&
      x.status !== 'Removed' && x.is_active !== 'NO';
  });
  if (!dels.length) d.appendChild(el('p', 'note', 'Nothing filed here yet.'));
  else {
    const t = el('table');
    t.innerHTML = '<thead><tr><th>Type</th><th>File</th><th>Filed by</th><th></th></tr></thead>';
    const tb = el('tbody');
    // v11.1: a doc_code can have several active rows at once, one per BOM
    // part — "+ Add part" only needs to appear once per doc_code, not once
    // per row, or filing 4 parts would show it 4 times in a row.
    const addPartShown = {};
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
                  : '<span class="note">' + esc(x.file_name) + '</span><br><a href="file:///' + esc(path.replace(/\\/g, '/')) + '" class="note" style="font-size:10px;word-break:break-all">' + iconHtml('folder-open') + ' ' + esc(path) + '</a>')
        : '<span class="note">—</span>';
      var removedMark = isDelRemoved ? ' <span class="badge bg-secondary" style="text-decoration:line-through;opacity:0.7">Removed</span>' : '';
      const revMark = x.revision_no ? ' <span class="badge bg-secondary rev-badge" title="Revision ' + esc(x.revision_no) + ' is the active one">rev ' + esc(x.revision_no) + '</span>' : '';
      // v11.1: the part badge doubles as an "Edit part" button — the whole
      // reason a badge exists is that the filename-derived guess is often
      // right but not always ("BOM.pdf" might really be the BOM for just one
      // part), so relabelling it needs to be one click, not a modal.
      const partMark = x.part_id
        ? ' <span class="badge part-badge part-badge-btn" title="Click to rename this part">' + esc(x.part_id) + '</span>'
        : (!isDelRemoved && !isLink ? ' <span class="badge bg-secondary part-badge part-badge-btn" title="Click to give this a part / category">+ part</span>' : '');
      tr.innerHTML = '<td>' + dcEl + removedMark + revMark + partMark + (x.custom_doc === 'YES' ? ' <span class="note custom-mark">model custom</span>' : '') + (isLink ? ' <span class="note">cited</span>' : '') + '</td>' +
        '<td><code>' + esc(x.file_name) + '</code><div class="note">' + pathHtml + '</div>' +
        (x.change_reason ? '<div class="note">Change: ' + esc(x.change_reason) + '</div>' : '') + '</td>' +
        '<td>' + esc(x.uploaded_by) + '<div class="note">' + esc(fmtStamp(x.uploaded_utc)) + '</div></td><td></td>';
      if (isDelRemoved) tr.style.opacity = '0.65';
      // doc_code click → re-open drawer focused on this doc
      const dcLink = tr.querySelector('.doc-link');
      if (dcLink) dcLink.onclick = () => openDrawerForDoc(project, step, x.doc_code);
      const partBtn = tr.querySelector('.part-badge-btn');
      if (partBtn) partBtn.onclick = () => renamePart(project, sk, x.doc_code, x.part_id, () => openDrawer(project, step, x.doc_code));
      // A link_url isn't a filesystem path — nothing for Explorer to open.
      if (path && !isLink) {
        const openBtn = el('button', 'primary', 'Open in Explorer');
        openBtn.onclick = async () => {
          try { await API.openPath(path); } catch (err) { alert('Could not open: ' + err.message); }
        };
        tr.lastChild.appendChild(openBtn);
      }
      // v11 R1: history + an explicit new revision (with a change reason).
      // v11.1: both are scoped to this row's own part — History for "DWG
      // (Bracket)" must not mix in "DWG (Motor)"'s revisions, and New revision
      // must supersede THIS part, not create a third, unlabelled one.
      if (x.revision_no) {
        const histBtn = el('button', '', 'History');
        histBtn.style.marginLeft = '4px';
        histBtn.onclick = function(e) { e.stopPropagation(); openHistoryModal(project, step, x.doc_code, x.part_id); };
        tr.lastChild.appendChild(histBtn);
        if (!isLink) {
          const revBtn = el('button', '', 'New revision');
          revBtn.style.marginLeft = '4px';
          revBtn.onclick = function(e) {
            e.stopPropagation();
            pickNewRevision(project, sk, x.doc_code, function() { openDrawer(project, step, x.doc_code); }, x.part_id);
          };
          tr.lastChild.appendChild(revBtn);
        }
      }
      // "+ Add part": files another BOM part under this SAME doc_code, once
      // it already has at least one part filed (before that it still shows
      // as missing/on-going and has its own dropzone below).
      if (!isDelRemoved && !isLink && !addPartShown[x.doc_code]) {
        addPartShown[x.doc_code] = true;
        const addPartBtn = el('button', '', '+ Add part');
        addPartBtn.style.marginLeft = '4px';
        addPartBtn.title = 'File another BOM part / category under ' + x.doc_code;
        addPartBtn.onclick = function(e) {
          e.stopPropagation();
          pickFilesForDoc(project, sk, x.doc_code, function() { openDrawer(project, step, x.doc_code); });
        };
        tr.lastChild.appendChild(addPartBtn);
      }
      // No Claim/Assign button here — every row in this table already has a
      // file or an approval (see the filter above), so there is nothing left
      // to claim. "Filed by" already names who did the work.
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
  if (c.missing.length || c.ongoing.length) {
    if (c.missing.length) {
    const mb = el('div', 'banner bad');
    mb.innerHTML = '<b>Required but not filed:</b> ' + c.missing.map(function(x) { return esc(docTypeById(x).name) + (c.customSet.has(x) ? ' <span class="note">(model custom)</span>' : ''); }).join(', ');
    d.appendChild(mb);
    }
    d.appendChild(el('h3', null, 'Drop evidence here'));
    const needsDropzone = c.missing.concat(c.ongoing);
    needsDropzone.forEach(code => {
      var dzRow = TRK.lb_deliverables.find(function(d) { return d.project_id === project.project_id && d.step_key === sk && d.doc_code === code; }) || { project_id: project.project_id, step_key: sk, doc_code: code };
      // Claiming or being assigned a document hands the job of filing it to
      // that person. Everyone else — including whoever assigned it — sees the
      // ownership, not an upload box, so two people cannot quietly file the
      // same deliverable and overwrite each other.
      var dzOwner = dzRow.owner_pic || dzRow.claimed_by || '';
      var dzAssignedBy = dzRow.assigned_by || '';
      var lockedToOther = !!dzOwner && dzOwner !== getUser();

      const dz = el('div', lockedToOther ? 'dz dz-locked' : 'dz');
      dz.setAttribute('data-doc-code', code);
      dz.style.cssText = 'margin-bottom:8px;padding:12px';
      dz.innerHTML = '<b>' + esc(docTypeById(code).name) + ' (' + esc(code) + ')</b>' +
        (c.customSet.has(code) ? ' <span class="note custom-mark">model custom</span>' : '') +
        '<br><span class="note">' + (lockedToOther ? 'Assigned — only the owner can file this' : 'Drop a file or click to browse') + '</span>';
      dz.appendChild(el('br'));
      if (lockedToOther) {
        // Ownership badge in place of the claim button: a third party taking
        // this on would contradict the assignment that was just made.
        var ownLabel = 'Owner: ' + dzOwner + (dzAssignedBy ? ' (Assigned by ' + dzAssignedBy + ')' : '');
        dz.appendChild(el('span', 'claim-badge ' + badgeClass('FILED'), ownLabel));
        var dzSupporter = dzRow.supporter_pic || dzRow.supporter_by || '';
        if (dzSupporter) dz.appendChild(el('span', 'claim-badge badge bg-teal-lt', 'Supporter: ' + dzSupporter));
      } else {
        dz.appendChild(makeClaimButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function(who, role) {}));
      }
      if (isPrivileged()) {
        // Admins keep re-assignment even on a locked row — that is oversight,
        // not filing.
        dz.appendChild(makeAssignButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function() {
          openDrawer(project, step, code);
        }));
      }
      // Task-lifecycle buttons render in both the locked and unlocked branch
      // based on each action's own visibility (privileged vs. row owner).
      [makeEditAssignmentButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function() { openDrawer(project, step, code); }),
       makeRemoveOwnerButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function() { openDrawer(project, step, code); }),
       makeRemoveSupporterButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function() { openDrawer(project, step, code); }),
       makeDeleteTaskButton('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], function() { openDrawer(project, step, code); })
      ].forEach(function(b) { if (b) dz.appendChild(b); });
      dz.appendChild(el('br'));
      // Everything reaching this dropzone is by definition still missing or
      // on-going (never done/filed), so the overdue check just needs "is
      // there a past-due date at all" — see needsDropzone above.
      dz.appendChild(makeTargetWeekEditor('Deliverable', 'lb_deliverables', dzRow, ['project_id', 'step_key', 'doc_code'], false, function() {
        openDrawer(project, step, code);
      }));
      dz.appendChild(dzNoteSection(project, sk, code));
      var dt = docTypeById(code);
      if (dt.template_file && !lockedToOther) {
        var dlBtn = el('a');
        dlBtn.textContent = 'Download Blank Template';
        dlBtn.href = '/api/templates/' + encodeURIComponent(dt.template_file);
        dlBtn.download = dt.template_file;
        dlBtn.className = 'btn btn-sm dz-template-btn';
        dz.appendChild(dlBtn);
      }
      if (c.missing.indexOf(code) >= 0) {
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
      }

      // Upload affordances only exist for the person who owns the task. The
      // handlers are not merely hidden — they are never attached, so a drag
      // onto a locked box does nothing rather than silently uploading.
      if (!lockedToOther) {
      dz.ondragover = e => { e.preventDefault(); dz.style.borderColor = 'var(--good)'; dz.style.background = 'var(--good2)'; };
      dz.ondragleave = () => { dz.style.borderColor = ''; dz.style.background = ''; };
      const afterUpload = async () => {
        const pageY = window.scrollY;
        const drawerEl = $('#drawer');
        const drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
        await refreshSilently();
        openDrawer(project, step, code);
        window.scrollTo(0, pageY);
        const newDrawer = $('#drawer');
        if (newDrawer) newDrawer.scrollTop = drawerScroll;
      };
      // v11.1: dropping N files here at once must not end with only the LAST
      // one active and the rest silently superseded — that was the actual
      // bug report. A single file dropped alone still gets a blank part
      // (unchanged). More than one gets each file its own part, taken from
      // its own file name ("Bracket.pdf" -> part "Bracket") so no prompt is
      // needed and nothing collides by accident; a folder drop is expanded
      // to its files first. Wrong guesses (this is really the BOM drawing for
      // one part, not the whole document) are fixed afterwards by clicking
      // the part badge on the filed row — see renamePart().
      const filesToItems = list => {
        const multi = list.length > 1;
        return list.map(function(file) {
          return {
            project: project, stepKey: sk, docCode: code, file: file,
            uploadExtra: multi ? { partId: partLabelFromFileName(file.name) } : undefined,
            rowExtra: multi ? { part_id: partLabelFromFileName(file.name) } : undefined
          };
        });
      };
      dz.ondrop = async e => {
        e.preventDefault();
        dz.style.borderColor = ''; dz.style.background = '';
        const entries = await filesFromDataTransfer(e.dataTransfer);
        if (!entries.length) return;
        enqueueUploads(filesToItems(entries.map(fe => fe.file)), function() { afterUpload(); });
      };
      dz.onclick = (e) => {
        // Any interactive control inside the dropzone (buttons, the template
        // link, target-week input, note field/button, claim badge) handles
        // its own click — bubbling past it into the file picker was the v6.2
        // bug for elements that stopPropagation covered, and was never
        // covered at all for the plain <a> template-download link. Guarding
        // by ancestry here is robust to both cases without relying on every
        // future control remembering to call stopPropagation itself.
        if (e.target.closest('button, a, input, select, label, .target-week-editor, .claim-badge, .dz-note-wrap')) return;
        const inp = el('input'); inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
        inp.onchange = () => {
          if (!inp.files.length) return;
          enqueueUploads(filesToItems(Array.prototype.slice.call(inp.files)), function() { afterUpload(); });
        };
        document.body.appendChild(inp); inp.click(); document.body.removeChild(inp);
      };
      }
      if (focusDocCode && code === focusDocCode) {
        dz.style.outline = '2px solid var(--blue)';
        dz.style.outlineOffset = '-1px';
      }
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
    if (allDocTypes().some(function(d) { return d.doctype_id === code; })) {
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
      // Unlike its siblings below, makeClaimButton patches the button/badges
      // in place instead of redrawing — reasonable for most rows, but this
      // one also needs to reveal issueResolveDropzone() once an owner
      // exists, and that dropzone is only decided at the initial render.
      var issueClaimBtn = makeClaimButton('Issue', 'lb_issues', i, ['issue_id'], function() { openDrawer(project, step, focusDocCode); });
      div.appendChild(issueClaimBtn);
      if (isPrivileged()) {
        div.appendChild(makeAssignButton('Issue', 'lb_issues', i, ['issue_id'], function(target, isPrimary, admin) {
          if (isPrimary) {
            issueClaimBtn.textContent = 'Owner: ' + target + ' (Assigned by ' + admin + ')';
            issueClaimBtn.className = 'claimed-btn';
          }
        }));
      }
      [makeEditAssignmentButton('Issue', 'lb_issues', i, ['issue_id'], function() { openDrawer(project, step, focusDocCode); }),
       makeRemoveOwnerButton('Issue', 'lb_issues', i, ['issue_id'], function() { openDrawer(project, step, focusDocCode); }),
       makeRemoveSupporterButton('Issue', 'lb_issues', i, ['issue_id'], function() { openDrawer(project, step, focusDocCode); }),
       makeDeleteTaskButton('Issue', 'lb_issues', i, ['issue_id'], function() { openDrawer(project, step, focusDocCode); })
      ].forEach(function(b) { if (b) div.appendChild(b); });
      // An LFI carries a generated LL_info workbook; surface where it landed.
      var lfiPath = vaultPathLine(i.evidence_path, 'LFI report');
      if (lfiPath) div.appendChild(lfiPath);
      var resolveDz = issueResolveDropzone(project, function() { openDrawer(project, step, focusDocCode); }, i);
      if (resolveDz) div.appendChild(resolveDz);
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
  if (focusDocCode) {
    var focusedDz = d.querySelector('.dz[data-doc-code="' + CSS.escape(focusDocCode) + '"]');
    if (focusedDz) focusedDz.scrollIntoView({ block: 'center' });
  }
}

/* ===================================================================== */
/* TAB — CLAIMED WORK (Task 2b)                                          */
/* ===================================================================== */
var PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
// Survives the 15s auto-reload so an admin mid-review of one person's queue
// does not get thrown back to "All Personnel" every refresh.
var claimedUserSel = '';

function viewClaimed(root) {
  root.appendChild(pageHeader(i18n('claimedTitle'), i18n('claimedSub')));
  var who = getUser();
  var b = el('div', 'banner');
  if (!who) {
    b.innerHTML = '<b>Your session has ended.</b> <a href="/login.html">Sign in again</a> to see the tasks assigned to you.';
    root.appendChild(b);
    return;
  }
  // Admins and moderators supervise the whole floor, so they see everybody's
  // queue and filter down to a person; everyone else sees only their own.
  var privileged = isPrivileged();
  b.innerHTML = privileged
    ? '<b>All claimed and assigned work across every user.</b> Only open items appear here — approved or closed items drop off the list. Filter by person below.'
    : '<b>Tasks claimed by or assigned to ' + esc(who) + '.</b> Only open items appear here — approved or closed items drop off the list.';
  root.appendChild(b);

  var nw = nowWeek();
  var items = [];

  // Owner/supporter/assignee of one tracking row, in the two-tier claim shape
  // every store shares.
  function partiesOf(row) {
    return {
      owner: row.owner_pic || row.claimed_by || '',
      supporter: row.supporter_pic || row.supporter_by || '',
      assignedBy: row.assigned_by || ''
    };
  }
  // Privileged view keeps any row somebody is on the hook for; the personal
  // view keeps only rows naming the logged-in user.
  function keeps(p) {
    if (privileged) return !!(p.owner || p.supporter);
    return p.owner === who || p.supporter === who;
  }

  // Open gates claimed by the user (status not Approved)
  (TRK.lb_gates || []).forEach(function(g) {
    if (g.status === 'Approved') return;
    var p = partiesOf(g);
    if (!keeps(p)) return;
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
      owner: p.owner,
      supporter: p.supporter,
      assignedBy: p.assignedBy
    });
  });

  // Open deliverables (not approved) claimed by the user
  (TRK.lb_deliverables || []).forEach(function(d) {
    if (d.approved === 'YES') return;
    var p = partiesOf(d);
    if (!keeps(p)) return;
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
      owner: p.owner,
      supporter: p.supporter,
      assignedBy: p.assignedBy,
      docCode: d.doc_code
    });
  });

  // Open SP issues claimed by the user
  (TRK.lb_sp_issues || []).forEach(function(i) {
    if (i.status === 'Closed') return;
    var p = partiesOf(i);
    if (!keeps(p)) return;
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
      owner: p.owner,
      supporter: p.supporter,
      assignedBy: p.assignedBy,
      issueDate: (i.raised_utc || '').slice(0, 10)
    });
  });

  // Open lb_issues claimed by the user
  (TRK.lb_issues || []).forEach(function(i) {
    if (i.status === 'Closed') return;
    var p = partiesOf(i);
    if (!keeps(p)) return;
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
      owner: p.owner,
      supporter: p.supporter,
      assignedBy: p.assignedBy,
      issueDate: (i.raised_utc || '').slice(0, 10)
    });
  });

  if (!items.length) {
    root.appendChild(el('p', 'note', privileged
      ? 'Nobody has claimed or been assigned anything yet. Claims are made from the inspection drawer in the NPI or ECN tab.'
      : 'You have nothing claimed or assigned right now. Use the inspection drawer in the NPI or ECN tab to claim tasks.'));
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

  var card = el('div', 'card');
  var body = el('div', 'card-body');

  // Personnel filter — privileged only, since an ordinary user's list is
  // already just their own work and a one-entry dropdown would be noise.
  if (privileged) {
    var everyone = [];
    items.forEach(function(it) {
      [it.owner, it.supporter].forEach(function(n) {
        if (n && everyone.indexOf(n) < 0) everyone.push(n);
      });
    });
    everyone.sort();
    if (everyone.indexOf(claimedUserSel) < 0) claimedUserSel = '';
    var filterBar = el('div', 'filters');
    filterBar.appendChild(el('label', null, 'Filter by personnel'));
    var userSel = el('select');
    userSel.id = 'claimedUserFilter';
    function countFor(name) {
      return items.filter(function(it) { return it.owner === name || it.supporter === name; }).length;
    }
    userSel.innerHTML = '<option value="">All Personnel (' + items.length + ' task' + (items.length === 1 ? '' : 's') + ')</option>' +
      everyone.map(function(n) {
        return '<option value="' + esc(n) + '"' + (n === claimedUserSel ? ' selected' : '') + '>' + esc(n) + ' (' + countFor(n) + ')</option>';
      }).join('');
    userSel.onchange = function() { claimedUserSel = userSel.value; show('claimed'); };
    filterBar.appendChild(userSel);
    body.appendChild(filterBar);
  }

  var shown = (privileged && claimedUserSel)
    ? items.filter(function(it) { return it.owner === claimedUserSel || it.supporter === claimedUserSel; })
    : items;

  // Build table
  var t = el('table');
  t.innerHTML = privileged
    ? '<thead><tr><th>Project</th><th>What</th><th>Item</th><th>Primary owner</th><th>Supporter</th><th>Assigned by</th><th>Issue Date</th><th>Target week</th><th>Priority</th><th>Status</th></tr></thead>'
    : '<thead><tr><th>Project</th><th>What</th><th>Item</th><th>Issue Date</th><th>Target week</th><th>Priority</th><th>Status</th></tr></thead>';
  var tb = el('tbody');
  if (!shown.length) {
    var emptyTr = el('tr');
    emptyTr.innerHTML = '<td colspan="' + (privileged ? 10 : 7) + '" class="note">Nothing claimed or assigned for ' + esc(claimedUserSel) + '.</td>';
    tb.appendChild(emptyTr);
  }
  shown.forEach(function(item) {
    var tr = el('tr', 'claimed-row');
    tr.style.cursor = 'pointer';
    var overdue = item.targetWeek && item.targetWeek < nw;
    var twDisplay = item.targetWeek || '—';
    if (overdue) twDisplay = 'Overdue: ' + twDisplay;

    var partyCells = privileged
      ? '<td>' + (item.owner ? esc(item.owner) : '<span class="note">—</span>') + '</td>' +
        '<td>' + (item.supporter ? esc(item.supporter) : '<span class="note">—</span>') + '</td>' +
        '<td>' + (item.assignedBy ? esc(item.assignedBy) : '<span class="note">self-claimed</span>') + '</td>'
      : '';

    var issueDateCell = '<td>' + (item.issueDate ? esc(item.issueDate) : '<span class="note">—</span>') + '</td>';

    tr.innerHTML = '<td><b>' + esc(item.projectId) + '</b></td>' +
      '<td><span class="note">' + esc(item.type) + '</span></td>' +
      '<td>' + esc(item.label) + (item.assignedBy ? ' <span class="badge bg-primary" style="font-size:10px">Assigned by Admin</span>' : '') + '</td>' +
      partyCells +
      issueDateCell +
      '<td class="' + (overdue ? 'claimed-overdue' : '') + '">' + (overdue ? iconHtml('alert-triangle') + ' ' : '') + esc(twDisplay) + '</td>' +
      '<td>' + esc(item.priority) + '</td>' +
      '<td><span class="' + badgeClass(item.status) + '">' + esc(item.status.replace(/_/g, ' ')) + '</span></td>';

    tr.onclick = function() {
      if (item.project && item.step) {
        openDrawer(item.project, item.step, item.docCode || null);
      } else if (item.project && item.project.process) {
        // For items without a specific step, open at step 1
        var steps = stepsOf(item.project.process, item.project);
        if (steps.length) openDrawer(item.project, steps[0], item.docCode || null);
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
/* TAB — INPUT                                                           */
/* ===================================================================== */
function viewInput(root) {
  root.appendChild(pageHeader(i18n('inputTitle'), i18n('inputSub')));
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
  // combobox: datalist shows "Type <id> — <name> (<cycle>)", normalised back
  // to type_id at submit via normaliseChangeTypeInput.
  const classDlOpts = changeTypes().map(t => '<option value="Type ' + esc(t.type_id) + ' — ' + esc(t.name) +
    (t.cycle_time_days == null ? ' (cycle TBD)' : ' (' + t.cycle_time_days + ' d)') + '">').join('');

  g.appendChild(fld('Process', '<select id="npProc">' + pillarDefs().map(pd => '<option value="' + esc(pd.id) + '">' + esc(pd.id) +
    (pd.name && pd.name !== pd.id ? ' — ' + esc(pickLang(pd.name, pd.name_vi)) : '') + '</option>').join('') + '</select>'));
  g.appendChild(fld('Family ID *', '<input id="npFamId" list="fgList" placeholder="9649LP, 5612, …">' +
    '<datalist id="fgList">' + known.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>'));
  g.appendChild(fld('Change / project type *', '<input id="npClass" list="classList" placeholder="— type or pick —">' +
    '<datalist id="classList">' + classDlOpts + '</datalist>'));
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
    const t = changeTypeById(normaliseChangeTypeInput($('#npClass').value));
    const proc = $('#npProc').value;
    if (!t) { ctNote.style.display = 'none'; return; }
    const override = $('#npTargetDate').value;
    const tgt = override || targetDateFor(t.type_id, $('#npPrf').value);
    const runs = ctStepsFor(t, proc) || allStepsOf(proc).map(s => s.step_id);
    const all = allStepsOf(proc);
    const skipped = all.filter(s => (runs || []).indexOf(s.step_id) < 0);
    const fam = familyById($('#npFamId').value.trim());
    ctNote.style.display = '';
    ctNote.innerHTML = '<b>Type ' + esc(t.type_id) + ' — ' + esc(t.name) + '.</b> ' + esc(t.description) +
      '<br>Cycle time: ' + (t.cycle_time_days == null ? '<b>TBD</b> — ' + esc(t.cycle_time_note) + ' No target date will be set.'
        : '<b>' + t.cycle_time_days + ' days</b> ' + iconHtml('arrow-right') + ' target finish <b>' + esc(tgt || '—') + '</b>' + (override ? ' <span class="note">(manual override)</span>' : '')) +
      '<br>Runs ' + (runs || all.map(s => s.step_id)).length + ' of ' + all.length + ' ' + esc(proc) + ' steps.' +
      (skipped.length ? ' Not applicable: ' + skipped.map(s => 'step ' + s.step_id + ' ' + esc(s.step_name)).join(', ') +
        (t.excluded_step_reason ? ' — ' + esc(t.excluded_step_reason) : '') : '') +
      (fam ? '<br>Family: <b>' + esc(fam.prod_family_name) + '</b> (' + esc(fam.prod_family_id) + ')' +
        (fam.typical_lead_time_days ? ' · typical lead time <b>' + fam.typical_lead_time_days + ' days</b>' : '') : '');
  };
  // oninput so the type-in combobox reacts as the user types, not just on
  // blur; onchange too, since picking a suggestion from the native datalist
  // popup fires change but not always input in every browser.
  $('#npClass', reg).oninput = () => { _npClassEdited = true; upd(); };
  $('#npClass', reg).onchange = () => { _npClassEdited = true; upd(); };
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
        if (ct) $('#npClass').value = 'Type ' + ct.type_id + ' — ' + ct.name;
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
    const clsRaw = $('#npClass').value;
    const cls = normaliseChangeTypeInput(clsRaw);
    if (!famId) { alert('Family ID is required — it forms the project ID.'); return; }
    if (!cls) { alert('Pick a change / project type. It decides the cycle time and which steps apply.'); return; }
    // The old <select> could only ever hold a valid type_id or ''; the type-in
    // combobox can hold arbitrary text, so unlike the empty check above this
    // has to be checked explicitly now — silently registering a project with
    // a class_abcde that matches nothing would leave it with no workflow steps.
    if (!changeTypeById(cls)) {
      alert('Change / project type "' + clsRaw.trim() + '" wasn\'t recognised — pick one from the list.');
      return;
    }
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
    window._isUploadingEvidence = true;
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
      window._isUploadingEvidence = false;
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
  // v11.1: folder-aware. Dropping a whole project folder expands to every
  // file inside it, and if the folder's own name matches a registered
  // project (by project_id or family — "9944", "NPI-9944", "NPI_9944" all
  // match), that project is pre-selected below instead of making the user
  // type or pick it.
  dz.ondrop = async e => {
    e.preventDefault(); dz.style.borderColor = '';
    const entries = await filesFromDataTransfer(e.dataTransfer);
    if (!entries.length) return;
    const folderHit = entries.map(en => en.topFolder).filter(Boolean).map(guessProjectFromFolderName).find(Boolean);
    pick(entries.map(en => en.file), folderHit);
  };
  fin.onchange = () => { if (fin.files.length) pick([...fin.files]); };

  /* Batch confirm table: one row per dropped file, each pre-filled by guessing
     from the filename, each individually overridable. Nothing is uploaded
     until File all is clicked. */
  function pick(files, folderProject) {
    if (!TRK.lb_projects.length) { alert('Register a project first.'); return; }
    const projLabel = r => r.project_id + (r.prod_family ? ' — ' + ((familyById(r.prod_family) || {}).prod_family_name || r.prod_family) : '');
    const projOpts = TRK.lb_projects.map(r => '<option value="' + esc(r.project_id) + '">' + esc(projLabel(r)) + '</option>').join('');
    // combobox format: value shown to user is "DOCTYPE_ID — Name", normalised at read time
    const docDlOpts = allDocTypes().map(d => '<option value="' + esc(d.doctype_id) + ' — ' + esc(d.name) + '">').join('');
    // v11.1: suggestions only, reused across every part input in the batch -
    // every part label used anywhere, so people re-use "Bracket" rather than
    // minting a slightly different spelling of it.
    const partOpts = (function() {
      const seen = {}, out = [];
      (TRK.lb_deliverables || []).forEach(r => { if (r.part_id && !seen[r.part_id]) { seen[r.part_id] = true; out.push(r.part_id); } });
      return out;
    })();

    form.className = '';
    form.innerHTML = '<h3>Confirm before filing — ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '</h3>' +
      '<div class="filters">' +
      // v11.1: type-in AND pick — a searchable combobox (datalist), not a
      // plain <select> that only jump-to-letter searches.
      '<label>Project (all)</label><input id="bProj" list="bProjList" style="min-width:200px" placeholder="Type or pick a project…">' +
      '<datalist id="bProjList">' + projOpts + '</datalist>' +
      '<label>WVN code</label><input id="bWvn" style="width:100px" placeholder="1010523">' +
      '<label>WNB code</label><input id="bWnb" style="width:100px" placeholder="3025015">' +
      '<label class="note" style="font-weight:400;display:flex;align-items:center;gap:4px"><input type="checkbox" id="bKeepName"> keep the original file name</label>' +
      '</div>' +
      '<p class="note">Document type, step and part are guessed where possible — check them. ' +
      'Give two files the same document type but a DIFFERENT part when they are different BOM parts of the same document ' +
      '(e.g. a drawing per part) — otherwise the second one supersedes the first instead of filing alongside it. ' +
      'The WVN and WNB codes apply to every file in this batch and feed the standardised name — unless "keep the original ' +
      'file name" is ticked, which files every one of them under its own name instead.</p>' +
      '<datalist id="bPartList">' + partOpts.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
      '<div class="scroll"><table><thead><tr><th>Dropped file</th><th>Document type</th><th>Step</th>' +
      '<th>Description</th><th>Part / category</th><th>Will be saved as</th><th>Skip</th></tr></thead><tbody id="bRows"></tbody></table></div>' +
      '<button id="bGo" class="primary" style="margin-top:8px">File all</button> ' +
      '<button id="bCancel" style="margin-top:8px">Cancel</button>' +
      '<div id="bLog" class="note"></div>';
    if (folderProject) $('#bProj', form).value = folderProject.project_id;

    const rowsHost = $('#bRows', form);
    /* An unconfident guess is discarded outright rather than carried in state.
       Blanking only the visible input would leave st.doc holding the guess, and
       the pre-flight check below would wave the row through with a document the
       user never saw, let alone chose — the exact failure Task 4b exists to
       prevent. Blank state and a blank box are the same fact. */
    const state = files.map((f, i) => {
      const guess = guessFromName(f.name);
      return {
        file: f, idx: i, desc: guess.desc, part: '', skip: false, confident: guess.confident,
        doc: guess.confident ? guess.doc : '', step: guess.confident ? guess.step : null
      };
    });
    // v11.1: two files that share the SAME document type would otherwise
    // both default to a blank part — the second one then supersedes the
    // first as soon as they're both filed. Give each a part from its own
    // file name up front, so a batch of "one drawing per BOM part" comes out
    // as several independent documents by default; still freely editable
    // per row afterwards. Re-run whenever a row's document type changes too
    // (below) — an unconfident guess left blank at drop time still collides
    // once the user manually picks the same doc type for two rows.
    const fillCollidingParts = () => {
      const byDoc = {};
      state.forEach(st => { if (st.doc) (byDoc[st.doc] = byDoc[st.doc] || []).push(st); });
      Object.keys(byDoc).forEach(doc => {
        if (byDoc[doc].length > 1) byDoc[doc].forEach(st => { if (!st.part) st.part = partLabelFromFileName(st.file.name); });
      });
    };
    fillCollidingParts();

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
          '<td><input data-k="part" data-i="' + st.idx + '" list="bPartList" style="width:120px" placeholder="e.g. Bracket" value="' + esc(st.part) + '"></td>' +
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
          const d = allDocTypes().find(x => x.doctype_id === st.doc);
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
            fillCollidingParts();
            syncStepSelect(node.closest('tr'), st, projById($('#bProj', form).value), true);
            drawRows();
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
      const keepName = $('#bKeepName', form).checked;
      for (const st of state) {
        const cell = rowsHost.querySelector('[data-name="' + st.idx + '"]');
        if (!cell) continue;
        if (st.skip) { cell.textContent = '—'; continue; }
        // "Keep the original name" skips the naming standard entirely — no
        // server round trip needed, it is just the file's own name, made
        // filesystem-safe.
        if (keepName) { cell.innerHTML = '<code>' + esc(st.file.name.replace(/[\\/:*?"<>|]/g, '_')) + '</code>'; continue; }
        try {
          const r = await API.previewName({
            docType: st.doc, family: p ? p.family : '', wvnId: $('#bWvn', form).value.trim(),
            wnbId: $('#bWnb', form).value.trim(), description: st.desc, fileName: st.file.name,
            partId: st.part, projectId: p ? p.project_id : ''
          });
          cell.innerHTML = '<code>' + esc(r.fileName) + '</code>';
        } catch (e) { cell.textContent = st.file.name; }
      }
    };

    // input, not just change: typing a project id (rather than picking one
    // from the datalist popup) still has to refresh the step guesses.
    $('#bProj', form).oninput = drawRows;
    $('#bProj', form).onchange = drawRows;
    $('#bWvn', form).onchange = previewNames;
    $('#bWnb', form).onchange = previewNames;
    $('#bKeepName', form).onchange = previewNames;
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
      const wvn = $('#bWvn', form).value.trim(), wnb = $('#bWnb', form).value.trim();
      // v11.1: two files with the same doc_code AND the same (non-blank) part
      // would file as revisions of one another, which is only right when that
      // is actually intended (re-filing the same part). Flag it up front
      // rather than let it happen silently.
      const byDocPart = {};
      todo.forEach(function(st) {
        const k = st.doc + '|' + (st.part || '').trim().toLowerCase();
        (byDocPart[k] = byDocPart[k] || []).push(st);
      });
      const clashes = Object.keys(byDocPart).filter(k => byDocPart[k].length > 1);
      if (clashes.length && !confirm(
        clashes.map(k => byDocPart[k].length + ' files share document type "' + k.split('|')[0] +
          '"' + (k.split('|')[1] ? ' and part "' + k.split('|')[1] + '"' : ' with no part set')).join('\n') +
        '\n\nEach later file will supersede the earlier one as a new revision of the SAME slot, rather than filing separately. ' +
        'Give them different parts first if that is not what you want. Continue anyway?')) {
        btn.disabled = false; return;
      }
      // v11 R2: the whole batch goes through the upload queue - sequential
      // bytes, rows in chunks of 20, retries, per-file status in the panel.
      // The staged rows are cleared at once, so the queue owns the files and
      // auto-reload stays paused only while it is actually working.
      const keepName = $('#bKeepName', form).checked;
      const items = todo.map(function(st) {
        const step = stepsOf(p.process, p).find(s => s.step_id === Number(st.step));
        const part = (st.part || '').trim();
        return {
          project: p, stepKey: stepKeyOf(p.process, step), docCode: st.doc, file: st.file,
          uploadExtra: { docType: st.doc, family: p.family, partId: part, wvnId: wvn, wnbId: wnb, description: st.desc, keepOriginalName: keepName },
          rowExtra: function(up) {
            return {
              status: up.duplicate ? 'Already filed' : 'Filed', approved: 'NO', suspect_template: 'NO',
              notes: up.duplicate ? 'byte-identical file already present, no copy written' : '',
              wvn_id: wvn, wnb_id: wnb, description: st.desc, part_id: part
            };
          }
        };
      });
      form.className = 'hide'; form.innerHTML = ''; fin.value = '';
      enqueueUploads(items, function(done) {
        const saved = done.filter(q => q.status === 'Saved' && !q.duplicate).length;
        const dup = done.filter(q => q.status === 'Saved' && q.duplicate).length;
        const bad = done.filter(q => q.status === 'Failed').length;
        if (log) log.innerHTML += '<br>' + saved + ' filed, ' + dup + ' already present' + (bad ? ', <b style="color:var(--bad)">' + bad + ' failed - see the upload panel</b>' : '') + '.';
        redrawAfterWrite();
      });
    };
  }

  /* ---- C. Uncategorized files in the vault (v11.1) ----
     A file that reaches the vault by any route other than this app — someone
     pasting it straight into Explorer, or a folder synced in from elsewhere —
     carries no project, no step, no doc_code and no audit trail. It has to be
     impossible to miss rather than merely visible somewhere, so it gets its
     own always-present card here rather than a badge tucked into the Vault
     tab. "Put there by" is the Windows file owner and the creation time —
     the most the filesystem can say about a file the app never saw arrive;
     there is no in-app audit trail for an action the app was bypassed for. */
  const orph = el('div', 'card');
  const orphHdr = el('div', 'card-header'); orphHdr.appendChild(el('h3', 'card-title', 'C. Uncategorized files in the vault')); orph.appendChild(orphHdr);
  const orphBody = el('div', 'card-body');
  orphBody.appendChild(el('p', 'note', 'Checking the vault for files nobody filed through this app…'));
  orph.appendChild(orphBody); root.appendChild(orph);
  (async () => {
    let data;
    try {
      const r = await fetch('/api/vault/orphans', { cache: 'no-store' });
      if (!r.ok) throw await API.err(r);
      data = await r.json();
    } catch (e) {
      orphBody.innerHTML = '<p class="note" style="color:var(--bad)">Could not check the vault: ' + esc(e.message) + '</p>';
      return;
    }
    const list = data.orphans || [];
    // v12.2: a staged change for a file that is no longer an orphan is moot
    (function pruneStage() {
      const st = orphanStage(), here = {};
      list.forEach(o => { here[o.path] = true; });
      Object.keys(st).forEach(p => { if (!here[p]) delete st[p]; });
      saveOrphanStage();
    })();
    orphBody.innerHTML = '';
    if (!list.length) {
      orphBody.appendChild(el('p', 'note', 'Every file in the vault is accounted for.' +
        (data.ignored ? ' (' + data.ignored + ' previously marked "not a deliverable".)' : '')));
      return;
    }
    const banner = el('div', 'banner bad');
    banner.innerHTML = '<b>' + list.length + ' file' + (list.length === 1 ? '' : 's') + ' in the vault ' + (list.length === 1 ? 'was' : 'were') +
      ' not filed through this app.</b> Someone put ' + (list.length === 1 ? 'it' : 'them') +
      ' straight into the vault folder — Categorize each one so it shows up on the dashboard and in the Vault, or mark it as not a deliverable.' +
      '<div class="note" style="margin-top:4px">Your choices are kept in this browser tab and saved together when you press <b>Save changes</b> or leave this tab — the list does not reload after each file.</div>';
    orphBody.appendChild(banner);
    /* Sticky bar: how many choices are waiting, and the way to save or drop them. */
    const sbar = el('div', 'stage-bar hide');
    sbar.setAttribute('role', 'status');
    const sbarText = el('span', 'stage-bar-text');
    const sbarSave = el('button', 'primary sm', 'Save changes');
    const sbarDrop = el('button', 'sm', 'Discard');
    sbar.appendChild(sbarText); sbar.appendChild(sbarSave); sbar.appendChild(sbarDrop);
    orphBody.appendChild(sbar);
    const paintBar = () => {
      const n = orphanStageCount();
      sbar.classList.toggle('hide', !n);
      sbarText.textContent = n + (n === 1 ? ' change' : ' changes') + ' not saved yet';
    };
    sbarSave.onclick = async () => {
      sbarSave.disabled = true; sbarDrop.disabled = true;
      try {
        const r = await flushOrphanStage('save');
        if (r.failed) alert(r.failed + ' of ' + (r.saved + r.failed) + ' could not be saved: ' + r.firstError + '\n\nThey stay marked in the list so you can fix or undo them.');
      } finally { sbarSave.disabled = false; sbarDrop.disabled = false; }
      repaintAll();
    };
    sbarDrop.onclick = () => {
      if (!confirm('Discard the ' + orphanStageCount() + ' unsaved change(s)? The files stay uncategorized.')) return;
      Object.keys(orphanStage()).forEach(unstageOrphan);
      repaintAll();
    };
    const t = el('table');
    t.innerHTML = '<thead><tr><th>File</th><th>Looks like</th><th>Size</th><th>Put there by</th><th>When</th><th></th></tr></thead>';
    const tb = el('tbody');
    const rowDraws = [];
    const repaintAll = () => { rowDraws.forEach(d => d()); paintBar(); };
    list.forEach(o => {
      let tr = null;
      const draw = () => { const n = buildRow(); if (tr) tr.replaceWith(n); else tb.appendChild(n); tr = n; };
      rowDraws.push(draw);
      const restage = () => { draw(); paintBar(); };
      const buildRow = () => {
      const tr = el('tr');
      const g = o.guess;
      const staged = orphanStage()[o.path];
      // v11.1: if the file already sits where the app itself would have put
      // it ([Family]\[DocType]\[Part]\file), say so plainly instead of a
      // blank form — the point of "aware where the user placed the doc" is
      // that filing it becomes a one-click confirm, not a re-typed guess.
      const guessCell = g
        ? (g.confident
            ? '<b>' + esc(g.project_id) + '</b> / ' + esc(g.doc_code) + (g.part_id ? ' (' + esc(g.part_id) + ')' : '') + '<div class="note">' + esc(g.doc_name || '') + '</div>'
            : '<span class="note">' + esc(g.doc_code) + (g.part_id ? ' (' + esc(g.part_id) + ')' : '') + ', family "' + esc(g.family) + '"' +
              (g.ambiguous_projects.length > 1 ? ' — matches ' + g.ambiguous_projects.length + ' projects, pick one' : ' — no step found, pick one') + '</span>')
        : '<span class="note">not in a recognised folder structure</span>';
      tr.innerHTML = '<td><code>' + esc(o.path) + '</code></td>' +
        '<td>' + guessCell + '</td>' +
        '<td>' + Math.round(o.bytes / 1024) + ' KB</td>' +
        '<td>' + esc(o.owner || '(unknown)') + '</td>' +
        '<td>' + esc(fmtStamp(o.created_utc)) + '<div class="note">modified ' + esc(fmtStamp(o.modified_utc)) + '</div></td>' +
        '<td></td>';
      const acts = tr.lastChild;
      if (staged) {
        // v12.2: chosen but not saved yet - the row stays where it is, dimmed,
        // with the choice written out and a way back.
        tr.classList.add('orph-staged');
        const what = el('div', staged.error ? 'orph-staged-err' : 'orph-staged-what');
        what.textContent = (staged.error ? 'Could not save: ' + staged.error + ' — ' : '✓ ') + staged.label;
        acts.appendChild(what);
        const undo = el('button', 'sm', 'Undo');
        undo.onclick = () => { unstageOrphan(o.path); restage(); };
        acts.appendChild(undo);
        return tr;
      }
      if (g && g.confident) {
        const okBtn = el('button', 'primary sm', 'Confirm');
        okBtn.title = 'File as ' + g.project_id + ' / ' + g.doc_code + (g.part_id ? ' (' + g.part_id + ')' : '') + ', renamed to the naming standard';
        okBtn.onclick = () => {
          // staged, not posted: see flushOrphanStage
          stageOrphan(o.path, {
            action: 'adopt', label: 'will be filed as ' + g.project_id + ' / ' + g.doc_code + (g.part_id ? ' (' + g.part_id + ')' : '') + ' and renamed to the naming standard',
            body: { path: o.path, sha256: o.sha256, standardize: true, project_id: g.project_id, step_key: g.step_key, doc_code: g.doc_code, part_id: g.part_id }
          });
          restage();
        };
        acts.appendChild(okBtn);
        const adjBtn = el('button', 'sm', 'Adjust');
        adjBtn.style.marginLeft = '4px';
        adjBtn.onclick = () => openOrphanCategorizeModal(o, restage);
        acts.appendChild(adjBtn);
      } else {
        const catBtn = el('button', 'primary sm', 'Categorize');
        catBtn.onclick = () => openOrphanCategorizeModal(o, restage);
        acts.appendChild(catBtn);
      }
      const ignBtn = el('button', 'sm', 'Not a deliverable');
      ignBtn.style.marginLeft = '4px';
      ignBtn.onclick = () => {
        const reason = prompt('Why is this not a deliverable? (optional)', '');
        if (reason === null) return;
        stageOrphan(o.path, { action: 'ignore', reason: reason, label: 'will be marked "not a deliverable"' + (reason ? ' (' + reason + ')' : '') });
        restage();
      };
      acts.appendChild(ignBtn);
      return tr;
      };
      draw();
    });
    paintBar();
    t.appendChild(tb);
    const scroll = el('div', 'scroll'); scroll.appendChild(t); orphBody.appendChild(scroll);
  })();
}

/* v11.1 — registers an orphan file found already sitting in the vault as a
   real deliverable. Pre-fills project/document/step/part from the file's
   own location when Get-OrphanGuess recognised it (the "aware where the
   user placed the doc" case), otherwise opens blank for a fully manual pick.
   "Standardize the name" (checked whenever the guess was confident, since
   that is what being asked to confirm a guess implies) renames the file to
   the current naming standard via POST /api/vault/orphans/adopt; unchecked
   keeps the original name and location exactly as found. */
function openOrphanCategorizeModal(orphan, onStaged) {
  const g = orphan.guess;
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  const projOpts = TRK.lb_projects.map(r => '<option value="' + esc(r.project_id) + '">').join('');
  box.innerHTML = '<h2>Categorize file</h2><p class="note"><code>' + esc(orphan.path) + '</code></p>' +
    (g ? '<p class="note">Guessed from its folder: ' + esc(g.doc_code) + (g.part_id ? ' (' + esc(g.part_id) + ')' : '') +
      ' under family "' + esc(g.family) + '"' + (g.ambiguous_projects.length > 1 ? ' — matches several projects, pick the right one below' : '') + '.</p>' : '') +
    '<div class="filters" style="flex-direction:column;align-items:stretch;gap:8px">' +
    '<label>Project</label><input id="ocProj" list="ocProjList" value="' + esc(g && g.ambiguous_projects.length <= 1 ? (g.project_id || '') : '') + '"><datalist id="ocProjList">' + projOpts + '</datalist>' +
    '<label>Document type</label><input id="ocDoc" list="ocDocList" placeholder="— pick document type —" value="' + esc(g ? g.doc_code : '') + '"><datalist id="ocDocList"></datalist>' +
    '<label>Step</label><input id="ocStep" list="ocStepList" placeholder="— pick step —"><datalist id="ocStepList"></datalist>' +
    '<label>Part / category (optional)</label><input id="ocPart" placeholder="e.g. Bracket" value="' + esc(g ? g.part_id || '' : '') + '">' +
    '<label class="note" style="font-weight:400"><input type="checkbox" id="ocStd"' + (g && g.confident ? ' checked' : '') + '> Standardize the file name to the current naming standard (unchecked keeps its original name, in place)</label>' +
    '</div><div class="acts"><button id="ocCancel">Cancel</button><button id="ocGo" class="primary">File it</button></div>';
  scrim.appendChild(box); document.body.appendChild(scrim);
  const refill = (keepDoc) => {
    const p = projById($('#ocProj', box).value);
    const doc = normaliseDoctypeInput($('#ocDoc', box).value);
    const stepId = resolveStepInput($('#ocStep', box).value, p);
    $('#ocDocList', box).innerHTML = docDatalistOptionsForStep(p, stepId);
    $('#ocStepList', box).innerHTML = stepDatalistOptions(p, doc);
    if (!keepDoc && doc && p) {
      const best = bestStepForDoc(p, doc);
      if (best && !$('#ocStep', box).value.trim()) $('#ocStep', box).value = best.step.step_id + ' — ' + best.step.step_name;
    }
  };
  refill(false);
  // A confident guess already knows the step key directly (it walked the
  // process' own step list to find it) — resolve it to the "N — Name" label
  // refill() expects, rather than re-deriving it from bestStepForDoc, which
  // can legitimately disagree when a document is required at more than one step.
  if (g && g.confident && g.step_key) {
    const p = projById(g.project_id);
    const stepId = g.step_key.split('-').pop();
    const step = p && stepsOf(p.process, p).find(s => String(s.step_id) === stepId);
    if (step) $('#ocStep', box).value = step.step_id + ' — ' + step.step_name;
  }
  $('#ocProj', box).onchange = () => refill(false);
  $('#ocDoc', box).onchange = () => refill(false);
  $('#ocStep', box).onchange = () => refill(true);
  const close = () => scrim.remove();
  $('#ocCancel', box).onclick = close;
  $('#ocGo', box).onclick = async () => {
    const who = requireName(); if (!who) return;
    const p = projById($('#ocProj', box).value);
    if (!p) { alert('Pick a registered project first.'); return; }
    const doc = normaliseDoctypeInput($('#ocDoc', box).value);
    if (!doc) { alert('Pick a document type first.'); return; }
    const stepId = resolveStepInput($('#ocStep', box).value, p);
    if (stepId == null) { alert('Pick a valid step first.'); return; }
    const step = stepsOf(p.process, p).find(s => s.step_id === stepId);
    const part = $('#ocPart', box).value.trim();
    // v12.2: staged, not posted - saved with the rest by "Save changes" / on leaving the tab
    stageOrphan(orphan.path, {
      action: 'adopt',
      label: 'will be filed as ' + p.project_id + ' / ' + doc + (part ? ' (' + part + ')' : '') + ($('#ocStd', box).checked ? ' and renamed to the naming standard' : ' in place'),
      body: { path: orphan.path, sha256: orphan.sha256, standardize: $('#ocStd', box).checked, project_id: p.project_id, step_key: stepKeyOf(p.process, step), doc_code: doc, part_id: part }
    });
    close();
    if (onStaged) onStaged();
  };
}

/* ===================================================================== */
/* v11 R3 - TAB: Document Vault (cross-project, revision-aware search)   */
/* ===================================================================== */
/* One row per DOCUMENT (project + step + doc type) with its active revision
   inline. Filtering and paging happen on the server (/api/vault/search) -
   this view never scans the full store dump. Filter state lives outside the
   view so the 15 s auto-reload redraw keeps it. */
var vaultState = { q: '', pillar: '', family: '', doc: '', pic: '', dept: '', from: '', to: '', status: '', stale: false, page: 1, size: 50 };
function viewVault(root) {
  root.appendChild(pageHeader(i18n('vaultTitle'), i18n('vaultSub')));
  const bar = el('div', 'filters vault-filters');
  const sel = (id, label) => '<label for="' + id + '">' + label + '</label><select id="' + id + '"></select>';
  bar.innerHTML =
    '<input id="vq" type="search" placeholder="Search file name, description, project, document…" style="min-width:260px">' +
    sel('vPillar', 'Pillar') + sel('vFam', 'Family') + sel('vDoc', 'Doc type') + sel('vPic', 'PIC') + sel('vDept', 'Dept') +
    '<label for="vStatus">Status</label><select id="vStatus"><option value="">Any</option><option value="Filed">Filed</option>' +
      '<option value="Approved">Approved</option><option value="Removed">Removed</option></select>' +
    '<label for="vFrom">From</label><input id="vFrom" type="date"><label for="vTo">To</label><input id="vTo" type="date">' +
    '<label class="vault-stale-chk"><input id="vStale" type="checkbox"> stale approvals only</label>' +
    '<button id="vReset" type="button">Reset</button>';
  root.appendChild(bar);
  const out = el('div', 'vault-results');
  root.appendChild(out);

  const ids = { q: 'vq', pillar: 'vPillar', family: 'vFam', doc: 'vDoc', pic: 'vPic', dept: 'vDept', status: 'vStatus', from: 'vFrom', to: 'vTo' };
  Object.keys(ids).forEach(k => { const e = $('#' + ids[k], bar); if (e.tagName !== 'SELECT' || k === 'status') e.value = vaultState[k]; });
  $('#vStale', bar).checked = !!vaultState.stale;

  let seq = 0, timer = null;
  const fillSelect = (id, values, current, allLabel, labelOf) => {
    const s = $('#' + id, bar);
    const vals = values.slice();
    if (current && vals.indexOf(current) < 0) vals.unshift(current);
    s.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + vals.map(v => '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(labelOf ? labelOf(v) : v) + '</option>').join('');
  };
  const run = async () => {
    const my = ++seq;
    const qs = new URLSearchParams();
    ['q', 'pillar', 'family', 'doc', 'pic', 'dept', 'status', 'from', 'to'].forEach(k => { if (vaultState[k]) qs.set(k, vaultState[k]); });
    if (vaultState.stale) qs.set('stale', '1');
    qs.set('page', vaultState.page); qs.set('size', vaultState.size);
    out.innerHTML = '<p class="note">Searching…</p>';
    let res;
    try {
      const r = await fetch('/api/vault/search?' + qs.toString(), { cache: 'no-store' });
      if (!r.ok) throw await API.err(r);
      res = await r.json();
    } catch (e) { if (my === seq) out.innerHTML = '<p class="note" style="color:var(--bad)">Search failed: ' + esc(e.message) + '</p>'; return; }
    if (my !== seq) return;   // a newer search superseded this one
    const f = res.facets || {};
    // every configured pillar, not only those that already have documents
    fillSelect('vPillar', pillarDefs().map(pd => pd.id), vaultState.pillar, 'All pillars', v => pillarName(v));
    fillSelect('vFam', f.families || [], vaultState.family, 'All families', v => { const fm = familyById(v); return fm ? fm.prod_family_name + ' (' + v + ')' : v; });
    fillSelect('vDoc', f.docs || [], vaultState.doc, 'All doc types', v => v + ' — ' + docTypeById(v).name);
    fillSelect('vPic', f.pics || [], vaultState.pic, 'Anyone');
    fillSelect('vDept', f.depts || [], vaultState.dept, 'All departments');
    renderVaultResults(out, res, run);
  };
  const onChange = () => {
    Object.keys(ids).forEach(k => { vaultState[k] = $('#' + ids[k], bar).value.trim(); });
    vaultState.stale = $('#vStale', bar).checked;
    vaultState.page = 1;
    run();
  };
  bar.querySelectorAll('select, input[type="date"], input[type="checkbox"]').forEach(e => { e.onchange = onChange; });
  $('#vq', bar).oninput = () => { clearTimeout(timer); timer = setTimeout(onChange, 300); };
  $('#vReset', bar).onclick = () => {
    vaultState = { q: '', pillar: '', family: '', doc: '', pic: '', dept: '', from: '', to: '', status: '', stale: false, page: 1, size: 50 };
    show('vault');
  };
  run();
}
function renderVaultResults(out, res, rerun) {
  out.innerHTML = '';
  const total = res.total || 0;
  const from = total ? (res.page - 1) * res.size + 1 : 0;
  const to = Math.min(total, res.page * res.size);
  const head = el('div', 'vault-summary');
  head.innerHTML = '<b>' + total + '</b> document' + (total === 1 ? '' : 's') + (total ? ' · showing ' + from + '–' + to : '');
  out.appendChild(head);
  if (!total) { out.appendChild(el('p', 'note', 'No document matches these filters.')); return; }
  const wrap = el('div', 'scroll');
  const t = el('table', 'vault-table');
  t.innerHTML = '<thead><tr><th>Project</th><th>Pillar</th><th>Document</th><th>Step</th><th>Rev</th><th>PIC</th><th>Filed</th><th>Status</th><th></th></tr></thead>';
  const tb = el('tbody');
  res.rows.forEach(r => {
    const tr = el('tr');
    // v11.1: status is now the document's real lifecycle state - Filed,
    // Approved (its step's gate has been signed or bypassed) or Removed -
    // instead of the old binary Active/Removed that never told anyone
    // whether a filed document had actually been signed off.
    const statusCls = badgeClass(String(r.status || '').toUpperCase());
    // v11.1: same "+ part" fallback as the drawer's filed-documents table —
    // a document with no part yet still needs a one-click way to give it
    // one, not just a rename once it already has one.
    const partBadge = r.part_id
      ? ' <span class="badge part-badge part-badge-btn" title="Click to rename this part">' + esc(r.part_id) + '</span>'
      : (r.kind !== 'link' && r.status !== 'Removed' ? ' <span class="badge bg-secondary part-badge part-badge-btn" title="Click to give this a part / category">+ part</span>' : '');
    tr.innerHTML =
      '<td><b>' + esc(r.project_id) + '</b><div class="note">' + esc(r.family || '') + '</div></td>' +
      '<td>' + esc(pillarName(r.process)) + '</td>' +
      '<td><b>' + esc(r.doc_code) + '</b>' + partBadge + '<div class="note">' + esc(r.doc_name || '') + (r.owner_dept ? ' · ' + esc(r.owner_dept) : '') + '</div>' +
        (r.file_name ? '<div class="note"><code>' + esc(r.file_name) + '</code></div>' : '') +
        (r.change_reason ? '<div class="note">Change: ' + esc(r.change_reason) + '</div>' : '') + '</td>' +
      '<td>' + esc(r.step_key) + '<div class="note">' + esc(r.step_name || '') + '</div></td>' +
      '<td>' + (r.rev ? '<span class="badge bg-secondary rev-badge">rev ' + esc(r.rev) + '</span>' + (r.revisions > 1 ? '<div class="note">' + r.revisions + ' revisions</div>' : '') : '—') + '</td>' +
      '<td>' + esc(r.pic || '') + '</td>' +
      '<td>' + esc(fmtStamp(r.date)) + '</td>' +
      '<td><span class="' + statusCls + '">' + esc(r.status) + '</span>' +
        (r.stale ? '<div>' + staleBadgeHtml({ docs: [r.doc_code], approved_utc: '' }).replace(/title="[^"]*"/, 'title="The gate was signed before this revision was filed"') + '</div>' : '') + '</td><td class="vault-acts"></td>';
    const acts = tr.lastChild;
    const project = projById(r.project_id);
    const step = project ? allStepsOf(project.process).find(s => stepKeyOf(project.process, s) === r.step_key) : null;
    const viewUrl = r.kind === 'link' ? r.link_url : evidenceViewerUrl(r.file_path);
    if (viewUrl) {
      const a = el('a', 'btn btn-sm', 'Open');
      a.href = viewUrl; a.target = '_blank'; a.rel = 'noopener';
      acts.appendChild(a);
    }
    if (project && step && r.rev) {
      const h = el('button', 'sm', 'History');
      h.onclick = () => openHistoryModal(project, step, r.doc_code, r.part_id);
      acts.appendChild(h);
      if (r.kind !== 'link' && r.status !== 'Removed') {
        const nr = el('button', 'sm', 'New revision');
        nr.onclick = () => pickNewRevision(project, r.step_key, r.doc_code, rerun, r.part_id);
        acts.appendChild(nr);
      }
    }
    const partBtn = tr.querySelector('.part-badge-btn');
    if (partBtn && project) partBtn.onclick = () => renamePart(project, r.step_key, r.doc_code, r.part_id, rerun);
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); out.appendChild(wrap);
  if (total > res.size) {
    const pager = el('div', 'filters vault-pager');
    const prev = el('button', '', '‹ Previous'); prev.disabled = res.page <= 1;
    const next = el('button', '', 'Next ›'); next.disabled = to >= total;
    prev.onclick = () => { vaultState.page = Math.max(1, res.page - 1); rerun(); };
    next.onclick = () => { vaultState.page = res.page + 1; rerun(); };
    pager.appendChild(prev);
    pager.appendChild(el('span', 'note', 'page ' + res.page + ' of ' + Math.ceil(total / res.size)));
    pager.appendChild(next);
    out.appendChild(pager);
  }
}

/* ---- v11 R4: Pillars (processes) - admin editor ------------------------ */
const PILLAR_FEATURES = [
  ['ppap', 'PPAP package sub-view + matrix column'],
  ['mwer', 'MWER record on steps whose name mentions MWER'],
  ['trial_by_step_name', 'Trial quantities on "trial production execution" steps'],
  ['gate_grouped_matrix', 'Dashboard matrix grouped by gate'],
  ['stage_completion', 'Stage-completion cards on the dashboard']
];
/* ===================================================================== */
/* v11.1 — Settings: File naming standard (no-code, Excel-style builder) */
/* ===================================================================== */
/* Mirrors Get-NamingFieldValue / the field list launcher.ps1 keeps in
   $NamingFieldDefs — kept here too so Settings can preview a DRAFT rule
   (one not yet saved) without a server round trip on every keystroke. The
   real, authoritative render always happens server-side at upload time via
   Get-StandardFileName / /api/filename/preview; this is only ever a hint. */
const NAMING_FIELDS = [
  ['doc_code', 'Document code (e.g. DWG)'],
  ['model', 'Model / family (e.g. 9649LP)'],
  ['wvn_id', 'WVN code'],
  ['wnb_id', 'WNB / customer number'],
  ['description', "Description (falls back to the original file's name)"],
  ['project_id', 'Project ID'],
  ['part', 'Part / category'],
  ['date', "Today's date (YYYYMMDD)"],
  ['time', 'Time of upload (HHMMSS)']
];
const NAMING_FIELD_LABEL = {}; NAMING_FIELDS.forEach(f => { NAMING_FIELD_LABEL[f[0]] = f[1]; });
const NAMING_SAMPLE = {
  doc_code: 'DWG', model: 'CL-CORDLESS', wvn_id: '1010523', wnb_id: '3025015',
  description: 'Motor with PCBA', project_id: 'NPI-9649LP', part: 'Bracket', date: '20260101', time: '120000'
};
// Sanitises a DATA value: strips characters Windows forbids in a file name,
// then either keeps its internal spaces (collapsed to one) or turns them into
// underscores, and trims '_'/' '/'.' off both ends. Mirrors ConvertTo-NamePart.
function namingPart(v, keepSpaces) {
  v = String(v == null ? '' : v).replace(/[\\/:*?"<>|]/g, '_');
  v = keepSpaces ? v.replace(/\s+/g, ' ').trim() : v.replace(/\s+/g, '_');
  v = v.replace(/_{2,}/g, '_');
  return v.replace(/^[_ .]+|[_ .]+$/g, '');
}
// A literal piece is admin-typed, on purpose (a separator, a prefix like
// "PD") — it comes back UNCHANGED except for characters Windows forbids in a
// file name; anything that trims it, the way namingPart() does, would erase
// a whitespace- or underscore-only separator to nothing. Mirrors
// ConvertTo-NamingLiteral.
function namingLiteral(v) {
  return String(v == null ? '' : v).replace(/[\\/:*?"<>|]/g, '_');
}
function previewNamingSegments(segments, sample, originalName) {
  const ext = ((originalName || '').match(/\.[^.]*$/) || [''])[0].toLowerCase();
  const stem = (originalName || '').replace(/\.[^.]*$/, '');
  let out = (segments || []).map(seg => {
    if (seg.type === 'text') return namingLiteral(seg.value);
    const raw = (sample[seg.key] != null && sample[seg.key] !== '') ? sample[seg.key] : (seg.key === 'description' ? stem : '');
    return namingPart(raw, !!seg.keep_spaces);
  }).join('');
  // A blank field leaves its neighbouring "_" separators doubled — collapsed
  // here exactly like Format-NamingTemplate does server-side.
  out = out.replace(/_{2,}/g, '_').replace(/^[_ .]+|[_ .]+$/g, '');
  if (!out) out = namingPart(stem, false);
  return out + ext;
}
function rawNamingRules() {
  return JSON.parse(JSON.stringify((CFG.naming && CFG.naming.rules && CFG.naming.rules.length) ? CFG.naming.rules : []));
}
async function postNaming(rules, appliedRuleId) {
  try { await API.post('/api/config/naming', { user: getUser(), rules }); }
  catch (e) { alert('Could not save: ' + e.message); return; }
  await refreshSilently();
  show('settings');
  // v11.1: offer to bring existing filed documents in line with the rule
  // that was just saved — otherwise "the naming standard changed" only ever
  // affects files uploaded from now on, and the vault ends up a mix of old
  // and new names with no way to tell which is which without opening History.
  if (!appliedRuleId) return;
  let count = 0;
  try { count = (await (await fetch('/api/config/naming/apply?rule_id=' + encodeURIComponent(appliedRuleId))).json()).documents || 0; }
  catch (e) { return; }
  if (!count) return;
  if (!confirm('Rename ' + count + ' already-filed document' + (count === 1 ? '' : 's') + ' that this rule now covers, to match the new naming standard?\n\n' +
    'Only the file name changes — the file\'s content, revision history and folder are untouched.')) return;
  let result;
  try { result = await API.post('/api/config/naming/apply', { user: getUser(), rule_id: appliedRuleId }); }
  catch (e) { alert('Rename failed: ' + e.message); return; }
  alert('Renamed ' + result.renamed + ' of ' + result.scanned + ' document(s).' +
    (result.skipped ? ' ' + result.skipped + ' skipped (already correctly named, or the target name already exists).' : '') +
    (result.errors && result.errors.length ? '\n\nErrors:\n' + result.errors.join('\n') : ''));
  await redrawAfterWrite();
}
function namingCard() {
  const card = el('div', 'card naming-card');
  const hdr = el('div', 'card-header'); hdr.appendChild(el('h3', 'card-title', 'File naming standard')); card.appendChild(hdr);
  const body = el('div', 'card-body');
  body.appendChild(el('p', 'note', 'How an uploaded file is renamed before it is saved. Build each rule by picking fields and text in ' +
    'the order they should appear on the file name — no code, no punctuation to get right. The first rule whose document code list ' +
    'matches wins; one rule with a blank list is the default that catches everything else.'));
  const rules = rawNamingRules();
  const t = el('table', 'naming-table');
  t.innerHTML = '<thead><tr><th>Label</th><th>Applies to</th><th>Example</th><th></th></tr></thead>';
  const tb = el('tbody');
  rules.forEach((r, i) => {
    const tr = el('tr');
    const applies = (r.doc_codes && r.doc_codes.length) ? r.doc_codes.join(', ') : '(default — everything else)';
    const example = previewNamingSegments(r.segments, NAMING_SAMPLE, 'original.pdf');
    tr.innerHTML = '<td><b>' + esc(r.label || r.id) + '</b></td><td class="note">' + esc(applies) + '</td>' +
      '<td><code>' + esc(example) + '</code></td><td></td>';
    const acts = tr.lastChild;
    const up = el('button', 'sm', '↑'); up.disabled = i === 0; up.title = 'Move up';
    up.onclick = () => { const l = rawNamingRules(); const t2 = l[i - 1]; l[i - 1] = l[i]; l[i] = t2; postNaming(l); };
    const down = el('button', 'sm', '↓'); down.disabled = i === rules.length - 1; down.title = 'Move down';
    down.onclick = () => { const l = rawNamingRules(); const t2 = l[i + 1]; l[i + 1] = l[i]; l[i] = t2; postNaming(l); };
    const edit = el('button', 'sm', 'Edit'); edit.onclick = () => editNamingRuleModal(r, i);
    acts.appendChild(up); acts.appendChild(down); acts.appendChild(edit);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const scroll = el('div', 'scroll'); scroll.appendChild(t); body.appendChild(scroll);
  const add = el('button', 'primary', 'Add rule'); add.style.marginTop = '8px';
  add.onclick = () => editNamingRuleModal(null, -1);
  body.appendChild(add);
  card.appendChild(body);
  return card;
}
function editNamingRuleModal(rule, index) {
  const isNew = !rule;
  const raw = rule ? JSON.parse(JSON.stringify(rule)) : { id: 'rule_' + Date.now().toString(36), label: '', doc_codes: [], segments: [] };
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal naming-modal');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'nrTitle');
  const v = x => esc(x == null ? '' : String(x));
  // v11.1: a checkbox list of known document types to pick from, rather than
  // typing codes by hand and hoping they're spelled the way the catalogue
  // spells them. A "custom / other codes" box stays underneath for anything
  // not in the shared catalogue (a per-pillar or per-project custom doc).
  const knownCodes = allDocTypes().map(d => d.doctype_id).sort();
  const rawCodes = (raw.doc_codes || []).map(c => String(c).toUpperCase());
  const otherCodes = rawCodes.filter(c => knownCodes.indexOf(c) < 0);
  box.innerHTML = '<h2 id="nrTitle">' + (isNew ? 'Add naming rule' : 'Edit naming rule') + '</h2>' +
    '<div class="fld"><span>Label</span><input id="nrLabel" value="' + v(raw.label) + '" placeholder="e.g. Drawings"></div>' +
    '<div class="fld"><span>Applies to (leave everything unchecked and blank for "everything else")</span>' +
    '<div class="naming-code-list scroll">' + knownCodes.map(c => {
      const dt = allDocTypes().find(d => d.doctype_id === c);
      return '<label><input type="checkbox" data-code="' + esc(c) + '"' + (rawCodes.indexOf(c) >= 0 ? ' checked' : '') + '> ' +
        esc(c) + (dt && dt.name && dt.name !== c ? ' <span class="note">— ' + esc(dt.name) + '</span>' : '') + '</label>';
    }).join('') + '</div>' +
    '<input id="nrOtherCodes" value="' + v(otherCodes.join(', ')) + '" placeholder="Other / custom codes, comma-separated" style="margin-top:6px"></div>' +
    '<h3 style="margin-bottom:4px">The file name is built from, in this order:</h3>' +
    '<table class="naming-seg-table"><thead><tr><th style="width:40px"></th><th>Piece</th><th style="width:80px"></th></tr></thead><tbody id="nrSegs"></tbody></table>' +
    '<div class="filters" style="margin-top:6px"><button id="nrAddField" type="button" class="sm">+ Add a field</button>' +
    '<button id="nrAddText" type="button" class="sm">+ Add fixed text</button></div>' +
    '<p class="note" style="margin-top:8px">Example with sample data: <code id="nrPreview"></code></p>' +
    '<p class="nr-err" style="color:var(--bad);display:none"></p>' +
    '<div class="acts"></div>';
  scrim.appendChild(box); document.body.appendChild(scrim);
  // Common separators, offered as a pick-list on every "fixed text" input —
  // still a free text box (a prefix like "PD" is legitimate too), just with
  // suggestions so the usual case needs no typing.
  const sepListId = 'nrSepList' + (++_modalSeq);
  box.insertAdjacentHTML('beforeend', '<datalist id="' + sepListId + '">' +
    ['_', '-', ' ', '.', 'PD'].map(s => '<option value="' + esc(s) + '">').join('') + '</datalist>');
  const segs = (raw.segments || []).map(s => Object.assign({}, s));
  const segBody = box.querySelector('#nrSegs');
  const preview = box.querySelector('#nrPreview');
  const refreshPreview = () => { preview.textContent = previewNamingSegments(segs, NAMING_SAMPLE, 'original.pdf'); };
  const drawSegs = () => {
    segBody.innerHTML = '';
    segs.forEach((seg, i) => {
      const tr = el('tr');
      const handle = '<div class="naming-seg-handle"><button type="button" class="sm" data-mv="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="sm" data-mv="down" data-i="' + i + '"' + (i === segs.length - 1 ? ' disabled' : '') + '>↓</button></div>';
      let piece;
      if (seg.type === 'text') {
        piece = '<span class="note">Text:</span> <input list="' + sepListId + '" data-k="value" data-i="' + i + '" value="' + v(seg.value) + '" placeholder="e.g. _ or PD" style="width:160px">';
      } else {
        piece = '<span class="note">Field:</span> <select data-k="key" data-i="' + i + '">' +
          NAMING_FIELDS.map(f => '<option value="' + f[0] + '"' + (seg.key === f[0] ? ' selected' : '') + '>' + esc(f[1]) + '</option>').join('') +
          '</select> <label class="note" style="font-weight:400"><input type="checkbox" data-k="keep_spaces" data-i="' + i + '"' +
          (seg.keep_spaces ? ' checked' : '') + '> keep spaces</label>';
      }
      const rm = '<button type="button" class="sm" data-rm="' + i + '">Remove</button>';
      tr.innerHTML = '<td>' + handle + '</td><td>' + piece + '</td><td>' + rm + '</td>';
      segBody.appendChild(tr);
    });
    segBody.querySelectorAll('[data-mv]').forEach(btn => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i), j = btn.dataset.mv === 'up' ? i - 1 : i + 1;
        const t2 = segs[j]; segs[j] = segs[i]; segs[i] = t2;
        drawSegs(); refreshPreview();
      };
    });
    segBody.querySelectorAll('[data-rm]').forEach(btn => {
      btn.onclick = () => { segs.splice(Number(btn.dataset.rm), 1); drawSegs(); refreshPreview(); };
    });
    segBody.querySelectorAll('[data-k]').forEach(inp => {
      const ev = inp.type === 'checkbox' ? 'onchange' : 'oninput';
      inp[ev] = () => {
        const seg = segs[Number(inp.dataset.i)];
        if (inp.dataset.k === 'keep_spaces') seg.keep_spaces = inp.checked;
        else seg[inp.dataset.k] = inp.value;
        refreshPreview();
      };
    });
    refreshPreview();
  };
  drawSegs();
  box.querySelector('#nrAddField').onclick = () => { segs.push({ type: 'field', key: NAMING_FIELDS[0][0], keep_spaces: false }); drawSegs(); refreshPreview(); };
  box.querySelector('#nrAddText').onclick = () => { segs.push({ type: 'text', value: '_' }); drawSegs(); refreshPreview(); };

  const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  const err = msg => { const e = box.querySelector('.nr-err'); e.textContent = msg; e.style.display = msg ? '' : 'none'; };
  const acts = box.querySelector('.acts');
  if (!isNew) {
    const del = el('button', 'danger', 'Delete rule');
    del.onclick = () => { const l = rawNamingRules(); l.splice(index, 1); close(); postNaming(l); };
    acts.appendChild(del);
  }
  const no = el('button', '', 'Cancel'); no.onclick = close;
  const yes = el('button', 'primary', isNew ? 'Add rule' : 'Save rule');
  yes.onclick = () => {
    const checked = $$('.naming-code-list input[type=checkbox]:checked', box).map(c => c.dataset.code);
    const other = box.querySelector('#nrOtherCodes').value.split(/[,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    const out = {
      id: raw.id, label: box.querySelector('#nrLabel').value.trim(),
      doc_codes: checked.concat(other).filter((c, i, a) => a.indexOf(c) === i),
      segments: segs
    };
    if (!out.label) { err('A label is required.'); return; }
    if (!segs.length) { err('Add at least one field or piece of text.'); return; }
    if (!segs.some(s => s.type === 'field')) { err('Add at least one field, or every file with this rule gets the same name.'); return; }
    const l = rawNamingRules();
    if (isNew) l.push(out); else l[index] = out;
    close();
    postNaming(l, out.id);
  };
  acts.appendChild(no); acts.appendChild(yes);
}

/* v11.1 — a folder browser fenced to the app's "site" (its own parent
   folder), for Settings -> Evidence vault location. Backed by
   GET /api/browse-folders, which enforces the same boundary server-side —
   this is a convenience for picking a path that was always going to be
   validated on save, not the only thing stopping someone leaving the site. */
function openVaultFolderBrowser(onChoose) {
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = '<h2>Choose the vault folder</h2>' +
    '<p class="note" id="vbBreadcrumb"></p>' +
    '<div class="scroll naming-code-list" id="vbList" style="max-height:280px;display:block"></div>' +
    '<p class="vb-err note" style="color:var(--bad);display:none"></p>' +
    '<div class="acts"><button id="vbUp" class="sm">↑ Up</button><button id="vbCancel">Cancel</button><button id="vbChoose" class="primary">Choose this folder</button></div>';
  scrim.appendChild(box); document.body.appendChild(scrim);
  let cwd = '';
  const list = box.querySelector('#vbList');
  const crumb = box.querySelector('#vbBreadcrumb');
  const errEl = box.querySelector('.vb-err');
  const load = async (path) => {
    errEl.style.display = 'none';
    list.innerHTML = '<p class="note">Loading…</p>';
    let data;
    try {
      const r = await fetch('/api/browse-folders?path=' + encodeURIComponent(path || ''), { cache: 'no-store' });
      data = await r.json();
    } catch (e) { errEl.textContent = 'Could not list folders: ' + e.message; errEl.style.display = ''; return; }
    cwd = data.path || '';
    crumb.textContent = '(site root)/' + cwd;
    box.querySelector('#vbUp').disabled = !data.can_go_up;
    if (data.error) { errEl.textContent = data.error; errEl.style.display = ''; }
    list.innerHTML = '';
    if (!data.folders.length) { list.appendChild(el('p', 'note', '(no subfolders here)')); return; }
    data.folders.forEach(name => {
      const row = el('div');
      row.style.cssText = 'padding:4px 2px;cursor:pointer';
      row.innerHTML = iconHtml('folder-open') + ' ' + esc(name);
      row.onclick = () => load(cwd ? cwd + '/' + name : name);
      row.onmouseenter = () => row.style.background = 'var(--soft)';
      row.onmouseleave = () => row.style.background = '';
      list.appendChild(row);
    });
  };
  box.querySelector('#vbUp').onclick = () => {
    const parts = cwd.split('/').filter(Boolean); parts.pop();
    load(parts.join('/'));
  };
  const close = () => scrim.remove();
  box.querySelector('#vbCancel').onclick = close;
  box.querySelector('#vbChoose').onclick = () => {
    if (!cwd) { errEl.textContent = 'Pick a subfolder — the site root itself cannot be the vault.'; errEl.style.display = ''; return; }
    close();
    onChoose(cwd);
  };
  load('');
}

function rawPillarList() {
  const src = (CFG.pillars && CFG.pillars.length) ? CFG.pillars : LEGACY_PILLARS;
  return JSON.parse(JSON.stringify(src));
}
function pillarsCard() {
  const card = el('div', 'card pillars-card');
  const hdr = el('div', 'card-header'); hdr.appendChild(el('h3', 'card-title', 'Pillars (processes)')); card.appendChild(hdr);
  const body = el('div', 'card-body');
  body.appendChild(el('p', 'note', 'Each pillar is a stage-gate process with its own steps, document types and name for the responsible person. ' +
    'A pillar added here gets its own tab, dashboard matrix, Gantt rows, revision history and Vault search without any code change. ' +
    'NPI and ECN keep their step definitions in npi_workflow / ecn_workflow.'));
  const t = el('table', 'pillar-table');
  t.innerHTML = '<thead><tr><th>ID</th><th>Name</th><th>Steps</th><th>Signed gates</th><th>Responsible label</th><th>Own doc types</th><th>Features</th><th>Projects</th><th></th></tr></thead>';
  const tb = el('tbody');
  pillarDefs().forEach(pd => {
    const tr = el('tr');
    const feats = PILLAR_FEATURES.filter(f => pd.features[f[0]]).map(f => f[0]).join(', ') || '—';
    tr.innerHTML = '<td><b>' + esc(pd.id) + '</b></td><td>' + esc(pd.name) + (pd.name_vi ? '<div class="note">' + esc(pd.name_vi) + '</div>' : '') + '</td>' +
      '<td>' + pd.steps.length + (pd.workflow ? '<div class="note">from ' + esc(pd.workflow) + '</div>' : '') + '</td>' +
      '<td>' + (pd.gate_mode === 'flagged' ? 'flagged steps' : 'every step') + '</td>' +
      '<td>' + esc(pd.pic_label) + '</td><td>' + pd.doc_types.length + '</td><td class="note">' + esc(feats) + '</td>' +
      '<td>' + projectsOf(pd.id).length + '</td><td></td>';
    const b = el('button', 'sm', 'Edit');
    b.onclick = () => editPillarModal(pd);
    tr.lastChild.appendChild(b);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const scroll = el('div', 'scroll'); scroll.appendChild(t); body.appendChild(scroll);
  const add = el('button', 'primary', 'Add pillar');
  add.style.marginTop = '8px';
  add.onclick = () => editPillarModal(null);
  body.appendChild(add);
  card.appendChild(body);
  return card;
}
function editPillarModal(pd) {
  const isNew = !pd;
  const raw = pd ? JSON.parse(JSON.stringify(pd.raw)) : { features: {}, steps: [{ step_id: 1, step_name: '', required_evidence_doctypes: [], conditional_evidence_doctypes: [], gate_clearance_required: true }], doc_types: [] };
  const ownsSteps = !raw.workflow;
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal pillar-modal');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'pmTitle');
  const v = x => esc(x == null ? '' : String(x));
  let html = '<h2 id="pmTitle">' + (isNew ? 'Add pillar' : 'Edit pillar ' + v(raw.process_id)) + '</h2><div class="pm-body">' +
    '<div class="grid2">' +
    '<div class="fld"><span>ID * (prefixes project IDs)</span><input id="pmId" value="' + v(raw.process_id) + '"' + (isNew ? '' : ' disabled') + ' placeholder="e.g. EEM"></div>' +
    '<div class="fld"><span>Icon</span><select id="pmIcon">' + PILLAR_ICONS.map(i => '<option' + (i === (raw.icon || 'clipboard-check') ? ' selected' : '') + '>' + i + '</option>').join('') + '</select></div>' +
    '<div class="fld"><span>Name *</span><input id="pmName" value="' + v(raw.name) + '"></div>' +
    '<div class="fld"><span>Name (Vietnamese)</span><input id="pmNameVi" value="' + v(raw.name_vi) + '"></div>' +
    '<div class="fld"><span>Responsible-person label (shown where NPI says "PIC")</span><input id="pmPic" value="' + v(raw.pic_label || 'PIC') + '"></div>' +
    '<div class="fld"><span>Responsible-person label (Vietnamese)</span><input id="pmPicVi" value="' + v(raw.pic_label_vi) + '"></div>' +
    '<div class="fld"><span>Signed gates</span><select id="pmGate"><option value="all"' + (raw.gate_mode !== 'flagged' ? ' selected' : '') + '>Every step is a signed gate</option>' +
      '<option value="flagged"' + (raw.gate_mode === 'flagged' ? ' selected' : '') + '>Only steps marked "gate"</option></select></div>' +
    '</div><h3>Features</h3><div class="pm-feats">' +
    PILLAR_FEATURES.map(f => '<label><input type="checkbox" data-feat="' + f[0] + '"' + ((raw.features || {})[f[0]] ? ' checked' : '') + '> ' + esc(f[1]) + '</label>').join('') +
    '</div><h3>Steps</h3>';
  if (ownsSteps) {
    html += '<p class="note">Document codes are comma-separated and must exist in the shared catalogue or in this pillar\'s own document types below.</p>' +
      '<table class="pm-steps"><thead><tr><th>#</th><th>Step name *</th><th>Required documents</th><th>If applicable</th><th>Gate</th><th></th></tr></thead><tbody></tbody></table>' +
      '<button type="button" class="sm" id="pmAddStep">Add step</button>';
  } else {
    html += '<p class="note">Steps come from <code>' + v(raw.workflow) + '</code> in config.json (' + (pd ? pd.steps.length : 0) + ' steps) and are not edited here.</p>';
  }
  html += '<h3>Own document types</h3><p class="note">Added to the shared catalogue for this pillar only.</p>' +
    '<table class="pm-docs"><thead><tr><th>Code *</th><th>Name *</th><th>Owner dept</th><th></th></tr></thead><tbody></tbody></table>' +
    '<button type="button" class="sm" id="pmAddDoc">Add document type</button>' +
    '<p class="note pm-err" style="color:var(--bad);display:none"></p></div>';
  box.innerHTML = html;

  const stepBody = box.querySelector('.pm-steps tbody');
  const addStepRow = s => {
    const tr = el('tr');
    tr.innerHTML = '<td><input class="pm-sid" type="number" min="1" style="width:56px" value="' + v(s.step_id) + '"></td>' +
      '<td><input class="pm-sname" value="' + v(s.step_name) + '"></td>' +
      '<td><input class="pm-sreq" value="' + v((s.required_evidence_doctypes || []).join(', ')) + '"></td>' +
      '<td><input class="pm-scond" value="' + v((s.conditional_evidence_doctypes || []).join(', ')) + '"></td>' +
      '<td><input class="pm-sgate" type="checkbox"' + (s.gate_clearance_required !== false ? ' checked' : '') + '></td><td></td>';
    const rm = el('button', 'sm', 'Remove'); rm.type = 'button'; rm.onclick = () => tr.remove();
    tr.lastChild.appendChild(rm);
    stepBody.appendChild(tr);
  };
  if (stepBody) {
    (raw.steps || []).forEach(addStepRow);
    box.querySelector('#pmAddStep').onclick = () => addStepRow({ step_id: stepBody.children.length + 1, step_name: '', gate_clearance_required: true });
  }
  const docBody = box.querySelector('.pm-docs tbody');
  const addDocRow = d => {
    const tr = el('tr');
    tr.innerHTML = '<td><input class="pm-did" value="' + v(d.doctype_id) + '" style="width:120px"></td><td><input class="pm-dname" value="' + v(d.name) + '"></td>' +
      '<td><input class="pm-ddept" value="' + v(d.owner_dept) + '" style="width:120px"></td><td></td>';
    const rm = el('button', 'sm', 'Remove'); rm.type = 'button'; rm.onclick = () => tr.remove();
    tr.lastChild.appendChild(rm);
    docBody.appendChild(tr);
  };
  (raw.doc_types || []).forEach(addDocRow);
  box.querySelector('#pmAddDoc').onclick = () => addDocRow({});

  const acts = el('div', 'acts');
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = e => { if (e.key === 'Escape') close(); };
  const err = msg => { const e = box.querySelector('.pm-err'); e.textContent = msg; e.style.display = msg ? '' : 'none'; };
  const post = async list => {
    try {
      await API.post('/api/config/pillars', { user: getUser(), pillars: list });
    } catch (e) { err(e.message); return false; }
    close();
    await refreshSilently();
    show('settings');
    return true;
  };
  if (!isNew && !projectsOf(raw.process_id).length) {
    const del = el('button', 'danger', 'Delete pillar');
    del.onclick = () => post(rawPillarList().filter(x => x.process_id !== raw.process_id));
    acts.appendChild(del);
  }
  const no = el('button', '', 'Cancel'); no.onclick = close;
  const yes = el('button', 'primary', 'Save pillar');
  const codes = s => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  yes.onclick = () => {
    const out = raw;
    out.process_id = (box.querySelector('#pmId').value || '').trim().toUpperCase();
    out.name = box.querySelector('#pmName').value.trim();
    out.name_vi = box.querySelector('#pmNameVi').value.trim();
    out.pic_label = box.querySelector('#pmPic').value.trim() || 'PIC';
    out.pic_label_vi = box.querySelector('#pmPicVi').value.trim();
    out.gate_mode = box.querySelector('#pmGate').value;
    out.icon = box.querySelector('#pmIcon').value;
    out.features = {};
    box.querySelectorAll('[data-feat]').forEach(c => { if (c.checked) out.features[c.getAttribute('data-feat')] = true; });
    if (ownsSteps) {
      out.steps = Array.prototype.map.call(stepBody.children, tr => ({
        step_id: Number(tr.querySelector('.pm-sid').value),
        step_name: tr.querySelector('.pm-sname').value.trim(),
        required_evidence_doctypes: codes(tr.querySelector('.pm-sreq').value),
        conditional_evidence_doctypes: codes(tr.querySelector('.pm-scond').value),
        gate_clearance_required: tr.querySelector('.pm-sgate').checked
      }));
    }
    out.doc_types = Array.prototype.map.call(docBody.children, tr => ({
      doctype_id: tr.querySelector('.pm-did').value.trim(),
      name: tr.querySelector('.pm-dname').value.trim(),
      owner_dept: tr.querySelector('.pm-ddept').value.trim()
    })).filter(d => d.doctype_id || d.name);
    const list = rawPillarList();
    const i = list.findIndex(x => x.process_id === (isNew ? out.process_id : raw.process_id));
    if (isNew && i >= 0) { err('A pillar with id ' + out.process_id + ' already exists.'); return; }
    if (i >= 0) list[i] = out; else list.push(out);
    post(list);
  };
  acts.appendChild(no); acts.appendChild(yes);
  box.appendChild(acts);
  scrim.appendChild(box);
  scrim.onclick = e => { if (e.target === scrim) close(); };
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(scrim);
  (isNew ? box.querySelector('#pmId') : box.querySelector('#pmName')).focus();
}

/* ===================================================================== */
/* SHARED — project picker + step cards                                  */
/* ===================================================================== */
let justPickedTree = false;
let dashMatrixOpen = true;
// v9.2.1: the stage-completion grid is a drill-down, not a landing view — it
// pushed the Gantt and Work Matrix below the fold on every load. Collapsed by
// default; the flag lives at module scope so the choice survives the filter
// re-renders inside viewDashboard and the 15s auto-reload.
let npiStageOpen = false;
// v10: which Gantt rows have their per-step sub-rows expanded, keyed by
// project_id. A set rather than a single id because comparing two projects'
// step schedules side by side is the whole reason the drill-down exists.
let ganttExpanded = {};
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

function commentsFor(pid, delId) {
  return (TRK.lb_doc_comments || []).filter(c => c.project_id === pid && c.deliverable_id === delId);
}
// Gate-level comments reuse lb_doc_comments with deliverable_id left blank —
// step_key is what ties them to the gate instead. No schema change needed,
// the field was already there for exactly this kind of "not tied to one
// specific document" note.
function commentsForGate(pid, stepKey) {
  return (TRK.lb_doc_comments || []).filter(c => c.project_id === pid && c.step_key === stepKey && !c.deliverable_id);
}
// A still-missing/on-going dropzone has no deliverable_id yet — evidenceFor()
// hasn't created the row — so notes on it are addressed by doc_code+step_key
// instead, same "no schema change needed" logic as commentsForGate above.
function commentsForDoc(pid, stepKey, docCode) {
  return (TRK.lb_doc_comments || []).filter(c => c.project_id === pid && c.step_key === stepKey && c.doc_code === docCode);
}
/* ---- gate-level comment section (Section 4) -----------------------------
   Same visual/interaction pattern as the deliverable "Notes (N)" thread in
   evidenceTable, but for the stage gate itself rather than one document —
   there was previously no comment mechanism at the gate level at all. */
function gateCommentSection(project, stepKey) {
  const wrap = el('div', 'gate-comment-section');
  const notes = commentsForGate(project.project_id, stepKey);
  const cb = el('button', 'sm', 'Gate Notes (' + notes.length + ')');
  const noteWrap = el('div');
  wrap.appendChild(cb);
  wrap.appendChild(noteWrap);

  cb.onclick = () => {
    const existing = noteWrap.querySelector('.comment-thread');
    if (existing) { existing.remove(); cb.textContent = 'Gate Notes (' + notes.length + ')'; return; }

    const thread = el('div', 'comment-thread');
    if (notes.length) {
      notes.forEach(c => {
        const ci = el('div', 'comment-item');
        ci.innerHTML = '<b>' + esc(c.author) + '</b> <span class="note">' + esc((c.created_utc || '').slice(0, 10)) + '</span><br>' + esc(c.comment);
        thread.appendChild(ci);
      });
    } else {
      thread.appendChild(el('p', 'note', 'No notes on this gate yet.'));
    }

    const addWrap = el('div', 'comment-add');
    const inp = el('input');
    // captureUiState() matches `input[type=text]` — a CSS attribute selector
    // that requires the literal type="text" attribute, not just the DOM's
    // implicit default for a bare <input> — plus a non-empty id to re-find
    // the field after the reload's re-render (see line ~229). Without both,
    // typed-but-unsubmitted text here is silently dropped on reload. Only
    // one gate-comment section exists per open drawer, so a fixed id is safe.
    inp.type = 'text';
    inp.id = 'gateNoteInput';
    inp.placeholder = 'Add a note about this gate…';
    const save = el('button', 'sm primary', 'Save');
    save.onclick = async () => {
      const txt = inp.value.trim();
      if (!txt) return;
      const who = requireName() || '(unnamed)';
      save.disabled = true; save.textContent = 'Saving…';
      try {
        await API.action('lb_doc_comments', {
          project_id: project.project_id, deliverable_id: '', doc_code: '',
          step_key: stepKey, author: who, comment: txt, created_utc: new Date().toISOString()
        }, { audit: { user: who, action: 'Comment_Gate', projectId: project.project_id, objType: 'Gate', objId: stepKey, from: '', to: '', detail: txt.slice(0, 120) } });
        const ci = el('div', 'comment-item');
        ci.innerHTML = '<b>' + esc(who) + '</b> <span class="note">' + esc(new Date().toISOString().slice(0, 10)) + '</span><br>' + esc(txt);
        thread.insertBefore(ci, addWrap);
        inp.value = '';
        notes.push({ author: who, created_utc: new Date().toISOString(), comment: txt });
        cb.textContent = 'Gate Notes (' + notes.length + ')';
      } catch (e) {
        alert('Could not save the note: ' + e.message);
      }
      save.disabled = false; save.textContent = 'Save';
    };
    addWrap.appendChild(inp);
    addWrap.appendChild(save);
    thread.appendChild(addWrap);
    noteWrap.appendChild(thread);
    cb.textContent = 'Gate Notes (' + notes.length + ') ';
    cb.appendChild(icon('chevron-down'));
  };
  return wrap;
}
/* ---- inline dropzone notes (v8.0 Section 3) ------------------------------
   A still-missing/on-going document has no deliverable_id yet, so this reuses
   commentsForDoc (project+step+doc_code) rather than evidenceTable's
   deliverable_id-keyed thread. Rendered open (not behind a toggle) since the
   dropzone list is already the place people scan for what's outstanding. */
function dzNoteSection(project, stepKey, docCode) {
  const wrap = el('div', 'dz-note-wrap');
  const notes = commentsForDoc(project.project_id, stepKey, docCode);
  const list = el('div', 'dz-note-list');
  notes.forEach(c => {
    const ci = el('div', 'comment-item');
    ci.innerHTML = '<b>' + esc(c.author) + '</b> <span class="note">' + esc((c.created_utc || '').slice(0, 10)) + '</span><br>' + esc(c.comment);
    list.appendChild(ci);
  });
  wrap.appendChild(list);

  const addWrap = el('div', 'comment-add dz-note-add');
  const inp = el('input', 'dz-note-input');
  // Same type+id requirement as gateNoteInput above — one dropzone per
  // doc_code renders at a time inside the drawer, so doc_code alone is a
  // stable, unique key across the reload's DOM rebuild.
  inp.type = 'text';
  inp.id = 'dzNoteInput_' + docCode;
  inp.placeholder = 'Add a note…';
  const save = el('button', 'sm', 'Save Note');
  save.onclick = async (e) => {
    e.stopPropagation();
    const txt = inp.value.trim();
    if (!txt) return;
    const who = requireName() || '(unnamed)';
    save.disabled = true; save.textContent = 'Saving…';
    try {
      await API.action('lb_doc_comments', {
        project_id: project.project_id, deliverable_id: '', doc_code: docCode,
        step_key: stepKey, author: who, comment: txt, created_utc: new Date().toISOString()
      }, { audit: { user: who, action: 'Comment_Document', projectId: project.project_id, objType: 'Deliverable', objId: docCode, from: '', to: '', detail: txt.slice(0, 120) } });
      const ci = el('div', 'comment-item');
      ci.innerHTML = '<b>' + esc(who) + '</b> <span class="note">' + esc(new Date().toISOString().slice(0, 10)) + '</span><br>' + esc(txt);
      list.appendChild(ci);
      inp.value = '';
    } catch (err) {
      alert('Could not save the note: ' + err.message);
    }
    save.disabled = false; save.textContent = 'Save Note';
  };
  addWrap.appendChild(inp);
  addWrap.appendChild(save);
  wrap.appendChild(addWrap);
  return wrap;
}
function cellNoteCount(project, stepKey) {
  if (!TRK.lb_doc_comments || !TRK.lb_doc_comments.length) return 0;
  const dels = (TRK.lb_deliverables || []).filter(d => d.project_id === project.project_id && d.step_key === stepKey);
  let count = commentsForGate(project.project_id, stepKey).length;
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
      // A link_url isn't a filesystem path — nothing for Explorer to open.
      if (path && !isLink) {
        const openBtn = el('button', 'primary', 'Open in Explorer');
        openBtn.title = path;
        openBtn.onclick = async () => {
          try { await API.openPath(path); } catch (err) { alert('Could not open: ' + err.message); }
        };
        act.appendChild(openBtn);
      }

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
        // Same type+id requirement as gateNoteInput/dzNoteInput — see those
        // for why captureUiState() needs both to survive a reload.
        inp.type = 'text';
        inp.id = 'filedNoteInput_' + d.deliverable_id;
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
        cb.textContent = 'Notes (' + notes.length + ') ';
        cb.appendChild(icon('chevron-down'));
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
  if (g.approval && g.stale) {
    const warn = el('div', 'banner stale-banner');
    warn.innerHTML = iconHtml('alert-triangle') + ' <b>Approval stale.</b> ' + esc(staleText(g.stale)) +
      ' Review the new revision(s); the original signature stays on record.';
    wrap.appendChild(warn);
  }
  if (g.gated) {
    if (!g.approval) {
      const ap = el('button', g.canApprove ? 'primary' : '', 'Approve step ' + step.step_id);
      ap.disabled = !g.canApprove;
      ap.title = g.canApprove ? 'Sign this gate'
        : g.priorBlocks ? 'step ' + g.priorOpen.map(s => s.step_id).join(', ') + ' must close first'
        : g.missing.length ? g.missing.length + ' required document(s) missing'
        : 'blocking issue open';
      ap.onclick = async () => {
        const who = requireName(); if (!who) return;
        const noteRaw = prompt('Comment (optional):', '');
        if (noteRaw === null) return; // user clicked Cancel / pressed Escape — abort, do not approve
        const note = noteRaw;
        await API.action('lb_approvals', {
          project_id: project.project_id, step_key: sk, deliverable_id: '', approved_by: who, approved_utc: new Date().toISOString(),
          approval_type: (pillarDef(proc) || {}).approval_type || (isGated(proc, { gate_clearance_required: false }) ? 'Evidence-Based' : 'Milestone'), evidence_count: g.ev.length, comments: note
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
  iss.onclick = async (e) => {
    e.stopPropagation();
    const who = requireName() || '(unnamed)';
    // One modal for the whole flow, not a native prompt() for description/
    // owner/due date/severity in sequence — the Owner field specifically
    // needs a user_registry <select>, and stacking that between two native
    // prompts would be worse UX than just replacing the flow outright.
    const scrim = el('div', 'modal-scrim');
    const box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'raiseIssueTitle');
    box.innerHTML = '<h2 id="raiseIssueTitle">Raise Issue — ' + esc(sk) + '</h2>';
    const body = el('div');
    function fld(labelText) {
      const w = el('div'); w.style.cssText = 'margin-top:8px';
      const lab = el('label', null, labelText);
      lab.style.cssText = 'display:block;font-size:12px;font-weight:600;margin-bottom:4px';
      w.appendChild(lab);
      return w;
    }
    const descWrap = fld('Description *');
    const descTa = el('textarea'); descTa.rows = 3; descTa.style.cssText = 'width:100%;box-sizing:border-box';
    descWrap.appendChild(descTa); body.appendChild(descWrap);

    const ownerWrap = fld('Owner');
    const ownerSel = el('select'); ownerSel.style.cssText = 'width:100%';
    const registry = (CFG && CFG.user_registry) || [];
    const blankOpt = el('option', null, '(none)'); blankOpt.value = ''; ownerSel.appendChild(blankOpt);
    // v9.2.1: whoever spotted the problem owns it until it is handed over.
    // Leaving this blank produced unowned issues nobody was accountable for;
    // the dropdown is still free to reassign to anyone in the registry.
    registry.forEach(function(u) {
      const o = el('option', null, u.username + (u.role ? ' (' + u.role + ')' : '')); o.value = u.username;
      ownerSel.appendChild(o);
    });
    // Pre-select the raiser. Only if they are actually in the registry —
    // requireName() can return '(unnamed)', and forcing that into the value
    // would silently select nothing and look like a rendering bug.
    if (registry.some(function(u) { return u.username === who; })) ownerSel.value = who;
    ownerWrap.appendChild(ownerSel); body.appendChild(ownerWrap);

    const dueWrap = fld('Due date (optional)');
    const dueIn = el('input'); dueIn.type = 'date'; dueIn.style.cssText = 'width:100%';
    dueWrap.appendChild(dueIn); body.appendChild(dueWrap);

    const sevWrap = fld('Severity');
    const sevSel = el('select'); sevSel.style.cssText = 'width:100%';
    ['Critical', 'Major', 'Minor'].forEach(function(s) {
      const o = el('option', null, s); o.value = s; if (s === 'Major') o.selected = true; sevSel.appendChild(o);
    });
    sevWrap.appendChild(sevSel); body.appendChild(sevWrap);

    const errDiv = el('div', 'note'); errDiv.style.cssText = 'color:var(--bad);display:none;margin-top:6px';
    body.appendChild(errDiv);
    box.appendChild(body);

    const acts = el('div', 'acts');
    const no = el('button', '', 'Cancel');
    const yes = el('button', 'primary', 'Raise Issue');
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    no.onclick = close;
    yes.onclick = async () => {
      const d = descTa.value.trim();
      if (!d) { errDiv.textContent = 'Description is required.'; errDiv.style.display = 'block'; return; }
      close();
      await API.action('lb_issues', {
        project_id: project.project_id, step_key: sk, raised_utc: new Date().toISOString(), raised_by: who, category: 'LFI',
        description: d, owner: ownerSel.value, due_date: dueIn.value, status: 'Open', resolution: '', closed_utc: '', severity: sevSel.value
      }, { audit: { user: who, action: 'Raise_Issue', projectId: project.project_id, objType: 'Issue', objId: sk, from: '', to: 'Open', detail: d } });
      await redraw();
    };
    acts.appendChild(no); acts.appendChild(yes);
    box.appendChild(acts);
    scrim.appendChild(box);
    scrim.onclick = (ev) => { if (ev.target === scrim) close(); };
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(scrim);
    descTa.focus();
  };
  wrap.appendChild(iss);
  return wrap;
}

function stepCard(project, proc, step, redraw) {
  const g = gateState(project, proc, step);
  const card = el('div', 'stepcard s-' + g.status);
  const h = el('div', 'stephead');
  h.style.cursor = 'pointer';
  // The card body starts collapsed, so a warning that only lives down there is
  // a warning nobody sees. The out-of-sequence flag rides in the always-visible
  // header next to the status badge; the body banner still carries the detail.
  const priorBadge = (g.priorOpen.length && !g.done)
    ? '<span class="badge bg-warning prior-open-badge" title="Earlier gate' +
      (g.priorOpen.length > 1 ? 's' : '') + ' still open: step ' +
      esc(g.priorOpen.map(s => s.step_id).join(', ')) + '">Prior Step Open</span> '
    : '';
  h.innerHTML = '<div><b>Step ' + step.step_id + ' — ' + esc(step.step_name) + '</b>' +
    '<div class="note">' + esc(step.description || '') + ' · approver: ' + esc(step.mandatory_approver || step.responsible_dept || '') + '</div></div>' +
    '<div><span class="step-toggle-arrow">' + iconHtml('chevron-down') + '</span> ' + priorBadge +
    '<span class="' + badgeClass(g.gated ? g.status : 'TRACK') + '">' + (g.gated ? g.status.replace(/_/g, ' ') : 'tracked') + '</span></div>';
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
  // Both banners carry !g.done: once this gate is signed or bypassed, an
  // earlier open gate is a fact about the project, not an obstacle to
  // anything, and telling the user a closed gate is "blocked" is just wrong.
  if (g.priorBlocks && !g.done) {
    const pb = el('div', 'banner bad');
    pb.innerHTML = '<b>Blocked by an earlier gate.</b> Step ' + g.priorOpen.map(s => s.step_id + ' (' + esc(s.step_name) + ')').join(', ') +
      ' must be signed or bypassed before this one can close.';
    body.appendChild(pb);
  }
  // Privileged users get the same information as a warning rather than a
  // block. It has to stay visible - signing out of sequence is allowed here,
  // not encouraged, and the badge is the only thing that says so.
  if (g.priorOpen.length && !g.done && !g.priorBlocks) {
    const sw = el('div', 'banner warn');
    sw.innerHTML = '<b>Prior Step Open.</b> Step ' + g.priorOpen.map(s => s.step_id + ' (' + esc(s.step_name) + ')').join(', ') +
      ' is still open. You may sign this gate out of sequence because you are an admin or moderator.';
    body.appendChild(sw);
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
    if (arrow) arrow.innerHTML = body.classList.contains('collapsed') ? iconHtml('chevron-right') : iconHtml('chevron-down');
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
/* Finds the earliest step that isn't done yet, for "click a project row to
   jump straight to what's next" — falls back to the last step once every
   step is done, so a completed project still opens on something. */
function firstIncompleteStepOf(project, proc) {
  const steps = stepsOf(proc, project);
  for (let i = 0; i < steps.length; i++) {
    if (!gateState(project, proc, steps[i]).done) return steps[i];
  }
  return steps[steps.length - 1] || null;
}

/* One row in the flat NPI/ECN project list: identity + progress on the
   left, the transfer-package actions on the right. Clicking the row (but
   not its buttons) opens the Dashboard-style drawer at the project's next
   incomplete step — the drawer, not an inline accordion, is now where gate
   approval, document filing, and MWER/trial-quantity entry all happen. */
function projectListRow(project, proc) {
  const fam = familyById(project.prod_family);
  const tgt = toWeek(project.target_date) || targetDateFor(project.class_abcde, project.prf_date) || '';
  const pr = progressOf(project);
  const status = classifyProject(project);
  const firstIncomplete = firstIncompleteStepOf(project, proc);

  const row = el('div', 'card project-list-row');
  row.style.cursor = firstIncomplete ? 'pointer' : 'default';
  const rowBody = el('div', 'card-body');
  rowBody.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap';

  const info = el('div');
  info.innerHTML = '<b>' + esc(project.project_id) + '</b> <span class="' + badgeClass(status) + '">' + esc(status.replace(/_/g, ' ')) + '</span>' +
    '<div class="note">' + esc(fam ? fam.prod_family_name : (project.prod_family || '')) +
    (tgt ? ' · target ' + esc(tgt) : '') + ' · ' + pr.done + '/' + pr.total + ' gates signed' +
    (project.market_manager ? ' · ' + esc(project.market_manager) : '') + '</div>';
  rowBody.appendChild(info);

  const actions = el('div');
  actions.appendChild(packageBar(project));
  rowBody.appendChild(actions);

  row.appendChild(rowBody);
  row.onclick = e => {
    if (e.target.closest('button')) return; // let the row's own buttons act without opening the drawer
    if (firstIncomplete) openDrawer(project, firstIncomplete, null);
  };
  return row;
}

/* v11 R4 - one view for every pillar. PPAP gets its own sub-view where the
   pillar has the ppap feature; everything else is the flat project list, and
   the drawer carries approval, filing, MWER and trial quantities. */
function viewPillar(root, pid) {
  const pd = pillarDef(pid);
  if (!pd) { root.appendChild(el('p', 'note', 'Unknown process ' + pid)); return; }
  root.appendChild(pageHeader(pillarTitle(pd), pillarSubtitle(pd)));
  const withPpap = !!pd.features.ppap;
  const tabId = pillarTabId(pid);
  if (withPpap) {
    const seg = el('div', 'seg');
    [['steps', 'Process steps'], ['ppap', 'PPAP package']].forEach(([k, l]) => {
      const bt = el('button', ecnMode === k ? 'on' : '', l); bt.onclick = () => { ecnMode = k; show(tabId); }; seg.appendChild(bt);
    });
    root.appendChild(seg);
  }

  const projects = projectsOf(pid);
  if (!projects.length) {
    const p = el('div', 'card'); const pb = el('div', 'card-body');
    pb.appendChild(el('p', 'note', 'No ' + pickLang(pd.name, pd.name_vi) + ' projects registered yet — use the Input tab.'));
    p.appendChild(pb); root.appendChild(p); return;
  }

  if (withPpap && ecnMode === 'ppap') {
    // PPAP is inherently a single-project checklist, so it keeps a project
    // picker — just a plain <select>, not the removed tree/accordion.
    if (!projects.some(p => p.project_id === ecnSel)) ecnSel = projects[0].project_id;
    const pickBar = el('div', 'filters');
    pickBar.appendChild(el('label', null, 'Project'));
    const sel = el('select');
    sel.innerHTML = projects.map(p => '<option value="' + esc(p.project_id) + '"' + (p.project_id === ecnSel ? ' selected' : '') + '>' +
      esc(p.project_id) + ' — ' + esc((familyById(p.prod_family) || {}).prod_family_name || p.prod_family) + '</option>').join('');
    sel.onchange = () => { ecnSel = sel.value; show(tabId); };
    pickBar.appendChild(sel);
    root.appendChild(pickBar);
    root.appendChild(ppapSection(projects.find(p => p.project_id === ecnSel) || projects[0]));
    return;
  }

  const b = el('div', 'banner');
  const nm = esc(pickLang(pd.name, pd.name_vi));
  const extras = (pd.features.mwer ? ', MWER records' : '') + (pd.features.trial_by_step_name ? ', trial quantities' : '');
  if (pd.banner) b.innerHTML = esc(pd.banner);
  else if (pd.gate_mode === 'flagged') {
    const gatedIds = pd.steps.filter(s => s.gate_clearance_required).map(s => s.step_id).join(', ');
    b.innerHTML = '<b>' + nm + ' gates are signed milestones.</b> Only steps <b>' + esc(gatedIds || 'none') + '</b> are signed; the rest are tracked. ' +
      'Click a project to open its detail — gate approval, filing' + extras + ' all live in that sidebar.';
  } else {
    b.innerHTML = '<b>' + nm + ' gates are strict.</b> A step closes only when every required document is filed, no issue is open against it, ' +
      'and a named person signs. Click a project to open its detail — gate approval, filing' + extras + ', and Authorise bypass all live in that sidebar now.';
  }
  root.appendChild(b);

  const list = el('div', 'project-list');
  projects.forEach(project => list.appendChild(projectListRow(project, pid)));
  root.appendChild(list);
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
  const openVaultBtn = el('button', 'primary', 'Open vault folder');
  openVaultBtn.onclick = async () => {
    try { await API.openPath(PATHS.vault || ''); } catch (err) { alert('Could not open: ' + err.message); }
  };
  wrap.appendChild(openVaultBtn);
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

/* MWER — the morning meeting or Zoom call whose summary email from the
   chair is the actual approval record at Wahl. */
function mwerSection(project, step, redraw) {
  const sk = stepKeyOf(project.process, step);
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
  root.appendChild(pageHeader(i18n('settingsTitle'), i18n('settingsSub')));
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
    const edit = el('button', null);
    edit.appendChild(icon('pencil'));
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
  const dlist = el('div', 'taglist taglist-grid');
  CFG.document_types.forEach(d => {
    const t = el('div', 'doctype-card');

    const top = el('div', 'doctype-card-top');
    top.innerHTML = '<b>' + esc(d.doctype_id) + '</b><span>' + esc(d.name) + '</span>';
    t.appendChild(top);

    const mid = el('div', 'doctype-card-mid');
    if (isPrivileged()) {
      var tmplSel = el('select');
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
      mid.appendChild(tmplSel);
    } else {
      mid.appendChild(el('span', 'note', d.template_file || '(no template)'));
    }
    t.appendChild(mid);

    const bottom = el('div', 'doctype-card-bottom');
    bottom.appendChild(el('span', 'badge bg-secondary-lt', d.stage_required || 'not gated'));
    const actsWrap = el('span', 'doctype-card-acts');
    const edit = el('button', null);
    edit.appendChild(icon('pencil'));
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
    actsWrap.appendChild(edit);
    const del = el('button', null, '×');
    del.title = 'Delete this document type';
    del.onclick = async () => {
      if (!confirm('Delete document type "' + d.doctype_id + '"? Steps that require it will show it as unresolved.')) return;
      try { await API.doctype('delete', null, d.doctype_id, requireName() || ''); await redrawAfterWrite(); }
      catch (e) { alert('Could not delete: ' + e.message); }
    };
    actsWrap.appendChild(del);
    bottom.appendChild(actsWrap);
    t.appendChild(bottom);

    dlist.appendChild(t);
  });
  dpBody.appendChild(dlist);
  // Collapse everything past the first 8 doctypes behind a toggle — with the
  // full 27-doctype set this card used to be a very long scroll on its own.
  const dtRows = dlist.querySelectorAll('.doctype-card');
  dtRows.forEach((row, i) => { if (i >= 8) row.classList.add('taglist-hidden'); });
  if (CFG.document_types.length > 8) {
    const dtMoreBtn = el('button', '', 'Show more (' + (CFG.document_types.length - 8) + ')');
    dtMoreBtn.style.marginTop = '6px';
    let dtExpanded = false;
    dtMoreBtn.onclick = () => {
      dtExpanded = !dtExpanded;
      dtRows.forEach((row, i) => { if (i >= 8) row.classList.toggle('taglist-hidden', !dtExpanded); });
      dtMoreBtn.textContent = dtExpanded ? 'Show less' : 'Show more (' + (CFG.document_types.length - 8) + ')';
    };
    dpBody.appendChild(dtMoreBtn);
  }
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
            await API.post('/api/config/moderators', { user: getUser(), moderators: newList });
            // redrawAfterWrite, NOT viewSettings(root) - viewSettings appends
            // to root and never clears it, so calling it again stacks a second
            // copy of the whole Settings page under the first.
            await redrawAfterWrite();
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
        await API.post('/api/config/moderators', { user: getUser(), moderators: newList });
        // The server trims, de-duplicates and strips 'admin', so re-read the
        // config rather than rendering the list we hoped it would store.
        await redrawAfterWrite();
      } catch (e) { alert('Could not save: ' + e.message); }
    };
    addRow.appendChild(modInput);
    addRow.appendChild(modAddBtn);
    mpBody.appendChild(addRow);
  }
  mp.appendChild(mpBody); root.appendChild(mp);

  /* ---- my account (v12) ---- */
  const acct = el('div', 'card');
  const acctHdr = el('div', 'card-header'); acctHdr.appendChild(el('h3', 'card-title', 'My account')); acct.appendChild(acctHdr);
  const acctBody = el('div', 'card-body');
  const acctRow = el('div', 'acct-row');
  acctRow.innerHTML = '<span>' + iconHtml('user', 'icon-sm') + ' <b>' + esc(getUser()) + '</b></span><span class="badge bg-secondary">' + esc(SESSION.role || 'user') + '</span>' +
    (SESSION.department ? '<span class="note" style="margin:0">' + esc(SESSION.department) + '</span>' : '');
  const acctBtn = el('button', '', 'Change my password');
  acctBtn.style.marginLeft = 'auto';
  acctBtn.onclick = changePasswordModal;
  acctRow.appendChild(acctBtn);
  acctBody.appendChild(acctRow);
  acct.appendChild(acctBody); root.appendChild(acct);

  /* ---- users and passwords (v12) ---------------------------------------
     Replaces the v8 "User Registry" and "Admin Security PIN" cards. The
     roster itself (name, role, department) is still config.user_registry and
     still saved through /api/config/user-registry; what is new is the
     password column, which comes from /api/auth/users and is admin-only.
     A non-admin sees the roster read-only, exactly as before. */
  const urp = el('div', 'card');
  const urpHdr = el('div', 'card-header'); urpHdr.appendChild(el('h3', 'card-title', 'Users and passwords')); urp.appendChild(urpHdr);
  const urpBody = el('div', 'card-body');
  urp.appendChild(urpBody); root.appendChild(urp);
  const saveRegistry = async function(list) {
    await API.post('/api/config/user-registry', { user: getUser(), registry: list });
  };
  if (!isAdmin()) {
    urpBody.appendChild(el('p', 'note', 'Everyone who can sign in. Only the admin can add people, change roles or reset a password.'));
    const roList = el('div', 'taglist');
    (CFG.user_registry || []).forEach(function(u) {
      const row = el('div', 'tagrow');
      row.innerHTML = '<span><b>' + esc(u.username) + '</b> · ' + esc(u.role || 'user') + (u.department ? ' · ' + esc(u.department) : '') + '</span>';
      roList.appendChild(row);
    });
    urpBody.appendChild(roList);
  } else {
    urpBody.appendChild(el('p', 'note', 'Passwords are stored only as salted hashes, one small file per user under system\\auth. Nobody can read a password back from a hash; a forgotten one is replaced with a temporary password that the user must change at their next sign-in.'));
    const urTableWrap = el('div', 'scroll users-table');
    urTableWrap.innerHTML = '<p class="note" style="padding:8px">Loading…</p>';
    urpBody.appendChild(urTableWrap);
    const viewWrap = el('div', 'users-view-toggle');

    const drawUsers = function(data) {
      const canView = !!data.admin_can_view;
      const tbl = el('table');
      tbl.innerHTML = '<thead><tr><th>User</th><th>Role</th><th>Department</th><th>Password</th><th>Stored on disk</th>' + (canView ? '<th>View</th>' : '') + '<th>Changed</th><th></th></tr></thead>';
      const tb = el('tbody');
      (data.users || []).forEach(function(u) {
        const isAdminRow = String(u.username).toLowerCase() === 'admin';
        const tr = el('tr');
        tr.appendChild(el('td')).innerHTML = '<b>' + esc(u.username) + '</b>';
        const roleSel = el('select');
        roleSel.setAttribute('aria-label', 'Role of ' + u.username);
        roleSel.innerHTML = '<option value="admin">admin</option><option value="moderator">moderator</option><option value="user">user</option>';
        roleSel.value = u.role || 'user';
        roleSel.disabled = isAdminRow;
        roleSel.onchange = async function() {
          try { await saveRegistry((CFG.user_registry || []).map(function(x) { return x.username === u.username ? Object.assign({}, x, { role: roleSel.value }) : x; })); await redrawAfterWrite(); }
          catch (e) { alert('Could not save: ' + e.message); }
        };
        tr.appendChild(el('td')).appendChild(roleSel);
        const deptIn = el('input');
        deptIn.placeholder = 'department'; deptIn.value = u.department || '';
        deptIn.setAttribute('aria-label', 'Department of ' + u.username);
        deptIn.onchange = async function() {
          try { await saveRegistry((CFG.user_registry || []).map(function(x) { return x.username === u.username ? Object.assign({}, x, { department: deptIn.value.trim() }) : x; })); await redrawAfterWrite(); }
          catch (e) { alert('Could not save: ' + e.message); }
        };
        tr.appendChild(el('td')).appendChild(deptIn);
        tr.appendChild(el('td')).innerHTML = !u.has_password ? '<span class="badge bg-danger-lt">No password yet</span>'
          : u.must_change ? '<span class="badge bg-warning-lt">Temporary, must change</span>' : '<span class="badge bg-success-lt">Set</span>';
        tr.appendChild(el('td')).innerHTML = u.stored ? '<code title="Salted PBKDF2-HMAC-SHA256, 100 000 rounds">' + esc(u.stored) + '</code>' : '<span class="note" style="margin:0">nothing</span>';
        if (canView) {
          const vTd = tr.appendChild(el('td'));
          if (u.recoverable) {
            const vBtn = el('button', 'btn-sm', 'View');
            vBtn.onclick = async function() {
              const pw = await askAdminPassword('Admin password required', 'Type the admin password again to view the password of ' + u.username + '. The view is written to the audit log.');
              if (pw == null) return;
              try {
                const r = await API.post('/api/auth/reveal', { username: u.username, admin_password: pw });
                formModal({ title: 'Password of ' + u.username, html: '<div class="temp-pw">' + esc(r.password) + '</div><p class="note">This view has been written to the audit log.</p>', ok: 'Done', noCancel: true });
              } catch (e) { alert(e.message); }
            };
            vTd.appendChild(vBtn);
          } else if (u.has_password) {
            vTd.innerHTML = '<span class="note" style="margin:0" title="A viewable copy is saved the next time this user signs in or changes their password.">after next sign-in</span>';
          }
        }
        tr.appendChild(el('td', null, u.changed_utc ? String(u.changed_utc).slice(0, 10) : ''));
        const actTd = tr.appendChild(el('td'));
        actTd.style.whiteSpace = 'nowrap';
        if (!isAdminRow) {
          const rsBtn = el('button', 'btn-sm', u.has_password ? 'Reset password' : 'Issue password');
          rsBtn.onclick = function() {
            const go = async function() {
              try { const r = await API.post('/api/auth/reset-password', { username: u.username }); tempPasswordModal(u.username, r.temp_password, !u.has_password); await redrawAfterWrite(); }
              catch (e) { alert('Could not reset: ' + e.message); }
            };
            if (u.has_password) confirmModal('Reset Password', 'Replace the password of <b>' + esc(u.username) + '</b> with a temporary one? Their current password stops working at once.', 'Reset', go);
            else go();
          };
          actTd.appendChild(rsBtn);
          const rmBtn = el('button', 'btn-sm', '×');
          rmBtn.title = 'Remove user'; rmBtn.setAttribute('aria-label', 'Remove ' + u.username);
          rmBtn.style.marginLeft = '6px';
          rmBtn.onclick = function() {
            confirmModal('Remove User', 'Remove <b>' + esc(u.username) + '</b>? They can no longer sign in, and their password is deleted.', 'Remove', async function() {
              // redrawAfterWrite, NOT viewSettings(root) - viewSettings appends
              // to root and never clears it, so calling it again stacks a second
              // copy of the whole Settings page under the first.
              try { await saveRegistry((CFG.user_registry || []).filter(function(x) { return x.username !== u.username; })); await redrawAfterWrite(); }
              catch (e) { alert('Could not save: ' + e.message); }
            });
          };
          actTd.appendChild(rmBtn);
        }
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      urTableWrap.innerHTML = ''; urTableWrap.appendChild(tbl);

      // "Admin can view passwords": off unless switched on here.
      viewWrap.innerHTML = '';
      const vLab = el('label', 'users-view-label');
      const vChk = el('input'); vChk.type = 'checkbox'; vChk.checked = canView;
      vLab.appendChild(vChk);
      vLab.appendChild(document.createTextNode(' Let the admin view passwords'));
      viewWrap.appendChild(vLab);
      viewWrap.appendChild(el('p', 'note', canView
        ? 'ON. Besides the hash, an encrypted copy of each password is kept that only the admin password can unlock. Whoever learns the admin password can read every password, so keep it strong and to yourself. Switching this off deletes those copies.'
        : 'OFF (recommended). Only hashes are stored and nobody, including the admin, can see a password. Switch this on only if you really need to read passwords back; a copy is then saved the next time each user signs in.'));
      vChk.onchange = async function() {
        const want = vChk.checked;
        const pw = await askAdminPassword(want ? 'Let the admin view passwords?' : 'Stop keeping viewable copies?',
          want ? 'From now on an encrypted copy of every password is kept beside its hash. Type the admin password to confirm.'
               : 'Every viewable copy is deleted; the hashes stay. Type the admin password to confirm.');
        if (pw == null) { vChk.checked = !want; return; }
        try { await API.post('/api/auth/recovery', { enable: want, admin_password: pw }); await redrawAfterWrite(); }
        catch (e) { vChk.checked = !want; alert(e.message); }
      };
    };
    API.get('/api/auth/users').then(drawUsers).catch(function(e) { urTableWrap.innerHTML = '<p class="note" style="padding:8px;color:var(--bad)">Could not load users: ' + esc(e.message) + '</p>'; });

    var urAddRow = el('form', 'users-add');
    var urNameIn = el('input'); urNameIn.placeholder = 'New user name'; urNameIn.setAttribute('aria-label', 'New user name');
    var urAddRoleSel = el('select'); urAddRoleSel.setAttribute('aria-label', 'Role');
    urAddRoleSel.innerHTML = '<option value="user" selected>user</option><option value="moderator">moderator</option><option value="admin">admin</option>';
    var urDeptIn = el('input'); urDeptIn.placeholder = 'Department'; urDeptIn.setAttribute('aria-label', 'Department');
    var urAddBtn = el('button', 'primary', 'Add user'); urAddBtn.type = 'submit';
    urAddRow.onsubmit = async function(ev) {
      ev.preventDefault();
      var uname = urNameIn.value.trim();
      if (!uname) return;
      if ((CFG.user_registry || []).some(function(x) { return String(x.username).toLowerCase() === uname.toLowerCase(); })) { alert('That user name already exists.'); return; }
      try {
        // Roster first (the server trims and de-duplicates it), then a
        // temporary password, which is the only way the new person gets in.
        await saveRegistry((CFG.user_registry || []).concat([{ username: uname, role: urAddRoleSel.value, department: urDeptIn.value.trim() }]));
        const r = await API.post('/api/auth/reset-password', { username: uname });
        tempPasswordModal(r.username, r.temp_password, true);
        await redrawAfterWrite();
      } catch (e) { alert('Could not add the user: ' + e.message); }
    };
    urAddRow.appendChild(urNameIn); urAddRow.appendChild(urAddRoleSel); urAddRow.appendChild(urDeptIn); urAddRow.appendChild(urAddBtn);
    urpBody.appendChild(urAddRow);
    urpBody.appendChild(el('p', 'note', 'A new user gets a temporary password, shown to you once.'));
    urpBody.appendChild(viewWrap);
  }

  /* ---- pillars (v11 R4) ---- */
  if (isAdmin()) root.appendChild(pillarsCard());

  /* ---- file naming standard (v11.1) ---- */
  if (isAdmin()) root.appendChild(namingCard());

  /* ---- common vault folder structure (v12) ------------------------------
     The folder levels every upload to the common vault is filed under.
     Before v12 they were hard-coded in launcher.ps1 as Model > DocType >
     PartID, which is still what an install that never saves this card uses.
     Only the admin can change them; everyone else sees them read-only. */
  const fsp = el('div', 'card');
  const fspHdr = el('div', 'card-header'); fspHdr.appendChild(el('h3', 'card-title', 'Common vault folder structure'));
  fspHdr.appendChild(el('span', 'badge bg-primary-lt', 'Fixed by admin'));
  fsp.appendChild(fspHdr);
  const fspBody = el('div', 'card-body');
  const fsGrid = el('div', 'folder-struct');
  const fsLeft = el('div'), fsRight = el('div');
  fsLeft.appendChild(el('p', 'note', 'Every file uploaded to the common vault is filed under these levels, top level first. A level that comes out blank for a file (no part, for example) is skipped.'));
  let fsLevels = (FOLDER.levels || []).slice();
  const fsList = el('div');
  const fsTree = el('div', 'folder-tree');
  const fsExample = { Model: '9649LP', Process: 'NPI', ProjectID: 'NPI-9649LP', Step: 'NPI-3', DocType: 'DWG', PartID: 'Blade' };
  const drawFsTree = function() {
    const names = fsLevels.map(function(l) { return String(l).replace(/\[([^\]]*)\]/g, function(m, k) { return fsExample[k] != null ? fsExample[k] : m; }).trim(); }).filter(Boolean);
    fsTree.innerHTML = '<span class="lv">' + iconHtml('folder-open', 'icon-sm') + esc(String(PATHS.vault || '').split('\\').pop() || 'vault') + '</span>' +
      names.map(function(n, i) { return '<span class="lv" style="padding-left:' + ((i + 1) * 16) + 'px">' + iconHtml('folder-open', 'icon-sm') + esc(n) + '</span>'; }).join('') +
      '<span class="lv" style="padding-left:' + ((names.length + 1) * 16) + 'px">' + iconHtml('file-text', 'icon-sm') + 'PD9649LP_01 Blade.pdf</span>';
  };
  const drawFsList = function() {
    fsList.innerHTML = '';
    fsLevels.forEach(function(l, i) {
      const row = el('div', 'folder-level');
      row.appendChild(el('span', 'folder-level-n', 'Level ' + (i + 1)));
      const inp = el('input'); inp.value = l; inp.disabled = !isAdmin();
      inp.setAttribute('aria-label', 'Folder level ' + (i + 1));
      inp.oninput = function() { fsLevels[i] = inp.value; drawFsTree(); };
      row.appendChild(inp);
      if (isAdmin()) {
        const acts = el('span', 'folder-level-acts');
        const upB = el('button', 'btn-sm', '↑'); upB.type = 'button'; upB.title = 'Move up'; upB.disabled = i === 0;
        upB.onclick = function() { const t = fsLevels[i - 1]; fsLevels[i - 1] = fsLevels[i]; fsLevels[i] = t; drawFsList(); };
        const dnB = el('button', 'btn-sm', '↓'); dnB.type = 'button'; dnB.title = 'Move down'; dnB.disabled = i === fsLevels.length - 1;
        dnB.onclick = function() { const t = fsLevels[i + 1]; fsLevels[i + 1] = fsLevels[i]; fsLevels[i] = t; drawFsList(); };
        const rmB = el('button', 'btn-sm', '×'); rmB.type = 'button'; rmB.title = 'Remove level'; rmB.setAttribute('aria-label', 'Remove level ' + (i + 1));
        rmB.onclick = function() { fsLevels.splice(i, 1); drawFsList(); };
        acts.appendChild(upB); acts.appendChild(dnB); acts.appendChild(rmB);
        row.appendChild(acts);
      }
      fsList.appendChild(row);
    });
    drawFsTree();
  };
  fsLeft.appendChild(fsList);
  if (isAdmin()) {
    const tokRow = el('div', 'taglist');
    tokRow.appendChild(el('span', 'note', 'Add a level:'));
    (FOLDER.tokens || []).forEach(function(t) {
      const tb = el('button', 'btn-sm', '+ [' + t + ']'); tb.type = 'button';
      tb.onclick = function() { fsLevels.push('[' + t + ']'); drawFsList(); };
      tokRow.appendChild(tb);
    });
    fsLeft.appendChild(tokRow);
    const fsSave = el('button', 'primary', 'Save folder structure');
    fsSave.style.marginTop = '8px';
    fsSave.onclick = async function() {
      try { await API.post('/api/config/folder-structure', { user: getUser(), levels: fsLevels }); await redrawAfterWrite(); }
      catch (e) { alert('Could not save: ' + e.message); }
    };
    fsLeft.appendChild(fsSave);
    fsLeft.appendChild(el('p', 'note', 'Applies to files uploaded from now on. Files already in the vault are not moved, and every link to them keeps working.'));
  } else {
    fsLeft.appendChild(el('p', 'note', 'Only the admin user can change this.'));
  }
  fsRight.appendChild(el('p', 'note', 'Example: a drawing of the Blade for 9649LP'));
  fsRight.appendChild(fsTree);
  fsGrid.appendChild(fsLeft); fsGrid.appendChild(fsRight);
  fspBody.appendChild(fsGrid);
  fsp.appendChild(fspBody); root.appendChild(fsp);
  drawFsList();

  /* ---- all vaults (v12, admin) ------------------------------------------ */
  if (isAdmin()) {
    const avp = el('div', 'card');
    const avpHdr = el('div', 'card-header'); avpHdr.appendChild(el('h3', 'card-title', 'All vaults')); avp.appendChild(avpHdr);
    const avpBody = el('div', 'card-body');
    avpBody.appendChild(el('p', 'note', 'The common vault, and every personal vault. A personal vault is visible to its owner and to the admin only.'));
    const avWrap = el('div', 'scroll');
    avWrap.innerHTML = '<p class="note" style="padding:8px">Loading…</p>';
    avpBody.appendChild(avWrap);
    avp.appendChild(avpBody); root.appendChild(avp);
    API.get('/api/vaults').then(function(d) {
      const tbl = el('table');
      tbl.innerHTML = '<thead><tr><th>Vault</th><th>Kind</th><th>Owner</th><th>Folder</th><th>Projects</th><th></th></tr></thead>';
      const tb = el('tbody');
      (d.vaults || []).forEach(function(v) {
        const tr = el('tr');
        tr.appendChild(el('td')).innerHTML = '<b>' + esc(v.name) + '</b>' + (v.archived ? ' <span class="badge bg-secondary">archived</span>' : '');
        tr.appendChild(el('td')).innerHTML = v.kind === 'common' ? '<span class="badge bg-primary-lt">Common</span>' : '<span class="badge bg-teal-lt">Personal</span>';
        tr.appendChild(el('td', null, v.kind === 'common' ? 'everyone' : v.owner));
        tr.appendChild(el('td')).innerHTML = '<code>' + esc(v.path) + '</code>';
        tr.appendChild(el('td', 'num', String(v.projects)));
        const aTd = tr.appendChild(el('td'));
        aTd.style.whiteSpace = 'nowrap';
        if (v.kind === 'personal') {
          const openA = el('a', '', 'Open'); openA.href = '/vault.html?id=' + encodeURIComponent(v.id);
          aTd.appendChild(openA);
          const arB = el('button', 'btn-sm', v.archived ? 'Restore' : 'Archive');
          arB.style.marginLeft = '8px';
          arB.onclick = async function() {
            try { await API.post('/api/vaults/' + encodeURIComponent(v.id) + '/archive', { archived: !v.archived }); await redrawAfterWrite(); }
            catch (e) { alert(e.message); }
          };
          aTd.appendChild(arB);
        } else {
          aTd.appendChild(el('span', 'note', 'this vault'));
        }
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      avWrap.innerHTML = ''; avWrap.appendChild(tbl);
    }).catch(function(e) { avWrap.innerHTML = '<p class="note" style="padding:8px;color:var(--bad)">Could not load vaults: ' + esc(e.message) + '</p>'; });
  }

  if (isAdmin()) projectsAdminCard(root);
  vaultDataCard(root);

  /* ---- evidence vault location ---- */
  const vp = el('div', 'card');
  const vpHdr = el('div', 'card-header'); vpHdr.appendChild(el('h3', 'card-title', 'Evidence vault location')); vp.appendChild(vpHdr);
  const vpBody = el('div', 'card-body');
  vpBody.appendChild(el('p', 'note', 'Where uploaded evidence files are stored, as a folder name and a path relative to the app\'s install folder (default: one level up, named "NPI_EPM_Documents_Control"). Changing this does NOT move files already uploaded, and does not take effect until the server is restarted.'));
  vpBody.appendChild(el('p', 'note', '⚠ Must stay under the same site as the app (the shared SharePoint/OneDrive folder this copy runs from) — this app is deployed as ONE app folder synced to every PC, and a vault outside that tree would exist on this machine only. "Browse…" only ever lets you pick from inside it.'));
  const dd = (CFG.deployment_defaults || {});
  const vpRow = el('div');
  vpRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end';
  const folderWrap = el('div');
  folderWrap.appendChild(el('label', null, 'Folder name'));
  const folderInput = el('input');
  folderInput.value = dd.evidence_vault_folder_name || 'NPI_EPM_Documents_Control';
  folderInput.style.cssText = 'display:block;width:260px';
  folderWrap.appendChild(folderInput);
  vpRow.appendChild(folderWrap);
  const relWrap = el('div');
  relWrap.appendChild(el('label', null, 'Relative path from app root'));
  const relInput = el('input');
  relInput.value = dd.evidence_vault_relative_to_root || '..';
  relInput.style.cssText = 'display:block;width:160px';
  relWrap.appendChild(relInput);
  vpRow.appendChild(relWrap);
  if (isAdmin()) {
    const browseBtn = el('button', '', 'Browse…');
    browseBtn.type = 'button';
    browseBtn.onclick = () => openVaultFolderBrowser(function(relPath) {
      // relPath is relative to the site root (the app's own parent folder) —
      // split into "relative path from app root" + "folder name" the same
      // way the two saved fields already mean: relative_to_root climbs OUT
      // of the app folder first (".." to reach the site root, then back
      // down), folder_name is the leaf.
      const parts = relPath.split('/').filter(Boolean);
      const leaf = parts.pop() || 'NPI_EPM_Documents_Control';
      const rest = parts.length ? '\\' + parts.join('\\') : '';
      relInput.value = '..' + rest;
      folderInput.value = leaf;
    });
    vpRow.appendChild(browseBtn);
  }
  vpBody.appendChild(vpRow);
  if (isAdmin()) {
    const vpSaveBtn = el('button', 'primary', 'Save (restart required)');
    vpSaveBtn.style.marginTop = '8px';
    vpSaveBtn.onclick = async function() {
      try {
        await API.post('/api/config/vault', {
          user: getUser(),
          evidence_vault_folder_name: folderInput.value.trim(),
          evidence_vault_relative_to_root: relInput.value.trim()
        });
        await redrawAfterWrite();
      } catch (e) { alert('Could not save: ' + e.message); }
    };
    vpBody.appendChild(vpSaveBtn);
  } else {
    vpBody.appendChild(el('p', 'note', 'Only the admin user can change this.'));
  }
  vp.appendChild(vpBody); root.appendChild(vp);

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
        '<td><input data-ct="type_id" data-idx="' + i + '" value="' + esc(t.type_id || '') + '" maxlength="3"></td>' +
        '<td><input data-ct="name" data-idx="' + i + '" value="' + esc(t.name || '') + '"></td>' +
        '<td><input data-ct="description" data-idx="' + i + '" value="' + esc(t.description || '') + '"></td>' +
        '<td><input data-ct="cycle_time_days" data-idx="' + i + '" value="' + (t.cycle_time_days != null ? t.cycle_time_days : '') + '" placeholder="TBD"></td>' +
        '<td><input data-ct="npi_steps" data-idx="' + i + '" value="' + esc((t.npi_steps || []).join(',')) + '" title="Comma-separated step numbers, e.g. 1,3,5"></td>' +
        '<td><input data-ct="ecn_steps" data-idx="' + i + '" value="' + esc((t.ecn_steps || []).join(',')) + '" title="Comma-separated step numbers"></td>' +
        '<td><input data-ct="trial_preset" data-idx="' + i + '" value="' + esc(t.trial_preset || '') + '"></td>' +
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

  /* v9.2.1: the table is 8 columns of editable inputs and used to carry fixed
     pixel widths, so collapsing the sidebar rail (which widens .page-wrapper)
     left it stranded while expanding it pushed the last columns past the card
     edge. The inputs are fluid now and this wrapper owns the horizontal
     scroll, so the card never overflows regardless of rail state. */
  const ctScroll = el('div', 'scroll change-types-scroll');
  ctTable.appendChild(ctBody);
  ctScroll.appendChild(ctTable);
  cpBody.appendChild(ctScroll);
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
/* v11 R1 - revision history of one document, newest first. Served by the
   scoped /api/document-history endpoint rather than filtered out of the full
   store, so it stays fast when lb_deliverables is large. */
async function openHistoryModal(project, step, docCode, partId) {
  const sk = stepKeyOf(project.process, step);
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal history-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'histTitle');
  const doc = docTypeById(docCode);
  box.innerHTML = '<h2 id="histTitle">History - ' + esc(docCode) + (partId ? ' (' + esc(partId) + ')' : '') + '</h2><p class="note">' + esc(project.project_id) + ' · ' +
    esc(sk) + (doc && doc.name && doc.name !== docCode ? ' · ' + esc(doc.name) : '') + '</p><div class="history-body"><p class="note">Loading…</p></div>';
  const acts = el('div', 'acts');
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = e => { if (e.key === 'Escape') close(); };
  const closeBtn = el('button', '', 'Close');
  closeBtn.onclick = close;
  acts.appendChild(closeBtn);
  box.appendChild(acts);
  scrim.appendChild(box);
  scrim.onclick = e => { if (e.target === scrim) close(); };
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(scrim);
  closeBtn.focus();
  const body = box.querySelector('.history-body');
  let h;
  try {
    const r = await fetch('/api/document-history?project_id=' + encodeURIComponent(project.project_id) +
      '&step_key=' + encodeURIComponent(sk) + '&doc_code=' + encodeURIComponent(docCode) +
      '&part_id=' + encodeURIComponent(partId || ''), { cache: 'no-store' });
    if (!r.ok) throw await API.err(r);
    h = await r.json();
  } catch (e) { body.innerHTML = '<p class="note" style="color:var(--bad)">Could not load history: ' + esc(e.message) + '</p>'; return; }
  const revs = h.revisions || [];
  if (!revs.length) { body.innerHTML = '<p class="note">No revision has been filed for this document yet.</p>'; return; }
  let html = '';
  if (h.stale && h.approval) {
    html += '<div class="banner stale-banner">' + iconHtml('alert-triangle') + ' The gate was signed ' + esc(fmtStamp(h.approval.approved_utc)) +
      ' by ' + esc(h.approval.approved_by) + '; a newer revision was filed afterwards.</div>';
  }
  html += '<table class="history-table"><thead><tr><th>Rev</th><th>Filed</th><th>PIC</th><th>Status</th><th>Change reason</th><th>File</th></tr></thead><tbody>';
  revs.forEach(function(r) {
    const active = r.is_active === 'YES';
    const status = r.status === 'Removed' ? 'Removed' : (active ? 'Active' : 'Superseded');
    const cls = status === 'Active' ? badgeClass('COMPLETE') : (status === 'Removed' ? badgeClass('NO_DATA') : 'badge bg-secondary');
    const viewUrl = r.kind === 'link' ? r.link_url : evidenceViewerUrl(r.file_path);
    const fileCell = viewUrl
      ? '<a href="' + esc(viewUrl) + '" target="_blank" rel="noopener">' + esc(r.file_name || r.link_url || 'open') + '</a>'
      : esc(r.file_name || r.file_path || '');
    html += '<tr class="' + (active ? 'history-active' : '') + '"><td><b>' + esc(r.revision_no) + '</b></td>' +
      '<td>' + esc(fmtStamp(r.uploaded_utc)) + (r.superseded_utc ? '<div class="note">superseded ' + esc(fmtStamp(r.superseded_utc)) + '</div>' : '') + '</td>' +
      '<td>' + esc(r.uploaded_by) + '</td><td><span class="' + cls + '">' + status + '</span></td>' +
      '<td>' + (r.change_reason ? esc(r.change_reason) : '<span class="note">-</span>') + '</td>' +
      '<td>' + fileCell + (r.sha256 ? '<div class="note" title="SHA-256">' + esc(r.sha256.slice(0, 12)) + '…</div>' : '') + '</td></tr>';
  });
  html += '</tbody></table>';
  body.innerHTML = html;
}

/* v11 R1 - an explicit new revision of an already-filed document: pick the
   file, then give a change reason. Goes through the same upload queue as
   every other upload, so the file and its row are written the same way. */
function pickNewRevision(project, stepKey, docCode, onDone, partId) {
  const fin = document.createElement('input');
  fin.type = 'file';
  fin.style.display = 'none';
  fin.onchange = function() {
    const file = fin.files && fin.files[0];
    fin.remove();
    if (!file) return;
    reasonModal('New revision of ' + docCode + (partId ? ' (' + partId + ')' : ''), file.name, function(reason) {
      // partId keeps this revision in the SAME part's chain — omitting it
      // here would silently create a third, unlabelled slot instead of
      // superseding the part the button was clicked on.
      enqueueUploads([{
        project: project, stepKey: stepKey, docCode: docCode, file: file, changeReason: reason,
        uploadExtra: { partId: partId || '' }, rowExtra: { part_id: partId || '' }
      }], onDone);
    });
  };
  document.body.appendChild(fin);
  fin.click();
}
function reasonModal(title, fileName, onOk) {
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'reasonTitle');
  box.innerHTML = '<h2 id="reasonTitle">' + esc(title) + '</h2><p class="note">' + esc(fileName) +
    '</p><label class="fld"><span>Change reason *</span><textarea rows="3" class="reason-input" placeholder="What changed and why - e.g. RPN updated after trial 2"></textarea></label>' +
    '<p class="note reason-err" style="color:var(--bad);display:none">A change reason is required.</p>';
  const acts = el('div', 'acts');
  const no = el('button', '', 'Cancel');
  const yes = el('button', 'primary', 'Upload revision');
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = e => { if (e.key === 'Escape') close(); };
  no.onclick = close;
  yes.onclick = () => {
    const v = box.querySelector('.reason-input').value.trim();
    if (!v) { box.querySelector('.reason-err').style.display = ''; return; }
    close(); onOk(v);
  };
  acts.appendChild(no); acts.appendChild(yes);
  box.appendChild(acts);
  scrim.appendChild(box);
  scrim.onclick = e => { if (e.target === scrim) close(); };
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(scrim);
  box.querySelector('.reason-input').focus();
}

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

/* ---- LFI (Late Found Issue) in-drawer accordion --------------------------
   Returns a collapsed trigger button plus an inline form panel that expands
   inside the sidebar drawer. This replaced a floating draggable modal: a
   popup that overlays the drawer hides the very step context the person is
   describing, and on a laptop screen the two fought for the same space. */
function lfiSection(project, step) {
  var proc = project.process;
  var sk = stepKeyOf(proc, step);
  var who = getUser();
  var todayStr = today();

  var wrap = el('div', 'lfi-wrap');
  var toggle = el('button', 'lfi-expand-btn');
  toggle.innerHTML = '+ Late Found Issue (LFI) <span class="lfi-caret">' + iconHtml('chevron-right') + '</span>';
  wrap.appendChild(toggle);

  var box = el('div', 'lfi-sidebar-container');
  box.style.display = 'none';
  wrap.appendChild(box);

  var okDiv = el('div', 'lfi-ok');
  okDiv.id = 'lfiOk';
  okDiv.style.display = 'none';
  wrap.appendChild(okDiv);

  var expanded = false;
  toggle.onclick = function() {
    expanded = !expanded;
    box.style.display = expanded ? 'block' : 'none';
    toggle.innerHTML = '+ Late Found Issue (LFI) <span class="lfi-caret">' + (expanded ? iconHtml('chevron-down') : iconHtml('chevron-right')) + '</span>';
    toggle.classList.toggle('on', expanded);
    if (expanded) {
      var t = box.querySelector('#lfiTitle');
      if (t) t.focus();
    }
  };

  var h = '<p class="note">' + esc(project.project_id) + ' · step ' + esc(step.step_id) + ' — ' + esc(step.step_name) + '</p>';

  // Field rows
  var lfiRegistryNames = ((CFG && CFG.user_registry) || []).map(function(u) { return u.username; });
  if (who && lfiRegistryNames.indexOf(who) === -1) lfiRegistryNames.unshift(who);
  var fields = [
    ['Title', 'text', 'lfiTitle', '', true],
    ['Author', 'select', 'lfiAuthor', who, false, lfiRegistryNames],
    ['Date', 'date', 'lfiDate', todayStr, false],
    ['Plant', 'text', 'lfiPlant', 'WVN', false],
    ['Impact', 'text', 'lfiImpact', '', false],
    ['Severity', 'select', 'lfiSeverity', 'Major', false, ['Critical', 'Major', 'Minor']],
    ['Description', 'textarea', 'lfiDesc', '', false],
    ['Root Cause', 'textarea', 'lfiRootCause', '', false],
    ['Remediation', 'textarea', 'lfiRemediation', '', false]
  ];

  fields.forEach(function(f) {
    var isTextarea = f[1] === 'textarea';
    var isSelect = f[1] === 'select';
    h += '<div class="lfi-field"><label for="' + f[2] + '">' + esc(f[0]) + (f[4] ? ' <span class="lfi-required">*</span>' : '') + '</label>';
    if (isTextarea) {
      h += '<textarea id="' + f[2] + '" class="lfi-input" rows="3">' + esc(f[3]) + '</textarea>';
    } else if (isSelect) {
      h += '<select id="' + f[2] + '" class="lfi-input">' + f[5].map(function(opt) {
        return '<option value="' + esc(opt) + '"' + (opt === f[3] ? ' selected' : '') + '>' + esc(opt) + '</option>';
      }).join('') + '</select>';
    } else {
      h += '<input id="' + f[2] + '" class="lfi-input" type="' + f[1] + '" value="' + esc(f[3]) + '">';
    }
    h += '</div>';
  });

  // Image attachment areas — two distinct dropzones, not one shared bucket,
  // since which panel a photo lands in (Problem vs Solution) determines
  // which fixed cell range (A16:L47 vs M16:AA47) it gets anchored into on
  // the server, and letting one dropzone stand for "whichever image you
  // dropped first" was too easy to get backwards.
  h += '<div class="lfi-dropzones">';
  h += '<div class="lfi-field"><label>Problem / Need / General Practice</label>';
  h += '<div class="lfi-attach-area" id="lfiProblemArea">';
  h += '<div id="lfiProblemPreviews" class="lfi-previews"></div>';
  h += '<label class="lfi-attach-btn">Choose files<input type="file" id="lfiProblemInput" accept=".png,.jpg,.jpeg" multiple style="display:none"></label>';
  h += '</div></div>';
  h += '<div class="lfi-field"><label>Solution / Best Practice</label>';
  h += '<div class="lfi-attach-area" id="lfiSolutionArea">';
  h += '<div id="lfiSolutionPreviews" class="lfi-previews"></div>';
  h += '<label class="lfi-attach-btn">Choose files<input type="file" id="lfiSolutionInput" accept=".png,.jpg,.jpeg" multiple style="display:none"></label>';
  h += '</div></div>';
  h += '</div>';

  // Error area. The success notice deliberately lives OUTSIDE this panel
  // (appended to wrap below) — the panel collapses on success, so a notice
  // inside it would be hidden at the exact moment it matters.
  h += '<div id="lfiError" class="lfi-error" style="display:none"></div>';

  // Actions
  h += '<div class="acts"><button id="lfiCancel">Cancel</button><button id="lfiSubmit" class="primary">Submit LFI</button></div>';

  box.innerHTML = h;

  var problemImages = [];
  var solutionImages = [];

  var collapse = function() {
    expanded = false;
    box.style.display = 'none';
    toggle.innerHTML = '+ Late Found Issue (LFI) <span class="lfi-caret">' + iconHtml('chevron-right') + '</span>';
    toggle.classList.remove('on');
  };

  var cancelBtn = box.querySelector('#lfiCancel');
  cancelBtn.onclick = collapse;

  // Thumbnails are removed by identity, not by a captured index — splicing on
  // a stale index deletes whichever file happens to sit there after an earlier
  // removal, which silently attached the wrong photo to the report. Wired
  // identically for both zones via this shared factory so Problem and
  // Solution behave the same way, just against their own array/preview list.
  function wireDropzone(imagesArray, areaId, inputId, previewsId) {
    var area = box.querySelector('#' + areaId);
    var input = box.querySelector('#' + inputId);
    var previews = box.querySelector('#' + previewsId);

    function addImage(f) {
      if (!/\.(png|jpe?g)$/i.test(f.name)) return;
      imagesArray.push(f);
      var thumb = el('div', 'lfi-thumb');
      var img = el('img');
      img.alt = f.name;
      thumb.appendChild(img);
      thumb.appendChild(el('span', '', f.name));
      var rmBtn = el('button', 'lfi-rm-thumb', '×');
      rmBtn.title = 'Remove ' + f.name;
      rmBtn.onclick = function(e) {
        e.preventDefault();
        var at = imagesArray.indexOf(f);
        if (at >= 0) imagesArray.splice(at, 1);
        thumb.remove();
      };
      thumb.appendChild(rmBtn);
      previews.appendChild(thumb);
      var reader = new FileReader();
      reader.onload = function(e) { img.src = e.target.result; };
      reader.readAsDataURL(f);
    }

    input.onchange = function() {
      for (var i = 0; i < input.files.length; i++) addImage(input.files[i]);
      input.value = '';
    };
    if (area) {
      area.ondragover = function(e) { e.preventDefault(); area.classList.add('dragover'); };
      area.ondragleave = function() { area.classList.remove('dragover'); };
      area.ondrop = function(e) {
        e.preventDefault();
        area.classList.remove('dragover');
        var fl = e.dataTransfer.files;
        for (var i = 0; i < fl.length; i++) addImage(fl[i]);
      };
    }
  }
  wireDropzone(problemImages, 'lfiProblemArea', 'lfiProblemInput', 'lfiProblemPreviews');
  wireDropzone(solutionImages, 'lfiSolutionArea', 'lfiSolutionInput', 'lfiSolutionPreviews');

  var submitBtn = box.querySelector('#lfiSubmit');
  submitBtn.onclick = async function() {
    var titleVal = (box.querySelector('#lfiTitle').value || '').trim();
    var errDiv = box.querySelector('#lfiError');

    if (!titleVal) {
      errDiv.textContent = 'Title is required.';
      errDiv.style.display = 'block';
      return;
    }

    // Read images as base64. Order matters: launcher.ps1 anchors payload
    // index 0 into A16:L47 (Problem) and index 1 into M16:AA47 (Solution) by
    // array position, so Problem's files must be read first regardless of
    // which dropzone the user actually filled second.
    var orderedFiles = problemImages.concat(solutionImages);
    var imagePayloads = [];
    for (var i = 0; i < orderedFiles.length; i++) {
      var buf = await new Promise(function(resolve) {
        var r = new FileReader();
        r.onload = function(e) { resolve(e.target.result); };
        r.readAsDataURL(orderedFiles[i]);
      });
      imagePayloads.push({ name: orderedFiles[i].name, data: buf });
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
      severity: (box.querySelector('#lfiSeverity').value || '').trim(),
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
      var lfiResult = await API.lfi(body);
      collapse();
      // Refresh drawer in-place — no page scroll, no viewport jump
      var pageY = window.scrollY;
      var drawerEl = $('#drawer');
      var drawerScroll = drawerEl ? drawerEl.scrollTop : 0;
      await refreshSilently();
      openDrawer(project, step);
      window.scrollTo(0, pageY);
      var newDrawer = $('#drawer');
      if (newDrawer) {
        newDrawer.scrollTop = drawerScroll;
        // The drawer was rebuilt, so the success notice has to be planted on
        // the NEW node — the one this closure captured is already detached.
        var okDiv = newDrawer.querySelector('#lfiOk');
        if (okDiv) {
          okDiv.textContent = 'LFI recorded — ' + titleVal;
          okDiv.style.display = 'block';
          var savedPath = lfiResult && lfiResult.path;
          var pathLine = vaultPathLine(savedPath, 'Workbook saved to');
          if (pathLine) okDiv.appendChild(pathLine);
        }
      }
    } catch (e) {
      errDiv.textContent = 'Submit failed: ' + e.message;
      errDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit LFI';
    }
  };

  return wrap;
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
    btn.innerHTML = iconHtml(v === 'dark' ? 'sun' : 'moon');
  }
  try { localStorage.setItem(TK, v); } catch (e) { }
}
// Light is the stable default. The OS prefers-color-scheme is deliberately NOT
// consulted: it made the tool open dark on some company laptops and light on
// others with no user action, which read as a rendering bug. Dark is now only
// ever entered by an explicit click, and that choice is what gets persisted.
try { setTheme(localStorage.getItem(TK) === 'dark' ? 'dark' : 'light'); } catch (e) { setTheme('light'); }
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ---------------------------------------------------- header: signed-in user -- */
/* v12: the header shows who is signed in. It used to be a dropdown anyone
   could change, with a PIN prompt in front of "admin"; the name now comes
   from the login session and can only be changed by signing out. */
function paintVaultSwitch() {
  const n = $('#vaultSwitchName'), k = $('#vaultSwitchKind');
  // <wbr> after each underscore: a folder name like NPI_EPM_Documents_Control
  // is one unbreakable word otherwise, and the rail would cut it mid-letter.
  if (n) n.innerHTML = esc(String(PATHS.vault || '').split('\\').pop() || '').replace(/_/g, '_<wbr>');
  if (k) k.textContent = getLang() === 'vi' ? 'Kho chung' : 'Common vault';
  const a = $('#vaultSwitch');
  if (a) a.title = getLang() === 'vi' ? 'Đổi kho' : 'Switch vault';
}
function renderUserChip() {
  let wrap = $('#userChipWrap');
  if (!wrap) {
    wrap = el('div', 'userchip-wrap'); wrap.id = 'userChipWrap';
    $('#srvState').insertAdjacentElement('afterend', wrap);
    document.addEventListener('click', function(ev) { if (!ev.target.closest('#userChipWrap')) { const m = $('#userMenu'); if (m) m.classList.add('hide'); const c = $('#userChip'); if (c) c.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') { const m = $('#userMenu'); if (m && !m.classList.contains('hide')) { m.classList.add('hide'); $('#userChip').focus(); } } });
  }
  const vi = getLang() === 'vi';
  const wasOpen = $('#userMenu') && !$('#userMenu').classList.contains('hide');
  wrap.innerHTML = '';
  const chip = el('button', 'userchip'); chip.id = 'userChip'; chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'true'); chip.setAttribute('aria-expanded', wasOpen ? 'true' : 'false');
  chip.innerHTML = iconHtml('user', 'icon-sm') + '<b>' + esc(getUser()) + '</b><span class="badge bg-secondary">' + esc(SESSION.role || 'user') + '</span>' + iconHtml('chevron-down', 'icon-sm');
  const menu = el('div', 'usermenu' + (wasOpen ? '' : ' hide')); menu.id = 'userMenu';
  const item = function(iconName, label, fn) {
    const b = el('button'); b.type = 'button';
    b.innerHTML = iconHtml(iconName, 'icon-sm') + '<span>' + esc(label) + '</span>';
    b.onclick = function() { menu.classList.add('hide'); fn(); };
    menu.appendChild(b);
  };
  item('lock', vi ? 'Đổi mật khẩu' : 'Change my password', changePasswordModal);
  item('switch-horizontal', vi ? 'Đổi kho' : 'Switch vault', async function() { try { await flushOrphanStage(); } catch (e) { } location.href = '/login.html'; });
  item('logout', vi ? 'Đăng xuất' : 'Sign out', signOut);
  chip.onclick = function() { const open = menu.classList.toggle('hide'); chip.setAttribute('aria-expanded', open ? 'false' : 'true'); };
  wrap.appendChild(chip); wrap.appendChild(menu);
  paintVaultSwitch();
}

boot();
