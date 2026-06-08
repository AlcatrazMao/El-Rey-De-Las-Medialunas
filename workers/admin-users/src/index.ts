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
  DB: D1Database;
  FIREBASE_SERVICE_ACCOUNT: string;
  FIREBASE_API_KEY: string;
  AUTH_SECRET: string;
}

// ── Rate limiter (5 attempts/min per IP) ──────────────────────────────
const rateLimit = new Map<string, { count: number; reset: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.reset) { rateLimit.set(ip, { count: 1, reset: now + 60000 }); return true; }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// ── Get OAuth2 token ──────────────────────────────────────────────────
async function getAccessToken(env: Env): Promise<string> {
  const raw = (env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const decoded = raw.startsWith('{') ? raw : atob(raw.replace(/\s/g, ''));
  let sa: any;
  try {
    sa = JSON.parse(decoded.trim());
  } catch (e: any) {
    throw new Error(`Failed to parse SA JSON. Raw starts with: "${raw.substring(0, 50)}", Decoded starts with: "${decoded.substring(0, 50)}". Error: ${e.message}`);
  }
  const now = Math.floor(Date.now() / 1000);
  
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toBase64 = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${toBase64(header)}.${toBase64(claim)}`;

  // Sign JWT — extract and rebuild PEM key
  let pk = sa.private_key.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  // Extract base64 body and decode to raw binary
  const bodyMatch = pk.match(/-----BEGIN PRIVATE KEY-----\n?([\s\S]*?)\n?-----END PRIVATE KEY-----/);
  const b64 = bodyMatch ? bodyMatch[1].replace(/\s/g, '') : pk.replace(/-----.*?-----/g, '').replace(/\s/g, '');
  
  // Decode base64 to ArrayBuffer, then try importKey
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'pkcs8', bytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
  } catch (e: any) {
    const pemKey = '-----BEGIN PRIVATE KEY-----\n' + b64.match(/.{1,64}/g)?.join('\n') + '\n-----END PRIVATE KEY-----';
    const encoder2 = new TextEncoder();
    try {
      cryptoKey = await crypto.subtle.importKey(
        'pkcs8', encoder2.encode(pemKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
      );
    } catch (e2: any) {
      throw new Error(`PKCS8 import failed (raw: ${e.message}, pem: ${e2.message})`);
    }
  }
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(jwt));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signedJwt = `${jwt}.${sigB64}`;

  const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
  });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`OAuth2 token request failed (${tokenRes.status}): ${tokenText.substring(0, 200)}`);
  }
  let tokenData: any;
  try {
    tokenData = JSON.parse(tokenText);
  } catch {
    throw new Error(`OAuth2 returned non-JSON (status ${tokenRes.status}): ${tokenText.substring(0, 300)}`);
  }
  if (!tokenData.access_token) {
    throw new Error(`OAuth2 response missing access_token: ${tokenText.substring(0, 300)}`);
  }
  return tokenData.access_token;
}

// ── Handle ────────────────────────────────────────────────────────────
async function handleRequest(req: Request, env: Env, url: URL) {
  const path = url.pathname;
  const method = req.method;

  // Auth check with rate limiting (5 attempts/min per IP)
  const authHeader = req.headers.get('Authorization');
  const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip)) {
    return { status: 429, error: 'Demasiados intentos. Esperá un minuto.' };
  }
  if (!authToken || authToken !== (env.AUTH_SECRET || '').trim()) {
    const sa = (env.AUTH_SECRET || '').trim();
    return { status: 401, error: `No autorizado (token_len=${authToken.length}, secret_len=${sa.length}, secret_set=${!!env.AUTH_SECRET})` };
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
    const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/accounts:query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnUserInfo: true, maxResults: 100 }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { status: res.status, error: `Firebase API error (${res.status}): ${text.substring(0, 300)}` };
    }
    try {
      const data = JSON.parse(text);
      const users = (data.accounts || []).map((u: any) => ({
        uid: u.localId, email: u.email || '', displayName: u.displayName || '',
        disabled: u.disabled || false, emailVerified: u.emailVerified || false,
        created: u.createdAt ? new Date(Number(u.createdAt)).toISOString() : '',
        lastSignIn: u.lastLoginAt ? new Date(Number(u.lastLoginAt)).toISOString() : '',
        provider: (u.providerUserInfo || []).map((p: any) => p.providerId).join(', '),
      }));
      return { status: 200, data: users };
    } catch {
      return { status: 500, error: `Firebase returned non-JSON: ${text.substring(0, 300)}` };
    }
  }

  // ── Create user ──
  if (method === 'POST' && path === '/api/users') {
    const body: any = await req.json();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts?key=${env.FIREBASE_API_KEY}`,
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
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update?key=${env.FIREBASE_API_KEY}`,
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
      `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:delete?key=${env.FIREBASE_API_KEY}`,
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
