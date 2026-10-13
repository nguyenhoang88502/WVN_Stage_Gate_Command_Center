// Sign-in helper for the node test suites (v12).
//
// Since v12 every /api/* call needs a session, and the server takes the
// acting user from that session - not from the `user` a request body claims.
// The suites written before v12 pass `user: 'admin'` / `user: 'intern'` in the
// body to say who is acting; clients() keeps them working by signing both of
// those accounts in and sending each request with the cookie of the user its
// body names (admin when it names nobody).
//
// Only ever used against an ISOLATED copy: it replaces the first-run admin
// password (the old PIN from that copy's config.json) with a fixed test one.
const fs = require('fs');
const path = require('path');

const TEST_PW = { admin: 'Test-admin-2026', other: 'Test-user-2026' };

function readPin(root) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'app', 'system', 'config.json'), 'utf8').replace(/^﻿/, ''));
  return cfg.admin_pin || '';
}
async function call(base, cookie, method, p, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  let json = null;
  try { json = await r.json(); } catch (e) { }
  return { status: r.status, json, cookie: sc ? sc.split(';')[0] : '' };
}
async function waitUp(base) {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(base + '/api/auth/status'); if (r.ok) return; } catch (e) { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}
// Signs `username` in with `password`; if the server says the password is
// temporary, replaces it with `newPassword`. Returns the session cookie.
async function signIn(base, username, password, newPassword) {
  const r = await call(base, '', 'POST', '/api/auth/login', { username, password });
  if (r.status !== 200) throw new Error('sign-in as ' + username + ' failed: ' + r.status + ' ' + JSON.stringify(r.json));
  if (r.json.must_change) {
    const c = await call(base, r.cookie, 'POST', '/api/auth/change-password', { current: password, new: newPassword });
    if (c.status !== 200) throw new Error('could not set the password of ' + username + ': ' + JSON.stringify(c.json));
  }
  return r.cookie;
}
// The admin session of a copy: first run uses the copy's old PIN, later runs
// (the same copy started again) use the test password it was replaced with.
async function adminCookie(base, root) {
  const pin = readPin(root);
  if (pin) { try { return await signIn(base, 'admin', pin, TEST_PW.admin); } catch (e) { } }
  return signIn(base, 'admin', TEST_PW.admin, TEST_PW.admin);
}
// A session for any other roster user: the admin issues a temporary password,
// the user replaces it.
async function userCookie(base, admin, username) {
  const r = await call(base, admin, 'POST', '/api/auth/reset-password', { username });
  if (r.status !== 200) throw new Error('could not issue a password for ' + username + ': ' + JSON.stringify(r.json));
  return signIn(base, username, r.json.temp_password, TEST_PW.other);
}

async function clients(base, root, others) {
  await waitUp(base);
  const cookies = { admin: await adminCookie(base, root) };
  for (const u of (others || ['intern'])) cookies[u.toLowerCase()] = await userCookie(base, cookies.admin, u);
  const pick = body => cookies[String((body && body.user) || 'admin').toLowerCase()] || cookies.admin;
  return {
    cookies,
    async api(p) { return (await call(base, cookies.admin, 'GET', p)).json; },
    async post(p, body) { const r = await call(base, pick(body), 'POST', p, body); return Object.assign({ _status: r.status }, r.json || {}); },
    async raw(method, p, body, as) { return call(base, cookies[(as || 'admin').toLowerCase()], method, p, body); },
    // Puts a session into a Playwright browser context, so the page opens
    // already signed in (the pre-v12 suites picked a name in the header).
    async signInContext(context, as) {
      const [name, value] = cookies[(as || 'admin').toLowerCase()].split('=');
      await context.addCookies([{ name, value, url: base }]);
    }
  };
}

module.exports = { TEST_PW, readPin, call, waitUp, signIn, adminCookie, userCookie, clients };
