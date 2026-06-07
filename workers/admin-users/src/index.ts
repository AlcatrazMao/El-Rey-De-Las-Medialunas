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
      // Serve HTML
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors },
        });
      }

      // API routes  
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
  AUTH_SECRET: string; // simple password to protect the admin panel
}

// ── Get OAuth2 token ──────────────────────────────────────────────────
async function getAccessToken(env: Env): Promise<string> {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.auth https://www.googleapis.com/auth/identitytoolkit',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toBase64 = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${toBase64(header)}.${toBase64(claim)}`;

  // Sign JWT with the private key
  const encoder = new TextEncoder();
  const keyData = encoder.encode(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(jwt));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signedJwt = `${jwt}.${sigB64}`;

  const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
  });
  const tokenData: any = await tokenRes.json();
  return tokenData.access_token;
}

// ── Handle ────────────────────────────────────────────────────────────
async function handleRequest(req: Request, env: Env, url: URL) {
  const path = url.pathname;
  const method = req.method;

  // Auth check — compare token part only (header is "Bearer <token>")
  const authHeader = req.headers.get('Authorization');
  const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!authToken || authToken !== (env.AUTH_SECRET || '').trim()) {
    return { status: 401, error: 'No autorizado' };
  }

  const token = await getAccessToken(env);
  let sa: any;
  try {
    const raw = (env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    // Support both raw JSON and base64-encoded JSON
    const decoded = raw.startsWith('{') ? raw : atob(raw.replace(/\s/g, ''));
    sa = JSON.parse(decoded.trim());
  } catch (e: any) {
    const raw = (env.FIREBASE_SERVICE_ACCOUNT || '');
    return { status: 500, error: `Service account JSON inválido (longitud=${raw.length}, primeros 40 chars="${raw.substring(0, 40)}"). Error: ${e.message}` };
  }

  // ── List users ──
  if (method === 'GET' && path === '/api/users') {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/accounts:query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ returnUserInfo: true, maxResults: 100 }),
      }
    );
    const data: any = await res.json();
    if (!res.ok) return { status: res.status, error: data.error?.message || 'Error' };
    
    const users = (data.accounts || []).map((u: any) => ({
      uid: u.localId,
      email: u.email || '',
      displayName: u.displayName || '',
      disabled: u.disabled || false,
      emailVerified: u.emailVerified || false,
      created: u.createdAt ? new Date(Number(u.createdAt)).toISOString() : '',
      lastSignIn: u.lastLoginAt ? new Date(Number(u.lastLoginAt)).toISOString() : '',
      provider: (u.providerUserInfo || []).map((p: any) => p.providerId).join(', '),
    }));
    return { status: 200, data: users };
  }

  // ── Create user ──
  if (method === 'POST' && path === '/api/users') {
    const body: any = await req.json();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: body.email,
          password: body.password,
          displayName: body.displayName,
          disabled: body.disabled || false,
        }),
      }
    );
    const data: any = await res.json();
    if (!res.ok) return { status: res.status, error: data.error?.message || 'Error' };
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
    if (body.emailVerified !== undefined) updates.emailVerified = body.emailVerified;

    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );
    const data: any = await res.json();
    if (!res.ok) return { status: res.status, error: data.error?.message || 'Error' };
    return { status: 200, data: { uid: data.localId } };
  }

  // ── Delete user ──
  if (method === 'DELETE' && path.startsWith('/api/users/')) {
    const uid = path.split('/api/users/')[1];
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:delete`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ localId: uid }),
      }
    );
    const data: any = await res.json();
    if (!res.ok) return { status: res.status, error: data.error?.message || 'Error' };
    return { status: 200, data: { deleted: uid } };
  }

  return { status: 404, error: 'Ruta no encontrada' };
}
