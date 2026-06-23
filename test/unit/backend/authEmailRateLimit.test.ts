import { describe, it, expect } from 'vitest';

// Réplica de la función exportada desde workers/api/src/routes/auth.ts.
// Hasheamos email.toLowerCase() con SHA-256 para que el rate limit sea
// case-insensitive y no exponga el email en texto plano en KV.
async function hashEmail(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.toLowerCase()),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('hashEmail — rate limit por email', () => {
  it('retorna un hex string de 64 caracteres (SHA-256)', async () => {
    const result = await hashEmail('user@example.com');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('es case-insensitive: "Test@Example.COM" y "test@example.com" producen el mismo hash', async () => {
    const h1 = await hashEmail('Test@Example.COM');
    const h2 = await hashEmail('test@example.com');
    expect(h1).toBe(h2);
  });

  it('produce hashes distintos para emails diferentes', async () => {
    const h1 = await hashEmail('alice@example.com');
    const h2 = await hashEmail('bob@example.com');
    expect(h1).not.toBe(h2);
  });

  it('no lanza con string vacío', async () => {
    await expect(hashEmail('')).resolves.toHaveLength(64);
  });

  it('el hash de string vacío es el SHA-256 de cadena vacía (valor conocido)', async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const result = await hashEmail('');
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
