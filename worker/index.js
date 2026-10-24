/**
 * TOEIC BOOST — 帳號 / 進度同步 / 錯題本 / 留言板 / 管理介面 API
 * Cloudflare Worker + D1；靜態檔由 ASSETS 提供。
 */
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/.{2}/g).map((h) => parseInt(h, 16)));

async function sha256(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return hex(d);
}

async function pbkdf2(password, saltHex, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unhex(saltHex), iterations: iter, hash: 'SHA-256' },
    key,
    256
  );
  return hex(bits);
}

async function hashPassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const h = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITER}$${salt}$${h}`;
}

async function verifyPassword(password, stored) {
  const [algo, iter, salt, h] = String(stored).split('$');
  if (algo !== 'pbkdf2' || !salt || !h) return false;
  const calc = await pbkdf2(password, salt, Number(iter) || PBKDF2_ITER);
  if (calc.length !== h.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= calc.charCodeAt(i) ^ h.charCodeAt(i);
  return diff === 0;
}

async function createSession(env, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(24)));
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now + SESSION_DAYS * 86400, now)
    .run();
  return token;
}

async function getUser(req, env) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.username, u.is_admin, u.created_at, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).bind(await sha256(token)).first();
  if (!row) return null;
  if (row.expires < Math.floor(Date.now() / 1000)) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return null;
  }
  return row;
}

const blankProgress = () => ({
  srs: {}, dayDone: {}, curDay: 1, partStats: {}, exams: [], wrong: {}, streak: {},
});

function parseJSON(v, fallback) {
  try { return typeof v === 'string' ? JSON.parse(v) : v ?? fallback; } catch { return fallback; }
}

async function loadProgress(env, userId) {
  const row = await env.DB.prepare('SELECT * FROM progress WHERE user_id = ?').bind(userId).first();
  if (!row) return blankProgress();
  return {
    srs: parseJSON(row.srs, {}),
    dayDone: parseJSON(row.day_done, {}),
    curDay: row.cur_day || 1,
    partStats: parseJSON(row.part_stats, {}),
    exams: parseJSON(row.exams, []),
    wrong: parseJSON(row.wrong, {}),
    streak: parseJSON(row.streak, {}),
  };
}

function mergeProgress(a, b) {
  const out = {
    srs: { ...a.srs }, dayDone: { ...a.dayDone }, curDay: Math.max(a.curDay || 1, b.curDay || 1),
    partStats: { ...a.partStats }, exams: [...(a.exams || [])], wrong: { ...a.wrong }, streak: { ...(a.streak || {}) },
  };
  for (const [w, rec] of Object.entries(b.srs || {})) {
    const cur = out.srs[w];
    if (!cur) { out.srs[w] = rec; continue; }
    const box = Math.max(cur.box || 0, rec.box || 0);
    const due = [cur.due, rec.due].filter(Boolean).sort()[0];
    out.srs[w] = { ...cur, ...rec, box, due, seen: Math.max(cur.seen || 0, rec.seen || 0), lapses: Math.max(cur.lapses || 0, rec.lapses || 0) };
  }
  for (const [d, v] of Object.entries(b.dayDone || {})) if (!out.dayDone[d] || out.dayDone[d] > v) out.dayDone[d] = v;
  for (const [p, s] of Object.entries(b.partStats || {})) {
    const cur = out.partStats[p] || { n: 0, c: 0 };
    out.partStats[p] = { n: Math.max(cur.n || 0, s.n || 0), c: Math.max(cur.c || 0, s.c || 0) };
  }
  const seenExam = new Set(out.exams.map((e) => `${e.date}|${e.score}|${e.total}`));
  for (const e of b.exams || []) {
    const k = `${e.date}|${e.score}|${e.total}`;
    if (!seenExam.has(k)) { out.exams.push(e); seenExam.add(k); }
  }
  out.exams = out.exams.sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 12);
  for (const [w, r] of Object.entries(b.wrong || {})) {
    const cur = out.wrong[w] || { n: 0, last: '' };
    out.wrong[w] = { n: Math.max(cur.n || 0, r.n || 0), last: [cur.last, r.last].filter(Boolean).sort().pop() || '' };
  }
  if ((b.streak?.count || 0) > (out.streak?.count || 0)) out.streak = b.streak;
  return out;
}

async function saveProgress(env, userId, p) {
  await env.DB.prepare(
    `INSERT INTO progress (user_id, srs, day_done, cur_day, part_stats, exams, wrong, streak, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       srs = excluded.srs, day_done = excluded.day_done, cur_day = excluded.cur_day,
       part_stats = excluded.part_stats, exams = excluded.exams, wrong = excluded.wrong,
       streak = excluded.streak, updated_at = excluded.updated_at`
  ).bind(
    userId, JSON.stringify(p.srs || {}), JSON.stringify(p.dayDone || {}), p.curDay || 1,
    JSON.stringify(p.partStats || {}), JSON.stringify(p.exams || []), JSON.stringify(p.wrong || {}),
    JSON.stringify(p.streak || {})
  ).run();
}

const publicUser = (u) => ({ id: u.id, username: u.username, isAdmin: !!u.is_admin });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);

    try {
      // ---------------- 註冊 / 登入 ----------------
      if (path === '/api/register' && req.method === 'POST') {
        const { username, password } = await req.json().catch(() => ({}));
        const name = String(username || '').trim();
        const pw = String(password || '');
        if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/.test(name)) return json({ error: '帳號需 3–20 字，可用英數字、底線或中文' }, 400);
        if (pw.length < 6) return json({ error: '密碼至少 6 個字元' }, 400);
        const exists = await env.DB.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').bind(name).first();
        if (exists) return json({ error: '這個帳號已經有人用了' }, 409);
        const hash = await hashPassword(pw);
        const ins = await env.DB.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').bind(name, hash).run();
        const userId = ins.meta.last_row_id;
        await saveProgress(env, userId, blankProgress());
        const token = await createSession(env, userId);
        return json({ token, user: { id: userId, username: name, isAdmin: false }, progress: blankProgress() });
      }

      if (path === '/api/login' && req.method === 'POST') {
        const { username, password } = await req.json().catch(() => ({}));
        const row = await env.DB.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').bind(String(username || '').trim()).first();
        if (!row || !(await verifyPassword(String(password || ''), row.pass_hash))) return json({ error: '帳號或密碼不正確' }, 401);
        const token = await createSession(env, row.id);
        await env.DB.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").bind(row.id).run();
        return json({ token, user: publicUser(row), progress: await loadProgress(env, row.id) });
      }

      if (path === '/api/logout' && req.method === 'POST') {
        const auth = req.headers.get('authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
        return json({ ok: true });
      }

      const user = await getUser(req, env);

      if (path === '/api/me' && req.method === 'GET') {
        if (!user) return json({ user: null }, 200);
        return json({ user: publicUser(user), progress: await loadProgress(env, user.id) });
      }

      // ---------------- 進度同步 ----------------
      if (path === '/api/progress' && req.method === 'PUT') {
        if (!user) return json({ error: '需要登入' }, 401);
        const body = await req.json().catch(() => ({}));
        const merged = mergeProgress(await loadProgress(env, user.id), body);
        await saveProgress(env, user.id, merged);
        if (!user.last_seen) await env.DB.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").bind(user.id).run();
        return json({ ok: true, progress: merged });
      }

      // ---------------- 留言板 ----------------
      if (path === '/api/messages' && req.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT id, username, body, created_at, admin_reply, replied_at, replied_by FROM messages ORDER BY id DESC LIMIT 100'
        ).all();
        return json({ messages: rows.results || [] });
      }

      if (path === '/api/messages' && req.method === 'POST') {
        if (!user) return json({ error: '請先登入再留言' }, 401);
        const { body } = await req.json().catch(() => ({}));
        const text = String(body || '').trim().slice(0, 1000);
        if (text.length < 2) return json({ error: '留言太短了' }, 400);
        const r = await env.DB.prepare('INSERT INTO messages (user_id, username, body) VALUES (?, ?, ?)')
          .bind(user.id, user.username, text).run();
        return json({ ok: true, id: r.meta.last_row_id });
      }

      // ---------------- 管理介面 ----------------
      if (path === '/api/admin/stats' && req.method === 'GET') {
        if (!user || !user.is_admin) return json({ error: '需要管理員權限' }, 403);
        const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE last_seen >= datetime('now','-7 day')").first();
        const msgs = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN admin_reply IS NULL THEN 1 ELSE 0 END) AS pending FROM messages').first();
        const rows = await env.DB.prepare('SELECT username, srs, wrong, part_stats FROM progress p JOIN users u ON u.id = p.user_id').all();
        let learned = 0, wrongTotal = 0;
        const wrongCount = {};
        for (const r of rows.results || []) {
          const srs = parseJSON(r.srs, {});
          learned += Object.keys(srs).length;
          const wr = parseJSON(r.wrong, {});
          for (const [w, v] of Object.entries(wr)) {
            wrongTotal += 1;
            wrongCount[w] = (wrongCount[w] || 0) + (v.n || 1);
          }
        }
        const topWrong = Object.entries(wrongCount).sort((a, b) => b[1] - a[1]).slice(0, 20)
          .map(([word, n]) => ({ word, n }));
        const list = rows.results || [];
        return json({
          users: users.n, active7d: active.n, messages: msgs.n || 0, pending: msgs.pending || 0,
          avgLearned: list.length ? Math.round(learned / list.length) : 0,
          wrongTotal, topWrong,
        });
      }

      if (path === '/api/admin/users' && req.method === 'GET') {
        if (!user || !user.is_admin) return json({ error: '需要管理員權限' }, 403);
        const rows = await env.DB.prepare(
          `SELECT u.id, u.username, u.created_at, u.last_seen, p.srs, p.part_stats, p.day_done, p.wrong
           FROM users u LEFT JOIN progress p ON p.user_id = u.id ORDER BY u.id DESC LIMIT 300`
        ).all();
        const users2 = (rows.results || []).map((r) => {
          const srs = parseJSON(r.srs, {});
          const parts = parseJSON(r.part_stats, {});
          let n = 0, c = 0;
          Object.values(parts).forEach((s) => { n += s.n || 0; c += s.c || 0; });
          return {
            id: r.id, username: r.username, created: r.created_at, lastSeen: r.last_seen,
            learned: Object.keys(srs).length, daysDone: Object.keys(parseJSON(r.day_done, {})).length,
            wrong: Object.keys(parseJSON(r.wrong, {})).length,
            accuracy: n ? Math.round((c / n) * 100) : null,
          };
        });
        return json({ users: users2 });
      }

      if (path === '/api/admin/reply' && req.method === 'POST') {
        if (!user || !user.is_admin) return json({ error: '需要管理員權限' }, 403);
        const { id, reply } = await req.json().catch(() => ({}));
        const text = String(reply || '').trim().slice(0, 1000);
        if (!id || text.length < 1) return json({ error: '缺少參數' }, 400);
        await env.DB.prepare("UPDATE messages SET admin_reply = ?, replied_at = datetime('now'), replied_by = ? WHERE id = ?")
          .bind(text, user.username, id).run();
        return json({ ok: true });
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: 'server error', detail: String(err).slice(0, 200) }, 500);
    }
  },
};
