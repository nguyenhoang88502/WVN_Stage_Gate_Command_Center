'use strict';
/* ===========================================================================
   vault.js - one personal vault: its project register, the steps-and-
   deadlines timeline, and its setup (fields, processes, document types,
   folder levels, Excel template).

   Nothing here knows about NPI/ECN. A personal vault has only what its owner
   defined in Vault setup; the server keeps it in its own folder beside the
   common vault (see "v12 personal vaults" in launcher.ps1).

   Rendering: one render() rebuilds #root from state, and every control acts
   through a data-act / data-chg attribute handled by one delegated listener.
   Setup edits go to a working copy (S.cfg) and reach the server only on
   "Save setup"; project edits (status, deadline, files) are sent at once.
   ======================================================================== */
const ROOT = byId('root');
const VID = new URLSearchParams(location.search).get('id') || '';
const S = {
  me: null, v: null, projects: [], path: '', loading: true, fatal: '',
  view: 'projects', setupTab: 'fields', procSel: 0, expanded: null,
  draft: null,          // the Register project form while it is open
  cfg: null,            // working copy of the setup; S.v holds what is saved
  dirty: false, menu: false, modal: null, lastLevel: null, flash: '', busy: false,
  edit: {}              // project id -> field values being edited
};
const clone = o => JSON.parse(JSON.stringify(o));
const setupOf = v => clone({ fields: v.fields || [], processes: v.processes || [], doctypes: v.doctypes || [], folder: v.folder || [] });
const NAV = [['projects', 'table', 'Projects', 'Dự án'], ['timeline', 'calendar', 'Steps and deadlines', 'Bước và hạn'], ['setup', 'settings', 'Vault setup', 'Thiết lập kho']];

const stepState = s => s.status === 'done' ? 'done' : (s.due < iso(today()) ? 'late' : s.status);
const stLabel = st => ({ done: L('Done', 'Xong'), doing: L('In progress', 'Đang làm'), todo: L('Not started', 'Chưa bắt đầu'), late: L('Late', 'Trễ') }[st]);
const stBadge = st => '<span class="badge ' + { done: 'b-good', doing: 'b-blue', todo: 'b-grey', late: 'b-bad' }[st] + '">' + stLabel(st) + '</span>';
const fileUrl = rel => '/api/vaults/' + encodeURIComponent(VID) + '/file?path=' + encodeURIComponent(rel);
const kb = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

/* Where a file for this project / step / document type will be put. Mirrors
   Resolve-VaultFolder in launcher.ps1; the server's answer is the one that
   counts, this is only for showing the path before anything is uploaded. */
function resolvePath(cfg, p, procName, stepName, code) {
  const map = { 'project id': p.id, process: procName, step: stepName, doctype: code };
  cfg.fields.forEach(f => { map[f.label.toLowerCase()] = (p.values || {})[f.key]; });
  return cfg.folder.map(l => l.replace(/\[([^\]]*)\]/g, (m, k) => { const x = map[k.trim().toLowerCase()]; return x == null ? m : x; })
    .replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\\');
}
function fieldInput(f, v, attrs) {
  if (f.type === 'list') return '<select ' + attrs + '><option value=""></option>' + f.options.map(o => '<option ' + (o === v ? 'selected' : '') + '>' + h(o) + '</option>').join('') + '</select>';
  if (f.type === 'yesno') return '<select ' + attrs + '><option value=""></option>' + ['Yes', 'No'].map(o => '<option value="' + o + '" ' + (o === v ? 'selected' : '') + '>' + (o === 'Yes' ? L('Yes', 'Có') : L('No', 'Không')) + '</option>').join('') + '</select>';
  return '<input ' + attrs + ' type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '" value="' + h(v || '') + '">';
}
const showVal = (f, v) => !v ? '—' : f.type === 'date' ? fmtD(v) : f.type === 'yesno' ? (v === 'Yes' ? L('Yes', 'Có') : L('No', 'Không')) : h(v);

/* ---- shell ----------------------------------------------------------------- */
function shell(body) {
  const cur = NAV.find(n => n[0] === S.view);
  return '<aside class="app-sidebar">' +
      '<div class="sidebar-brand">' + ic('factory') + '<div><b>WAHL Vietnam</b><span>NPI &amp; ECN Command Center</span></div></div>' +
      '<button class="vault-switch" data-act="switchVault" title="' + L('Switch vault', 'Đổi kho') + '"><small>' + L('Personal vault', 'Kho cá nhân') + '</small><b>' + h(S.v.name) + '</b>' + ic('switch') + '</button>' +
      '<nav class="tabs" aria-label="' + L('Vault', 'Kho') + '">' + NAV.map(n => '<button class="' + (n[0] === S.view ? 'on' : '') + '" data-act="nav" data-v="' + n[0] + '">' + ic(n[1]) + '<span>' + L(n[2], n[3]) + (n[0] === 'setup' && S.dirty ? ' •' : '') + '</span></button>').join('') + '</nav>' +
      '<div class="sidebar-foot">' + L('Owner', 'Chủ kho') + ': ' + h(S.v.owner) + '</div></aside>' +
    '<div class="page-wrapper"><header class="topbar"><div class="topbar-title">' + L(cur[2], cur[3]) + '</div>' +
      '<div class="cmdbar">' + toolsHtml() +
        '<button class="userchip" data-act="menu" aria-expanded="' + S.menu + '">' + ic('user', 'icon-sm') + ' ' + h(S.me.user) + ' <span class="badge b-grey">' + h(S.me.role) + '</span> ' + ic('chev', 'icon-sm') + '</button>' +
        (S.menu ? '<div class="menu"><button data-act="account">' + ic('lock', 'icon-sm') + ' ' + L('Change my password', 'Đổi mật khẩu') + '</button>' +
          '<button data-act="switchVault">' + ic('switch', 'icon-sm') + ' ' + L('Switch vault', 'Đổi kho') + '</button><hr>' +
          '<button data-act="signout">' + ic('logout', 'icon-sm') + ' ' + L('Sign out', 'Đăng xuất') + '</button></div>' : '') +
      '</div></header>' +
      '<main class="page-body">' + (S.v.archived ? '<div class="banner warn">' + L('This vault is archived. It is hidden from the vault list until it is restored (Vault setup › About).', 'Kho này đã lưu trữ. Kho bị ẩn khỏi danh sách cho tới khi được khôi phục (Thiết lập kho › Thông tin).') + '</div>' : '') +
      (S.flash ? '<div class="banner good" role="status">' + h(S.flash) + '</div>' : '') + body + '</main></div>';
}
function header(title, actions) {
  return '<div class="page-header"><div><h1>' + title + '</h1><div class="sub">' + L('Personal vault', 'Kho cá nhân') + ' · ' + h(S.v.name) + '</div></div><div class="actions">' + (actions || '') + '</div></div>';
}

/* ---- projects -------------------------------------------------------------- */
function viewProjects() {
  const v = S.v, cols = v.fields.filter(f => f.inList), d = S.draft;
  let out = header(L('Projects', 'Dự án'), '<button class="primary" data-act="regOpen">' + ic('plus', 'icon-sm') + ' ' + L('Register project', 'Đăng ký dự án') + '</button>');
  if (d) {
    const proc = v.processes.find(p => p.id === d.processId) || v.processes[0];
    out += '<div class="card"><div class="card-header"><h3 class="card-title">' + L('Register a project', 'Đăng ký dự án') + '</h3><span class="note" style="margin:0">' + L('The form is built from your own fields in Vault setup.', 'Biểu mẫu được dựng từ các trường bạn tự khai báo ở Thiết lập kho.') + '</span></div>' +
      '<form class="card-body" data-submit="regSave"><div class="grid2">' +
      v.fields.map(f => '<label class="fld"><span>' + h(f.label) + (f.required ? ' <b class="req">*</b>' : '') + '</span>' + fieldInput(f, d.values[f.key], 'data-chg="draftVal" data-k="' + h(f.key) + '"') + '</label>').join('') +
      '<label class="fld"><span>' + L('Process', 'Quy trình') + ' <b class="req">*</b></span><select data-chg="draftProc">' + v.processes.map(p => '<option value="' + h(p.id) + '" ' + (p.id === proc.id ? 'selected' : '') + '>' + h(p.name) + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>' + L('Start date', 'Ngày bắt đầu') + ' <b class="req">*</b></span><input type="date" data-chg="draftStart" value="' + h(d.start) + '"></label></div>' +
      '<p class="note" style="margin-top:14px">' + L('Deadlines are counted from the start date using each step duration. Change any of them here.', 'Hạn được tính từ ngày bắt đầu theo thời lượng từng bước. Có thể sửa ngay tại đây.') + '</p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>#</th><th>' + L('Step', 'Bước') + '</th><th>' + L('Duration', 'Thời lượng') + '</th><th>' + L('Deadline', 'Hạn') + '</th><th>' + L('Documents expected', 'Tài liệu cần có') + '</th></tr></thead><tbody>' +
      proc.steps.map((s, i) => '<tr><td class="tight">' + (i + 1) + '</td><td>' + h(s.name) + '</td><td class="tight">' + s.days + ' ' + L('days', 'ngày') + '</td><td style="width:170px"><input type="date" data-chg="draftDue" data-i="' + i + '" value="' + h(d.dues[i]) + '" aria-label="' + L('Deadline', 'Hạn') + ' ' + h(s.name) + '"></td><td>' + (s.docs.map(c => '<span class="chip">' + h(c) + '</span>').join(' ') || '—') + '</td></tr>').join('') +
      '</tbody></table></div>' + (d.err ? '<div class="err-line" role="alert">' + ic('alert', 'icon-sm') + '<span>' + h(d.err) + '</span></div>' : '') +
      '<div class="acts"><button type="button" data-act="regCancel">' + L('Cancel', 'Hủy') + '</button><button class="primary" ' + (S.busy ? 'disabled' : '') + '>' + L('Register project', 'Đăng ký dự án') + '</button></div></form></div>';
  }
  if (!S.projects.length) return out + '<div class="card"><div class="empty"><b>' + L('No projects yet.', 'Chưa có dự án.') + '</b>' + L('Check your fields and steps in Vault setup, then register the first project.', 'Kiểm tra trường và bước ở Thiết lập kho rồi đăng ký dự án đầu tiên.') + '</div></div>';
  out += '<div class="card"><div class="tbl-wrap" style="border:0"><table><thead><tr><th>ID</th>' + cols.map(f => '<th>' + h(f.label) + '</th>').join('') + '<th>' + L('Process', 'Quy trình') + '</th><th>' + L('Current step', 'Bước hiện tại') + '</th><th>' + L('Next deadline', 'Hạn kế tiếp') + '</th><th>' + L('Progress', 'Tiến độ') + '</th></tr></thead><tbody>' +
    S.projects.map(p => {
      const open = p.steps.find(s => s.status !== 'done'), done = p.steps.filter(s => s.status === 'done').length, isOpen = S.expanded === p.id;
      const row = '<tr class="clickable" data-act="expand" data-id="' + h(p.id) + '" tabindex="0" aria-expanded="' + isOpen + '"><td class="tight"><b>' + h(p.id) + '</b></td>' + cols.map(f => '<td>' + showVal(f, (p.values || {})[f.key]) + '</td>').join('') + '<td>' + h(p.process_name) + '</td>' +
        '<td>' + (open ? h(open.name) + ' ' + stBadge(stepState(open)) : stBadge('done')) + '</td><td class="tight">' + (open ? fmtD(open.due) : '—') + '</td><td class="tight">' + done + '/' + p.steps.length + '</td></tr>';
      return isOpen ? row + '<tr class="detail"><td colspan="' + (cols.length + 5) + '">' + projectDetail(p) + '</td></tr>' : row;
    }).join('') + '</tbody></table></div></div>';
  return out;
}
function projectDetail(p) {
  const v = S.v, ev = S.edit[p.id];
  const details = ev
    ? '<form data-submit="saveDetails" data-id="' + h(p.id) + '"><div class="grid2">' + v.fields.map(f => '<label class="fld"><span>' + h(f.label) + (f.required ? ' <b class="req">*</b>' : '') + '</span>' + fieldInput(f, ev[f.key], 'data-chg="editVal" data-id="' + h(p.id) + '" data-k="' + h(f.key) + '"') + '</label>').join('') + '</div>' +
      '<div class="acts"><button type="button" data-act="editCancel" data-id="' + h(p.id) + '">' + L('Cancel', 'Hủy') + '</button><button class="primary">' + L('Save details', 'Lưu thông tin') + '</button></div></form>'
    : '<dl class="kv">' + v.fields.map(f => '<dt>' + h(f.label) + '</dt><dd>' + showVal(f, (p.values || {})[f.key]) + '</dd>').join('') +
      '<dt>' + L('Start date', 'Ngày bắt đầu') + '</dt><dd>' + fmtD(p.start) + '</dd><dt>' + L('Registered by', 'Người đăng ký') + '</dt><dd>' + h(p.created_by) + ' · ' + fmtD(p.created_utc) + '</dd></dl>' +
      '<div class="row" style="margin-top:10px"><button class="sm" data-act="editOpen" data-id="' + h(p.id) + '">' + L('Edit details', 'Sửa thông tin') + '</button>' +
      '<button class="sm" data-act="openFolder" data-rel="' + h(resolvePath(v, p, p.process_name, '', '').split('\\').filter(Boolean).slice(0, 1).join('\\')) + '">' + ic('folder', 'icon-sm') + ' ' + L('Open vault folder', 'Mở thư mục kho') + '</button>' +
      '<button class="sm ghost" style="margin-left:auto" data-act="delProject" data-id="' + h(p.id) + '">' + ic('trash', 'icon-sm') + ' ' + L('Delete project', 'Xóa dự án') + '</button></div>';
  const steps = '<div class="tbl-wrap" style="margin-top:14px"><table><thead><tr><th>#</th><th>' + L('Step', 'Bước') + '</th><th>' + L('Deadline', 'Hạn') + '</th><th>' + L('Status', 'Trạng thái') + '</th><th>' + L('Documents', 'Tài liệu') + '</th></tr></thead><tbody>' +
    p.steps.map((s, si) => '<tr><td class="tight">' + (si + 1) + '</td><td><b>' + h(s.name) + '</b> ' + (stepState(s) === 'late' ? stBadge('late') : '') + '</td>' +
      '<td style="width:160px"><input type="date" data-chg="stepDue" data-id="' + h(p.id) + '" data-s="' + si + '" value="' + h(s.due) + '" aria-label="' + L('Deadline', 'Hạn') + ' ' + h(s.name) + '"></td>' +
      '<td style="width:150px"><select data-chg="stepStatus" data-id="' + h(p.id) + '" data-s="' + si + '" aria-label="' + L('Status', 'Trạng thái') + ' ' + h(s.name) + '">' + ['todo', 'doing', 'done'].map(k => '<option value="' + k + '" ' + (k === s.status ? 'selected' : '') + '>' + stLabel(k) + '</option>').join('') + '</select></td>' +
      '<td>' + ((s.docs || []).map(d => {
        const files = d.files || [];
        return '<div class="slot"><div class="slot-head"><b>' + h(d.code) + '</b>' + (files.length ? '<span class="badge b-good">' + files.length + ' ' + L('filed', 'đã lưu') + '</span>' : '<span class="badge b-grey">' + L('missing', 'chưa có') + '</span>') +
          '<label class="chip" style="cursor:pointer;margin-left:auto" tabindex="0">' + ic('upload', 'icon-sm') + L('Add file', 'Thêm tệp') + '<input type="file" multiple class="hide" data-chg="upload" data-id="' + h(p.id) + '" data-s="' + si + '" data-c="' + h(d.code) + '"></label></div>' +
          (files.length ? '<ul class="filelist">' + files.map(f => '<li>' + ic('file', 'icon-sm') + '<a href="' + h(fileUrl(f.rel_path)) + '" target="_blank" rel="noopener" title="' + h(f.rel_path) + '">' + h(f.name) + '</a><small>' + kb(f.bytes || 0) + ' · ' + h(f.by) + ' · ' + fmtD(f.utc) + '</small>' +
            '<button class="xs" data-act="unfile" data-id="' + h(p.id) + '" data-s="' + si + '" data-c="' + h(d.code) + '" data-rel="' + h(f.rel_path) + '" title="' + L('Take off this list (the file stays in the folder)', 'Gỡ khỏi danh sách (tệp vẫn nằm trong thư mục)') + '">×</button></li>').join('') + '</ul>' : '') + '</div>';
      }).join('') || '—') + '</td></tr>').join('') + '</tbody></table></div>';
  return details + steps + '<p class="note">' + L('Files for this project go to', 'Tệp của dự án này được lưu vào') + ' <code>' + h(S.path + '\\' + resolvePath(v, p, p.process_name, '[Step]', '[DocType]')) + '</code></p>';
}

/* ---- timeline -------------------------------------------------------------- */
function viewTimeline() {
  let out = header(L('Steps and deadlines', 'Bước và hạn'));
  if (!S.projects.length) return out + '<div class="card"><div class="empty"><b>' + L('No projects yet.', 'Chưa có dự án.') + '</b></div></div>';
  const DAY = 864e5;
  const t0 = Math.min.apply(null, S.projects.map(p => +toD(p.start)).concat(+today())) - 2 * DAY;
  const t1 = Math.max.apply(null, S.projects.map(p => Math.max.apply(null, p.steps.map(s => +toD(s.due)))).concat(+today())) + 3 * DAY;
  const pct = ms => (ms - t0) / (t1 - t0) * 100;
  let ticks = '';
  for (let i = 0; i < 6; i++) { const ms = t0 + (t1 - t0) * i / 6; ticks += '<span class="tl-tick" style="left:' + pct(ms).toFixed(2) + '%">' + toD(iso(new Date(ms))).toLocaleDateString(getLang() === 'vi' ? 'vi-VN' : 'en-GB', { day: '2-digit', month: 'short' }) + '</span>'; }
  const todayLine = '<span class="tl-today" style="left:' + pct(+today()).toFixed(2) + '%" title="' + L('Today', 'Hôm nay') + '"></span>';
  const first = S.v.fields.find(f => f.inList) || S.v.fields[0];
  out += '<div class="row" style="margin-bottom:10px">' + ['done', 'doing', 'todo', 'late'].map(stBadge).join(' ') + '<span class="note" style="margin:0">· ' + L('red line = today', 'vạch đỏ = hôm nay') + '</span></div>' +
    '<div class="tl"><div class="tl-row tl-axis"><div class="tl-name"><small>' + L('Project', 'Dự án') + '</small></div><div class="tl-track">' + ticks + todayLine + '</div></div>' +
    S.projects.map(p => {
      let from = p.start;
      const bars = p.steps.map(s => {
        const a = Math.min(+toD(from), +toD(s.due)), b = Math.max(+toD(s.due), a + DAY), st = stepState(s);
        from = s.due;
        return '<span class="tl-bar s-' + st + '" style="left:' + pct(a).toFixed(2) + '%;width:' + (pct(b) - pct(a)).toFixed(2) + '%" title="' + h(s.name) + ' · ' + L('deadline', 'hạn') + ' ' + fmtD(s.due) + ' · ' + stLabel(st) + '">' + h(s.name) + '</span>';
      }).join('');
      return '<div class="tl-row"><div class="tl-name"><b>' + h(p.id) + '</b><small>' + h(first ? (p.values || {})[first.key] : '') + '</small></div><div class="tl-track">' + bars + todayLine + '</div></div>';
    }).join('') + '</div>';
  return out;
}

/* ---- setup ----------------------------------------------------------------- */
/* Three small parts of the setup screen depend on text that is being typed
   (a process name, a step duration, a folder level). They are redrawn on
   their own by patchSetup(): redrawing the whole screen when a text box loses
   focus would replace the very button the person is in the middle of
   clicking, and the click would be lost. */
function procChipsHtml() {
  return S.cfg.processes.map((x, i) => '<button class="chip ' + (i === S.procSel ? 'on' : '') + '" data-act="procSel" data-i="' + i + '">' + h(x.name) + ' · ' + x.steps.length + '</button>').join('');
}
function procTotalHtml() {
  const p = S.cfg.processes[S.procSel];
  return L('Total', 'Tổng') + ': ' + (p ? p.steps.reduce((a, s) => a + (+s.days || 0), 0) : 0) + ' ' + L('days from start to the last deadline', 'ngày từ lúc bắt đầu đến hạn cuối');
}
function folderPreviewHtml() {
  const c = S.cfg, proc = c.processes[0] || { name: 'Process', steps: [] }, st = proc.steps[0] || { name: 'Step', docs: [] };
  const sample = S.projects[0] || { id: 'P-001', values: Object.fromEntries(c.fields.map(f => [f.key, f.type === 'list' ? ((f.options || [])[0] || f.label) : f.label])) };
  const code = (st.docs || [])[0] || (c.doctypes[0] || {}).code || 'DOC';
  const parts = resolvePath(c, sample, sample.process_name || proc.name, (sample.steps && sample.steps[0] && sample.steps[0].name) || st.name, code).split('\\').filter(Boolean);
  return '<p class="note" style="margin-top:0">' + L('Preview', 'Xem trước') + ' · ' + h(sample.id) + '</p>' +
    '<div class="tree"><span class="lv">' + ic('folder') + h(S.v.name) + '</span>' + parts.map((l, i) => '<span class="lv" style="padding-left:' + ((i + 1) * 16) + 'px">' + ic('folder') + h(l) + '</span>').join('') + '</div>';
}
function patchSetup() {
  [['procChips', procChipsHtml], ['procTotal', procTotalHtml], ['folderPreview', folderPreviewHtml]].forEach(r => { const n = byId(r[0]); if (n) n.innerHTML = r[1](); });
}
function viewSetup() {
  const c = S.cfg;
  const tabs = [['fields', L('Project fields', 'Trường dự án')], ['process', L('Processes and steps', 'Quy trình và bước')], ['docs', L('Document types', 'Loại tài liệu')], ['folder', L('Folder structure', 'Cấu trúc thư mục')], ['excel', L('Excel template', 'Mẫu Excel')], ['about', L('About', 'Thông tin')]];
  let out = header(L('Vault setup', 'Thiết lập kho')) + '<div class="subtabs" role="tablist">' + tabs.map(t => '<button role="tab" aria-selected="' + (S.setupTab === t[0]) + '" class="' + (S.setupTab === t[0] ? 'on' : '') + '" data-act="setupTab" data-t="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
  const mv = (arr, i) => '<button class="xs" data-act="mv" data-arr="' + arr + '" data-i="' + i + '" data-d="-1" title="' + L('Move up', 'Lên') + '">↑</button><button class="xs" data-act="mv" data-arr="' + arr + '" data-i="' + i + '" data-d="1" title="' + L('Move down', 'Xuống') + '">↓</button><button class="xs" data-act="rm" data-arr="' + arr + '" data-i="' + i + '" title="' + L('Remove', 'Xóa') + '">' + ic('trash', 'icon-sm') + '</button>';
  if (S.setupTab === 'fields') {
    const types = [['text', L('Text', 'Chữ')], ['number', L('Number', 'Số')], ['date', L('Date', 'Ngày')], ['list', L('List', 'Danh sách')], ['yesno', L('Yes / No', 'Có / Không')]];
    out += '<div class="card"><div class="card-body"><p class="note" style="margin-top:0">' + L('These are the boxes on your Register project form. Nothing here is tied to a product.', 'Đây là các ô trên biểu mẫu Đăng ký dự án của bạn. Không gắn với sản phẩm nào.') + '</p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>' + L('Field label', 'Tên trường') + '</th><th>' + L('Type', 'Kiểu') + '</th><th>' + L('Choices (for List, separate with ;)', 'Lựa chọn (kiểu Danh sách, cách nhau bằng ;)') + '</th><th>' + L('Required', 'Bắt buộc') + '</th><th>' + L('Show in list', 'Hiện ở danh sách') + '</th><th></th></tr></thead><tbody>' +
      c.fields.map((f, i) => '<tr><td><input data-path="fields.' + i + '.label" value="' + h(f.label) + '" aria-label="' + L('Field label', 'Tên trường') + '"></td>' +
        '<td style="width:140px"><select data-path="fields.' + i + '.type" data-rr aria-label="' + L('Type', 'Kiểu') + '">' + types.map(o => '<option value="' + o[0] + '" ' + (o[0] === f.type ? 'selected' : '') + '>' + o[1] + '</option>').join('') + '</select></td>' +
        '<td><input data-chg="fOpts" data-i="' + i + '" value="' + h((f.options || []).join('; ')) + '" ' + (f.type === 'list' ? '' : 'disabled') + ' aria-label="' + L('Choices', 'Lựa chọn') + '"></td>' +
        '<td class="tight"><input type="checkbox" data-path="fields.' + i + '.required" ' + (f.required ? 'checked' : '') + ' aria-label="' + L('Required', 'Bắt buộc') + '"></td>' +
        '<td class="tight"><input type="checkbox" data-path="fields.' + i + '.inList" ' + (f.inList ? 'checked' : '') + ' aria-label="' + L('Show in list', 'Hiện ở danh sách') + '"></td>' +
        '<td class="tight">' + mv('fields', i) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="acts" style="justify-content:flex-start"><button data-act="addField">' + ic('plus', 'icon-sm') + ' ' + L('Add field', 'Thêm trường') + '</button></div></div></div>';
  } else if (S.setupTab === 'process') {
    if (S.procSel >= c.processes.length) S.procSel = 0;
    const p = c.processes[S.procSel], pi = S.procSel;
    out += '<div class="card"><div class="card-body"><div class="row"><div class="chips" id="procChips">' + procChipsHtml() + '</div>' +
      '<button class="sm" data-act="addProc">' + ic('plus', 'icon-sm') + ' ' + L('Add process', 'Thêm quy trình') + '</button></div>' +
      (p ? '<div class="grid2" style="margin-top:14px"><label class="fld"><span>' + L('Process name', 'Tên quy trình') + '</span><input data-path="processes.' + pi + '.name" data-patch value="' + h(p.name) + '"></label>' +
        '<label class="fld"><span>' + L('Description', 'Mô tả') + '</span><input data-path="processes.' + pi + '.desc" value="' + h(p.desc || '') + '"></label></div>' +
        '<div class="tbl-wrap" style="margin-top:14px"><table><thead><tr><th>#</th><th>' + L('Step name', 'Tên bước') + '</th><th>' + L('Duration (days)', 'Thời lượng (ngày)') + '</th><th>' + L('Documents expected at this step', 'Tài liệu cần có ở bước này') + '</th><th></th></tr></thead><tbody>' +
        p.steps.map((s, i) => '<tr><td class="tight">' + (i + 1) + '</td><td><input data-path="processes.' + pi + '.steps.' + i + '.name" value="' + h(s.name) + '" aria-label="' + L('Step name', 'Tên bước') + '"></td>' +
          '<td style="width:130px"><input type="number" min="0" max="3650" data-num data-path="processes.' + pi + '.steps.' + i + '.days" data-patch value="' + s.days + '" aria-label="' + L('Duration (days)', 'Thời lượng (ngày)') + '"></td>' +
          '<td><div class="chips">' + (c.doctypes.map(d => '<button class="chip ' + (s.docs.includes(d.code) ? 'on' : '') + '" data-act="togDoc" data-s="' + i + '" data-c="' + h(d.code) + '" aria-pressed="' + s.docs.includes(d.code) + '" title="' + h(d.name) + '">' + h(d.code) + '</button>').join('') || '<span class="note" style="margin:0">' + L('Add document types first.', 'Hãy thêm loại tài liệu trước.') + '</span>') + '</div></td>' +
          '<td class="tight">' + mv('processes.' + pi + '.steps', i) + '</td></tr>').join('') + '</tbody></table></div>' +
        '<div class="row" style="margin-top:12px"><button data-act="addStep">' + ic('plus', 'icon-sm') + ' ' + L('Add step', 'Thêm bước') + '</button>' +
        '<span class="note" style="margin:0" id="procTotal">' + procTotalHtml() + '</span>' +
        (c.processes.length > 1 ? '<button class="ghost sm" style="margin-left:auto" data-act="rm" data-arr="processes" data-i="' + pi + '">' + ic('trash', 'icon-sm') + ' ' + L('Delete this process', 'Xóa quy trình này') + '</button>' : '') + '</div>' +
        '<p class="note">' + L('Changing steps affects projects registered from now on. Projects already registered keep the steps they started with.', 'Thay đổi bước áp dụng cho dự án đăng ký từ nay. Dự án đã đăng ký giữ nguyên các bước ban đầu.') + '</p>' : '') + '</div></div>';
  } else if (S.setupTab === 'docs') {
    out += '<div class="card"><div class="card-body"><div class="tbl-wrap"><table><thead><tr><th>' + L('Code', 'Mã') + '</th><th>' + L('Name', 'Tên') + '</th><th>' + L('File name hint', 'Gợi ý tên tệp') + '</th><th></th></tr></thead><tbody>' +
      (c.doctypes.map((d, i) => '<tr><td style="width:150px"><input data-chg="dCode" data-i="' + i + '" value="' + h(d.code) + '" aria-label="' + L('Code', 'Mã') + '"></td><td><input data-path="doctypes.' + i + '.name" value="' + h(d.name) + '" aria-label="' + L('Name', 'Tên') + '"></td><td><input data-path="doctypes.' + i + '.hint" value="' + h(d.hint || '') + '" aria-label="' + L('File name hint', 'Gợi ý tên tệp') + '"></td><td class="tight">' + mv('doctypes', i) + '</td></tr>').join('') || '<tr><td colspan="4">' + L('No document types yet.', 'Chưa có loại tài liệu.') + '</td></tr>') +
      '</tbody></table></div><p class="note">' + L('Codes use letters, digits, - and _ only. Tick which step expects each type under Processes and steps.', 'Mã chỉ dùng chữ, số, - và _. Chọn bước cần từng loại ở tab Quy trình và bước.') + '</p>' +
      '<div class="acts" style="justify-content:flex-start"><button data-act="addDoc">' + ic('plus', 'icon-sm') + ' ' + L('Add document type', 'Thêm loại tài liệu') + '</button></div></div></div>';
  } else if (S.setupTab === 'folder') {
    const tokens =['Project ID', 'Process', 'Step', 'DocType'].concat(c.fields.map(f => f.label));
    out += '<div class="card"><div class="card-body"><div class="split"><div>' +
      '<p class="note" style="margin-top:0">' + L('How this vault files documents, top level first. Tokens in [brackets] are filled from the project. Click a token to add it to the level you last edited.', 'Cách kho này xếp tài liệu, cấp trên cùng trước. Phần trong [ngoặc] lấy từ dự án. Bấm một thẻ để thêm vào cấp bạn vừa sửa.') + '</p>' +
      c.folder.map((l, i) => '<div class="lvl-row"><span>' + L('Level', 'Cấp') + ' ' + (i + 1) + '</span><input data-path="folder.' + i + '" data-patch data-lvl="' + i + '" value="' + h(l) + '" aria-label="' + L('Level', 'Cấp') + ' ' + (i + 1) + '"><span class="row" style="gap:4px">' + mv('folder', i) + '</span></div>').join('') +
      '<div class="chips" style="margin-top:10px">' + tokens.map(t => '<button class="chip" data-act="tok" data-t="' + h(t) + '">[' + h(t) + ']</button>').join('') + '</div>' +
      '<div class="acts" style="justify-content:flex-start"><button data-act="addLevel">' + ic('plus', 'icon-sm') + ' ' + L('Add level', 'Thêm cấp') + '</button></div>' +
      '<p class="note">' + L('A change applies to files added from now on. Files already filed stay where they are.', 'Thay đổi áp dụng cho tệp thêm từ nay. Tệp đã lưu vẫn ở chỗ cũ.') + '</p>' +
      '</div><div id="folderPreview">' + folderPreviewHtml() + '</div></div></div></div>';
  } else if (S.setupTab === 'excel') {
    const sh = templateSheets(Object.assign({ name: S.v.name }, c));
    out += '<div class="split"><div class="card"><div class="card-header"><h3 class="card-title">1 · ' + L('Download the template', 'Tải mẫu về') + '</h3></div><div class="card-body">' +
      '<p class="note" style="margin-top:0">' + L('An .xlsx with one sheet per topic, already filled with this vault\'s current setup. Fill it in Excel, or hand it to a colleague to fill.', 'Tệp .xlsx, mỗi chủ đề một sheet, đã điền sẵn thiết lập hiện tại của kho. Điền trong Excel hoặc gửi đồng nghiệp điền giúp.') + '</p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>Sheet</th><th>' + L('Columns', 'Cột') + '</th><th>' + L('Rows now', 'Số dòng') + '</th></tr></thead><tbody>' +
      sh.slice(1).map(s => '<tr><td><b>' + h(s.name) + '</b></td><td>' + s.rows[0].map(h).join(' · ') + '</td><td class="tight">' + (s.rows.length - 1) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="acts" style="justify-content:flex-start"><button class="primary" data-act="xlsxOut">' + ic('download', 'icon-sm') + ' ' + L('Download template (.xlsx)', 'Tải mẫu (.xlsx)') + '</button></div></div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">2 · ' + L('Import the filled file', 'Nhập tệp đã điền') + '</h3></div><div class="card-body">' +
      '<p class="note" style="margin-top:0">' + L('You see a summary and any problems first. Nothing changes until you confirm.', 'Bạn sẽ thấy tóm tắt và các lỗi trước. Chưa có gì thay đổi cho tới khi bạn xác nhận.') + '</p>' +
      '<input type="file" accept=".xlsx" data-chg="xlsxIn" aria-label="' + L('Filled template file', 'Tệp mẫu đã điền') + '">' +
      '<p class="note">' + L('Registered projects keep their values for every field whose label is unchanged.', 'Dự án đã đăng ký giữ nguyên giá trị với các trường không đổi tên.') + '</p></div></div></div>';
  } else {
    out += '<div class="card"><div class="card-body"><dl class="kv"><dt>' + L('Vault name', 'Tên kho') + '</dt><dd><b>' + h(S.v.name) + '</b></dd><dt>' + L('Owner', 'Chủ kho') + '</dt><dd>' + h(S.v.owner) + '</dd>' +
      '<dt>' + L('Created', 'Ngày tạo') + '</dt><dd>' + fmtD(S.v.created_utc) + '</dd><dt>' + L('Projects', 'Dự án') + '</dt><dd>' + S.projects.length + '</dd>' +
      '<dt>' + L('Folder', 'Thư mục') + '</dt><dd><code>' + h(S.path) + '</code></dd><dt>' + L('Who can open it', 'Ai mở được') + '</dt><dd>' + L('The owner and the admin only.', 'Chỉ chủ kho và admin.') + '</dd></dl>' +
      '<div class="row" style="margin-top:14px"><button data-act="openFolder" data-rel="">' + ic('folder', 'icon-sm') + ' ' + L('Open folder in Explorer', 'Mở thư mục trong Explorer') + '</button>' +
      '<button data-act="archive">' + (S.v.archived ? L('Restore this vault', 'Khôi phục kho này') : L('Archive this vault', 'Lưu trữ kho này')) + '</button></div>' +
      '<p class="note">' + L('Archiving hides the vault from the vault list. Nothing is deleted, and it can be restored at any time.', 'Lưu trữ sẽ ẩn kho khỏi danh sách. Không có gì bị xóa và có thể khôi phục bất cứ lúc nào.') + '</p></div></div>';
  }
  out += '<div class="dirty-bar' + (S.dirty ? '' : ' hide') + '" role="status"><b>' + L('Setup changed, not saved yet.', 'Thiết lập đã thay đổi, chưa lưu.') + '</b>' + (S.cfgErr ? '<span style="color:var(--bad)">' + h(S.cfgErr) + '</span>' : '') +
    '<span class="sp"><button data-act="discard">' + L('Discard changes', 'Bỏ thay đổi') + '</button><button class="primary" data-act="saveSetup" ' + (S.busy ? 'disabled' : '') + '>' + L('Save setup', 'Lưu thiết lập') + '</button></span></div>';
  return out;
}

/* ---- modals ---------------------------------------------------------------- */
function viewModal() {
  const m = S.modal; if (!m) return '';
  let inner = '';
  if (m.type === 'import') {
    const c = m.cfg;
    inner = '<h2>' + L('Import this template?', 'Nhập mẫu này?') + '</h2><p class="note">' + h(m.file) + '</p><div class="tbl-wrap" style="margin-top:10px"><table><tbody>' +
      '<tr><td>' + L('Project fields', 'Trường dự án') + '</td><td><b>' + c.fields.length + '</b> · ' + c.fields.map(f => h(f.label)).join(', ') + '</td></tr>' +
      '<tr><td>' + L('Processes', 'Quy trình') + '</td><td><b>' + c.processes.length + '</b> · ' + c.processes.map(p => h(p.name) + ' (' + p.steps.length + ')').join(', ') + '</td></tr>' +
      '<tr><td>' + L('Document types', 'Loại tài liệu') + '</td><td><b>' + c.doctypes.length + '</b> · ' + c.doctypes.map(d => h(d.code)).join(', ') + '</td></tr>' +
      '<tr><td>' + L('Folder structure', 'Cấu trúc thư mục') + '</td><td><code>' + h(c.folder.join('\\')) + '</code></td></tr></tbody></table></div>' +
      (c.warn.length ? '<div class="banner warn" style="margin-top:12px"><b>' + L('Check these', 'Cần kiểm tra') + ':</b><ul style="margin:4px 0 0;padding-left:18px">' + c.warn.map(w => '<li>' + h(w) + '</li>').join('') + '</ul></div>' : '<div class="banner good" style="margin-top:12px">' + L('No problems found.', 'Không thấy lỗi.') + '</div>') +
      (m.err ? '<div class="err-line" role="alert">' + ic('alert', 'icon-sm') + '<span>' + h(m.err) + '</span></div>' : '') +
      '<div class="acts"><button data-act="closeModal">' + L('Cancel', 'Hủy') + '</button><button class="primary" data-act="applyImport" ' + (c.fields.length && c.processes.length && !S.busy ? '' : 'disabled') + '>' + L('Replace this vault\'s setup', 'Thay thiết lập của kho') + '</button></div>';
  } else if (m.type === 'confirm') {
    inner = '<h2>' + h(m.title) + '</h2><p>' + h(m.text) + '</p><div class="acts"><button data-act="closeModal" autofocus>' + L('Cancel', 'Hủy') + '</button><button class="danger" data-act="confirmYes">' + h(m.yes) + '</button></div>';
  }
  return '<div class="modal-scrim" data-act="scrim"><div class="modal" role="dialog" aria-modal="true">' + inner + '</div></div>';
}

/* A redraw replaces every control, so the one that had the keyboard focus is
   found again afterwards by what it is bound to, not by identity. */
function focusKey(el) {
  if (!el || el === document.body || !el.dataset) return '';
  const d = el.dataset;
  if (el.id) return '#' + el.id;
  if (d.path) return 'p:' + d.path;
  if (d.chg) return 'c:' + [d.chg, d.id, d.s, d.k, d.i, d.c].join('|');
  if (d.act) return 'a:' + [d.act, d.id, d.v, d.t, d.i, d.arr, d.d, d.s, d.c, d.rel].join('|');
  return '';
}
function render() {
  const hadFocus = focusKey(document.activeElement);
  renderNow();
  if (hadFocus && !ROOT.querySelector('.modal [autofocus]')) {
    const again = [...ROOT.querySelectorAll('input,select,button,textarea,[tabindex]')].find(e => focusKey(e) === hadFocus);
    if (again) again.focus({ preventScroll: true });
  }
}
function renderNow() {
  if (S.fatal) { ROOT.innerHTML = '<div class="login-main" style="min-height:100vh"><div class="login-card"><h2>' + L('This vault cannot be opened', 'Không mở được kho này') + '</h2><p class="note" style="font-size:13px">' + h(S.fatal) + '</p><div class="acts"><a href="/login.html"><button type="button" class="primary">' + L('Back to the vault list', 'Về danh sách kho') + '</button></a></div></div></div>'; return; }
  if (S.loading) { ROOT.innerHTML = '<div class="login-main" style="min-height:100vh"><div class="login-card"><p class="note">' + L('Loading…', 'Đang tải…') + '</p></div></div>'; return; }
  const body = S.view === 'projects' ? viewProjects() : S.view === 'timeline' ? viewTimeline() : viewSetup();
  ROOT.innerHTML = shell(body) + viewModal();
  document.title = S.v.name + ' — ' + L('Personal vault', 'Kho cá nhân');
  const af = ROOT.querySelector('.modal [autofocus]'); if (af) af.focus();
  S.flash = '';
}

/* ---- actions --------------------------------------------------------------- */
const vurl = verb => '/api/vaults/' + encodeURIComponent(VID) + (verb ? '/' + verb : '');
function moveIn(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
const getPath = (o, path) => path.split('.').reduce((a, k) => a[k], o);
function setPath(o, path, v) { const ks = path.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }
/* Marks the setup as changed. The save bar is always in the page and only
   un-hidden here, so the first edit does not need a redraw (which would take
   the caret away from whatever the person tabbed to next). */
const touch = () => { S.dirty = true; S.cfgErr = ''; const bar = ROOT.querySelector('.dirty-bar'); if (bar) bar.classList.remove('hide'); };
function newDraft() {
  const proc = S.v.processes[0], start = iso(today());
  let acc = 0;
  return { values: {}, processId: proc.id, start, dues: proc.steps.map(s => { acc += +s.days || 0; return addDays(start, acc); }), err: '' };
}
function recalcDraft() {
  const d = S.draft, proc = S.v.processes.find(p => p.id === d.processId);
  let acc = 0;
  d.dues = proc.steps.map(s => { acc += +s.days || 0; return addDays(d.start, acc); });
}
/* An imported setup keeps the key of every field whose label is unchanged and
   the id of every process whose name is unchanged, so projects already
   registered keep their values and stay attached to their process. */
function mergeKeys(into, from) {
  from.fields.forEach(f => { const old = into.fields.find(o => o.label.toLowerCase() === f.label.toLowerCase()); if (old) f.key = old.key; });
  from.processes.forEach(p => { const old = into.processes.find(o => o.name.toLowerCase() === p.name.toLowerCase()); if (old) p.id = old.id; });
  return { fields: from.fields, processes: from.processes, doctypes: from.doctypes, folder: from.folder.length ? from.folder : ['[Project ID]'] };
}
async function saveSetup() {
  S.busy = true; render();
  try {
    const r = await api.post(vurl('config'), S.cfg);
    S.v = r.vault; S.cfg = setupOf(S.v); S.dirty = false; S.cfgErr = '';
    S.flash = L('Setup saved.', 'Đã lưu thiết lập.');
    return true;
  } catch (e) { S.cfgErr = e.message; return false; }
  finally { S.busy = false; render(); }
}
async function projectUpdate(body, okMsg) {
  try { const r = await api.post(vurl('project-update'), body); S.projects = r.projects; if (okMsg) toast(okMsg); }
  catch (e) { toast(e.message, true); }
  render();
}
const stepsPayload = (p, si, patch) => p.steps.map((s, i) => Object.assign({ due: s.due, status: s.status }, i === si ? patch : {}));

const ACT = {
  lang() { setLang(getLang() === 'vi' ? 'en' : 'vi'); render(); },
  theme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); render(); },
  menu() { S.menu = !S.menu; render(); },
  account() { S.menu = false; render(); openChangePassword(); },
  switchVault() { location.href = '/login.html'; },
  async signout() { try { await api.post('/api/auth/logout'); } catch (e) { } S.dirty = false; location.href = '/login.html'; },
  nav(b) { S.view = b.dataset.v; S.menu = false; S.draft = null; render(); window.scrollTo(0, 0); },
  closeModal() { S.modal = null; render(); },
  scrim(b, e) { if (e.target === b) { S.modal = null; render(); } },
  confirmYes() { const fn = S.modal.onYes; S.modal = null; fn(); },
  regOpen() { S.draft = newDraft(); render(); },
  regCancel() { S.draft = null; render(); },
  expand(b) { S.expanded = S.expanded === b.dataset.id ? null : b.dataset.id; render(); },
  editOpen(b) { const p = S.projects.find(x => x.id === b.dataset.id); S.edit[p.id] = Object.assign({}, p.values); render(); },
  editCancel(b) { delete S.edit[b.dataset.id]; render(); },
  delProject(b) {
    const id = b.dataset.id;
    S.modal = { type: 'confirm', title: L('Delete project ', 'Xóa dự án ') + id + '?', yes: L('Delete project', 'Xóa dự án'),
      text: L('The project leaves the register. Files already filed for it stay in the vault folder.', 'Dự án bị gỡ khỏi sổ đăng ký. Tệp đã lưu của dự án vẫn nằm trong thư mục kho.'),
      onYes: async () => { try { const r = await api.post(vurl('project-delete'), { project_id: id }); S.projects = r.projects; S.expanded = null; S.flash = id + ' ' + L('deleted.', 'đã xóa.'); } catch (e) { toast(e.message, true); } render(); } };
    render();
  },
  async unfile(b) {
    try { const r = await api.post(vurl('unfile'), { project_id: b.dataset.id, step_index: +b.dataset.s, code: b.dataset.c, rel_path: b.dataset.rel }); S.projects = r.projects; toast(L('Taken off the list. The file is still in the folder.', 'Đã gỡ khỏi danh sách. Tệp vẫn nằm trong thư mục.')); }
    catch (e) { toast(e.message, true); }
    render();
  },
  async openFolder(b) { try { await api.post(vurl('open'), { path: b.dataset.rel || '' }); } catch (e) { toast(e.message, true); } },
  setupTab(b) { S.setupTab = b.dataset.t; render(); },
  mv(b) { moveIn(getPath(S.cfg, b.dataset.arr), +b.dataset.i, +b.dataset.d); touch(); render(); },
  rm(b) { getPath(S.cfg, b.dataset.arr).splice(+b.dataset.i, 1); if (b.dataset.arr === 'processes') S.procSel = 0; touch(); render(); },
  addField() { S.cfg.fields.push({ key: 'f_' + uid(), label: L('New field', 'Trường mới') + ' ' + (S.cfg.fields.length + 1), type: 'text', options: [], required: false, inList: false }); touch(); render(); },
  procSel(b) { S.procSel = +b.dataset.i; render(); },
  addProc() { S.cfg.processes.push({ id: 'p_' + uid(), name: L('New process', 'Quy trình mới') + ' ' + (S.cfg.processes.length + 1), desc: '', steps: [{ name: L('Step 1', 'Bước 1'), days: 7, docs: [] }] }); S.procSel = S.cfg.processes.length - 1; touch(); render(); },
  addStep() { const p = S.cfg.processes[S.procSel]; p.steps.push({ name: L('Step ', 'Bước ') + (p.steps.length + 1), days: 7, docs: [] }); touch(); render(); },
  togDoc(b) { const s = S.cfg.processes[S.procSel].steps[+b.dataset.s], c = b.dataset.c, i = s.docs.indexOf(c); if (i < 0) s.docs.push(c); else s.docs.splice(i, 1); touch(); render(); },
  addDoc() { let n = S.cfg.doctypes.length + 1; while (S.cfg.doctypes.some(d => d.code === 'DOC' + n)) n++; S.cfg.doctypes.push({ code: 'DOC' + n, name: '', hint: '' }); touch(); render(); },
  addLevel() { S.cfg.folder.push('[DocType]'); S.lastLevel = S.cfg.folder.length - 1; touch(); render(); },
  tok(b) { const f = S.cfg.folder; if (!f.length) f.push(''); const i = S.lastLevel != null && S.lastLevel < f.length ? S.lastLevel : f.length - 1; f[i] = (f[i] + ' [' + b.dataset.t + ']').trim(); touch(); render(); },
  discard() { S.cfg = setupOf(S.v); S.dirty = false; S.cfgErr = ''; S.procSel = 0; render(); },
  saveSetup() { saveSetup(); },
  xlsxOut() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(buildWorkbook(Object.assign({ name: S.v.name }, S.cfg)));
    a.download = 'Vault_template_' + S.v.name.replace(/[^\p{L}\p{N}]+/gu, '_') + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  async applyImport() {
    const m = S.modal;
    S.cfg = mergeKeys(S.cfg, m.cfg); S.dirty = true; S.procSel = 0;
    const ok = await saveSetup();
    if (ok) { S.modal = null; S.setupTab = 'fields'; S.flash = L('Vault setup replaced from the Excel template.', 'Đã thay thiết lập kho từ mẫu Excel.'); }
    else { m.err = S.cfgErr; S.cfg = setupOf(S.v); S.dirty = false; }
    render();
  },
  async archive() {
    try { const r = await api.post(vurl('archive'), { archived: !S.v.archived }); S.v.archived = r.archived; S.flash = r.archived ? L('Vault archived.', 'Đã lưu trữ kho.') : L('Vault restored.', 'Đã khôi phục kho.'); }
    catch (e) { toast(e.message, true); }
    render();
  }
};
const SUBMIT = {
  async regSave() {
    const d = S.draft;
    const miss = S.v.fields.filter(f => f.required && !String(d.values[f.key] || '').trim());
    if (miss.length) { d.err = L('Fill in: ', 'Hãy điền: ') + miss.map(f => f.label).join(', '); return render(); }
    S.busy = true;
    try {
      const r = await api.post(vurl('projects'), { process_id: d.processId, start: d.start, dues: d.dues, values: d.values });
      S.projects = r.projects; S.draft = null; S.expanded = r.project_id; S.flash = r.project_id + ' ' + L('registered.', 'đã được đăng ký.');
    } catch (e) { d.err = e.message; }
    S.busy = false; render();
  },
  async saveDetails(f) {
    const id = f.dataset.id;
    try { const r = await api.post(vurl('project-update'), { project_id: id, values: S.edit[id] }); S.projects = r.projects; delete S.edit[id]; toast(L('Details saved.', 'Đã lưu thông tin.')); }
    catch (e) { toast(e.message, true); }
    render();
  }
};
const CHG = {
  draftVal(t) { S.draft.values[t.dataset.k] = t.value; },
  draftProc(t) { S.draft.processId = t.value; recalcDraft(); render(); },
  draftStart(t) { if (t.value) { S.draft.start = t.value; recalcDraft(); render(); } },
  draftDue(t) { if (t.value) S.draft.dues[+t.dataset.i] = t.value; },
  editVal(t) { S.edit[t.dataset.id][t.dataset.k] = t.value; },
  stepDue(t) { if (!t.value) return render(); const p = S.projects.find(x => x.id === t.dataset.id); projectUpdate({ project_id: p.id, steps: stepsPayload(p, +t.dataset.s, { due: t.value }) }); },
  stepStatus(t) { const p = S.projects.find(x => x.id === t.dataset.id); projectUpdate({ project_id: p.id, steps: stepsPayload(p, +t.dataset.s, { status: t.value }) }); },
  async upload(t) {
    const files = [...t.files]; if (!files.length) return;
    let ok = 0; const failed = [];
    ROOT.classList.add('busy');
    for (const f of files) {
      try {
        if (f.size > 25 * 1024 * 1024) throw new Error(L('over the 25 MB limit', 'vượt quá 25 MB'));
        const r = await api.post(vurl('upload'), { project_id: t.dataset.id, step_index: +t.dataset.s, code: t.dataset.c, fileName: f.name, contentBase64: await readFileBase64(f) });
        S.projects = r.projects; ok++;
      } catch (e) { failed.push(f.name + ': ' + e.message); }
    }
    ROOT.classList.remove('busy');
    if (failed.length) toast(L('Not filed: ', 'Chưa lưu được: ') + failed.join('; '), true);
    else toast(ok + ' ' + L('file(s) filed.', 'tệp đã lưu.'));
    render();
  },
  fOpts(t) { S.cfg.fields[+t.dataset.i].options = t.value.split(';').map(s => s.trim()).filter(Boolean); touch(); },
  dCode(t) {
    const d = S.cfg.doctypes[+t.dataset.i], old = d.code, nw = t.value.trim().toUpperCase().replace(/\s+/g, '-') || old;
    S.cfg.processes.forEach(p => p.steps.forEach(s => { s.docs = s.docs.map(c => c === old ? nw : c); }));
    d.code = nw; t.value = nw; touch();
  },
  async xlsxIn(t) {
    const f = t.files[0]; if (!f) return;
    try { S.modal = { type: 'import', file: f.name, cfg: parseTemplate(readSheets(await unzip(await f.arrayBuffer()))), err: '' }; }
    catch (e) { toast(e.message, true); }
    render();
  }
};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a) { if (S.menu) { S.menu = false; render(); } return; }
  if (a.tagName === 'TR' && e.target.closest('input,select,button,a,label')) return;
  if (ACT[a.dataset.act]) ACT[a.dataset.act](a, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (S.modal || S.menu)) { S.modal = null; S.menu = false; render(); }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-act]')) ACT[e.target.dataset.act](e.target, e);
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('label.chip')) { e.preventDefault(); e.target.querySelector('input').click(); }
});
document.addEventListener('submit', e => { const f = e.target.closest('[data-submit]'); if (f) { e.preventDefault(); if (!S.busy) SUBMIT[f.dataset.submit](f); } });
document.addEventListener('focusin', e => { if (e.target.dataset && e.target.dataset.lvl != null) S.lastLevel = +e.target.dataset.lvl; });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.path) {
    // Renaming a field renames its [token] in the folder levels with it;
    // otherwise the levels would point at a field that no longer exists and
    // the setup could not be saved until each one was retyped by hand.
    if (/^fields\.\d+\.label$/.test(t.dataset.path)) {
      const old = String(getPath(S.cfg, t.dataset.path) || '').trim().toLowerCase(), nw = t.value.replace(/[\[\]]/g, '').trim();
      if (old && nw) S.cfg.folder = S.cfg.folder.map(l => l.replace(/\[([^\]]*)\]/g, (m, k) => k.trim().toLowerCase() === old ? '[' + nw + ']' : m));
    }
    setPath(S.cfg, t.dataset.path, t.type === 'checkbox' ? t.checked : (t.dataset.num != null ? Math.max(0, Math.round(+t.value) || 0) : t.value));
    touch();
    // data-patch: a typed box, only its own preview is refreshed (see
    // patchSetup). data-rr: a drop-down that changes what the row shows.
    if (t.dataset.patch != null) patchSetup();
    else if (t.dataset.rr != null) render();
    return;
  }
  if (t.dataset.chg && CHG[t.dataset.chg]) CHG[t.dataset.chg](t, e);
});
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

(async function boot() {
  render();
  try {
    const st = await api.get('/api/auth/status');
    if (!st.authenticated || st.must_change) { location.href = '/login.html'; return; }
    S.me = st;
    const d = await api.get(vurl(''));
    S.v = d.vault; S.projects = d.projects || []; S.path = d.path || ''; S.cfg = setupOf(S.v);
    if (new URLSearchParams(location.search).get('new')) {
      S.view = 'setup';
      S.flash = L('Vault created. Check the setup, then register your first project.', 'Đã tạo kho. Kiểm tra thiết lập rồi đăng ký dự án đầu tiên.');
      history.replaceState(null, '', '/vault.html?id=' + encodeURIComponent(VID));
    }
  } catch (e) { S.fatal = e.message; }
  S.loading = false;
  render();
})();
