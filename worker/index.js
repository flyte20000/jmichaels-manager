// J Michael's Manager Dashboard — Cloudflare Worker API

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw + 'jm_s2024'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randId(n = 16) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getUser(db, req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const row = await db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?')
    .bind(token, Date.now()).first();
  if (!row) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const method = request.method;
    const db = env.DB;

    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try { body = await request.json(); } catch {}
    }

    // ── AUTH LOGIN ───────────────────────────────────────────────────────────
    if (path === '/api/auth/login' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return err('Username and password required');
      const user = await db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
        .bind(username).first();
      if (!user) return err('User not found', 401);
      const h = await hashPassword(password);
      if (h !== user.password_hash) return err('Incorrect password', 401);
      const token = randId();
      const expires = Date.now() + 1000 * 60 * 60 * 24 * 30;
      await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(token, user.id, expires).run();
      return json({ token, user: { id: user.id, username: user.username, role: user.role } });
    }

    // ── AUTH LOGOUT ──────────────────────────────────────────────────────────
    if (path === '/api/auth/logout' && method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.replace('Bearer ', '').trim();
      if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return json({ ok: true });
    }

    // All other routes require auth
    const user = await getUser(db, request);
    if (!user) return err('Unauthorized', 401);

    // ── REPORTS ──────────────────────────────────────────────────────────────
    if (path === '/api/reports') {
      if (method === 'GET') {
        const rows = await db.prepare('SELECT * FROM reports ORDER BY week DESC').all();
        return json((rows.results || []).map(r => ({ ...r, data: JSON.parse(r.data) })));
      }
      if (method === 'POST') {
        const { week, manager_name, data } = body;
        if (!week || !data) return err('week and data required');
        const rid = randId();
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO reports (id, week, manager_name, data, submitted_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(week) DO UPDATE SET
            manager_name = excluded.manager_name,
            data = excluded.data,
            submitted_at = excluded.submitted_at
        `).bind(rid, week, manager_name || '', JSON.stringify(data), now, user.id).run();

        // Push notification via ntfy.sh
        const d = data || {};
        const sales = d.s_gross ? '$' + parseFloat(d.s_gross).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
        const labor = d.l_pct || '—';
        const cash  = d.c_checking ? '$' + parseFloat(d.c_checking).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
        const mca   = d.m_balance ? '$' + parseFloat(d.m_balance).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
        ctx.waitUntil(fetch('https://ntfy.sh/jmichaels-reports-k9m3p7', {
          method: 'POST',
          headers: {
            'Title': `Weekly Report Submitted — ${week}`,
            'Priority': 'default',
            'Tags': 'restaurant,chart_with_upwards_trend',
          },
          body: `Manager: ${manager_name || 'Unknown'}\nSales: ${sales}\nLabor %: ${labor}\nCash (Checking): ${cash}\nMCA Balance: ${mca}`,
        }));

        return json({ ok: true });
      }
    }

    const reportMatch = path.match(/^\/api\/reports\/(.+)$/);
    if (reportMatch && method === 'DELETE') {
      await db.prepare('DELETE FROM reports WHERE id = ?').bind(reportMatch[1]).run();
      return json({ ok: true });
    }

    // ── CASHFLOW ─────────────────────────────────────────────────────────────
    if (path === '/api/cashflow') {
      if (method === 'GET') {
        const row = await db.prepare('SELECT * FROM cashflow WHERE id = ?').bind('current').first();
        if (!row) return json({ week_data: {}, days_data: {}, week: '' });
        return json({
          week_data: JSON.parse(row.week_data || '{}'),
          days_data: JSON.parse(row.days_data || '{}'),
          week: row.week || ''
        });
      }
      if (method === 'PUT') {
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO cashflow (id, week, week_data, days_data, updated_at, updated_by)
          VALUES ('current', ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            week = excluded.week,
            week_data = excluded.week_data,
            days_data = excluded.days_data,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `).bind(body.week || '', JSON.stringify(body.week_data || {}), JSON.stringify(body.days_data || {}), now, user.id).run();
        return json({ ok: true });
      }
    }

    // ── MCA ──────────────────────────────────────────────────────────────────
    if (path === '/api/mca') {
      if (method === 'GET') {
        const row = await db.prepare('SELECT * FROM mca_data WHERE id = ?').bind('current').first();
        if (!row) return json({});
        return json(JSON.parse(row.data || '{}'));
      }
      if (method === 'PUT') {
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO mca_data (id, data, updated_at, updated_by)
          VALUES ('current', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by
        `).bind(JSON.stringify(body), now, user.id).run();
        return json({ ok: true });
      }
    }

    // ── VENDORS ──────────────────────────────────────────────────────────────
    if (path === '/api/vendors') {
      if (method === 'GET') {
        const row = await db.prepare('SELECT * FROM vendors_data WHERE id = ?').bind('current').first();
        if (!row) return json([]);
        return json(JSON.parse(row.data || '[]'));
      }
      if (method === 'PUT') {
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO vendors_data (id, data, updated_at, updated_by)
          VALUES ('current', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by
        `).bind(JSON.stringify(Array.isArray(body) ? body : []), now, user.id).run();
        return json({ ok: true });
      }
    }

    // ── SETTINGS ─────────────────────────────────────────────────────────────
    if (path === '/api/settings') {
      if (method === 'GET') {
        const row = await db.prepare('SELECT * FROM app_settings WHERE id = ?').bind('current').first();
        if (!row) return json({});
        return json(JSON.parse(row.data || '{}'));
      }
      if (method === 'PUT') {
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO app_settings (id, data, updated_at, updated_by)
          VALUES ('current', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by
        `).bind(JSON.stringify(body), now, user.id).run();
        return json({ ok: true });
      }
    }

    // ── DRAFT ────────────────────────────────────────────────────────────────
    if (path === '/api/draft') {
      if (method === 'GET') {
        const row = await db.prepare('SELECT * FROM drafts WHERE user_id = ?').bind(user.id).first();
        if (!row) return json(null);
        return json(JSON.parse(row.data));
      }
      if (method === 'PUT') {
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO drafts (user_id, data, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
        `).bind(user.id, JSON.stringify(body), now).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM drafts WHERE user_id = ?').bind(user.id).run();
        return json({ ok: true });
      }
    }

    return err('Not found', 404);
  }
};
