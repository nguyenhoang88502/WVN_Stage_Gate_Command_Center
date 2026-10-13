'use strict';
/* ===========================================================================
   v12-shared.js - helpers used by BOTH login.js and vault.js.

   Loaded as a plain script (the app is air-gapped and has no bundler), so
   everything here is a global. app.js does not load this file: the NPI/ECN
   screens keep their own helpers and are untouched by it.
   ======================================================================== */

/* ---- icon sprite ----------------------------------------------------------
   Tabler Icons (MIT), the same subset convention as index.html. Injected
   rather than pasted into each page so login.html and vault.html stay short. */
const V12_SPRITE = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true"><symbol id="i-factory" viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21v-12l5 4v-4l5 4h4"/><path d="M19 21v-8l-1.436 -9.574a.5 .5 0 0 0 -.495 -.426h-1.145a.5 .5 0 0 0 -.494 .418l-1.43 8.582"/><path d="M9 17h1"/><path d="M14 17h1"/></symbol><symbol id="i-dash" viewBox="0 0 24 24"><path d="M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1"/><path d="M5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1"/><path d="M15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1"/><path d="M15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1"/></symbol><symbol id="i-checklist" viewBox="0 0 24 24"><path d="M9.615 20h-2.615a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8"/><path d="M14 19l2 2l4 -4"/><path d="M9 8h4"/><path d="M9 12h2"/></symbol><symbol id="i-folder" viewBox="0 0 24 24"><path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2"/></symbol><symbol id="i-folders" viewBox="0 0 24 24"><path d="M9 3h3l2 2h5a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2"/><path d="M17 16v2a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2h2"/></symbol><symbol id="i-import" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 13v-8a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2h-5.5m-9.5 -2h7m-3 -3l3 3l-3 3"/></symbol><symbol id="i-rocket" viewBox="0 0 24 24"><path d="M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3"/><path d="M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3"/><path d="M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/></symbol><symbol id="i-branch" viewBox="0 0 24 24"><path d="M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 8l0 8"/><path d="M9 18h6a2 2 0 0 0 2 -2v-5"/><path d="M14 14l3 -3l3 3"/></symbol><symbol id="i-settings" viewBox="0 0 24 24"><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/></symbol><symbol id="i-lock" viewBox="0 0 24 24"><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/></symbol><symbol id="i-user" viewBox="0 0 24 24"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/></symbol><symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5l0 14"/><path d="M5 12l14 0"/></symbol><symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/></symbol><symbol id="i-download" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/></symbol><symbol id="i-upload" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 9l5 -5l5 5"/><path d="M12 4l0 12"/></symbol><symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12l5 5l10 -10"/></symbol><symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0"/><path d="M12 16h.01"/></symbol><symbol id="i-table" viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14"/><path d="M3 10h18"/><path d="M10 3v18"/></symbol><symbol id="i-calendar" viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12"/><path d="M16 3l0 4"/><path d="M8 3l0 4"/><path d="M4 11l16 0"/><path d="M8 15h2v2h-2l0 -2"/></symbol><symbol id="i-moon" viewBox="0 0 24 24"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"/></symbol><symbol id="i-sun" viewBox="0 0 24 24"><path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/></symbol><symbol id="i-eye" viewBox="0 0 24 24"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/></symbol><symbol id="i-logout" viewBox="0 0 24 24"><path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/></symbol><symbol id="i-switch" viewBox="0 0 24 24"><path d="M16 3l4 4l-4 4"/><path d="M10 7l10 0"/><path d="M8 13l-4 4l4 4"/><path d="M4 17l9 0"/></symbol><symbol id="i-chev" viewBox="0 0 24 24"><path d="M6 9l6 6l6 -6"/></symbol><symbol id="i-file" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2"/></symbol></svg>';
document.body.insertAdjacentHTML('afterbegin', V12_SPRITE);

/* ---- small helpers -------------------------------------------------------- */
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, c) => '<svg class="icon ' + (c || '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
const byId = id => document.getElementById(id);
const val = id => { const e = byId(id); return e ? e.value : ''; };

/* Same storage keys as app.js, so the language and theme a person picked on
   one page are what the other pages open in. Vietnamese and light are the
   defaults there, so they are here. */
const LANG_KEY = 'wvn_lang', THEME_KEY = 'wvn-epm-theme';
function getLang() { try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'vi'; } catch (e) { return 'vi'; } }
function setLang(v) { try { localStorage.setItem(LANG_KEY, v); } catch (e) { } document.documentElement.lang = v; }
function getTheme() { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } }
function setTheme(v) { try { localStorage.setItem(THEME_KEY, v); } catch (e) { } document.documentElement.dataset.theme = v; }
document.documentElement.dataset.theme = getTheme();
document.documentElement.lang = getLang();
/* L('English', 'Tiếng Việt') - both strings sit next to each other where they
   are used, so a new line of UI cannot be added in one language only. */
const L = (en, vi) => getLang() === 'vi' ? vi : en;
function toolsHtml() {
  const vi = getLang() === 'vi', dark = getTheme() === 'dark';
  return '<button type="button" class="lang-toggle" data-act="lang" title="Chuyển ngôn ngữ / Switch language"><span class="' + (vi ? '' : 'dim') + '">VI</span> | <span class="' + (vi ? 'dim' : '') + '">EN</span></button>' +
    '<button type="button" class="sm icon-btn" data-act="theme" title="' + L('Switch theme', 'Đổi giao diện') + '">' + ic(dark ? 'sun' : 'moon') + '</button>';
}

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const toD = s => new Date(s + 'T00:00:00');
const addDays = (s, n) => { const d = toD(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtD = s => s ? toD(String(s).slice(0, 10)).toLocaleDateString(getLang() === 'vi' ? 'vi-VN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/* ---- API client ------------------------------------------------------------
   One round trip per call, JSON both ways. A 401 anywhere except on the login
   page itself means the session ended (launcher restarted, or 12 idle hours),
   so the browser is sent back to sign in instead of showing a broken screen. */
const api = {
  async req(method, path, body) {
    const opt = { method, cache: 'no-store' };
    if (body !== undefined) { opt.headers = { 'Content-Type': 'application/json; charset=utf-8' }; opt.body = JSON.stringify(body); }
    const r = await fetch(path, opt);
    let j = null;
    try { j = await r.json(); } catch (e) { }
    if (r.status === 401 && j && j.auth === 'required' && !/\/login\.html$/.test(location.pathname)) {
      location.href = '/login.html';
      throw new Error('Sign in first.');
    }
    if (!r.ok) { const e = new Error((j && j.error) || (r.status + ' ' + r.statusText)); e.status = r.status; e.data = j || {}; throw e; }
    return j;
  },
  get(path) { return api.req('GET', path); },
  post(path, body) { return api.req('POST', path, body || {}); }
};
function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result).split(',')[1] || '');
    rd.onerror = () => reject(rd.error || new Error('could not read the file'));
    rd.readAsDataURL(file);
  });
}

let toastTimer = null;
function toast(msg, bad) {
  let t = byId('v12Toast');
  if (!t) { t = document.createElement('div'); t.id = 'v12Toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (t.parentNode) t.remove(); }, bad ? 7000 : 3500);
}

/* ---- change-my-password dialog --------------------------------------------
   Built here because vault.js and login.js both need it. Appended to <body>,
   outside whatever the page re-renders, so a redraw never closes it mid-type. */
function openChangePassword(onDone) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = '<form class="modal" role="dialog" aria-modal="true" aria-labelledby="cpTitle" autocomplete="off">' +
    '<h2 id="cpTitle">' + L('Change my password', 'Đổi mật khẩu') + '</h2>' +
    '<label class="fld"><span>' + L('Current password', 'Mật khẩu hiện tại') + '</span><input id="cp0" type="password"></label>' +
    '<label class="fld"><span>' + L('New password (at least 8 characters)', 'Mật khẩu mới (ít nhất 8 ký tự)') + '</span><input id="cp1" type="password"></label>' +
    '<label class="fld"><span>' + L('Type it again', 'Nhập lại') + '</span><input id="cp2" type="password"></label>' +
    '<div class="err-line hide" role="alert">' + ic('alert', 'icon-sm') + '<span></span></div>' +
    '<div class="acts"><button type="button" data-x>' + L('Cancel', 'Hủy') + '</button><button class="primary">' + L('Save', 'Lưu') + '</button></div></form>';
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const err = scrim.querySelector('.err-line');
  const fail = m => { err.classList.remove('hide'); err.querySelector('span').textContent = m; };
  scrim.addEventListener('click', e => { if (e.target === scrim || e.target.closest('[data-x]')) close(); });
  scrim.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault(); e.stopPropagation();
    const cur = val('cp0'), a = val('cp1'), b = val('cp2');
    if (a.length < 8) return fail(L('Use at least 8 characters.', 'Dùng ít nhất 8 ký tự.'));
    if (a !== b) return fail(L('The two passwords are different.', 'Hai mật khẩu không giống nhau.'));
    try {
      await api.post('/api/auth/change-password', { current: cur, new: a });
      close(); toast(L('Password changed.', 'Đã đổi mật khẩu.'));
      if (onDone) onDone();
    } catch (ex) { fail(ex.message); }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  byId('cp0').focus();
}

/* ---- vault templates -------------------------------------------------------
   Starting points offered when a personal vault is created. They are only
   suggestions: every part can be changed afterwards in Vault setup. */
const TEMPLATES = {
  blank: () => ({
    fields: [{ key: 'f_' + uid(), label: 'Title', type: 'text', options: [], required: true, inList: true }],
    processes: [{ id: 'p_' + uid(), name: 'My process', desc: '', steps: [{ name: 'Step 1', days: 7, docs: [] }] }],
    doctypes: [], folder: ['[Project ID] [Title]', '[Step]']
  }),
  kaizen: () => ({
    fields: [
      { key: 'f_title', label: 'Title', type: 'text', options: [], required: true, inList: true },
      { key: 'f_area', label: 'Area', type: 'list', options: ['Assembly line 1', 'Assembly line 2', 'Blade grinding', 'Packing', 'Warehouse'], required: true, inList: true },
      { key: 'f_owner', label: 'Owner', type: 'text', options: [], required: false, inList: true },
      { key: 'f_budget', label: 'Budget (USD)', type: 'number', options: [], required: false, inList: false },
      { key: 'f_safety', label: 'Safety related', type: 'yesno', options: [], required: false, inList: false }
    ],
    processes: [
      { id: 'p_pdca', name: 'Kaizen (PDCA)', desc: 'Small improvement run as Plan-Do-Check-Act.', steps: [
        { name: 'Plan', days: 7, docs: ['A3'] }, { name: 'Do', days: 14, docs: ['PHOTO'] },
        { name: 'Check', days: 7, docs: ['COST', 'PHOTO'] }, { name: 'Act', days: 5, docs: ['STDWORK'] }] },
      { id: 'p_5s', name: '5S audit', desc: 'Audit an area, close the findings, audit again.', steps: [
        { name: 'Audit', days: 2, docs: ['CHECKLIST'] }, { name: 'Corrective actions', days: 10, docs: ['PHOTO'] },
        { name: 'Re-audit', days: 3, docs: ['CHECKLIST'] }] }
    ],
    doctypes: [
      { code: 'A3', name: 'A3 problem-solving report', hint: 'A3_[Project ID].xlsx' },
      { code: 'PHOTO', name: 'Before / after photos', hint: '' },
      { code: 'COST', name: 'Cost and saving sheet', hint: '' },
      { code: 'STDWORK', name: 'Standard work update', hint: '' },
      { code: 'CHECKLIST', name: '5S audit checklist', hint: '' }
    ],
    folder: ['[Area]', '[Project ID] [Title]', '[Step]', '[DocType]']
  }),
  audit: () => ({
    fields: [
      { key: 'f_' + uid(), label: 'Supplier', type: 'text', options: [], required: true, inList: true },
      { key: 'f_' + uid(), label: 'Commodity', type: 'list', options: ['Plastic', 'Metal', 'Electronics', 'Packaging'], required: true, inList: true },
      { key: 'f_' + uid(), label: 'Auditor', type: 'text', options: [], required: false, inList: true },
      { key: 'f_' + uid(), label: 'Audit date', type: 'date', options: [], required: false, inList: false }
    ],
    processes: [{ id: 'p_' + uid(), name: 'Supplier audit', desc: '', steps: [
      { name: 'Prepare', days: 5, docs: ['PLAN'] }, { name: 'On-site audit', days: 2, docs: ['CHECKLIST'] },
      { name: 'Report', days: 5, docs: ['REPORT'] }, { name: 'Follow-up', days: 30, docs: ['CAR'] }] }],
    doctypes: [
      { code: 'PLAN', name: 'Audit plan', hint: '' }, { code: 'CHECKLIST', name: 'Audit checklist', hint: '' },
      { code: 'REPORT', name: 'Audit report', hint: '' }, { code: 'CAR', name: 'Corrective action request', hint: '' }],
    folder: ['[Commodity]', '[Supplier]', '[Project ID]', '[DocType]']
  })
};

/* ---- Excel template: writer, reader, parser --------------------------------
   Done in the browser, with no library: an .xlsx is a zip of small XML files.
   The writer stores entries uncompressed; the reader also inflates entries
   Excel has compressed (DecompressionStream, in every current Edge/Chrome). */
const uid = () => Math.random().toString(36).slice(2, 9);
const xesc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUn = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');

function crc32(u8) {
  let crc = -1;
  for (let i = 0; i < u8.length; i++) {
    let c = (crc ^ u8[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ -1) >>> 0;
}
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data), n = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true);
    lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + n;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function sheetXml(rows, widths) {
  const col = i => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + (i - 1) % 26) + s; i = Math.floor((i - 1) / 26); } return s; };
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  x += '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  rows.forEach((r, ri) => {
    x += `<row r="${ri + 1}">` + r.map((v, ci) => {
      const ref = col(ci) + (ri + 1);
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    }).join('') + '</row>';
  });
  return x + '</sheetData></worksheet>';
}
/* cfg = {name, fields, processes, doctypes, folder} */
function templateSheets(cfg) {
  const yn = b => b ? 'Yes' : 'No';
  const tyOut = { text: 'Text', number: 'Number', date: 'Date', list: 'List', yesno: 'Yes/No' };
  return [
    { name: 'README', widths: [110], rows: [
      ['How to fill this vault template / Cách điền mẫu kho cá nhân'],
      ['Vault: ' + cfg.name],
      ['1. Fields — one row per piece of information you register for a project. Type is one of: Text, Number, Date, List, Yes/No. For List, put the choices in Options separated by ;'],
      ['2. Processes — one row per workflow you run in this vault.'],
      ['3. Steps — one row per step. Process name must match the Processes sheet. Duration (days) sets the deadline of each step counted from the project start. Required documents = DocTypes codes separated by ;'],
      ['4. DocTypes — the kinds of document you file. Code is short, no spaces.'],
      ['5. FolderStructure — one row per folder level, top level first. Use [Project ID], [Process], [Step], [DocType] or any [Field label]. Plain text is kept as typed.'],
      ['Keep the header row of every sheet. Do not rename the sheets. Then import the file in Vault setup > Excel template.'],
      ['Giữ nguyên dòng tiêu đề và tên các sheet. Sau khi điền, nhập lại tệp tại Thiết lập kho > Mẫu Excel.']
    ] },
    { name: 'Fields', widths: [30, 14, 50, 12, 14], rows: [['Field label', 'Type', 'Options (for List; separate with ;)', 'Required', 'Show in list']]
      .concat(cfg.fields.map(f => [f.label, tyOut[f.type] || 'Text', (f.options || []).join('; '), yn(f.required), yn(f.inList)])) },
    { name: 'Processes', widths: [30, 70], rows: [['Process name', 'Description']]
      .concat(cfg.processes.map(p => [p.name, p.desc || ''])) },
    { name: 'Steps', widths: [30, 10, 34, 16, 40], rows: [['Process name', 'Step no', 'Step name', 'Duration (days)', 'Required documents (codes; separate with ;)']]
      .concat(cfg.processes.flatMap(p => p.steps.map((s, i) => [p.name, i + 1, s.name, s.days, (s.docs || []).join('; ')]))) },
    { name: 'DocTypes', widths: [16, 40, 46], rows: [['Code', 'Name', 'File name hint']]
      .concat(cfg.doctypes.map(d => [d.code, d.name, d.hint || ''])) },
    { name: 'FolderStructure', widths: [10, 50], rows: [['Level', 'Folder name (tokens in [brackets])']]
      .concat(cfg.folder.map((l, i) => [i + 1, l])) }
  ];
}
function buildWorkbook(cfg) {
  const sheets = templateSheets(cfg);
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    { name: '[Content_Types].xml', data: H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF14589F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
  ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) })));
  return zipStore(files);
}
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), td = new TextDecoder();
  let i = u8.length - 22;
  while (i >= 0 && dv.getUint32(i, true) !== 0x06054b50) i--;
  if (i < 0) throw new Error('This is not an .xlsx file.');
  const n = dv.getUint16(i + 10, true), out = {};
  let p = dv.getUint32(i + 16, true);
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.slice(start, start + csz);
    out[name] = method === 0 ? raw
      : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nl + xl + cl;
  }
  return out;
}
function readSheets(files) {
  const td = new TextDecoder(), txt = n => files[n] ? td.decode(files[n]) : '';
  const tText = b => { let s = ''; b.replace(/<t\/>/g, '').replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => { s += t; return ''; }); return xmlUn(s); };
  const ss = [];
  txt('xl/sharedStrings.xml').replace(/<si>([\s\S]*?)<\/si>/g, (m, b) => { ss.push(tText(b.replace(/<rPh[\s\S]*?<\/rPh>/g, ''))); return ''; });
  const rels = {};
  txt('xl/_rels/workbook.xml.rels').replace(/<Relationship\b[^>]*>/g, m => {
    const id = /\bId="([^"]+)"/.exec(m), t = /\bTarget="([^"]+)"/.exec(m);
    if (id && t) rels[id[1]] = t[1];
    return '';
  });
  const out = {};
  txt('xl/workbook.xml').replace(/<sheet\b[^>]*>/g, m => {
    const nm = /\bname="([^"]+)"/.exec(m), rid = /\br:id="([^"]+)"/.exec(m);
    if (!nm || !rid) return '';
    const target = (rels[rid[1]] || '').replace(/^\/?(xl\/)?/, '');
    const rows = [];
    txt('xl/' + target).replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (m2, body) => {
      const r = [];
      body.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m3, attrs, inner) => {
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs), t = /\bt="(\w+)"/.exec(attrs);
        let ci = r.length;
        if (ref) { ci = 0; for (const ch of ref[1]) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci--; }
        let v = '';
        if (inner) {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (t && t[1] === 's') v = vm ? (ss[+vm[1]] || '') : '';
          else if (t && t[1] === 'inlineStr') v = tText(inner);
          else if (vm) v = xmlUn(vm[1]);
        }
        r[ci] = v;
        return '';
      });
      rows.push(Array.from(r, v => v == null ? '' : String(v)));
      return '';
    });
    out[xmlUn(nm[1])] = rows;
    return '';
  });
  return out;
}
function parseTemplate(sheets) {
  const warn = [], byName = {};
  Object.keys(sheets).forEach(k => { byName[k.trim().toLowerCase()] = sheets[k]; });
  const need = ['Fields', 'Processes', 'Steps', 'DocTypes', 'FolderStructure'];
  need.forEach(n => { if (!byName[n.toLowerCase()]) warn.push('Sheet "' + n + '" is missing.'); });
  const rows = n => (byName[n.toLowerCase()] || []).slice(1).filter(r => r.some(c => String(c || '').trim()));
  const cell = (r, i) => String(r[i] == null ? '' : r[i]).trim();
  const yes = x => /^(y|yes|true|1|x|có|co)$/i.test(String(x || '').trim());
  const types = { text: 'text', number: 'number', date: 'date', list: 'list', 'yes/no': 'yesno', yesno: 'yesno' };
  const fields = rows('Fields').filter(r => cell(r, 0)).map(r => {
    const raw = cell(r, 1).toLowerCase() || 'text', ty = types[raw];
    if (!ty) warn.push('Field "' + cell(r, 0) + '": type "' + cell(r, 1) + '" is not known, used Text.');
    return { key: 'f_' + uid(), label: cell(r, 0), type: ty || 'text', options: cell(r, 2).split(';').map(s => s.trim()).filter(Boolean), required: yes(r[3]), inList: yes(r[4]) };
  });
  const doctypes = rows('DocTypes').filter(r => cell(r, 0)).map(r => ({ code: cell(r, 0).toUpperCase().replace(/\s+/g, '-'), name: cell(r, 1), hint: cell(r, 2) }));
  const codes = new Set(doctypes.map(d => d.code));
  const processes = rows('Processes').filter(r => cell(r, 0)).map(r => ({ id: 'p_' + uid(), name: cell(r, 0), desc: cell(r, 1), steps: [] }));
  const stepRows = rows('Steps').filter(r => cell(r, 2)).map((r, i) => ({ proc: cell(r, 0), no: +cell(r, 1) || (i + 1), name: cell(r, 2), days: Math.max(0, Math.round(+cell(r, 3)) || 0), docs: cell(r, 4).split(';').map(s => s.trim().toUpperCase()).filter(Boolean) }));
  stepRows.sort((a, b) => a.no - b.no).forEach(s => {
    let p = processes.find(x => x.name.toLowerCase() === s.proc.toLowerCase());
    if (!p) { warn.push('Step "' + s.name + '": process "' + s.proc + '" is not on the Processes sheet, added it.'); p = { id: 'p_' + uid(), name: s.proc || 'Process', desc: '', steps: [] }; processes.push(p); }
    const bad = s.docs.filter(c => !codes.has(c));
    if (bad.length) warn.push('Step "' + s.name + '": document code ' + bad.join(', ') + ' is not on the DocTypes sheet, skipped.');
    p.steps.push({ name: s.name, days: s.days, docs: s.docs.filter(c => codes.has(c)) });
  });
  processes.filter(p => !p.steps.length).forEach(p => warn.push('Process "' + p.name + '" has no steps.'));
  const folder = rows('FolderStructure').map(r => cell(r, 1)).filter(Boolean);
  return { fields, doctypes, processes, folder, warn };
}
