# El Rey De Las Medialunas — ERP + POS System

ERP y sistema de punto de venta para cadena de panaderías y cafeterías "El Rey De Las Medialunas".

## Tech Stack

| Capa | Tecnología |
|------|-----------|
| **Frontend** | React + TypeScript + Vite (PWA con Service Workers) |
| **Backend** | Cloudflare Workers + Hono.js |
| **Base de Datos** | Cloudflare D1 (SQLite) + IndexedDB (offline) |
| **Almacenamiento** | Cloudflare R2 (imágenes, recibos, reportes) |
| **Caché** | Cloudflare KV |
| **Colas** | Cloudflare Queues (inventario, reportes) |
| **Autenticación** | Firebase Auth |
| **Monorepo** | pnpm workspaces + Turborepo |

## Estructura del Proyecto

```
├── apps/
│   ├── pos-pc/          # Punto de venta — escritorio
│   └── pos-tablet/      # Punto de venta — tablet
├── packages/
│   ├── shared/          # Tipos, constantes, validadores
│   ├── ui/              # Componentes UI (atoms, molecules)
│   ├── db-client/       # Cliente IndexedDB (Dexie.js)
│   ├── api-client/      # Cliente HTTP tipado
│   └── sync-engine/     # Motor de sincronización offline
├── workers/
│   ├── api/             # API Worker (Hono.js)
│   ├── inventory-worker/ # Procesador de inventario
│   ├── reports-worker/  # Generador de reportes
│   └── sync-worker/     # Sincronización cliente-servidor
└── migrations/          # Migraciones D1 (SQL)
```

## Requisitos

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Cuenta Cloudflare Workers (plan Free o superior)
- Proyecto Firebase (plan Spark o superior)

## Inicio Rápido

```bash
# Instalar dependencias
pnpm install

# Iniciar desarrollo
pnpm dev

# Ejecutar migraciones (local)
pnpm db:migrate:local
pnpm db:seed:local

# Lint y type-check
pnpm lint
pnpm type-check

# Tests
pnpm test
```

## Variables de Entorno

Copiá `.env.example` a `.env` y completá las variables necesarias:

```bash
cp .env.example .env
```

Variables requeridas:
- Firebase: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`
- Cloudflare: `CF_ACCOUNT_ID`, `CF_API_TOKEN`
- D1: `D1_DATABASE_ID`

## Licencia

Propietario. Todos los derechos reservados.
