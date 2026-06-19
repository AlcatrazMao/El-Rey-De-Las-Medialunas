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

  // SECURITY: validate the JOSE header BEFORE verifying the signature.
  // - Reject any token whose alg is not HS256 (defends against the classic
  //   alg=none bypass and against HS256/RS256 algorithm-confusion attacks
  //   if this code ever runs alongside RS256-signing code).
  // - typ is optional (some Firebase-issued tokens omit it) but if present
  //   it must be JWT.
  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(atob(parts[0]!.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;
  if (header.typ !== undefined && header.typ !== 'JWT') return null;

  const data = `${parts[0]}.${parts[1]}`;
  const key  = await getKey(secret, 'verify');
  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(
      atob(parts[2]!.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0),
    );
  } catch {
    return null;
  }

  const valid = await crypto.subtle.verify('HMAC', key, toBuffer(sig), toBuffer(toBytes(data)));
  if (!valid) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }

  // Expiration is required for our access tokens. Reject tokens without exp
  // (a forged token without exp would otherwise never expire).
  if (typeof payload.exp !== 'number') return null;
  if (Date.now() / 1000 > payload.exp) return null;

  // If nbf (not-before) is present, enforce it.
  if (typeof payload.nbf === 'number' && Date.now() / 1000 < payload.nbf) return null;

  return payload;
}
