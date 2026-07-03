import * as fs from 'node:fs';
import * as path from 'node:path';

export type ThermalPrinterVendor = 'epson' | 'star';
export type DriverKind = 'thermal' | 'windows-default';

export interface ThermalOptions {
  type: ThermalPrinterVendor;
  /**
   * Reservados para una futura versión con acceso USB de bajo nivel (requeriría
   * sumar la dependencia nativa `usb`). Hoy no se usan para resolver el
   * dispositivo — ver comentario en `drivers/escpos-usb.ts`.
   */
  vendorId?: number;
  productId?: number;
  /**
   * Nombre del printer object del sistema operativo que expone la impresora
   * térmica (interfaz `printer:<nombre>` de node-thermal-printer). Si se omite,
   * se intenta autodetectar la primera impresora RAW-ONLY (`printer:auto`).
   */
  interfaceName?: string;
}

export interface PrintBridgeConfig {
  port: number;
  driver: DriverKind;
  thermalOptions: ThermalOptions;
  /** Nombre de la impresora de Windows a usar con el driver "windows-default". Si se omite, usa la default del sistema. */
  windowsPrinterName?: string;
  /**
   * Valor para el header Access-Control-Allow-Origin. '*' por defecto para que
   * el POS pueda hacer fetch a http://localhost:9100 sin importar en qué
   * dominio (incluido HTTPS de producción) esté corriendo el navegador.
   */
  corsOrigin: string;
}

const CONFIG_FILENAME = 'config.json';

// driver "windows-default" es el default seguro: no requiere hardware térmico
// ni módulos nativos adicionales, funciona con cualquier impresora ya
// instalada en Windows.
const DEFAULT_CONFIG: PrintBridgeConfig = {
  port: 9100,
  driver: 'windows-default',
  thermalOptions: { type: 'epson' },
  corsOrigin: '*',
};

function configPath(): string {
  return path.join(process.cwd(), CONFIG_FILENAME);
}

function normalizeThermalOptions(raw: unknown): ThermalOptions {
  const parsed = (raw ?? {}) as Partial<ThermalOptions>;
  return {
    type: parsed.type === 'star' ? 'star' : 'epson',
    vendorId: typeof parsed.vendorId === 'number' ? parsed.vendorId : undefined,
    productId: typeof parsed.productId === 'number' ? parsed.productId : undefined,
    interfaceName: typeof parsed.interfaceName === 'string' ? parsed.interfaceName : undefined,
  };
}

/**
 * Lee `config.json` relativo al cwd del proceso. Si no existe, lo crea con
 * valores por defecto y loguea la ruta — para que el instalador no tenga que
 * escribirlo a mano la primera vez.
 */
export function loadConfig(): PrintBridgeConfig {
  const file = configPath();

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
    console.log(`[print-bridge] No se encontró ${CONFIG_FILENAME}, se creó uno nuevo con valores por defecto en: ${file}`);
    return { ...DEFAULT_CONFIG, thermalOptions: { ...DEFAULT_CONFIG.thermalOptions } };
  }

  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PrintBridgeConfig>;
    return {
      port: typeof parsed.port === 'number' ? parsed.port : DEFAULT_CONFIG.port,
      driver: parsed.driver === 'thermal' || parsed.driver === 'windows-default' ? parsed.driver : DEFAULT_CONFIG.driver,
      thermalOptions: normalizeThermalOptions(parsed.thermalOptions),
      windowsPrinterName: typeof parsed.windowsPrinterName === 'string' ? parsed.windowsPrinterName : undefined,
      corsOrigin: typeof parsed.corsOrigin === 'string' && parsed.corsOrigin.length > 0 ? parsed.corsOrigin : DEFAULT_CONFIG.corsOrigin,
    };
  } catch (err) {
    console.error(`[print-bridge] Error leyendo ${CONFIG_FILENAME}, se usan valores por defecto:`, err);
    return { ...DEFAULT_CONFIG, thermalOptions: { ...DEFAULT_CONFIG.thermalOptions } };
  }
}
