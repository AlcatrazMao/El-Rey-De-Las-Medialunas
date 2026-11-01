import { Check, FileText, Loader2, Star, Type } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { DocumentType } from '../hooks/useDocumentSettings';
import { useDocumentSettings } from '../hooks/useDocumentSettings';
import { useSettings } from '../hooks/useSettings';

import { DocumentCustomizationEditor } from './DocumentCustomizationEditor';

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ticket: 'Ticket',
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  factura_m: 'Factura M',
  nota_credito_a: 'Nota de Crédito A',
  nota_credito_b: 'Nota de Crédito B',
  nota_credito_c: 'Nota de Crédito C',
  nota_credito_m: 'Nota de Crédito M',
  nota_debito_a: 'Nota de Débito A',
  nota_debito_b: 'Nota de Débito B',
  nota_debito_c: 'Nota de Débito C',
  nota_debito_m: 'Nota de Débito M',
  presupuesto: 'Presupuesto',
  remito: 'Remito',
};

const DOCUMENT_TYPE_HINTS: Record<DocumentType, string> = {
  ticket: 'Comprobante estándar sin discriminar IVA. Numeración propia por sucursal.',
  factura_a: 'Para clientes Responsable Inscripto. Requiere CUIT cargado en el cliente.',
  factura_b: 'Para consumidor final / monotributista.',
  factura_c: 'Emitida por monotributistas.',
  factura_m: 'Factura con retención de IVA y Ganancias. Requiere CUIT cargado en el cliente.',
  nota_credito_a: 'Nota de Crédito A. Requiere CUIT cargado en el cliente.',
  nota_credito_b: 'Nota de Crédito B para consumidor final / monotributista.',
  nota_credito_c: 'Nota de Crédito C para operaciones con monotributistas.',
  nota_credito_m: 'Nota de Crédito M. Requiere CUIT cargado en el cliente.',
  nota_debito_a: 'Nota de Débito A. Requiere CUIT cargado en el cliente.',
  nota_debito_b: 'Nota de Débito B para consumidor final / monotributista.',
  nota_debito_c: 'Nota de Débito C para operaciones con monotributistas.',
  nota_debito_m: 'Nota de Débito M. Requiere CUIT cargado en el cliente.',
  presupuesto: 'Cotización con fecha de validez. No afecta stock ni caja.',
  remito: 'Entrega de mercadería sin precios ni IVA — solo cantidades y descripción.',
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
  const { settings, updateSection } = useSettings();
  const [pendingType, setPendingType] = useState<DocumentType | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const defaultDocType = settings.pos?.defaultDocumentType ?? 'ticket';

  const handleSetDefault = (documentType: DocumentType) => {
    updateSection('pos', { defaultDocumentType: documentType });
    setSuccessMsg(`"${DOCUMENT_TYPE_LABELS[documentType]}" establecido como comprobante predeterminado.`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

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
        Elegí qué tipos de comprobante puede emitir la caja en esta sucursal y cuál es el comprobante predeterminado
        para las ventas nuevas. Deshabilitar un tipo solo bloquea nuevas emisiones — los comprobantes ya emitidos
        siguen visibles en el histórico.
      </p>

      {/* Card de Comprobante Predeterminado */}
      <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
            <span className="text-xs font-extrabold text-amber-950 dark:text-amber-100">
              Comprobante Predeterminado de Venta
            </span>
          </div>
          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-500 text-white shadow-xs">
            Actual: {DOCUMENT_TYPE_LABELS[defaultDocType] || 'Ticket'}
          </span>
        </div>
        <p className="text-[11px] text-gray-600 dark:text-zinc-350">
          Se cargará de forma automática al abrir una pestaña de venta en el POS o al limpiar el carrito tras cobrar.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <label htmlFor="default-doc-type-select" className="text-[11px] font-bold text-gray-700 dark:text-zinc-300">
            Fijar predeterminado:
          </label>
          <select
            id="default-doc-type-select"
            value={defaultDocType}
            onChange={e => handleSetDefault(e.target.value as DocumentType)}
            className="bg-white dark:bg-zinc-850 border border-amber-300 dark:border-zinc-700 text-xs font-semibold rounded-lg px-2.5 py-1.5 text-gray-850 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer shadow-xs"
          >
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([dt, label]) => (
              <option key={dt} value={dt}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 animate-in fade-in">
          <Check className="h-3.5 w-3.5 shrink-0" /> {successMsg}
        </div>
      )}

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
          {data.map(setting => {
            const isDefault = defaultDocType === setting.document_type;
            return (
              <div
                key={setting.document_type}
                className="flex items-center justify-between gap-3 w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3"
              >
                <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setting.enabled}
                    disabled={pendingType === setting.document_type}
                    onChange={e => handleToggle(setting.document_type, e.target.checked)}
                    className="h-4 w-4 mt-0.5 accent-amber-500 cursor-pointer disabled:opacity-50 shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-gray-850 dark:text-zinc-100 truncate">
                      {DOCUMENT_TYPE_LABELS[setting.document_type]}
                    </span>
                    <span className="block text-[10px] font-normal text-gray-400 mt-0.5">
                      {DOCUMENT_TYPE_HINTS[setting.document_type]}
                    </span>
                  </span>
                </label>

                <div className="shrink-0 ml-2">
                  {isDefault ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 px-2 py-1 rounded-lg shadow-xs">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> Predeterminado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(setting.document_type)}
                      className="text-[10px] font-bold text-gray-600 hover:text-amber-600 dark:text-zinc-350 dark:hover:text-amber-400 px-2.5 py-1 rounded-lg border border-gray-250 dark:border-zinc-700 hover:border-amber-400 dark:hover:border-amber-600 transition-colors cursor-pointer bg-white dark:bg-zinc-800 shadow-2xs"
                      title={`Fijar ${DOCUMENT_TYPE_LABELS[setting.document_type]} como predeterminado`}
                    >
                      Fijar predeterminado
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-gray-100 dark:border-zinc-800 pt-4 mt-4">
        <div className="flex items-center gap-2 mb-2">
          <Type className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Personalización de comprobantes</h4>
        </div>
        <p className="text-[10px] text-gray-400 mb-3">
          Personalizá título, encabezado/pie y visibilidad de campos por tipo de comprobante.
          Podés definir un formato global o pisarlo por sucursal. El visualizador muestra una vista previa en vivo.
        </p>
        <DocumentCustomizationEditor />
      </div>
    </div>
  );
};
