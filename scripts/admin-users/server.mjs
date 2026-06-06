// ============================================================================
// Admin de Usuarios Firebase — Servidor local
// Uso: node scripts/admin-users/server.mjs
// Abre http://localhost:3456 en el navegador
// ============================================================================
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3456;

let auth;
let currentProjectId = '';

// ── Helper: init Firebase Admin ───────────────────────────────────────────
function initAdmin(serviceAccountPath) {
  if (!existsSync(serviceAccountPath)) {
    throw new Error(`Archivo no encontrado: ${serviceAccountPath}`);
  }
  const sa = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
  currentProjectId = sa.project_id;
  
  // Clean up existing apps
  getApps().forEach(app => app.delete());
  
  const app = initializeApp({ credential: cert(sa) }, 'admin-panel');
  auth = getAuth(app);
  return { projectId: sa.project_id, clientEmail: sa.client_email };
}

// ── API Router ────────────────────────────────────────────────────────────
async function handleAPI(req, res, body) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  try {
    // POST /api/init — initialize with service account
    if (method === 'POST' && path === '/api/init') {
      const { filePath } = JSON.parse(body);
      const info = initAdmin(filePath);
      return { status: 200, data: info };
    }

    // GET /api/users — list all users
    if (method === 'GET' && path === '/api/users') {
      if (!auth) return { status: 400, error: 'No inicializado. Primero cargá el JSON.' };
      const { users } = await auth.listUsers(100);
      const mapped = users.map(u => ({
        uid: u.uid,
        email: u.email || '',
        displayName: u.displayName || '',
        phoneNumber: u.phoneNumber || '',
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        created: u.metadata.creationTime,
        lastSignIn: u.metadata.lastSignInTime,
        provider: u.providerData.map(p => p.providerId).join(', '),
      }));
      return { status: 200, data: mapped };
    }

    // POST /api/users — create user
    if (method === 'POST' && path === '/api/users') {
      if (!auth) return { status: 400, error: 'No inicializado' };
      const { email, password, displayName, phoneNumber, disabled } = JSON.parse(body);
      const record = await auth.createUser({
        email, password, displayName, phoneNumber,
        disabled: disabled || false,
        emailVerified: true,
      });
      return { status: 201, data: { uid: record.uid, email: record.email } };
    }

    // PATCH /api/users/:uid — update user
    if (method === 'PATCH' && path.startsWith('/api/users/')) {
      if (!auth) return { status: 400, error: 'No inicializado' };
      const uid = path.split('/api/users/')[1];
      const updates = JSON.parse(body);
      const record = await auth.updateUser(uid, updates);
      return { status: 200, data: { uid: record.uid, email: record.email } };
    }

    // DELETE /api/users/:uid — delete user
    if (method === 'DELETE' && path.startsWith('/api/users/')) {
      if (!auth) return { status: 400, error: 'No inicializado' };
      const uid = path.split('/api/users/')[1];
      await auth.deleteUser(uid);
      return { status: 200, data: { deleted: uid } };
    }

    return { status: 404, error: 'Ruta no encontrada' };
  } catch (err) {
    return { status: 500, error: err.message };
  }
}

// ── Server ────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // API routes
  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const result = await handleAPI(req, res, body);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // Serve HTML
  const htmlPath = join(__dirname, 'index.html');
  if (existsSync(htmlPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(htmlPath, 'utf-8'));
  } else {
    res.writeHead(404);
    res.end('index.html not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  🥐 Admin de Usuarios listo en http://localhost:${PORT}\n`);
});
