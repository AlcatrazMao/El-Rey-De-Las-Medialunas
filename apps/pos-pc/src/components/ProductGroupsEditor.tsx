import { Plus, Trash2, Save, Layers } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { Product, ProductGroup } from '../types';
import { formatCurrency } from '../utils/format';
import { calcularPrecioBase, calcularTotalFinal } from '../utils/productGroups';

interface ProductGroupsEditorProps {
  product: Product;
  /** Persistir la lista completa de grupos del producto. */
  onSave: (groups: ProductGroup[]) => void;
}

const MAX_GROUPS = 3;
const MAX_NAME_LEN = 50;

type Draft = Omit<ProductGroup, 'id'> & { id?: string };

const emptyDraft = (orden: 1 | 2 | 3): Draft => ({
  nombre: '',
  cantidad: 12,
  descuento: 0,
  descuento_tipo: 'porcentaje',
  admite_acum_desc: 0,
  orden,
});

/**
 * Editor de grupos de venta para un producto del catálogo.
 * Permite crear, editar y eliminar hasta 3 presentaciones por producto, con
 * visores en tiempo real de precio_base y total_final.
 */
export const ProductGroupsEditor: React.FC<ProductGroupsEditorProps> = ({ product, onSave }) => {
  const initial: Draft[] = (product.groups ?? [])
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((g) => ({ ...g }));

  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const usedOrdenes = new Set(drafts.map((d) => d.orden));
  const nextOrden = ([1, 2, 3] as const).find((o) => !usedOrdenes.has(o)) ?? null;

  // PM-03: si algún slot tiene descuento fijo >= precio base, deshabilitar Guardar.
  const hasFijoExcedido = drafts.some((d) => {
    if (d.descuento_tipo !== 'fijo') return false;
    const base = calcularPrecioBase(product.price, d as ProductGroup);
    return base > 0 && d.descuento >= base;
  });

  const updateDraft = (idx: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const addDraft = () => {
    if (drafts.length >= MAX_GROUPS || nextOrden == null) return;
    setDrafts((prev) => [...prev, emptyDraft(nextOrden)]);
  };

  const removeDraft = (idx: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const validate = (): boolean => {
    const next: Record<number, string> = {};
    const ordenes = new Set<number>();

    drafts.forEach((d, idx) => {
      if (!d.nombre.trim()) {
        next[idx] = 'El nombre es requerido.';
        return;
      }
      if (d.nombre.length > MAX_NAME_LEN) {
        next[idx] = `Máximo ${MAX_NAME_LEN} caracteres.`;
        return;
      }
      if (!Number.isInteger(d.cantidad) || d.cantidad < 2 || d.cantidad > 1000) {
        next[idx] = 'Cantidad debe ser un entero entre 2 y 1000.';
        return;
      }
      if (!Number.isFinite(d.descuento) || d.descuento < 0) {
        next[idx] = 'Descuento debe ser un número >= 0.';
        return;
      }
      if (d.descuento_tipo === 'porcentaje' && d.descuento > 100) {
        next[idx] = 'Descuento porcentual no puede superar 100%.';
        return;
      }
      if (![1, 2, 3].includes(d.orden)) {
        next[idx] = 'Orden inválido.';
        return;
      }
      if (ordenes.has(d.orden)) {
        next[idx] = `Ya hay otro grupo con orden ${d.orden}.`;
        return;
      }
      ordenes.add(d.orden);
    });

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const persisted: ProductGroup[] = drafts.map((d) => ({
      id: d.id ?? `grp_local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      nombre: d.nombre.trim(),
      cantidad: d.cantidad,
      descuento: d.descuento,
      descuento_tipo: d.descuento_tipo,
      admite_acum_desc: d.admite_acum_desc,
      orden: d.orden,
    }));
    onSave(persisted);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b pb-2 border-gray-100 dark:border-zinc-800">
        <h4 className="font-extrabold text-xs text-amber-600 dark:text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> Grupos de venta (presentaciones)
        </h4>
        <span className="text-[10px] text-gray-400 font-bold">
          {drafts.length} / {MAX_GROUPS}
        </span>
      </div>

      {drafts.length === 0 && (
        <p className="text-[11px] text-gray-400 italic text-center py-3">
          Sin grupos. Agregá presentaciones como "Docena" o "Media docena" para venta rápida en POS.
        </p>
      )}

      {drafts.map((d, idx) => {
        const base = calcularPrecioBase(product.price, d as ProductGroup);
        const total = calcularTotalFinal(product.price, d as ProductGroup);
        const ahorro = parseFloat((base - total).toFixed(2));

        // PM-03: Validación en tiempo real — descuento fijo no puede ser >= precio base.
        // Se recalcula reactivamente al cambiar cantidad, precio unitario, descuento o tipo.
        const descuentoFijoExcedePrecio =
          d.descuento_tipo === 'fijo' && d.descuento >= base && base > 0;

        return (
          <div
            key={idx}
            className="border border-gray-200 dark:border-zinc-800 rounded-2xl p-3 bg-gray-50/50 dark:bg-zinc-950/30 space-y-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 col-span-2">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase tracking-wider">
                  Nombre
                </label>
                <input
                  id={`group-nombre-${idx}`}
                  type="text"
                  maxLength={MAX_NAME_LEN}
                  placeholder="Ej: Docena"
                  value={d.nombre}
                  onChange={(e) => updateDraft(idx, { nombre: e.target.value })}
                  className="w-full text-xs bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase tracking-wider">
                  Cantidad
                </label>
                <input
                  id={`group-cantidad-${idx}`}
                  type="number"
                  min={2}
                  max={1000}
                  step={1}
                  value={d.cantidad}
                  onChange={(e) =>
                    updateDraft(idx, { cantidad: Math.max(2, Math.floor(Number(e.target.value) || 0)) })
                  }
                  className="w-full text-xs font-mono bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase tracking-wider">
                  Orden (1-3)
                </label>
                <select
                  id={`group-orden-${idx}`}
                  value={d.orden}
                  onChange={(e) =>
                    updateDraft(idx, { orden: Number(e.target.value) as 1 | 2 | 3 })
                  }
                  className="w-full text-xs bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-2 focus:outline-none text-gray-850 dark:text-zinc-100"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase tracking-wider">
                  Tipo Descuento
                </label>
                <select
                  id={`group-tipo-${idx}`}
                  value={d.descuento_tipo}
                  onChange={(e) =>
                    updateDraft(idx, {
                      descuento_tipo: e.target.value as 'porcentaje' | 'fijo',
                    })
                  }
                  className="w-full text-xs bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-2 focus:outline-none text-gray-850 dark:text-zinc-100"
                >
                  <option value="porcentaje">Porcentaje (%)</option>
                  <option value="fijo">Monto fijo ($)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase tracking-wider">
                  Descuento {d.descuento_tipo === 'porcentaje' ? '(%)' : '($)'}
                </label>
                <input
                  id={`group-descuento-${idx}`}
                  type="number"
                  min={0}
                  max={d.descuento_tipo === 'porcentaje' ? 100 : undefined}
                  step="0.01"
                  value={d.descuento}
                  onChange={(e) =>
                    updateDraft(idx, { descuento: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="w-full text-xs font-mono bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[10px] font-semibold text-gray-600 dark:text-zinc-300 cursor-pointer select-none">
              <input
                id={`group-acum-${idx}`}
                type="checkbox"
                checked={d.admite_acum_desc === 1}
                onChange={(e) =>
                  updateDraft(idx, { admite_acum_desc: e.target.checked ? 1 : 0 })
                }
                className="rounded text-amber-500 border-gray-300 focus:ring-amber-500 h-3.5 w-3.5"
              />
              Admite descuento acumulado adicional en POS
            </label>

            {/* Visores en tiempo real */}
            <div className="grid grid-cols-3 gap-2 text-[10px] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-2">
              <div className="text-center">
                <p className="text-gray-400 uppercase font-bold">Precio base</p>
                <p className="font-mono font-extrabold text-gray-700 dark:text-zinc-300">
                  {formatCurrency(base)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 uppercase font-bold">Total final</p>
                <p className="font-mono font-extrabold text-amber-600 dark:text-amber-500">
                  {formatCurrency(total)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 uppercase font-bold">Ahorro</p>
                <p className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(Math.max(0, ahorro))}
                </p>
              </div>
            </div>

            {descuentoFijoExcedePrecio && (
              <p
                id={`group-error-descuento-${idx}`}
                className="text-[10px] text-red-600 dark:text-red-400 font-bold"
              >
                El descuento supera el precio del grupo.
              </p>
            )}

            {errors[idx] && (
              <p className="text-[10px] text-red-600 dark:text-red-400 font-bold">{errors[idx]}</p>
            )}

            <button
              type="button"
              id={`btn-group-remove-${idx}`}
              onClick={() => removeDraft(idx)}
              className="w-full py-1.5 text-[10px] font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-lg cursor-pointer flex items-center justify-center gap-1 transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Quitar grupo
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          id="btn-group-add"
          onClick={addDraft}
          disabled={drafts.length >= MAX_GROUPS}
          className="flex-1 py-2 px-3 text-[11px] font-bold border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar presentación
        </button>
        <button
          type="button"
          id="btn-group-save"
          onClick={handleSave}
          disabled={hasFijoExcedido}
          className="flex-1 py-2 px-3 text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 transition-colors"
        >
          <Save className="h-3.5 w-3.5" /> Guardar grupos
        </button>
      </div>
    </div>
  );
};
