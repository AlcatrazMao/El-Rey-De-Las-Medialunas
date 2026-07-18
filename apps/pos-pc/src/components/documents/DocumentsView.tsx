import { FileText, Receipt, Truck, Ban } from 'lucide-react';
import React, { useState } from 'react';

import { useApp } from '../../AppContext';
import { useDocuments } from '../../hooks/useDocuments';
import { useDocumentSettings } from '../../hooks/useDocumentSettings';
import { printDocument } from '../../utils/exportUtils';

import { CreateBudgetModal } from './CreateBudgetModal';
import { CreateCreditNoteModal } from './CreateCreditNoteModal';
import { CreateRemitoModal } from './CreateRemitoModal';

/**
 * Panel "Comprobantes": punto de entrada a las 3 pantallas de emisión que no
 * pasan por el carrito de venta (Remito, Presupuesto, Nota de Crédito — change
 * "Document Types"). Sigue el mismo patrón que TransfersView: header + grid
 * de acciones, con modales que se abren por encima.
 *
 * Cada tipo respeta el toggle de useDocumentSettings: si está deshabilitado
 * para la sucursal activa, la card se muestra atenuada con un mensaje claro
 * en vez de dejar abrir el modal y fallar recién al enviar.
 */
export const DocumentsView: React.FC = () => {
  const { activeUser, addSystemNotification } = useApp();
  const { data: documentSettings, isLoading: loadingSettings } = useDocumentSettings();
  const { createRemito, createBudget, createCreditNote } = useDocuments();

  const [openModal, setOpenModal] = useState<'remito' | 'presupuesto' | 'nota_credito' | null>(null);

  const isEnabled = (type: 'remito' | 'presupuesto' | 'nota_credito'): boolean => {
    // Mientras no cargó la config o no hay fila para el tipo, no bloqueamos
    // (mismo criterio tolerante que POSView: no bloquear la operación por
    // falta de red/config — ver useDocumentSettings.ts).
    if (loadingSettings || documentSettings.length === 0) return true;
    const setting = documentSettings.find(d => d.document_type === type);
    return setting ? setting.enabled : true;
  };

  const cards: { type: 'remito' | 'presupuesto' | 'nota_credito'; label: string; description: string; icon: React.ReactNode }[] = [
    { type: 'remito', label: 'Remito', description: 'Traslado de mercadería sin precios ni IVA.', icon: <Truck className="h-5 w-5" /> },
    { type: 'presupuesto', label: 'Presupuesto', description: 'Cotización con precios, no afecta stock ni caja.', icon: <FileText className="h-5 w-5" /> },
    { type: 'nota_credito', label: 'Nota de crédito', description: 'Referencia siempre una venta real existente.', icon: <Receipt className="h-5 w-5" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 px-4 py-3 flex items-center gap-2 shrink-0">
        <FileText className="h-5 w-5 text-amber-500" />
        <h1 className="text-base font-bold text-gray-900 dark:text-white">Comprobantes</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(card => {
            const enabled = isEnabled(card.type);
            return (
              <button
                key={card.type}
                disabled={!enabled}
                onClick={() => enabled && setOpenModal(card.type)}
                className={`text-left rounded-2xl border p-4 flex flex-col gap-2 transition-all ${
                  enabled
                    ? 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-amber-400 hover:shadow-md cursor-pointer'
                    : 'bg-gray-100 dark:bg-zinc-900/50 border-gray-200 dark:border-zinc-800 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-2 text-amber-500">
                  {enabled ? card.icon : <Ban className="h-5 w-5 text-gray-400" />}
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{card.label}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-zinc-400">{card.description}</p>
                {!enabled && (
                  <p className="text-[11px] font-semibold text-red-500">
                    Deshabilitado para esta sucursal. Activalo en Configuración → Comprobantes.
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {openModal === 'remito' && (
        <CreateRemitoModal
          onClose={() => setOpenModal(null)}
          onCreate={createRemito}
          onCreated={(result, printItems, customerName) => {
            setOpenModal(null);
            addSystemNotification('Remito creado', `Remito #${result.document_number} generado con éxito.`, 'success');
            void printDocument('remito', {
              documentNumber: result.document_number,
              items: printItems,
              operatorName: activeUser.name,
              customerName,
            });
          }}
        />
      )}

      {openModal === 'presupuesto' && (
        <CreateBudgetModal
          onClose={() => setOpenModal(null)}
          onCreate={createBudget}
          onCreated={(result, printItems, customerName) => {
            setOpenModal(null);
            addSystemNotification('Presupuesto creado', `Presupuesto #${result.document_number} generado con éxito.`, 'success');
            void printDocument('presupuesto', {
              documentNumber: result.document_number,
              items: printItems,
              operatorName: activeUser.name,
              customerName,
              total: result.total,
              subtotal: result.subtotal,
              validUntil: result.valid_until,
            });
          }}
        />
      )}

      {openModal === 'nota_credito' && (
        <CreateCreditNoteModal
          onClose={() => setOpenModal(null)}
          onCreate={createCreditNote}
          onCreated={(result, originalDocumentNumber) => {
            setOpenModal(null);
            addSystemNotification('Nota de crédito creada', `Nota de crédito #${result.document_number} generada con éxito.`, 'success');
            void printDocument('nota_credito', {
              documentNumber: result.document_number,
              items: [],
              operatorName: activeUser.name,
              total: result.amount,
              creditNoteReason: result.reason,
              originalDocumentNumber,
            });
          }}
        />
      )}
    </div>
  );
};

export default DocumentsView;
