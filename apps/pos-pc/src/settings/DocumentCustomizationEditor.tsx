import { Eye, Loader2, Save } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import type { DocumentCustomization, DocumentCustomizationFields } from '../hooks/useDocumentCustomizations';
import { useDocumentCustomizations } from '../hooks/useDocumentCustomizations';
import type { DocumentType } from '../hooks/useDocumentSettings';

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ticket: 'Ticket',
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito: 'Nota de Crédito',
  remito: 'Remito',
  presupuesto: 'Presupuesto',
};

const ALL_TYPES: DocumentType[] = ['ticket', 'factura_a', 'factura_b', 'factura_c', 'nota_credito', 'remito', 'presupuesto'];

interface EditableState {
  title: string;
  header_text: string;
  footer_text: string;
  show_prices: boolean;
  show_tax: boolean;
  show_logo: boolean;
  show_qr: boolean;
  show_customer: boolean;
  show_operator: boolean;
  presupuesto_valid_days: string;
  nota_credito_require_reason: boolean;
  factura_fiscal_legend: string;
}

function fieldsToEditable(f: DocumentCustomizationFields): EditableState {
  return {
    title: f.title ?? '',
    header_text: f.header_text ?? '',
    footer_text: f.footer_text ?? '',
    show_prices: f.show_prices,
    show_tax: f.show_tax,
    show_logo: f.show_logo,
    show_qr: f.show_qr,
    show_customer: f.show_customer,
    show_operator: f.show_operator,
    presupuesto_valid_days: f.presupuesto_valid_days != null ? String(f.presupuesto_valid_days) : '',
    nota_credito_require_reason: f.nota_credito_require_reason,
    factura_fiscal_legend: f.factura_fiscal_legend ?? '',
  };
}

function editableToFields(e: EditableState): DocumentCustomizationFields {
  return {
    title: e.title.trim() || null,
    header_text: e.header_text.trim() || null,
    footer_text: e.footer_text.trim() || null,
    show_prices: e.show_prices,
    show_tax: e.show_tax,
    show_logo: e.show_logo,
    show_qr: e.show_qr,
    show_customer: e.show_customer,
    show_operator: e.show_operator,
    presupuesto_valid_days: e.presupuesto_valid_days ? Number(e.presupuesto_valid_days) : null,
    nota_credito_require_reason: e.nota_credito_require_reason,
    factura_fiscal_legend: e.factura_fiscal_legend.trim() || null,
  };
}

export const DocumentCustomizationEditor: React.FC = () => {
  const { data, isLoading, updateCustomization } = useDocumentCustomizations();

  const [selectedType, setSelectedType] = useState<DocumentType>('ticket');
  const [scope, setScope] = useState<'global' | 'branch'>('global');
  const [edit, setEdit] = useState<EditableState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<'ok' | 'error' | null>(null);

  const current: DocumentCustomization | undefined = useMemo(
    () => data.find(d => d.document_type === selectedType),
    [data, selectedType],
  );

  // Al cambiar de tipo o scope, inicializa el editor desde el valor del scope
  // elegido (global o branch override). branch null → usa global como base.
  useEffect(() => {
    if (!current) { setEdit(null); return; }
    const base = scope === 'branch' ? (current.branch ?? current.global) : current.global;
    setEdit(fieldsToEditable(base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, scope, current?.document_type]);

  const preview = edit ? editableToFields(edit) : null;

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    setToast(null);
    const ok = await updateCustomization(selectedType, { scope, ...editableToFields(edit) });
    setSaving(false);
    setToast(ok ? 'ok' : 'error');
    if (ok) setTimeout(() => setToast(null), 2500);
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Cargando personalización...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Selector de tipo */}
      <div className="flex flex-wrap gap-1">
        {ALL_TYPES.map(dt => (
          <button
            key={dt}
            onClick={() => setSelectedType(dt)}
            className={`px-2.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors ${selectedType === dt ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-amber-50'}`}
          >
            {DOCUMENT_TYPE_LABELS[dt]}
          </button>
        ))}
      </div>

      {/* Scope */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400">Nivel:</span>
        <div className="flex gap-0.5 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5">
          <button onClick={() => setScope('global')} className={`px-3 py-1.5 text-xs font-bold rounded-md cursor-pointer ${scope === 'global' ? 'bg-white dark:bg-zinc-900 text-amber-600 shadow-sm' : 'text-gray-500 dark:text-zinc-400'}`}>Global</button>
          <button onClick={() => setScope('branch')} className={`px-3 py-1.5 text-xs font-bold rounded-md cursor-pointer ${scope === 'branch' ? 'bg-white dark:bg-zinc-900 text-amber-600 shadow-sm' : 'text-gray-500 dark:text-zinc-400'}`}>Sucursal</button>
        </div>
      </div>

      {edit && preview ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Formulario */}
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Título</span>
              <input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })}
                placeholder={DOCUMENT_TYPE_LABELS[selectedType]}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100" />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Encabezado</span>
              <textarea rows={2} value={edit.header_text} onChange={e => setEdit({ ...edit, header_text: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 resize-none" />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Pie</span>
              <textarea rows={2} value={edit.footer_text} onChange={e => setEdit({ ...edit, footer_text: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 resize-none" />
            </label>

            <div>
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Campos visibles</span>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {([
                  ['show_prices', 'Precios'],
                  ['show_tax', 'IVA'],
                  ['show_logo', 'Logo'],
                  ['show_qr', 'Código QR'],
                  ['show_customer', 'Cliente'],
                  ['show_operator', 'Operador'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-zinc-300">
                    <input type="checkbox" checked={edit[key]} onChange={e => setEdit({ ...edit, [key]: e.target.checked })}
                      className="h-3.5 w-3.5 accent-amber-500 cursor-pointer" />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Datos específicos por tipo */}
            {selectedType === 'presupuesto' && (
              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Días de validez default</span>
                <input type="number" min="1" max="3650" value={edit.presupuesto_valid_days} onChange={e => setEdit({ ...edit, presupuesto_valid_days: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100" />
              </label>
            )}
            {selectedType === 'nota_credito' && (
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-zinc-300">
                <input type="checkbox" checked={edit.nota_credito_require_reason} onChange={e => setEdit({ ...edit, nota_credito_require_reason: e.target.checked })}
                  className="h-3.5 w-3.5 accent-amber-500 cursor-pointer" />
                Requerir motivo obligatorio
              </label>
            )}
            {(selectedType === 'factura_a' || selectedType === 'factura_b' || selectedType === 'factura_c') && (
              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Leyenda fiscal</span>
                <input value={edit.factura_fiscal_legend} onChange={e => setEdit({ ...edit, factura_fiscal_legend: e.target.value })}
                  placeholder="SIN VALOR FISCAL — CAE PENDIENTE"
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100" />
              </label>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 cursor-pointer">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Guardar ({scope === 'global' ? 'global' : 'sucursal'})
              </button>
              {toast === 'ok' && <span className="text-xs font-bold text-emerald-600">Guardado ✓</span>}
              {toast === 'error' && <span className="text-xs font-bold text-red-600">No se pudo guardar</span>}
            </div>
          </div>

          {/* Visualizador */}
          <div className="rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden self-start">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 dark:border-zinc-800 text-[11px] font-bold text-gray-500 dark:text-zinc-400">
              <Eye className="h-3.5 w-3.5" /> Visualizador
            </div>
            <div className="p-4 font-mono text-[11px] leading-relaxed text-gray-800 dark:text-zinc-200 bg-white">
              {preview.show_logo && (
                <div className="text-center mb-2"><span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-600 text-lg">🥐</span></div>
              )}
              <div className="text-center font-bold text-sm mb-1">{preview.title || DOCUMENT_TYPE_LABELS[selectedType]}</div>
              {preview.header_text && <div className="text-center text-gray-500 mb-2">{preview.header_text}</div>}
              <div className="border-t border-dashed border-gray-300 dark:border-zinc-700 my-2" />
              {[['Medialunas x6', 2, 3000], ['Café con leche', 1, 1800]].map(([name, qty, price], i) => (
                <div key={i} className="flex justify-between">
                  <span>{name}</span>
                  <span>{qty} x {preview.show_prices ? `$${price}` : '—'}</span>
                </div>
              ))}
              {preview.show_tax && <div className="flex justify-between text-gray-500"><span>IVA</span><span>$1.234</span></div>}
              <div className="border-t border-dashed border-gray-300 dark:border-zinc-700 my-2" />
              {preview.show_prices && <div className="flex justify-between font-bold"><span>TOTAL</span><span>$7.800</span></div>}
              {preview.show_customer && <div className="text-gray-500 mt-1">Cliente: Consumidor Final</div>}
              {preview.show_operator && <div className="text-gray-500">Operador: —</div>}
              {preview.factura_fiscal_legend && <div className="text-gray-500 mt-1">{preview.factura_fiscal_legend}</div>}
              {preview.footer_text && <div className="text-center text-gray-500 mt-2">{preview.footer_text}</div>}
              {preview.show_qr && <div className="flex justify-center mt-2 text-gray-400">[ QR ]</div>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DocumentCustomizationEditor;
