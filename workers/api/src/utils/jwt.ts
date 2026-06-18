const BASE64URL = (buf: Uint8Array) =>
  btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

const toBytes = (s: string): Uint8Array => new TextEncoder().encode(s);

const toBuffer = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function getKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw', toBuffer(toBytes(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false, [usage]
  );
}

export async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = BASE64URL(toBytes(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body   = BASE64URL(toBytes(JSON.stringify(payload)));
  const data   = `${header}.${body}`;
  const key    = await getKey(secret, 'sign');
  const sigBuf = await crypto.subtle.sign('HMAC', key, toBuffer(toBytes(data)));
  return `${data}.${BASE64URL(new Uint8Array(sigBuf))}`;
}

export async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const key  = await getKey(secret, 'verify');
  const sig  = Uint8Array.from(
    atob(parts[2]!.replace(/-/g, '+').replace(/_/g, '/')),
    c => c.charCodeAt(0)
  );
  const valid = await crypto.subtle.verify('HMAC', key, toBuffer(sig), toBuffer(toBytes(data)));
  if (!valid) return null;
  const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}
