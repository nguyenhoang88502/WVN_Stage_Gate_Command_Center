'use strict';
/* ===========================================================================
   login.js - sign in, replace a temporary password, choose a vault.

   Three screens on one page, in this order:
     login   user name + password
     setpw   only after signing in with a temporary password
     choose  which vault to work in (the common vault is preselected), and
             where a new personal vault is created
   A browser that already has a session lands straight on "choose", which is
   also what "Switch vault" in either app links to.
   ======================================================================== */
const ROOT = byId('root');
const REMEMBER_KEY = 'wvn_last_user';
const S = {
  screen: 'loading', app: { name: '', version: '' }, me: null,
  loginUser: '', loginErr: '', tempPw: '',
  vaults: [], personalRoot: '', pick: 'common', modal: null, busy: false
};
try { S.loginUser = localStorage.getItem(REMEMBER_KEY) || ''; } catch (e) { }

function frame(inner) {
  return '<div class="login">' +
    '<section class="login-brand">' +
      '<div class="lb-top">' + ic('factory') + '<div><b>WAHL Vietnam</b><span>NPI &amp; ECN Command Center</span></div></div>' +
      '<div class="lb-mid"><h1>' + L('Stage Gate Command Center', 'Trung tâm điều hành Stage Gate') + '</h1>' +
        '<p>' + L('Sign in with your own account. Your name on every upload, sign-off and audit line comes from this login.',
                  'Đăng nhập bằng tài khoản riêng. Tên bạn trên mọi lần tải lên, phê duyệt và nhật ký lấy từ lần đăng nhập này.') + '</p></div>' +
      '<div class="lb-foot">' + h(S.app.name) + (S.app.version ? ' · v' + h(S.app.version) : '') + '</div>' +
    '</section>' +
    '<section class="login-main"><div class="login-tools">' + toolsHtml() + '</div>' + inner + '</section></div>';
}
const errLine = m => m ? '<div class="err-line" role="alert">' + ic('alert', 'icon-sm') + '<span>' + h(m) + '</span></div>' : '';

function viewLogin() {
  return frame('<form class="login-card" data-submit="login" autocomplete="off">' +
    '<h2>' + L('Sign in', 'Đăng nhập') + '</h2>' +
    '<p class="note">' + L('Use the user name and password the admin gave you.', 'Dùng tên đăng nhập và mật khẩu quản trị viên đã cấp.') + '</p>' +
    '<label class="fld"><span>' + L('User name', 'Tên đăng nhập') + '</span><input id="lgUser" value="' + h(S.loginUser) + '" ' + (S.loginUser ? '' : 'autofocus') + ' autocomplete="username" autocapitalize="none" spellcheck="false"></label>' +
    '<label class="fld"><span>' + L('Password', 'Mật khẩu') + '</span>' +
      '<div class="pw-wrap"><input id="lgPw" type="password" ' + (S.loginUser ? 'autofocus' : '') + ' autocomplete="current-password">' +
      '<button type="button" data-act="peek" data-for="lgPw" title="' + L('Show password', 'Hiện mật khẩu') + '">' + ic('eye') + '</button></div></label>' +
    errLine(S.loginErr) +
    '<button class="primary big" ' + (S.busy ? 'disabled' : '') + '>' + ic('lock', 'icon-sm') + ' ' + L('Sign in', 'Đăng nhập') + '</button>' +
    '<p class="note" style="margin-top:12px">' + L('Forgot your password? Ask the admin to reset it. Five wrong tries lock the account for 5 minutes.',
                                                     'Quên mật khẩu? Nhờ quản trị viên đặt lại. Sai 5 lần sẽ khóa tài khoản 5 phút.') + '</p>' +
    '</form>');
}
function viewSetPw() {
  return frame('<form class="login-card" data-submit="setpw" autocomplete="off">' +
    '<h2>' + L('Choose your own password', 'Đặt mật khẩu của bạn') + '</h2>' +
    '<p class="note">' + L('You signed in with a temporary password. Set your own before you continue.',
                           'Bạn vừa đăng nhập bằng mật khẩu tạm. Hãy đặt mật khẩu riêng trước khi tiếp tục.') + '</p>' +
    '<label class="fld"><span>' + L('New password (at least 8 characters)', 'Mật khẩu mới (ít nhất 8 ký tự)') + '</span><input id="np1" type="password" autofocus autocomplete="new-password"></label>' +
    '<label class="fld"><span>' + L('Type it again', 'Nhập lại') + '</span><input id="np2" type="password" autocomplete="new-password"></label>' +
    errLine(S.loginErr) +
    '<button class="primary big" ' + (S.busy ? 'disabled' : '') + '>' + L('Save and continue', 'Lưu và tiếp tục') + '</button>' +
    '<div class="acts"><button type="button" class="ghost" data-act="signout">' + L('Sign out', 'Đăng xuất') + '</button></div>' +
    '</form>');
}
function vaultOptions() {
  const list = S.vaults.filter(v => !v.archived);
  return list.map(v => {
    const common = v.kind === 'common', on = S.pick === v.id;
    return '<button type="button" class="vault-opt ' + (on ? 'on' : '') + '" data-act="pick" data-id="' + h(v.id) + '" aria-pressed="' + on + '">' +
      '<span class="vo-ic">' + ic(common ? 'factory' : 'folders') + '</span>' +
      '<span><b>' + h(v.name) + '</b><small>' + (common
        ? L('Common vault · NPI and ECN projects, shared by everyone', 'Kho chung · dự án NPI và ECN, dùng chung cho mọi người')
        : L('Personal vault', 'Kho cá nhân') + ' · ' + h(v.owner) + ' · ' + v.projects + ' ' + L(v.projects === 1 ? 'project' : 'projects', 'dự án')) + '</small></span>' +
      '<span class="vo-end">' + (common ? '<span class="badge b-blue">' + L('Default', 'Mặc định') + '</span>'
        : (v.mine ? '' : '<span class="badge b-grey">' + L('admin access', 'quyền admin') + '</span>')) + '</span></button>';
  }).join('') +
    '<button type="button" class="vault-opt new" data-act="newVault"><span class="vo-ic">' + ic('plus') + '</span><span><b>' + L('New personal vault', 'Tạo kho cá nhân mới') + '</b>' +
    '<small>' + L('Your own fields, steps, deadlines and folders', 'Trường thông tin, bước, hạn và thư mục của riêng bạn') + '</small></span></button>';
}
function viewChoose() {
  const archived = S.vaults.filter(v => v.archived).length;
  return frame('<form class="login-card wide" data-submit="enter">' +
    '<h2>' + L('Welcome, ', 'Xin chào, ') + h(S.me.user) + '</h2>' +
    '<p class="note">' + L('Which vault do you want to work in? You can switch later from the side bar.', 'Bạn muốn làm việc ở kho nào? Có thể đổi sau ở thanh bên.') + '</p>' +
    '<div style="margin-top:12px">' + vaultOptions() + '</div>' +
    (archived ? '<p class="note">' + archived + ' ' + L('archived vault(s) are hidden. The admin restores them in Settings.', 'kho đã lưu trữ đang ẩn. Admin khôi phục trong Cài đặt.') + '</p>' : '') +
    '<div class="acts"><button type="button" class="ghost" data-act="signout">' + L('Sign out', 'Đăng xuất') + '</button>' +
    '<button class="primary" autofocus>' + L('Open vault', 'Mở kho') + '</button></div></form>');
}
function viewModal() {
  const m = S.modal; if (!m) return '';
  const nm = m.name || '';
  const opts = [
    ['blank', L('Blank', 'Trống'), L('One field, one step. Build the rest yourself.', 'Một trường, một bước. Tự dựng phần còn lại.')],
    ['kaizen', L('Example: Kaizen and 5S', 'Ví dụ: Kaizen và 5S'), L('PDCA and 5S audit processes, 5 fields, 5 document types.', 'Quy trình PDCA và đánh giá 5S, 5 trường, 5 loại tài liệu.')],
    ['audit', L('Example: Supplier audit', 'Ví dụ: Đánh giá nhà cung cấp'), L('Prepare, on-site, report, follow-up.', 'Chuẩn bị, tại chỗ, báo cáo, theo dõi.')],
    ['excel', L('A filled Excel template', 'Mẫu Excel đã điền'), L('Import fields, processes, steps, document types and folders from a workbook.', 'Nhập trường, quy trình, bước, loại tài liệu và thư mục từ tệp Excel.')]
  ];
  return '<div class="modal-scrim" data-act="scrim"><form class="modal" role="dialog" aria-modal="true" aria-labelledby="nvTitle" data-submit="createVault">' +
    '<h2 id="nvTitle">' + L('New personal vault', 'Tạo kho cá nhân mới') + '</h2>' +
    '<p class="note">' + L('A personal vault has its own project register, steps, deadlines and folders. It is separate from the common vault, and only you and the admin can open it.',
                           'Kho cá nhân có sổ đăng ký dự án, bước, hạn và thư mục riêng. Tách biệt với kho chung, chỉ bạn và admin mở được.') + '</p>' +
    '<label class="fld"><span>' + L('Vault name', 'Tên kho') + '</span><input id="nvName" value="' + h(nm) + '" autofocus maxlength="60"></label>' +
    '<label class="fld"><span>' + L('Folder', 'Thư mục') + '</span><input id="nvPath" disabled value="' + h(S.personalRoot + '\\' + S.me.user + '\\' + (nm || '…')) + '"></label>' +
    '<p class="note">' + L('Kept inside the shared site folder so it syncs to your other PCs, like the common vault.', 'Nằm trong thư mục site dùng chung để đồng bộ sang các máy khác của bạn, giống kho chung.') + '</p>' +
    '<div class="fld"><span>' + L('Start from', 'Bắt đầu từ') + '</span>' +
      opts.map(o => '<label class="vault-opt ' + (m.tpl === o[0] ? 'on' : '') + '" style="cursor:pointer"><input type="radio" name="tpl" value="' + o[0] + '" ' + (m.tpl === o[0] ? 'checked' : '') + '><span><b>' + o[1] + '</b><small>' + o[2] + '</small></span></label>').join('') +
      '<input type="file" accept=".xlsx" id="nvFile" class="' + (m.tpl === 'excel' ? '' : 'hide') + '" style="margin-top:8px" aria-label="' + L('Filled template file', 'Tệp mẫu đã điền') + '">' +
      '<p class="note ' + (m.tpl === 'excel' ? '' : 'hide') + '" id="nvHint">' + L('No template yet? Create a blank vault first, then download the template from Vault setup.', 'Chưa có mẫu? Hãy tạo kho trống trước rồi tải mẫu ở Thiết lập kho.') + '</p></div>' +
    errLine(m.err) +
    '<div class="acts"><button type="button" data-act="closeModal">' + L('Cancel', 'Hủy') + '</button><button class="primary" ' + (S.busy ? 'disabled' : '') + '>' + L('Create vault', 'Tạo kho') + '</button></div></form></div>';
}

function render() {
  const main = S.screen === 'login' ? viewLogin() : S.screen === 'setpw' ? viewSetPw() : S.screen === 'choose' ? viewChoose()
    : frame('<div class="login-card"><p class="note">' + L('Loading…', 'Đang tải…') + '</p></div>');
  ROOT.innerHTML = main + viewModal();
  const scope = S.modal ? ROOT.querySelector('.modal') : ROOT;
  const af = scope && scope.querySelector('[autofocus]');
  if (af) af.focus();
}

async function loadVaults() {
  const d = await api.get('/api/vaults');
  S.vaults = d.vaults || []; S.personalRoot = d.personal_root || '';
  if (!S.vaults.some(v => v.id === S.pick && !v.archived)) S.pick = 'common';
}
async function goChoose() { await loadVaults(); S.screen = 'choose'; S.loginErr = ''; render(); }
function openVault(id) { location.href = id === 'common' ? '/' : '/vault.html?id=' + encodeURIComponent(id); }

const ACT = {
  lang() { setLang(getLang() === 'vi' ? 'en' : 'vi'); keepTyped(); render(); },
  theme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); keepTyped(); render(); },
  peek(b) { const i = byId(b.dataset.for); i.type = i.type === 'password' ? 'text' : 'password'; i.focus(); },
  pick(b) { S.pick = b.dataset.id; render(); },
  newVault() { S.modal = { tpl: 'blank', name: '', err: '' }; render(); },
  closeModal() { S.modal = null; render(); },
  scrim(b, e) { if (e.target === b) { S.modal = null; render(); } },
  async signout() { try { await api.post('/api/auth/logout'); } catch (e) { } S.me = null; S.tempPw = ''; S.screen = 'login'; S.loginErr = ''; S.modal = null; render(); }
};
/* A language or theme switch redraws the form, so whatever is already typed in
   the user-name / vault-name box is carried across instead of being wiped. */
function keepTyped() {
  if (byId('lgUser')) S.loginUser = val('lgUser');
  if (S.modal && byId('nvName')) S.modal.name = val('nvName');
}

const SUBMIT = {
  async login() {
    const name = val('lgUser').trim(), pw = val('lgPw');
    S.loginUser = name;
    if (!name || !pw) { S.loginErr = L('Type your user name and password.', 'Hãy nhập tên đăng nhập và mật khẩu.'); return render(); }
    S.busy = true;
    try {
      const me = await api.post('/api/auth/login', { username: name, password: pw });
      S.me = me; S.loginErr = '';
      try { localStorage.setItem(REMEMBER_KEY, me.user); } catch (e) { }
      if (me.must_change) { S.tempPw = pw; S.screen = 'setpw'; S.busy = false; return render(); }
      S.busy = false;
      await goChoose();
    } catch (e) {
      S.busy = false;
      const d = e.data || {};
      S.loginErr = d.no_password ? L('No password has been issued for this account yet. Ask the admin for a temporary password.', 'Tài khoản này chưa được cấp mật khẩu. Hãy nhờ admin cấp mật khẩu tạm.')
        : d.locked ? L('Too many wrong tries. This account is locked for 5 minutes.', 'Sai quá nhiều lần. Tài khoản bị khóa 5 phút.')
        : e.status === 401 ? L('Wrong user name or password.', 'Sai tên đăng nhập hoặc mật khẩu.') + (d.tries_left ? ' (' + L('tries left: ', 'còn ') + d.tries_left + (getLang() === 'vi' ? ' lần)' : ')') : '')
        : e.message;
      render();
    }
  },
  async setpw() {
    const a = val('np1'), b = val('np2');
    if (a.length < 8) { S.loginErr = L('Use at least 8 characters.', 'Dùng ít nhất 8 ký tự.'); return render(); }
    if (a !== b) { S.loginErr = L('The two passwords are different.', 'Hai mật khẩu không giống nhau.'); return render(); }
    S.busy = true;
    try {
      await api.post('/api/auth/change-password', { current: S.tempPw, new: a });
      S.tempPw = ''; S.me.must_change = false; S.busy = false;
      await goChoose();
    } catch (e) { S.busy = false; S.loginErr = e.message; render(); }
  },
  enter() { openVault(S.pick); },
  async createVault() {
    const m = S.modal;
    m.name = val('nvName').trim();
    m.err = '';
    if (!m.name) { m.err = L('Give the vault a name.', 'Hãy đặt tên cho kho.'); return render(); }
    let cfg;
    try {
      if (m.tpl === 'excel') {
        const f = byId('nvFile').files[0];
        if (!f) { m.err = L('Choose the filled .xlsx file.', 'Hãy chọn tệp .xlsx đã điền.'); return render(); }
        cfg = parseTemplate(readSheets(await unzip(await f.arrayBuffer())));
        if (!cfg.fields.length || !cfg.processes.length) { m.err = L('The workbook needs at least one field and one process.', 'Tệp cần ít nhất một trường và một quy trình.'); return render(); }
      } else cfg = TEMPLATES[m.tpl]();
      S.busy = true;
      const r = await api.post('/api/vaults', { name: m.name, config: { fields: cfg.fields, processes: cfg.processes, doctypes: cfg.doctypes, folder: cfg.folder } });
      location.href = '/vault.html?id=' + encodeURIComponent(r.vault.id) + '&new=1';
    } catch (e) { S.busy = false; m.err = e.message; render(); }
  }
};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (a && ACT[a.dataset.act]) ACT[a.dataset.act](a, e);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.modal) { S.modal = null; render(); } });
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-submit]');
  if (f) { e.preventDefault(); if (!S.busy) SUBMIT[f.dataset.submit](f); }
});
document.addEventListener('input', e => {
  // Live folder preview while the vault name is typed - without redrawing the
  // form, which would move the caret.
  if (e.target.id === 'nvName' && S.modal) { S.modal.name = e.target.value; const p = byId('nvPath'); if (p) p.value = S.personalRoot + '\\' + S.me.user + '\\' + (e.target.value.trim() || '…'); }
});
document.addEventListener('change', e => {
  if (e.target.name === 'tpl' && S.modal) { S.modal.tpl = e.target.value; S.modal.name = val('nvName'); render(); }
});

(async function boot() {
  render();
  try {
    const st = await api.get('/api/auth/status');
    S.app = st.app || S.app;
    if (st.authenticated && !st.must_change) { S.me = st; await goChoose(); return; }
    // A half-finished first sign-in (temporary password accepted, new one not
    // set yet) cannot be resumed: the temporary password is not kept anywhere,
    // so the person simply signs in again.
    if (st.authenticated) { try { await api.post('/api/auth/logout'); } catch (e) { } }
    S.screen = 'login';
  } catch (e) {
    S.screen = 'login';
    S.loginErr = L('Could not reach the local server. Make sure Open_WVN_NPI_Command_Center.cmd is running, then reload this page.',
                   'Không kết nối được máy chủ cục bộ. Hãy chạy Open_WVN_NPI_Command_Center.cmd rồi tải lại trang.');
  }
  render();
})();
