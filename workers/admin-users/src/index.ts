// ============================================================================
// Admin Users Worker — Cloudflare Workers
// CRUD de usuarios Firebase usando REST API + Service Account OAuth2
// ============================================================================
import { HTML } from './html';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
      }
      if (url.pathname.startsWith('/api/')) {
        const result = await handleRequest(request, env, url);
        return new Response(JSON.stringify(result), {
          status: result.status || 200,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      return new Response('Not found', { status: 404 });
    } catch (err: any) {
      return new Response(JSON.stringify({ status: 500, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
  },
};

// ── Types ─────────────────────────────────────────────────────────────
interface Env {
  FIREBASE_SERVICE_ACCOUNT: string;
  FIREBASE_API_KEY: string;
  AUTH_SECRET: string;
}

// ── Rate limiter ─────────────────────────────────────────────────────
const rateLimit = new Map<string, { count: number; reset: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.reset) { rateLimit.set(ip, { count: 1, reset: now + 60000 }); return true; }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// ── In-memory user cache ─────────────────────────────────────────────
let userCache: { uid: string; email: string; displayName: string; role: string; disabled: boolean; created: string }[] = [];

// ── Get OAuth2 token ──────────────────────────────────────────────────
async function getAccessToken(env: Env): Promise<string> {
  const raw = (env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const decoded = raw.startsWith('{') ? raw : atob(raw.replace(/\s/g, ''));
  const sa = JSON.parse(decoded.trim());
  const now = Math.floor(Date.now() / 1000);
  
  const joseHeader = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toB64 = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${toB64(joseHeader)}.${toB64(claim)}`;

  // Extract and clean private key
  let pk = sa.private_key.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  const m = pk.match(/-----BEGIN PRIVATE KEY-----\n?([\s\S]*?)\n?-----END PRIVATE KEY-----/);
  const b64 = m ? m[1].replace(/\s/g, '') : pk.replace(/-----.*?-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const key = await crypto.subtle.importKey('pkcs8', bytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(jwt));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signed = `${jwt}.${sigB64}`;

  const tres = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signed}`,
  });
  const ttext = await tres.text();
  if (!tres.ok) throw new Error(`OAuth2 failed (${tres.status}): ${ttext.substring(0, 200)}`);
  const td = JSON.parse(ttext);
  if (!td.access_token) throw new Error(`OAuth2 no access_token: ${ttext.substring(0, 200)}`);
  return td.access_token;
}

// ── Handle ────────────────────────────────────────────────────────────
async function handleRequest(req: Request, env: Env, url: URL) {
  const path = url.pathname;
  const method = req.method;

  // Auth
  const ah = req.headers.get('Authorization');
  const at = ah?.startsWith('Bearer ') ? ah.slice(7) : '';
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip)) return { status: 429, error: 'Demasiados intentos' };
  if (!at || at !== (env.AUTH_SECRET || '').trim()) return { status: 401, error: 'No autorizado' };

  const token = await getAccessToken(env);
  const sa = JSON.parse((env.FIREBASE_SERVICE_ACCOUNT || '').trim().startsWith('{') ? env.FIREBASE_SERVICE_ACCOUNT.trim() : atob(env.FIREBASE_SERVICE_ACCOUNT.replace(/\s/g, '')));
  const apiKey = (env.FIREBASE_API_KEY || '').trim();

  // ── List users (from cache, synced with Firebase on create/delete) ──
  if (method === 'GET' && path === '/api/users') {
    return { status: 200, data: userCache };
  }

  // ── Create user (uses API key, client-side endpoint) ──
  if (method === 'POST' && path === '/api/users') {
    const body: any = await req.json();
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:signUp?key=${apiKey}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: body.email, password: body.password, displayName: body.displayName, returnSecureToken: false }) }
    );
    const text = await res.text();
    if (!res.ok) return { status: res.status, error: `Firebase create failed (url=${url.substring(0, 120)}, status=${res.status}): ${text.substring(0, 300)}` };
    const data = JSON.parse(text);
    userCache.push({ uid: data.localId, email: data.email, displayName: body.displayName || '', role: body.role || 'cajero', disabled: false, created: new Date().toISOString() });
    
    // Write role to Firestore
    const role = body.role || 'cajero';
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/user_roles?documentId=${data.localId}`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { role: { stringValue: role }, email: { stringValue: body.email } } }) }
    );
    
    return { status: 201, data: { uid: data.localId, email: data.email } };
  }

  // ── Update user ──
  if (method === 'PATCH' && path.startsWith('/api/users/')) {
    const uid = path.split('/api/users/')[1];
    const body: any = await req.json();
    const updates: any = { localId: uid };
    if (body.email) updates.email = body.email;
    if (body.password) updates.password = body.password;
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.disabled !== undefined) updates.disableUser = body.disabled;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update?key=${apiKey}`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }
    );
    const text = await res.text();
    if (!res.ok) return { status: res.status, error: `Firebase: ${text.substring(0, 200)}` };
    const data = JSON.parse(text);
    // Update cache
    const idx = userCache.findIndex(u => u.uid === uid);
    if (idx >= 0 && userCache[idx]) {
      const u = userCache[idx]!;
      if (body.email) u.email = body.email;
      if (body.displayName !== undefined) u.displayName = body.displayName;
      if (body.role) u.role = body.role;
      if (body.disabled !== undefined) u.disabled = body.disabled;
    }
    return { status: 200, data: { uid: data.localId } };
  }

  // ── Delete user ──
  if (method === 'DELETE' && path.startsWith('/api/users/')) {
    const uid = path.split('/api/users/')[1];
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:delete?key=${apiKey}`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: uid }) }
    );
    const text = await res.text();
    if (!res.ok) return { status: res.status, error: `Firebase: ${text.substring(0, 200)}` };
    userCache = userCache.filter(u => u.uid !== uid);
    return { status: 200, data: { deleted: uid } };
  }

  return { status: 404, error: 'Ruta no encontrada' };
}
