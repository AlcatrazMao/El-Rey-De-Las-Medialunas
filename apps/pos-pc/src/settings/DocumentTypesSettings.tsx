import { FileText, Loader2 } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { DocumentType } from '../hooks/useDocumentSettings';
import { useDocumentSettings } from '../hooks/useDocumentSettings';

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ticket: 'Ticket',
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito: 'Nota de Crédito',
  remito: 'Remito',
  presupuesto: 'Presupuesto',
};

const DOCUMENT_TYPE_HINTS: Record<DocumentType, string> = {
  ticket: 'Comprobante estándar sin discriminar IVA. Numeración propia por sucursal.',
  factura_a: 'Para clientes Responsable Inscripto. Requiere CUIT cargado en el cliente. Sin valor fiscal real (CAE pendiente).',
  factura_b: 'Para consumidor final / monotributista. Requiere CUIT cargado en el cliente. Sin valor fiscal real (CAE pendiente).',
  factura_c: 'Emitida por monotributistas. Requiere CUIT cargado en el cliente. Sin valor fiscal real (CAE pendiente).',
  nota_credito: 'Anula o ajusta una venta existente. Siempre referencia un comprobante original.',
  remito: 'Entrega de mercadería sin precios ni IVA — solo cantidades y descripción.',
  presupuesto: 'Cotización con fecha de validez. No afecta stock ni caja.',
};

/**
 * Tab "Comprobantes" (change "Document Types"): togglear qué tipos de
 * comprobante puede emitir el POS en la sucursal activa. Deshabilitar un tipo
 * SOLO bloquea emisión futura — nunca oculta históricos ni resetea la
 * numeración (`document_sequences.last_number` vive en tabla separada del
 * flag `enabled`, ver `document_type_settings` / DT-12).
 */
export const DocumentTypesSettings: React.FC = () => {
  const { data, isLoading, updateSetting } = useDocumentSettings();
  const [pendingType, setPendingType] = useState<DocumentType | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleToggle = async (documentType: DocumentType, nextEnabled: boolean) => {
    setPendingType(documentType);
    setErrorMsg(null);
    const ok = await updateSetting(documentType, nextEnabled);
    if (!ok) {
      setErrorMsg(`No se pudo actualizar "${DOCUMENT_TYPE_LABELS[documentType]}". Reintentá.`);
    }
    setPendingType(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <FileText className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Comprobantes</h3>
      </div>

      <p className="text-[10px] text-gray-400">
        Elegí qué tipos de comprobante puede emitir la caja en esta sucursal. Deshabilitar un tipo
        solo bloquea nuevas emisiones — los comprobantes ya emitidos siguen visibles en el
        histórico y la numeración no se reinicia al volver a habilitarlo.
      </p>

      {errorMsg && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-bold px-3 py-2 rounded-xl">
          {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
        </div>
      ) : (
        <div className="space-y-2">
          {data.map(setting => (
            <label
              key={setting.document_type}
              className="flex items-start gap-3 w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={setting.enabled}
                disabled={pendingType === setting.document_type}
                onChange={e => handleToggle(setting.document_type, e.target.checked)}
                className="h-4 w-4 mt-0.5 accent-amber-500 cursor-pointer disabled:opacity-50"
              />
              <span className="flex-1">
                <span className="block text-gray-850 dark:text-zinc-100">
                  {DOCUMENT_TYPE_LABELS[setting.document_type]}
                </span>
                <span className="block text-[10px] font-normal text-gray-400 mt-0.5">
                  {DOCUMENT_TYPE_HINTS[setting.document_type]}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
