// ============================================================================
// Script para crear usuarios de Firebase Auth
// Uso: node test/create-users.mjs
// ============================================================================
// Requiere el archivo de service account en la raíz del proyecto.
// Opciones para pasar las credenciales:
//   1. Variable de entorno: GOOGLE_APPLICATION_CREDENTIALS=./firebase-key.json
//   2. Pasar el JSON como string en FIREBASE_SERVICE_ACCOUNT
// ============================================================================

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// ── Cargar credenciales ──────────────────────────────────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Intentar leer de archivo
  const { readFileSync } = await import('fs');
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-key.json';
  serviceAccount = JSON.parse(readFileSync(path, 'utf-8'));
}

const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);

// ── Usuarios a crear ─────────────────────────────────────────────────────────
const USERS = [
  {
    email: 'admin@elreydelasmedialunas.com',
    password: 'Admin123!',
    displayName: 'Carlos Pastor (Dueño)',
  },
  {
    email: 'cajero@elreydelasmedialunas.com',
    password: 'Cajero123!',
    displayName: 'Rodrigo Gómez (Caja)',
  },
  {
    email: 'panadero@elreydelasmedialunas.com',
    password: 'Panadero123!',
    displayName: 'Marta Pérez (Maestra)',
  },
  {
    email: 'supervisor@elreydelasmedialunas.com',
    password: 'Super123!',
    displayName: 'Laura Supervisora',
  },
];

// ── Crear usuarios ───────────────────────────────────────────────────────────
async function createUsers() {
  for (const user of USERS) {
    try {
      const record = await auth.createUser({
        email: user.email,
        password: user.password,
        displayName: user.displayName,
        emailVerified: true,
      });
      console.log(`✅ Creado: ${user.email} (UID: ${record.uid})`);
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        console.log(`⏭️  Ya existe: ${user.email}`);
      } else {
        console.error(`❌ Error creando ${user.email}:`, err.message);
      }
    }
  }
  console.log('\n🏁 Listo. Usuarios disponibles para login en el POS.');
}

createUsers().catch(console.error);
