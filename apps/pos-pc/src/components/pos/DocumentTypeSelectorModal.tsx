import { ArrowLeft, Check, ChevronRight, FileMinus, FilePlus, FileText, Receipt, ReceiptText, Truck, X, AlertTriangle } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { DocumentType } from '../../types';

export type DocumentFamily = 'ticket' | 'factura' | 'nota_credito' | 'nota_debito' | 'presupuesto' | 'remito';

export interface FamilyConfig {
  id: DocumentFamily;
  label: string;
  icon: string;
  description: string;
  hasVariants: boolean;
  directType?: DocumentType;
  variants?: DocumentType[];
}

export const FAMILIES: FamilyConfig[] = [
  {
    id: 'ticket',
    label: 'Ticket',
    icon: '🎫',
    description: 'Comprobante rápido de venta para mostrador.',
    hasVariants: false,
    directType: 'ticket',
  },
  {
    id: 'factura',
    label: 'Factura',
    icon: '📑',
    description: 'Facturación electrónica AFIP / ARCA (A, B, C, M).',
    hasVariants: true,
    variants: ['factura_a', 'factura_b', 'factura_c', 'factura_m'],
  },
  {
    id: 'nota_credito',
    label: 'Nota de Crédito',
    icon: '🧾',
    description: 'Comprobante de crédito, anulación o devolución.',
    hasVariants: true,
    variants: ['nota_credito_a', 'nota_credito_b', 'nota_credito_c', 'nota_credito_m'],
  },
  {
    id: 'nota_debito',
    label: 'Nota de Débito',
    icon: '📄',
    description: 'Comprobante de recargo o ajuste de saldo.',
    hasVariants: true,
    variants: ['nota_debito_a', 'nota_debito_b', 'nota_debito_c', 'nota_debito_m'],
  },
  {
    id: 'presupuesto',
    label: 'Presupuesto',
    icon: '📋',
    description: 'Cotización con validez formal. No afecta stock ni caja.',
    hasVariants: false,
    directType: 'presupuesto',
  },
  {
    id: 'remito',
    label: 'Remito',
    icon: '🚚',
    description: 'Documento oficial de entrega y traslado de mercadería.',
    hasVariants: false,
    directType: 'remito',
  },
];

export interface VariantDetail {
  type: DocumentType;
  letter: string;
  label: string;
  description: string;
  requirement: string;
  requiresCuit: boolean;
}

export const VARIANTS_BY_FAMILY: Record<'factura' | 'nota_credito' | 'nota_debito', VariantDetail[]> = {
  factura: [
    {
      type: 'factura_a',
      letter: 'A',
      label: 'Factura A',
      description: 'Emisor Responsable Inscripto a cliente Responsable Inscripto. Discrimina IVA.',
      requirement: 'Requiere CUIT del cliente cargado',
      requiresCuit: true,
    },
    {
      type: 'factura_b',
      letter: 'B',
      label: 'Factura B',
      description: 'Emisor Responsable Inscripto a Consumidor Final, Monotributista o Exento.',
      requirement: 'Consumidor Final / Monotributo',
      requiresCuit: false,
    },
    {
      type: 'factura_c',
      letter: 'C',
      label: 'Factura C',
      description: 'Emitida por sujetos Monotributistas o Exentos a cualquier destinatario.',
      requirement: 'Operaciones Monotributo',
      requiresCuit: false,
    },
    {
      type: 'factura_m',
      letter: 'M',
      label: 'Factura M',
      description: 'Régimen especial con retención total de IVA y 6% de Ganancias.',
      requirement: 'Requiere CUIT del cliente cargado',
      requiresCuit: true,
    },
  ],
  nota_credito: [
    {
      type: 'nota_credito_a',
      letter: 'A',
      label: 'Nota de Crédito A',
      description: 'Anulación o crédito sobre comprobantes A.',
      requirement: 'Requiere CUIT del cliente cargado',
      requiresCuit: true,
    },
    {
      type: 'nota_credito_b',
      letter: 'B',
      label: 'Nota de Crédito B',
      description: 'Anulación o crédito sobre comprobantes B (Consumidor Final).',
      requirement: 'Consumidor Final',
      requiresCuit: false,
    },
    {
      type: 'nota_credito_c',
      letter: 'C',
      label: 'Nota de Crédito C',
      description: 'Anulación o crédito sobre comprobantes C (Monotributo).',
      requirement: 'Monotributo',
      requiresCuit: false,
    },
    {
      type: 'nota_credito_m',
      letter: 'M',
      label: 'Nota de Crédito M',
      description: 'Anulación o crédito sobre comprobantes M.',
      requirement: 'Requiere CUIT del cliente cargado',
      requiresCuit: true,
    },
  ],
  nota_debito: [
    {
      type: 'nota_debito_a',
      letter: 'A',
      label: 'Nota de Débito A',
      description: 'Recargo o ajuste sobre comprobantes A.',
      requirement: 'Requiere CUIT del cliente cargado',
      requiresCuit: true,
    },
    {
      type: 'nota_debito_b',
      letter: 'B',
      label: 'Nota de Débito B',
      description: 'Recargo o ajuste sobre comprobantes B (Consumidor Final).',
      requirement: 'Consumidor Final',
      requiresCuit: false,
    },
    {
      type: 'nota_debito_c',
      letter: 'C',
      label: 'Nota de Débito C',
      description: 'Recargo o ajuste sobre comprobantes C (Monotributo).',
      requirement: 'Monotributo',
      requiresCuit: false,
    },
    {
      type: 'nota_debito_m',
      letter: 'M',
      label: 'Nota de Débito M',
      description: 'Recargo o ajuste sobre comprobantes M.',
      requirement: 'Requiere CUIT del cliente cargado',
      requiresCuit: true,
    },
  ],
};

export function getFamilyForDocumentType(type: DocumentType): DocumentFamily {
  if (type === 'ticket') return 'ticket';
  if (type === 'presupuesto') return 'presupuesto';
  if (type === 'remito') return 'remito';
  if (type.startsWith('factura_')) return 'factura';
  if (type.startsWith('nota_credito_')) return 'nota_credito';
  if (type.startsWith('nota_debito_')) return 'nota_debito';
  return 'ticket';
}

export interface DocumentTypeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedType: DocumentType;
  onSelect: (type: DocumentType) => void;
  isTypeEnabled?: (type: DocumentType) => boolean;
}

export const DocumentTypeSelectorModal: React.FC<DocumentTypeSelectorModalProps> = ({
  isOpen,
  onClose,
  selectedType,
  onSelect,
  isTypeEnabled = () => true,
}) => {
  const [activeFamilyView, setActiveFamilyView] = useState<'factura' | 'nota_credito' | 'nota_debito' | null>(null);

  if (!isOpen) return null;

  const currentFamily = getFamilyForDocumentType(selectedType);

  const handleFamilyClick = (family: FamilyConfig) => {
    if (!family.hasVariants && family.directType) {
      if (isTypeEnabled(family.directType)) {
        onSelect(family.directType);
        onClose();
      }
    } else if (family.hasVariants && (family.id === 'factura' || family.id === 'nota_credito' || family.id === 'nota_debito')) {
      setActiveFamilyView(family.id);
    }
  };

  const handleVariantClick = (type: DocumentType) => {
    if (isTypeEnabled(type)) {
      onSelect(type);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-2.5">
            {activeFamilyView ? (
              <button
                type="button"
                onClick={() => setActiveFamilyView(null)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-gray-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Volver a comprobantes"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            <div>
              <h3 className="text-sm font-extrabold text-gray-850 dark:text-zinc-100">
                {activeFamilyView === 'factura' && 'Seleccionar Tipo de Factura'}
                {activeFamilyView === 'nota_credito' && 'Seleccionar Nota de Crédito'}
                {activeFamilyView === 'nota_debito' && 'Seleccionar Nota de Débito'}
                {!activeFamilyView && 'Tipo de Comprobante'}
              </h3>
              <p className="text-[11px] text-gray-400">
                {activeFamilyView
                  ? 'Elegí la variante fiscal que corresponde a esta operación'
                  : 'Elegí el comprobante formal con los productos del carrito activo'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {!activeFamilyView ? (
            /* Vista Principal: 6 Familias */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FAMILIES.map(family => {
                const isCurrentFamily = currentFamily === family.id;
                const isDirectEnabled = family.directType ? isTypeEnabled(family.directType) : true;
                const enabledVariantsCount = family.variants
                  ? family.variants.filter(v => isTypeEnabled(v)).length
                  : 1;
                const isFamilyAvailable = family.hasVariants ? enabledVariantsCount > 0 : isDirectEnabled;

                return (
                  <button
                    key={family.id}
                    type="button"
                    disabled={!isFamilyAvailable}
                    onClick={() => handleFamilyClick(family)}
                    className={`text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer ${
                      !isFamilyAvailable
                        ? 'opacity-40 bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 cursor-not-allowed'
                        : isCurrentFamily
                          ? 'bg-amber-500/10 border-amber-500 shadow-sm ring-1 ring-amber-500/30 dark:bg-amber-950/20'
                          : 'bg-white dark:bg-zinc-850/60 border-gray-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-600 hover:bg-amber-50/30 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xl leading-none">{family.icon}</span>
                          <span className="text-xs font-extrabold text-gray-850 dark:text-zinc-100">
                            {family.label}
                          </span>
                        </div>
                        {isCurrentFamily && (
                          <span className="px-2 py-0.5 text-[9px] font-extrabold rounded-full bg-amber-500 text-white flex items-center gap-0.5 shadow-xs">
                            <Check className="h-2.5 w-2.5" /> Activo
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 dark:text-zinc-400 line-clamp-2">
                        {family.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-gray-100 dark:border-zinc-800/80 flex items-center justify-between text-[10px]">
                      {family.hasVariants ? (
                        <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                          Ver variantes (A, B, C, M) <ChevronRight className="h-3 w-3" />
                        </span>
                      ) : (
                        <span className="text-gray-400 font-semibold">
                          Selección directa
                        </span>
                      )}
                      {!isFamilyAvailable && (
                        <span className="text-red-500 font-bold text-[9px]">Deshabilitado</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Vista de Variantes: A, B, C, M */
            <div className="space-y-2.5">
              {VARIANTS_BY_FAMILY[activeFamilyView].map(variant => {
                const isSelected = selectedType === variant.type;
                const isEnabled = isTypeEnabled(variant.type);

                return (
                  <button
                    key={variant.type}
                    type="button"
                    disabled={!isEnabled}
                    onClick={() => handleVariantClick(variant.type)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3.5 cursor-pointer ${
                      !isEnabled
                        ? 'opacity-40 bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 cursor-not-allowed'
                        : isSelected
                          ? 'bg-amber-500/10 border-amber-500 shadow-sm ring-1 ring-amber-500/30 dark:bg-amber-950/20'
                          : 'bg-white dark:bg-zinc-850/60 border-gray-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-600 hover:bg-amber-50/30 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <div
                      className={`h-9 w-9 rounded-lg flex items-center justify-center font-extrabold text-sm shrink-0 ${
                        isSelected
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-200'
                      }`}
                    >
                      {variant.letter}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-gray-850 dark:text-zinc-100 truncate">
                          {variant.label}
                        </span>
                        {isSelected && (
                          <span className="px-2 py-0.5 text-[9px] font-extrabold rounded-full bg-amber-500 text-white shrink-0 flex items-center gap-0.5 shadow-xs">
                            <Check className="h-2.5 w-2.5" /> Seleccionado
                          </span>
                        )}
                        {!isEnabled && (
                          <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 shrink-0">
                            Deshabilitado
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] text-gray-500 dark:text-zinc-400 mt-0.5">
                        {variant.description}
                      </p>

                      <div className="mt-2 flex items-center gap-2">
                        {variant.requiresCuit ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-extrabold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 rounded-md">
                            <AlertTriangle className="h-2.5 w-2.5" /> {variant.requirement}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md">
                            ✓ {variant.requirement}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/50 flex items-center justify-between text-[11px] shrink-0">
          <span className="text-gray-400">
            Actual: <strong className="text-gray-700 dark:text-zinc-200">{selectedType.toUpperCase().replace(/_/g, ' ')}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
