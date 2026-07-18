import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { loadConfig } from './config';
import { printViaThermal } from './drivers/escpos-usb';
import { printViaWindowsSpooler } from './drivers/windows-spooler';
import type { PrintRequestBody, PrintResponseBody, TicketStyle } from './types';

const VALID_TICKET_STYLES: ReadonlySet<TicketStyle> = new Set([
  'receipt',
  'invoice',
  'remito',
  'presupuesto',
  'nota_credito',
]);

const config = loadConfig();

const app = new Hono();

// CORS permisivo (o configurable vía config.json -> corsOrigin): el POS puede
// estar sirviéndose desde un dominio HTTPS de producción y hacer fetch a
// http://localhost:9100 — no sabemos de antemano qué origin va a pegarle.
app.use(
  '*',
  cors({
    origin: config.corsOrigin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/print', async (c) => {
  let body: PrintRequestBody | undefined;
  try {
    body = await c.req.json<PrintRequestBody>();
  } catch {
    return c.json<PrintResponseBody>({ success: false, error: 'Body inválido: se esperaba JSON.' }, 500);
  }

  const validationError = validateBody(body);
  if (validationError) {
    return c.json<PrintResponseBody>({ success: false, error: validationError }, 500);
  }

  // A esta altura body y body.sale están garantizados por validateBody.
  const { sale, style } = body as PrintRequestBody;

  try {
    if (config.driver === 'thermal') {
      await printViaThermal(sale, style, config.thermalOptions);
    } else {
      await printViaWindowsSpooler(sale, style, config.windowsPrinterName);
    }
    return c.json<PrintResponseBody>({ success: true });
  } catch (err) {
    // Crítico: un driver que falla (impresora térmica desconectada, spooler
    // ocupado, etc.) NUNCA debe tirar abajo el proceso HTTP. Lo capturamos acá
    // y devolvemos 500 con el motivo — el POS cae a window.print() solo.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[print-bridge] Error al imprimir:', message);
    return c.json<PrintResponseBody>({ success: false, error: message }, 500);
  }
});

function validateBody(body: PrintRequestBody | undefined): string | null {
  if (!body || typeof body !== 'object') return 'Body vacío o inválido.';
  if (!body.sale || typeof body.sale !== 'object') return 'Falta "sale" en el body.';
  if (!Array.isArray(body.sale.items)) return '"sale.items" debe ser un array.';
  if (!VALID_TICKET_STYLES.has(body.style as TicketStyle)) {
    return '"style" debe ser "receipt", "invoice", "remito", "presupuesto" o "nota_credito".';
  }
  if (!body.sale.document_type) return 'Falta "sale.document_type" en el body.';
  return null;
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[print-bridge] Escuchando en http://localhost:${info.port} (driver: ${config.driver})`);
});
