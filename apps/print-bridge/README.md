# @medialunas/print-bridge

Servicio local ("bridge de impresión") que corre en la misma PC física del
navegador del POS. Escucha HTTP en `localhost` y manda tickets/facturas
directo a la impresora, sin pasar por el diálogo nativo de impresión del
navegador (`window.print()`).

El POS (`apps/pos-pc`) le pega vía `fetch` cuando `printer.useBridge` está
activo en Configuración → Impresora (ver `useSettings.ts` /
`PrinterSettings.tsx`). Si el bridge no está corriendo, no responde a tiempo,
o devuelve un error, el POS cae de forma silenciosa al comportamiento de
siempre (iframe + `window.print()`) — el bridge es 100% opcional.

## API

- `GET /health` → `200 {"status":"ok"}`
- `POST /print` → body `{ "sale": {...}, "style": "receipt" | "invoice" }`
  - `200 {"success": true}` si imprimió.
  - `500 {"success": false, "error": "..."}` si falló (impresora apagada/desconectada,
    driver no instalado, etc.). El proceso nunca se cae por un error de impresión.

Puerto por defecto: `9100` (configurable, ver `config.json` abajo).

## Instalación

Desde la raíz del monorepo (usa el mismo `pnpm-lock.yaml` de todo el proyecto):

```sh
pnpm install
```

## Desarrollo

```sh
pnpm --filter @medialunas/print-bridge dev
```

Esto corre `tsx watch src/server.ts` — reinicia solo ante cambios en `src/`.

## Build

```sh
pnpm --filter @medialunas/print-bridge build
```

Compila `src/` → `dist/` con `tsc`. Para correr el build:

```sh
pnpm --filter @medialunas/print-bridge start
# equivalente a: node dist/server.js
```

## `config.json`

Al arrancar por primera vez, si no existe `config.json` en el directorio
desde donde se ejecuta el proceso (`process.cwd()`), el bridge lo crea
automáticamente con valores por defecto y lo loguea en consola. Ejemplo:

```json
{
  "port": 9100,
  "driver": "windows-default",
  "thermalOptions": {
    "type": "epson"
  },
  "windowsPrinterName": "EPSON TM-T20III",
  "corsOrigin": "*"
}
```

Campos:

- `port`: puerto HTTP local. Default `9100`.
- `driver`: `"windows-default"` (default, sin dependencias nativas — imprime
  un PDF generado con `pdfkit` a la impresora de Windows configurada, o a la
  default del sistema) o `"thermal"` (impresión ESC/POS directa vía
  `node-thermal-printer`, pensado para impresoras térmicas de recibos por
  USB).
- `thermalOptions.type`: `"epson"` o `"star"` — set de comandos ESC/POS.
- `thermalOptions.vendorId` / `thermalOptions.productId`: reservados para una
  futura versión con transporte USB directo (necesitaría sumar la dependencia
  nativa `usb`); hoy no se usan para resolver el dispositivo.
- `thermalOptions.interfaceName`: nombre del printer object del sistema
  operativo que expone la impresora térmica. Si se omite, se autodetecta la
  primera impresora `RAW-ONLY` (`printer:auto`).
- `windowsPrinterName`: nombre exacto de la impresora de Windows a usar con
  el driver `"windows-default"`. Si se omite, usa la impresora default del
  sistema operativo.
- `corsOrigin`: valor del header `Access-Control-Allow-Origin`. `"*"` por
  defecto, para que el POS pueda hacer `fetch` desde cualquier origen
  (incluido un dominio HTTPS de producción) a `http://localhost:9100`.

### Driver `"thermal"` — dependencia nativa opcional

`node-thermal-printer` arma el buffer ESC/POS, pero para mandarlo al spooler
del sistema (interfaz `printer:<nombre>`) necesita el módulo nativo opcional
[`printer`](https://www.npmjs.com/package/printer) (requiere build tools de
Windows). **No es una dependencia del `package.json`** — si tu instalación no
imprime por térmica, instalala manualmente:

```sh
pnpm add printer --filter @medialunas/print-bridge
```

Si no está instalada y el driver configurado es `"thermal"`, `/print`
responde `500` con un mensaje explicando esto — nunca tira abajo el proceso.

## Dejarlo corriendo al iniciar Windows

La forma más simple es un `.bat` en la carpeta de inicio de Windows
(`shell:startup`, accesible desde el diálogo Ejecutar de Windows: tecla
Windows + R). Creá un archivo, por ejemplo `print-bridge.bat`, con este
contenido (ajustá la ruta a donde esté clonado/instalado el repo):

```bat
@echo off
cd /d "C:\ruta\al\repo\El-Rey-De-Las-Medialunas\apps\print-bridge"
node dist\server.js
```

Pasos:

1. Compilá el paquete una vez en la PC del POS: `pnpm --filter @medialunas/print-bridge build`.
2. Presioná Windows + R, escribí `shell:startup` y Enter — se abre la carpeta
   de inicio del usuario actual.
3. Copiá ahí el `.bat` de arriba (con la ruta real).
4. Reiniciá la PC (o corré el `.bat` a mano una vez) — el bridge queda
   escuchando en `http://localhost:9100`.

Para que la ventana de consola no moleste, podés lanzarlo minimizado
guardando el `.bat` como acceso directo y configurando "Minimizada" en
Propiedades → Ejecutar, o usando `start /min` dentro del propio `.bat`:

```bat
@echo off
cd /d "C:\ruta\al\repo\El-Rey-De-Las-Medialunas\apps\print-bridge"
start /min node dist\server.js
```
