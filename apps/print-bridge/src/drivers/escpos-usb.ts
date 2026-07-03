import { PrinterTypes, ThermalPrinter } from 'node-thermal-printer';

import type { ThermalOptions } from '../config';
import { buildThermalTicket } from '../ticket-format';
import type { PrintSale, TicketStyle } from '../types';

function resolvePrinterType(type: ThermalOptions['type']): PrinterTypes {
  return type === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON;
}

/**
 * Imprime directo a una impresora térmica ESC/POS conectada por USB.
 *
 * node-thermal-printer no trae acceso USB de bajo nivel (HID/bulk transfer):
 * para hardware conectado por cable USB, Windows expone la impresora como un
 * "printer object" del sistema (spooler) que acepta datos crudos — así quedan
 * instaladas la mayoría de las impresoras térmicas de recibos genéricas
 * (POS-58/80, EPSON TM-T20, etc.) apenas se conectan. Por eso usamos acá la
 * interfaz `printer:<nombre>` de node-thermal-printer, que a su vez necesita
 * el módulo nativo OPCIONAL `printer` (node-printer, requiere build tools)
 * para hablarle al spooler. Si no está instalado, fallamos con un error claro
 * en vez de romper el proceso — el caller (server.ts) lo convierte en un 500.
 *
 * `thermalOptions.vendorId` / `productId` quedan reservados en el config para
 * una futura versión con transporte USB directo (sumaría la dependencia
 * nativa `usb`); hoy no participan en la resolución del dispositivo.
 */
export async function printViaThermal(sale: PrintSale, style: TicketStyle, thermalOptions: ThermalOptions): Promise<void> {
  let printerDriver: unknown;
  try {
    // Require dinámico a propósito: 'printer' es una dependencia nativa
    // OPCIONAL del bridge, no un dependency del package.json — muchas PCs
    // van a usar el driver "windows-default" y no la necesitan.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    printerDriver = require('printer');
  } catch {
    throw new Error(
      "No se pudo cargar el módulo nativo opcional 'printer', necesario para hablarle al spooler desde node-thermal-printer. " +
        'Instalalo con: pnpm add printer --filter @medialunas/print-bridge (requiere build tools de Windows). ' +
        'Alternativa sin dependencias nativas: configurá "driver": "windows-default" en config.json.',
    );
  }

  const interfaceName = thermalOptions.interfaceName?.trim() || 'auto';
  const printer = new ThermalPrinter({
    type: resolvePrinterType(thermalOptions.type),
    interface: `printer:${interfaceName}`,
    driver: printerDriver as object,
    width: style === 'invoice' ? 48 : 32,
  });

  buildThermalTicket(printer, sale, style);

  const connected = await printer.isPrinterConnected().catch(() => false);
  if (!connected) {
    throw new Error(
      `La impresora térmica ('${interfaceName}') no responde. Verificá que esté encendida, conectada por USB y ` +
        'que el sistema operativo la tenga instalada como impresora (RAW-ONLY para autodetección con "auto").',
    );
  }

  await printer.execute();
}
