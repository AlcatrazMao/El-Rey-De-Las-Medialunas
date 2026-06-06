import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { 
  TrendingUp, 
  Package, 
  ArrowRightLeft, 
  Plus, 
  Clock, 
  CheckCircle2, 
  X, 
  History, 
  Sparkles, 
  Workflow 
} from 'lucide-react';

export const PanaderoSupplyView: React.FC = () => {
  const {
    products,
    ingredients,
    supplyRequests,
    requestSupply,
    addSystemNotification
  } = useApp();

  const [activeFormTab, setActiveFormTab] = useState<'ingredient' | 'product'>('ingredient');

  // Ingredient Form State
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>(ingredients[0]?.id || '');
  const [ingredientQty, setIngredientQty] = useState<number>(10);
  const [ingredientReason, setIngredientReason] = useState<string>('Bajo nivel de stock en la fosa de amasado.');

  // Product Form State
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [productQty, setProductQty] = useState<number>(50);
  const [productReason, setProductReason] = useState<string>('Producción fresca lista en el horno. Solicito traslado a mostrador.');

  const activeIngredient = ingredients.find(i => i.id === selectedIngredientId);
  const activeProduct = products.find(p => p.id === selectedProductId);

  const handleIngredientSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedIngredientId) {
      addSystemNotification('⚠️ Selección Incompleta', 'Selecciona una materia prima para reabastecer.', 'error');
      return;
    }

    if (ingredientQty <= 0) {
      addSystemNotification('⚠️ Cantidad Inválida', 'La cantidad del insumo debe ser superior a 0.', 'error');
      return;
    }

    if (!ingredientReason.trim()) {
      addSystemNotification('⚠️ Justificación Obligatoria', 'Describe por qué necesitas este insumo.', 'error');
      return;
    }

    requestSupply('ingredient', selectedIngredientId, ingredientQty, ingredientReason);
    setIngredientReason('Reposición ordinaria de materiales de panadería.');
    addSystemNotification('🚚 Solicitud Enviada', 'Se registró tu solicitud de insumos correctamente.', 'success');
  };

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProductId) {
      addSystemNotification('⚠️ Selección Incompleta', 'Elige qué artículo de panadería deseas transferir.', 'error');
      return;
    }

    if (productQty <= 0) {
      addSystemNotification('⚠️ Cantidad Inválida', 'La cantidad del lote de panadería debe ser superior a 0.', 'error');
      return;
    }

    if (!productReason.trim()) {
      addSystemNotification('⚠️ Justificación Obligatoria', 'Indica el detalle del lote elaborado.', 'error');
      return;
    }

    requestSupply('product', selectedProductId, productQty, productReason);
    setProductReason('Lote caliente listo en bandeja de traslado.');
    addSystemNotification('🔥 Solicitud Enviada', 'Se registró el pedido de aprobación de traslado.', 'success');
  };

  return (
    <div className="space-y-6">
      
      {/* Upper header segment */}
      <div className="border-b border-orange-100/50 dark:border-zinc-800/60 pb-5">
        <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-amber-500 animate-pulse" /> Solicitudes de Abastecimiento y Traslado de Producción
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Bandeja de comunicación directa entre panadería interna y administración general. Solicita materias primas al depósito central o pide aprobación para registrar y trasladar nuevos lotes terminados.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left section: Interactive Request Forms */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Selector Tabs */}
          <div className="bg-gray-100 dark:bg-zinc-950/40 p-1 rounded-2xl flex border border-gray-150 dark:border-zinc-800">
            <button
              id="tab-supply-ing"
              onClick={() => setActiveFormTab('ingredient')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeFormTab === 'ingredient'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-gray-550 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
              }`}
            >
              <Workflow className="h-3.5 w-3.5" /> Solicitar Insumo (Depósito)
            </button>
            <button
              id="tab-supply-prod"
              onClick={() => setActiveFormTab('product')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeFormTab === 'product'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-gray-550 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" /> Enviar Producto Elaborado
            </button>
          </div>

          {/* Form container */}
          <div className="bg-gray-50/50 dark:bg-zinc-950/25 border border-gray-150 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
            {activeFormTab === 'ingredient' ? (
              <form onSubmit={handleIngredientSubmit} className="space-y-4 text-xs">
                <div className="bg-amber-100/10 dark:bg-amber-950/10 border border-amber-500/10 rounded-xl p-3 text-[11px] text-amber-800 dark:text-amber-400 font-semibold mb-2 leading-relaxed">
                  📢 <strong>Solicitud de Insumos:</strong> Envía un aviso de abastecimiento a depósito para que el administrador retire o compre stock extra de los ingredientes básicos.
                </div>

                {/* Choose Ingredient */}
                <div className="space-y-1">
                  <label className="font-extrabold text-[10px] text-gray-400 uppercase">Materia Prima Requerida</label>
                  <select
                    id="select-supply-ing"
                    value={selectedIngredientId}
                    onChange={(e) => setSelectedIngredientId(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
                  >
                    {ingredients.map(i => (
                      <option key={i.id} value={i.id}>
                        🌾 {i.name} (Stock: {i.stock.toFixed(1)} {i.unit})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quantity */}
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="font-extrabold text-[10px] text-gray-400 uppercase">Cantidad Solicitada</label>
                    {activeIngredient && (
                      <span className="text-[10px] text-amber-600 font-black uppercase">{activeIngredient.unit}</span>
                    )}
                  </div>
                  <input
                    id="input-supply-ing-qty"
                    type="number"
                    min="1"
                    value={ingredientQty}
                    onChange={(e) => setIngredientQty(Number(e.target.value))}
                    className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Reason */}
                <div className="space-y-1">
                  <label className="font-extrabold text-[10px] text-gray-400 uppercase">Motivo o Justificación del Pedido</label>
                  <textarea
                    id="input-supply-ing-reason"
                    required
                    rows={3}
                    value={ingredientReason}
                    onChange={(e) => setIngredientReason(e.target.value)}
                    placeholder="Ejemplo: Necesitamos más levadura fresca ya que incrementamos el volumen de facturas para el fin de semana."
                    className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <button
                  type="submit"
                  id="btn-submit-supply-ing"
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer shadow-md transition-all active:scale-95"
                >
                  Enviar Pedido de Insumo ✓
                </button>
              </form>
            ) : (
              <form onSubmit={handleProductSubmit} className="space-y-4 text-xs">
                <div className="bg-emerald-100/10 dark:bg-emerald-950/10 border border-emerald-500/10 rounded-xl p-3 text-[11px] text-emerald-800 dark:text-emerald-450 font-semibold mb-2 leading-relaxed">
                  🥐 <strong>Aprobación de Traslado:</strong> Registra la mercadería nueva elaborada que está lista para colocarse bajo mostrador. El administrador autorizará el ingreso sumándolo al stock vendible. Una vez aprobado, el sistema creará un lote de control automáticamente.
                </div>

                {/* Choose Product */}
                <div className="space-y-1">
                  <label className="font-extrabold text-[10px] text-gray-400 uppercase">Producto de Panadería a Trasladar</label>
                  <select
                    id="select-supply-prod"
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.image} {p.name} (Stock Mostrador: {p.stock} u.)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quantity */}
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="font-extrabold text-[10px] text-gray-400 uppercase">Cantidad Total Producida</label>
                    <span className="text-[10px] text-emerald-600 font-extrabold pb-0.5">unidades</span>
                  </div>
                  <input
                    id="input-supply-prod-qty"
                    type="number"
                    min="1"
                    value={productQty}
                    onChange={(e) => setProductQty(Number(e.target.value))}
                    className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Reason */}
                <div className="space-y-1">
                  <label className="font-extrabold text-[10px] text-gray-400 uppercase">Detalle del Lote / Bandeja</label>
                  <textarea
                    id="input-supply-prod-reason"
                    required
                    rows={3}
                    value={productReason}
                    onChange={(e) => setProductReason(e.target.value)}
                    placeholder="Ejemplo: Salieron 50 flautas calientes recién horneadas para reposición vespertina."
                    className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <button
                  type="submit"
                  id="btn-submit-supply-prod"
                  className="w-full py-3 bg-emerald-550 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer shadow-md transition-all active:scale-95"
                >
                  Solicitar Traslado de Productos ✓
                </button>
              </form>
            )}
          </div>

        </div>

        {/* Right section: Request Monitoring Board */}
        <div className="lg:col-span-7 space-y-4">
          <h3 className="font-extrabold text-xs text-gray-400 uppercase tracking-wider flex items-center gap-1.5 leading-none select-none">
            <History className="h-3.5 w-3.5 text-amber-500" /> Estado de Solicitudes Realizadas
          </h3>

          {supplyRequests.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800 rounded-3xl select-none">
              <Clock className="mx-auto h-8 w-8 text-gray-300 dark:text-zinc-700 animate-pulse mb-3" />
              <p className="text-xs text-gray-400 italic">Haz tu primer pedido o reporte de producción arriba.</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {supplyRequests.map(req => {
                let statusClass = "bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-350/20";
                let statusLabel = "Pendiente de Autorización";
                let StatusIconObj = Clock;

                if (req.status === 'approved') {
                  statusClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-350/20";
                  statusLabel = "Aprobado - Stock Aumentado";
                  StatusIconObj = CheckCircle2;
                } else if (req.status === 'rejected') {
                  statusClass = "bg-red-100 text-red-700 dark:bg-red-950/20 dark:text-red-400 border-red-350/20";
                  statusLabel = "Rechazado";
                  StatusIconObj = X;
                }

                return (
                  <div
                    key={req.id}
                    className="bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800/80 rounded-2xl p-4.5 space-y-3 shadow-xs transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 select-none">
                          <span className="font-extrabold text-sm text-gray-850 dark:text-zinc-150">{req.itemName}</span>
                          <span className={`text-[8.5px] px-1.5 py-0.5 rounded-md font-bold uppercase ${
                            req.type === 'ingredient' 
                              ? 'bg-amber-500/10 text-amber-600' 
                              : 'bg-emerald-500/10 text-emerald-600'
                          }`}>
                            {req.type === 'ingredient' ? 'Insumo 🌾' : 'Producción 🥖'}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400">
                          {new Date(req.date).toLocaleString()} • por <span className="font-semibold text-zinc-400">{req.requestedBy}</span>
                        </p>
                      </div>

                      <div className={`px-2.5 py-1 rounded-full border text-[9px] font-black uppercase flex items-center gap-1 w-fit ${statusClass}`}>
                        <StatusIconObj className="h-3 w-3 shrink-0" />
                        {statusLabel}
                      </div>
                    </div>

                    <div className="bg-gray-50/50 dark:bg-zinc-950/30 border border-gray-100 dark:border-zinc-850/60 p-3 rounded-xl text-xs space-y-2">
                      <div>
                        <span className="font-bold text-gray-400 block text-[9px] uppercase tracking-wider mb-1">Detalles de la solicitud:</span>
                        <p className="font-medium text-gray-705 dark:text-zinc-300">
                          Se solicita incorporar <strong className="text-zinc-800 dark:text-white font-black">{req.quantity} {req.unit}</strong>.
                        </p>
                        <p className="mt-1 text-gray-500 dark:text-zinc-400 italic">
                          " {req.reason} "
                        </p>
                      </div>

                      {req.adminMemo && (
                        <div className="pt-2 border-t border-gray-200/50 dark:border-zinc-800/80">
                          <span className="font-bold text-gray-450 block text-[9px] uppercase tracking-wider mb-1">
                            Comentario de Administración:
                          </span>
                          <p className="font-extrabold text-amber-600 dark:text-amber-450 italic">
                            "{req.adminMemo}"
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
