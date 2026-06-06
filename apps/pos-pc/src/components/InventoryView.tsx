import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { exportIngredientsToCSV } from '../utils/exportUtils';
import {
  Download,
  Plus,
  Package,
  Wheat,
  Activity,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Search,
  CheckCircle,
  X,
  Calendar,
  Check,
  History,
  Trash2,
  FileText,
  ShieldAlert
} from 'lucide-react';
import { Ingredient, Product, CategoryType, ProductIngredient, ProductBatch, BatchWithdrawalRequest } from '../types';

export const InventoryView: React.FC = () => {
  const {
    ingredients,
    products,
    addIngredient,
    updateIngredientStock,
    addProduct,
    updateProductStock,
    addSystemNotification,
    setActiveTab,
    batches = [],
    withdrawalRequests = [],
    addBatch,
    requestBatchWithdrawal,
    approveWithdrawalRequest,
    rejectWithdrawalRequest,
    activeUser
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'insumos' | 'productos' | 'caducidad' | 'mermas'>('insumos');
  const [selectedProductForBatches, setSelectedProductForBatches] = useState<Product | null>(null);
  const [mermasFilter, setMermasFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const [resolvingMemo, setResolvingMemo] = useState<string>('');
  const [resolvingAction, setResolvingAction] = useState<'approved' | 'rejected' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Expiry Priority States
  const [priorityCriteria, setPriorityCriteria] = useState<'categoria' | 'precio' | 'unidades'>(() => {
    return (localStorage.getItem('pan_erp_criteria') as 'categoria' | 'precio' | 'unidades') || 'categoria';
  });
  const [priorityAlertDays, setPriorityAlertDays] = useState<number>(() => {
    const saved = localStorage.getItem('pan_erp_alert_days');
    return saved ? Number(saved) : 2;
  });
  const [priorityCategory, setPriorityCategory] = useState<string>(() => {
    return localStorage.getItem('pan_erp_prio_cat') || 'pasteleria';
  });

  const handleSavePriorityConfig = (criteria: 'categoria' | 'precio' | 'unidades', days: number, cat: string) => {
    setPriorityCriteria(criteria);
    setPriorityAlertDays(days);
    setPriorityCategory(cat);
    localStorage.setItem('pan_erp_criteria', criteria);
    localStorage.setItem('pan_erp_alert_days', days.toString());
    localStorage.setItem('pan_erp_prio_cat', cat);
    addSystemNotification('⚙️ Prioridades Guardadas', `Se priorizaron alertas de caducidad por: ${criteria.toUpperCase()}`, 'success');
  };

  const getProductExpiryDays = (prod: Product) => {
    if (!prod.elaborationDate || !prod.durabilityDays) return 999;
    const elaborDateObj = new Date(prod.elaborationDate + 'T00:00:00');
    const expiryDateObj = new Date(elaborDateObj.getTime());
    expiryDateObj.setDate(expiryDateObj.getDate() + prod.durabilityDays);
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const diffTime = expiryDateObj.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getPrioritizedExpiryProducts = () => {
    let list = products.filter(p => p.durabilityDays !== undefined);
    
    list.sort((a, b) => {
      const daysA = getProductExpiryDays(a);
      const daysB = getProductExpiryDays(b);
      
      if (daysA !== daysB) {
        return daysA - daysB; 
      }
      
      if (priorityCriteria === 'precio') {
        return b.price - a.price;
      } else if (priorityCriteria === 'unidades') {
        return b.stock - a.stock;
      } else if (priorityCriteria === 'categoria') {
        const isA_Prio = a.category === priorityCategory ? 1 : 0;
        const isB_Prio = b.category === priorityCategory ? 1 : 0;
        return isB_Prio - isA_Prio;
      }
      
      return 0;
    });
    
    return list;
  };
  
  // Insumo creation form modal
  const [showInsumoModal, setShowInsumoModal] = useState(false);
  const [insumoName, setInsumoName] = useState('');
  const [insumoUnit, setInsumoUnit] = useState<Ingredient['unit']>('kg');
  const [insumoStock, setInsumoStock] = useState(10);
  const [insumoMinStock, setInsumoMinStock] = useState(5);
  const [insumoCost, setInsumoCost] = useState(1.5);

  // Product creation form modal & dynamic recipe builder
  const [showProductModal, setShowProductModal] = useState(false);
  const [prodName, setProdName] = useState('');
  const [prodCategory, setProdCategory] = useState<CategoryType>('panes');
  const [prodPrice, setProdPrice] = useState(1.5);
  const [prodCost, setProdCost] = useState(0.5);
  const [prodStock, setProdStock] = useState(50);
  const [prodMinStock, setProdMinStock] = useState(10);
  const [prodImage, setProdImage] = useState('🥖');
  const [selectedRecipeIngredients, setSelectedRecipeIngredients] = useState<{ ingredientId: string; quantity: number }[]>([]);

  // Individual stock adjust
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [tempStockValue, setTempStockValue] = useState<number>(0);

  // Handle ingredient addition
  const handleCreateInsumoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!insumoName.trim()) return;

    addIngredient({
      name: insumoName,
      unit: insumoUnit,
      stock: Number(insumoStock),
      minStock: Number(insumoMinStock),
      unitCost: Number(insumoCost)
    });

    // Reset fields
    setInsumoName('');
    setInsumoUnit('kg');
    setInsumoStock(10);
    setInsumoMinStock(5);
    setInsumoCost(1.5);
    setShowInsumoModal(false);
  };

  // Add ingredient requirement line to Product recipe builder
  const toggleRecipeIngredientItem = (ingredientId: string, quantity: number) => {
    setSelectedRecipeIngredients(prev => {
      const exists = prev.find(i => i.ingredientId === ingredientId);
      if (exists) {
        return prev.filter(i => i.ingredientId !== ingredientId);
      } else {
        return [...prev, { ingredientId, quantity }];
      }
    });
  };

  const updateRecipeIngredientQuantity = (ingredientId: string, val: number) => {
    setSelectedRecipeIngredients(prev =>
      prev.map(item =>
        item.ingredientId === ingredientId ? { ...item, quantity: val } : item
      )
    );
  };

  // Handle product addition
  const handleCreateProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName.trim()) return;

    addProduct({
      name: prodName,
      category: prodCategory,
      price: Number(prodPrice),
      cost: Number(prodCost),
      stock: Number(prodStock),
      minStock: Number(prodMinStock),
      image: prodImage,
      ingredients: selectedRecipeIngredients
    });

    // Reset controls
    setProdName('');
    setProdCategory('panes');
    setProdPrice(1.5);
    setProdCost(0.5);
    setProdStock(50);
    setProdMinStock(10);
    setProdImage('🥖');
    setSelectedRecipeIngredients([]);
    setShowProductModal(false);
  };

  // Quick replenish helper
  const triggerIncrementStockVal = (ing: Ingredient, incAmount: number) => {
    updateIngredientStock(ing.id, ing.stock + incAmount);
  };

  const currentIngredientsInventoryValue = ingredients.reduce((sum, ing) => sum + (ing.stock * ing.unitCost), 0);
  const currentProductsInventoryValue = products.reduce((sum, prod) => sum + (prod.stock * prod.price), 0);
  const totalLowStockInsumos = ingredients.filter(i => i.stock <= i.minStock).length;
  const totalLowStockProducts = products.filter(p => p.stock <= p.minStock).length;

  return (
    <div className="space-y-6 transition-all duration-300">
      
      {/* HEADER SECTION WITH STATS COUNTER */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between border-b pb-4 border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <Package className="h-5 w-5 text-amber-500" /> Control de Inventario en Tiempo Real
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Administración coordinada de insumos primarios y productos terminados listos para mostrador.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {activeSubTab === 'insumos' ? (
            <button
              id="btn-add-insumo-trigger"
              onClick={() => setShowInsumoModal(true)}
              className="py-2 px-4 rounded-xl text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 cursor-pointer flex items-center gap-1.5 shadow-sm hover:shadow-md h-9 shrink-0 transition-all"
            >
              <Plus className="h-4 w-4" /> Registrar Materia Prima
            </button>
          ) : (
            <button
              id="btn-add-product-trigger"
              onClick={() => setShowProductModal(true)}
              className="py-2 px-4 rounded-xl text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 cursor-pointer flex items-center gap-1.5 shadow-sm hover:shadow-md h-9 shrink-0 transition-all"
            >
              <Plus className="h-4 w-4" /> Registrar Pan Elaborado Mismo
            </button>
          )}

          <button
            id="btn-export-insumos"
            onClick={() => exportIngredientsToCSV(ingredients)}
            className="py-2 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 text-xs font-bold flex items-center gap-1.5 h-9 shrink-0 transition-all cursor-pointer"
            title="Exportar inventario del ERP a formato de datos CSV"
          >
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
        </div>
      </div>

      {/* THREE BENTO CARDS OF INVENTORY BALANCES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        
        {/* Card 1: Valor Insumos */}
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900">
            <Wheat className="h-6 w-6 text-amber-600 dark:text-amber-500" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest leading-tight">Valor Físico Insumos</p>
            <p className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 mt-1">
              ${currentIngredientsInventoryValue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">Estimado en base a costos netos</p>
          </div>
        </div>

        {/* Card 2: Valor Sucursal Mostrador */}
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900">
            <Activity className="h-6 w-6 text-emerald-600 dark:text-emerald-500" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest leading-tight">Valor Venta Mostrador</p>
            <p className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 mt-1">
              ${currentProductsInventoryValue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">Mercadería disponible para la venta</p>
          </div>
        </div>

        {/* Card 3: Alertas de Quiebre de Stock */}
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest leading-tight">Quiebre / Stock Bajo</p>
            <p className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 mt-1">
              {totalLowStockInsumos + totalLowStockProducts} Alertas
            </p>
            <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-1 font-bold">
              {totalLowStockInsumos} insumos • {totalLowStockProducts} horneados restantes
            </p>
          </div>
        </div>

      </div>

      {/* FILTER SUB-BAR (Insumos vs Productos Elaborados) */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-850 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs">
        <div className="bg-gray-100 dark:bg-zinc-950 p-0.5 rounded-xl flex border border-gray-200 dark:border-zinc-800 select-none">
          <button
            id="btn-subtab-insumos"
            onClick={() => setActiveSubTab('insumos')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'insumos'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700'
            }`}
          >
            Materia Prima / Insumos
          </button>
          <button
            id="btn-subtab-productos"
            onClick={() => setActiveSubTab('productos')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'productos'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700'
            }`}
          >
            Productos Elaborados
          </button>
          <button
            id="btn-subtab-caducidad"
            onClick={() => setActiveSubTab('caducidad')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'caducidad'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700'
            }`}
          >
            🕒 Control de Caducidad y Alertas
          </button>
          <button
            id="btn-subtab-mermas"
            onClick={() => setActiveSubTab('mermas')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'mermas'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700'
            }`}
          >
            📋 Solicitudes de Baja & Mermas
          </button>
        </div>

        <div className="relative w-full sm:w-64 select-none">
          <input
            id="stock-search"
            type="text"
            placeholder="Filtrar por nombre..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg py-2 pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-800 dark:text-zinc-100"
          />
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
        </div>
      </div>

      {/* LIST OR CARDS VIEW IN REAL TIME */}
      {activeSubTab === 'insumos' && (
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-950 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none">
                <tr>
                  <th className="py-4 px-5">Insumo</th>
                  <th className="py-4 px-5">Costo Unitario ($)</th>
                  <th className="py-4 px-5">Tipo Unidad</th>
                  <th className="py-4 px-5 text-center">Nivel Crítico</th>
                  <th className="py-4 px-5 text-right">Stock de Reserva</th>
                  <th className="py-4 px-5 text-right">Restablecer / Sumar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-800 dark:text-zinc-200">
                {ingredients
                  .filter(ing => ing.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(ing => {
                    const isAlert = ing.stock <= ing.minStock;
                    const stockPercentage = Math.min((ing.stock / (ing.minStock * 3)) * 100, 100);

                    return (
                      <tr key={ing.id} className={`hover:bg-gray-50/50 dark:hover:bg-zinc-855/30 ${isAlert ? 'bg-red-50/10' : ''}`}>
                        <td className="py-4 px-5">
                          <div>
                            <p className="font-bold text-gray-855 dark:text-zinc-100">{ing.name}</p>
                            <p className="text-[10px] text-gray-450 dark:text-zinc-500 font-mono italic">ID: {ing.id}</p>
                          </div>
                        </td>
                        <td className="py-4 px-5 font-mono">${ing.unitCost.toFixed(2)}</td>
                        <td className="py-4 px-5 capitalize text-gray-500 font-medium">{ing.unit}</td>
                        <td className="py-4 px-5 text-center">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                            isAlert
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/30'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/20'
                          }`}>
                            {isAlert ? '⚠️ CRÍTICO' : '☕ ÓPTIMO'}
                          </span>
                        </td>
                        <td className="py-4 px-5 text-right font-mono">
                          <div className="inline-block text-right">
                            <span className={`font-extrabold text-sm ${isAlert ? 'text-red-500' : 'text-gray-800 dark:text-zinc-50'}`}>
                              {ing.stock.toFixed(2)} {ing.unit}
                            </span>
                            <div className="w-24 bg-gray-100 dark:bg-zinc-800 h-1.5 rounded-full mt-1 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isAlert ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${stockPercentage}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-gray-400 block mt-0.5 leading-none">Mín: {ing.minStock} {ing.unit}</span>
                          </div>
                        </td>
                        <td className="py-4 px-5 text-right">
                          <div className="flex items-center justify-end gap-1 select-none">
                            <button
                              id={`btn-replenish-10-${ing.id}`}
                              onClick={() => triggerIncrementStockVal(ing, 10)}
                              className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 text-[10px] font-bold text-amber-700 dark:text-amber-400 cursor-pointer"
                              title="Suma 10 unidades al stock físico del insumo de inmediato"
                            >
                              +10 {ing.unit}
                            </button>
                            <button
                              id={`btn-replenish-50-${ing.id}`}
                              onClick={() => triggerIncrementStockVal(ing, 50)}
                              className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 text-[10px] font-bold text-amber-700 dark:text-amber-400 cursor-pointer"
                              title="Suma 50 unidades al stock físico del insumo de inmediato"
                            >
                              +50 {ing.unit}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'productos' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products
            .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map(prod => {
              const isAlert = prod.stock <= prod.minStock;
              const hasRecipe = prod.ingredients && prod.ingredients.length > 0;

              return (
                <div
                  key={prod.id}
                  className={`p-4 rounded-2xl border bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800 shadow-xs flex flex-col justify-between ${
                    isAlert ? 'border-l-4 border-l-red-500' : ''
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl" img-emoji="true">{prod.image}</span>
                        <div>
                          <h3 className="font-extrabold text-sm text-gray-855 dark:text-zinc-50">{prod.name}</h3>
                          <span className="text-[10px] bg-amber-100/60 dark:bg-amber-950/20 text-amber-801 dark:text-amber-400 px-1.5 py-0.5 rounded uppercase font-bold text-[9px]">
                            {prod.category}
                          </span>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <p className="text-xs font-extrabold text-emerald-500">${prod.price.toFixed(2)}</p>
                        <p className="text-[9px] text-gray-400 leading-tight">Costo: ${prod.cost.toFixed(2)}</p>
                      </div>
                    </div>

                    {/* Stock indicator row */}
                    <div className="mt-4 flex items-center justify-between text-xs bg-gray-50 dark:bg-zinc-950/30 p-2 rounded-xl">
                      <span className="text-gray-500">Stock Mostrador:</span>
                      <div className="text-right font-mono">
                        <span className={`font-extrabold ${isAlert ? 'text-red-500' : 'text-gray-800 dark:text-zinc-50'}`}>
                          {prod.stock} unidades
                        </span>
                        <span className="text-[9px] text-gray-400 block font-sans">Crítico: {prod.minStock}</span>
                      </div>
                    </div>

                    {/* Recipe lists info block */}
                    <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mt-4">Ingredientes de Elaboración (Costo)</p>
                    <div className="mt-1 space-y-1">
                      {hasRecipe ? (
                        prod.ingredients.map((recipe, idx) => {
                          const originalIng = ingredients.find(i => i.id === recipe.ingredientId);
                          return (
                            <div key={idx} className="flex justify-between text-[11px] font-medium text-gray-600 dark:text-zinc-400">
                              <span className="truncate">🌾 {originalIng?.name || 'Insumo Eliminado'}</span>
                              <span className="font-mono text-zinc-400 shrink-0">
                                {recipe.quantity} {originalIng?.unit}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-[10px] text-gray-400 italic">No requiere insumos directos (venta directa de terceros)</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-1 select-none">
                    <button
                      id={`btn-manage-batches-${prod.id}`}
                      onClick={() => setSelectedProductForBatches(prod)}
                      className="w-full py-2 px-3 text-center bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all active:scale-95 duration-200"
                    >
                      <Package className="h-3.5 w-3.5 animate-bounce" />
                      Gestionar Lotes (Activos: {batches.filter(b => b.productId === prod.id && b.status === 'active' && b.stock > 0).length})
                    </button>
                  </div>

                  {/* Increment finished baked good stock counts directly */}
                  <div className="mt-4 pt-3 border-t border-gray-150 dark:border-zinc-800 flex items-center gap-2 select-none">
                    <button
                      id={`btn-prod-replenish-10-${prod.id}`}
                      onClick={() => updateProductStock(prod.id, prod.stock + 10)}
                      className="flex-1 py-1 px-1 text-center bg-gray-50 hover:bg-gray-105 dark:bg-zinc-850 dark:hover:bg-zinc-800 rounded text-[10px] font-bold text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-zinc-750 cursor-pointer animate-btn"
                      title="Horneada rápida: suma 10 unidades al stock disponible"
                    >
                      Sumar +10 {prod.image}
                    </button>
                    <button
                      id={`btn-prod-replenish-50-${prod.id}`}
                      onClick={() => updateProductStock(prod.id, prod.stock + 50)}
                      className="flex-1 py-1 px-1 text-center bg-gray-50 hover:bg-gray-105 dark:bg-zinc-850 dark:hover:bg-zinc-800 rounded text-[10px] font-bold text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-zinc-750 cursor-pointer animate-btn"
                      title="Horneada completa: suma 50 unidades al stock disponible"
                    >
                      Sumar +50 {prod.image}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {activeSubTab === 'caducidad' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
          
          {/* Main List of Expiries */}
          <div className="lg:col-span-2 space-y-4">
            
            <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2 pb-3 border-b border-gray-100 dark:border-zinc-800">
                <div>
                  <h3 className="font-extrabold text-sm text-gray-800 dark:text-zinc-100 uppercase tracking-wider">Línea de Alerta por Vencimiento</h3>
                  <p className="text-[11px] text-gray-450 mt-0.5">Control de vida útil ordenado según criterio de prioridad actual.</p>
                </div>
                <div className="flex items-center gap-1.5 select-none">
                  <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 uppercase tracking-wider">
                    Criterio: {priorityCriteria}
                  </span>
                  <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-350">
                    Alerta a {priorityAlertDays}d
                  </span>
                </div>
              </div>

              {/* Products Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50/50 dark:bg-zinc-950 text-[10px] uppercase font-bold text-gray-400 select-none">
                    <tr className="border-b border-gray-100 dark:border-zinc-850">
                      <th className="py-3 px-2">Producto</th>
                      <th className="py-3 px-2 text-center">Duración</th>
                      <th className="py-3 px-2">Elaborado</th>
                      <th className="py-3 px-2">Margen</th>
                      <th className="py-3 px-2">Estado</th>
                      <th className="py-3 px-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-800 dark:text-zinc-200">
                    {getPrioritizedExpiryProducts().length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-zinc-400 font-bold">
                          No hay productos elaborados registrados con control de caducidad.
                        </td>
                      </tr>
                    ) : (
                      getPrioritizedExpiryProducts()
                        .filter(prod => prod.name.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map(prod => {
                          const daysLeft = getProductExpiryDays(prod);
                          const isExpired = daysLeft < 0;
                          const isCriticalRange = daysLeft >= 0 && daysLeft <= priorityAlertDays;
              
                          return (
                            <tr
                              key={prod.id}
                              id={`item-expiry-row-${prod.id}`}
                              className={`hover:bg-gray-50/50 dark:hover:bg-zinc-850/20 ${
                                isExpired
                                  ? 'bg-red-50/10 dark:bg-red-950/10'
                                  : isCriticalRange
                                  ? 'bg-amber-50/10 dark:bg-amber-950/10'
                                  : ''
                              }`}
                            >
                              <td className="py-4 px-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xl inline-block" role="img" aria-label={prod.name}>{prod.image}</span>
                                  <div>
                                    <p className="font-extrabold text-gray-850 dark:text-zinc-100 leading-none">{prod.name}</p>
                                    <p className="text-[9px] text-gray-400 font-mono mt-1">Urgente por {prod.category.toUpperCase()} • Qda: {prod.stock} u.</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-4 px-2 text-center text-gray-500 font-semibold">{prod.durabilityDays} días</td>
                              <td className="py-4 px-2 text-gray-550 dark:text-zinc-400 font-mono italic text-[11px]">{prod.elaborationDate}</td>
                              <td className="py-4 px-2 font-mono">
                                <span className={isExpired ? 'text-red-500 font-extrabold' : isCriticalRange ? 'text-amber-500 font-extrabold' : 'text-emerald-600'}>
                                  {isExpired ? `${Math.abs(daysLeft)}d Vencido` : daysLeft === 0 ? '¡Vence hoy!' : `${daysLeft} días`}
                                </span>
                              </td>
                              <td className="py-4 px-2">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-extrabold ${
                                  isExpired
                                    ? 'bg-red-100 text-red-700 dark:bg-red-950/30'
                                    : isCriticalRange
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20'
                                }`}>
                                  {isExpired ? '🚨 DESECHAR' : isCriticalRange ? '⏳ RELEVAR' : ' FRESCO'}
                                </span>
                              </td>
                              <td className="py-4 px-2 text-right">
                                <div className="flex justify-end gap-1.5 select-none">
                                  {prod.stock > 0 ? (
                                    <>
                                      <button
                                        onClick={() => {
                                          const discountedPrice = prod.price * 0.5;
                                          addSystemNotification(
                                            '💰 Liquidación 50%',
                                            `Venta Promo -50%: ${prod.name} relevado a $${discountedPrice.toFixed(2)} por fecha límite.`,
                                            'success'
                                          );
                                          updateProductStock(prod.id, Math.max(0, prod.stock - 1));
                                        }}
                                        className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[9px] font-extrabold cursor-pointer transition-transform duration-100 transform active:scale-95 shadow-xs"
                                        title="Simula una orden de venta rápida a mitad de precio"
                                      >
                                        Oferta -50%
                                      </button>
                                      
                                      <button
                                        onClick={() => {
                                          updateProductStock(prod.id, 0);
                                          addSystemNotification(
                                            '🗑️ Merma Descontada',
                                            `Se registraron ${prod.stock} u. de merma desperdiciada para "${prod.name}".`,
                                            'warning'
                                          );
                                        }}
                                        className="px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 rounded text-[9px] font-extrabold cursor-pointer transition-transform duration-100 transform active:scale-95"
                                        title="Dar de baja unidades restantes por merma de caducidad"
                                      >
                                        Desechar
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        updateProductStock(prod.id, 50);
                                        addSystemNotification(
                                          '⚡ Lote Renovado',
                                          `Nuevo lote horneado: 50 u. frescas para ${prod.name}.`,
                                          'success'
                                        );
                                      }}
                                      className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-[9px] font-extrabold cursor-pointer transition-transform duration-100 transform active:scale-95"
                                    >
                                      Hornear Nuevo
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>

            </div>

          </div>

          {/* Right settings configuration panel */}
          <div className="space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl shadow-xs">
              <div className="flex items-center gap-2 border-b pb-3 border-gray-100 dark:border-zinc-800 mb-4 select-none">
                <div className="p-1.5 rounded-xl bg-amber-100 text-amber-700">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="font-extrabold text-[13px] text-gray-800 dark:text-zinc-100 uppercase tracking-wider">Prioridades de Rescate</h4>
                  <p className="text-[10px] text-gray-400">Orden de clasificación para alertas de vida útil</p>
                </div>
              </div>

              <div className="space-y-4">
                
                {/* Rule Selector */}
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest block">Ordenar ties por:</label>
                  <p className="text-[10px] text-gray-400 mb-2">Configura qué variable define qué producto es más crítico a la hora de rescatar.</p>
                  
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { id: 'categoria', title: '📂 Por Categoría Crítica', text: 'Priorizará la categoría seleccionada abajo antes que otras.' },
                      { id: 'precio', title: '💰 Por Precio de Lista', text: 'Muestra primero artículos del mayor valor para evitar pérdidas.' },
                      { id: 'unidades', title: '🍞 Por Stock / Unidades', text: 'Ordena de mayor a menor volumen físico en góndola.' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSavePriorityConfig(opt.id as any, priorityAlertDays, priorityCategory)}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                          priorityCriteria === opt.id
                            ? 'bg-amber-500/10 border-amber-500 text-amber-900 dark:text-amber-305'
                            : 'bg-white dark:bg-zinc-900 border-gray-150 dark:border-zinc-800 text-gray-700 dark:text-zinc-400 hover:bg-gray-50/50'
                        }`}
                      >
                        <p className="font-extrabold text-xs">{opt.title}</p>
                        <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{opt.text}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-gray-100 dark:border-zinc-850 pt-3 space-y-3">
                  
                  {/* Warning Days input */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Margen de Alerta (Días)</label>
                    <div className="flex items-center gap-2">
                      <input
                        id="priority-alert-days"
                        type="number"
                        min="1"
                        max="7"
                        value={priorityAlertDays}
                        onChange={(e) => handleSavePriorityConfig(priorityCriteria, Number(e.target.value), priorityCategory)}
                        className="w-16 text-center font-extrabold bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl p-2 focus:outline-none text-gray-850 dark:text-zinc-100"
                      />
                      <span className="text-[11px] text-gray-400 font-medium leading-tight">días de anticipación preventiva</span>
                    </div>
                  </div>

                  {/* Priority Category selector */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Categoría de Urgencia</label>
                    <select
                      id="priority-category-dropdown"
                      value={priorityCategory}
                      onChange={(e) => handleSavePriorityConfig(priorityCriteria, priorityAlertDays, e.target.value)}
                      className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-955 border border-gray-200 dark:border-zinc-800 rounded-xl p-2 py-2.5 focus:outline-none text-gray-850 dark:text-zinc-100"
                    >
                      <option value="panes">Panes Artesanales (baguettes)</option>
                      <option value="facturas">Facturas (medialunas, vigilantes)</option>
                      <option value="pasteleria">Repostería Fina (tortas, budines)</option>
                      <option value="salados">Salados y Sándwiches de Miga</option>
                      <option value="bebidas">Cafetaría y Jugos de Fruta</option>
                    </select>
                  </div>

                </div>

              </div>
            </div>
          </div>

        </div>
      )}

      {activeSubTab === 'mermas' && (
        <div className="space-y-6 animate-fade-in">
          {/* Header Introduction */}
          <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-850 p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-500 shrink-0">
                  <ShieldAlert className="h-5 w-5 animate-pulse" />
                </span>
                <div>
                  <h3 className="font-extrabold text-sm md:text-base text-gray-855 dark:text-zinc-50">Control de Bajas, Mermas y Retiros</h3>
                  <p className="text-[10px] md:text-xs text-gray-400">
                    Fiscalización de mermas de mercadería por vencimiento del lote activo. El producto es retirado del mostrador tras la firma digital de Coordinación.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* KPI Dashboard */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800 p-4 rounded-2xl shadow-xs">
              <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">Total Solicitudes</p>
              <h4 className="text-2xl font-black text-gray-855 dark:text-zinc-50 mt-1">{withdrawalRequests.length}</h4>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-950 p-4 rounded-2xl shadow-xs">
              <p className="text-[10px] font-extrabold text-amber-650 dark:text-amber-500 uppercase tracking-widest">Pendientes</p>
              <h4 className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-1 font-mono">
                {withdrawalRequests.filter(r => r.status === 'pending').length}
              </h4>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-950 p-4 rounded-2xl shadow-xs">
              <p className="text-[10px] font-extrabold text-emerald-650 dark:text-emerald-500 uppercase tracking-widest">Aprobados</p>
              <h4 className="text-2xl font-black text-emerald-700 dark:text-emerald-405 mt-1 font-mono">
                {withdrawalRequests.filter(r => r.status === 'approved').length}
              </h4>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-950 p-4 rounded-2xl shadow-xs">
              <p className="text-[10px] font-extrabold text-red-650 dark:text-red-550 uppercase tracking-widest">Rechazados</p>
              <h4 className="text-2xl font-black text-red-705 dark:text-red-400 mt-1 font-mono">
                {withdrawalRequests.filter(r => r.status === 'rejected').length}
              </h4>
            </div>
          </div>

          {/* Filter Subtabs */}
          <div className="flex items-center justify-between border-b border-gray-150 dark:border-zinc-805 pb-3">
            <div className="flex items-center gap-1.5 overflow-x-auto select-none">
              {(['all', 'pending', 'approved', 'rejected'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setMermasFilter(tab)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold capitalize cursor-pointer transition-all ${
                    mermasFilter === tab
                      ? 'bg-amber-500 text-white shadow-xs font-black'
                      : 'bg-white dark:bg-zinc-900 hover:bg-gray-50/50 text-gray-500 dark:text-zinc-400 border border-gray-150 dark:border-zinc-800'
                  }`}
                >
                  {tab === 'all' ? 'Ver Todos' : tab === 'pending' ? 'Pendientes' : tab === 'approved' ? 'Aprobados' : 'Desestimados'}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-black text-gray-400 tracking-wider uppercase select-none">
              Rol: <span className="text-amber-605 dark:text-amber-400">{activeUser.role.toUpperCase()}</span>
            </span>
          </div>

          {/* List of Withdrawal Events */}
          <div className="space-y-4">
            {withdrawalRequests.filter(r => mermasFilter === 'all' || r.status === mermasFilter).length === 0 ? (
              <div className="bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800 rounded-2xl text-center py-12 text-gray-400 font-bold select-none">
                Ninguna solicitud de baja coincide con este filtro.
              </div>
            ) : (
              withdrawalRequests
                .filter(r => mermasFilter === 'all' || r.status === mermasFilter)
                .map(req => {
                  const isPending = req.status === 'pending';
                  const isApproved = req.status === 'approved';
                  const isRejected = req.status === 'rejected';
                  const reqDate = new Date(req.date);

                  return (
                    <div
                      key={req.id}
                      className={`bg-white dark:bg-zinc-900 border rounded-2xl shadow-xs p-5 transition-all flex flex-col lg:flex-row lg:items-start justify-between gap-5 border-gray-150 dark:border-zinc-800 ${
                        isPending ? 'border-l-4 border-l-amber-500 bg-amber-500/5' : ''
                      }`}
                    >
                      {/* Product Name & Metadata */}
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl font-bold p-2 bg-gray-50 dark:bg-zinc-950 rounded-xl" role="img" aria-label={req.productName}>
                            📦
                          </span>
                          <div>
                            <h4 className="font-extrabold text-sm text-gray-855 dark:text-zinc-50 leading-tight">
                              {req.productName}
                            </h4>
                            <div className="flex items-center gap-2 mt-1 select-none">
                              <span className="inline-block text-[9px] px-1.5 py-0.5 font-mono font-black rounded bg-gray-100 dark:bg-zinc-800 text-gray-550 dark:text-zinc-400">
                                Lote: {req.batchNumber}
                              </span>
                              <span className="text-[9.5px] font-semibold text-gray-400">
                                {reqDate.toLocaleDateString()} a las {reqDate.toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Request parameters */}
                        <div className="pt-2 grid grid-cols-2 gap-4 border-t border-gray-100 dark:border-zinc-800 text-xs">
                          <div>
                            <span className="text-[9px] font-extrabold text-gray-400 uppercase block">Pedido por:</span>
                            <span className="font-bold text-gray-755 dark:text-zinc-100">{req.requestedBy}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-extrabold text-gray-400 uppercase block">Monto a retirar:</span>
                            <span className="font-black text-amber-600 dark:text-amber-400 font-mono text-sm">{req.quantity} unidades</span>
                          </div>
                        </div>

                        <div className="bg-gray-50 dark:bg-zinc-950/40 p-2.5 rounded-xl border border-gray-100 dark:border-zinc-800/65 mt-1.5 font-sans">
                          <span className="text-[8px] font-black tracking-wider text-gray-400 uppercase block mb-1">Motivo / Causa del Retiro:</span>
                          <p className="text-[11px] font-medium leading-relaxed text-gray-650 dark:text-zinc-300 italic">
                            "{req.reason}"
                          </p>
                        </div>
                      </div>

                      {/* Approval flow & admin input panel */}
                      <div className="lg:w-96 select-none shrink-0 flex flex-col justify-between self-stretch border-t lg:border-t-0 lg:border-l border-gray-150 dark:border-zinc-800 pt-4 lg:pt-0 lg:pl-5 bg-white dark:bg-zinc-900">
                        <div className="space-y-3 flex-1 flex flex-col justify-center bg-white dark:bg-zinc-900">
                          {isPending ? (
                            <>
                              {activeUser.role === 'admin' ? (
                                <div className="space-y-3 bg-white dark:bg-zinc-900">
                                  <div className="flex items-center gap-1.5 justify-between">
                                    <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Decisión de Administración:</span>
                                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
                                  </div>
                                  
                                  {resolvingRequestId === req.id ? (
                                    <div className="space-y-2.5 bg-gray-50 dark:bg-zinc-950/50 p-3 rounded-xl border border-gray-150 dark:border-zinc-800 select-none">
                                      <p className="text-[9.5px] font-black text-gray-500">
                                        Escribir {resolvingAction === 'approved' ? 'Aprobación' : 'Denegación'}:
                                      </p>
                                      <textarea
                                        id={`txt-resolving-memo-${req.id}`}
                                        value={resolvingMemo}
                                        onChange={(e) => setResolvingMemo(e.target.value)}
                                        placeholder={
                                          resolvingAction === 'approved'
                                            ? 'Ej: Autorizado retiro. Lote rancio.'
                                            : 'Ej: Denegado. Mantener en mostrador, no expiró.'
                                        }
                                        className="w-full text-xs bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-750 p-2 focus:outline-none focus:ring-1 focus:ring-amber-500 min-h-[50px] text-gray-850 dark:text-zinc-150 leading-normal font-sans"
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          id={`btn-cancel-resolve-${req.id}`}
                                          onClick={() => {
                                            setResolvingRequestId(null);
                                            setResolvingMemo('');
                                            setResolvingAction(null);
                                          }}
                                          className="flex-1 py-1.5 px-2.5 bg-gray-200 dark:bg-zinc-800 text-gray-650 dark:text-zinc-350 rounded text-[9.5px] font-extrabold cursor-pointer"
                                        >
                                          Cancelar
                                        </button>
                                        <button
                                          type="button"
                                          id={`btn-confirm-resolve-${req.id}`}
                                          disabled={!resolvingMemo.trim()}
                                          onClick={() => {
                                            if (resolvingAction === 'approved') {
                                              approveWithdrawalRequest(req.id, resolvingMemo);
                                            } else {
                                              rejectWithdrawalRequest(req.id, resolvingMemo);
                                            }
                                            setResolvingRequestId(null);
                                            setResolvingMemo('');
                                            setResolvingAction(null);
                                          }}
                                          className={`flex-1 py-1.5 px-2.5 rounded text-[9.5px] font-extrabold cursor-pointer text-white disabled:opacity-40 transition-colors ${
                                            resolvingAction === 'approved' ? 'bg-emerald-505 hover:bg-emerald-600' : 'bg-red-505 hover:bg-red-600'
                                          }`}
                                        >
                                          Confirmar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex gap-2 pt-1 bg-white dark:bg-zinc-900">
                                      <button
                                        type="button"
                                        id={`btn-start-reject-${req.id}`}
                                        onClick={() => {
                                          setResolvingRequestId(req.id);
                                          setResolvingAction('rejected');
                                          setResolvingMemo('Reprochado, la mercadería se encuentra apta; reingresar lote.');
                                        }}
                                        className="flex-1 py-2 rounded-xl bg-red-100 hover:bg-red-150 border border-red-200 text-red-650 text-[10px] font-black uppercase tracking-wider cursor-pointer transition-colors active:scale-95"
                                        title="Rechazar solicitud y reponer stock del lote"
                                      >
                                        Rechazar Baja
                                      </button>
                                      <button
                                        type="button"
                                        id={`btn-start-approve-${req.id}`}
                                        onClick={() => {
                                          setResolvingRequestId(req.id);
                                          setResolvingAction('approved');
                                          setResolvingMemo('Confirmado retiro preventivo física y digitalmente del stock.');
                                        }}
                                        className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-605 text-white text-[10px] font-black uppercase tracking-wider cursor-pointer shadow-xs transition-colors active:scale-95"
                                        title="Aprobar merma definitiva del inventario"
                                      >
                                        Aprobar Baja ✅
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-center py-4 bg-amber-500/10 rounded-2xl border border-amber-300 dark:border-amber-950 p-3 select-none text-xs">
                                  <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto mb-1.5 animate-bounce" />
                                  <p className="text-[10px] font-extrabold text-amber-705 dark:text-amber-400">
                                    Firmas Pendientes
                                  </p>
                                  <p className="text-[9px] text-gray-400 mt-1 leading-normal font-sans">
                                    Enviado al panel de administración para su autorización formal y retiro.
                                  </p>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className={`p-4 rounded-xl border text-xs leading-normal select-none ${
                              isApproved 
                                ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-300' 
                                : 'bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-300'
                            }`}>
                              <div className="flex items-center gap-1.5 font-extrabold pb-2 mb-2 border-b border-gray-100 dark:border-zinc-800 uppercase text-[9px] tracking-wider">
                                {isApproved ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                                    <span>Solicitud Aprobada (Mermado)</span>
                                  </>
                                ) : (
                                  <>
                                    <X className="h-3.5 w-3.5 text-red-500" />
                                    <span>Solicitud Desestimada</span>
                                  </>
                                )}
                              </div>
                              <span className="text-[8px] font-black text-gray-400 block uppercase mb-1">Comentario Administrativo:</span>
                              <p className="font-semibold text-[10.5px] italic leading-tight">
                                "{req.adminMemo || 'Sin comentarios adicionales.'}"
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: ADD NEW INSUMO */}
      {showInsumoModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in">
          <form
            onSubmit={handleCreateInsumoSubmit}
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-800 max-w-sm w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2.5 border-gray-100 dark:border-zinc-800">
              <h3 className="font-extrabold text-base text-gray-850 dark:text-zinc-50 flex items-center gap-1.5">
                <Wheat className="h-4.5 w-4.5 text-amber-500" /> Registrar Materia Prima
              </h3>
              <button
                type="button"
                id="btn-insumo-modal-close"
                onClick={() => setShowInsumoModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Nombre del Insumo / Harina</label>
              <input
                id="modal-insumo-name"
                type="text"
                required
                placeholder="Por ej: Harina Integral Organica"
                value={insumoName}
                onChange={(e) => setInsumoName(e.target.value)}
                className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Tipo Unidad</label>
                <select
                  id="modal-insumo-unit"
                  value={insumoUnit}
                  onChange={(e) => setInsumoUnit(e.target.value as Ingredient['unit'])}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                >
                  <option value="kg">kilogramos (kg)</option>
                  <option value="g">gramos (g)</option>
                  <option value="L">litros (L)</option>
                  <option value="ml">mililitros (ml)</option>
                  <option value="unidades">unidades (u)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Costo Unitario ($)</label>
                <input
                  id="modal-insumo-cost"
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  value={insumoCost}
                  onChange={(e) => setInsumoCost(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Stock Inicial</label>
                <input
                  id="modal-insumo-stock"
                  type="number"
                  step="0.1"
                  required
                  min="0"
                  value={insumoStock}
                  onChange={(e) => setInsumoStock(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Alerta de Stock (Mín)</label>
                <input
                  id="modal-insumo-minstock"
                  type="number"
                  step="0.1"
                  required
                  min="0.1"
                  value={insumoMinStock}
                  onChange={(e) => setInsumoMinStock(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2">
              <button
                type="button"
                id="btn-insumo-modal-cancel"
                onClick={() => setShowInsumoModal(false)}
                className="flex-1 py-3 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-850 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                id="btn-insumo-modal-submit"
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Guardar Insumo
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: ADD NEW BAKERY PRODUCT & ATTACH DYNAMIC INGREDIENTS FORMULA */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in dialog-overlay">
          <form
            onSubmit={handleCreateProductSubmit}
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-800 max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b pb-2.5 border-gray-100 dark:border-zinc-800">
              <h3 className="font-extrabold text-base text-gray-850 dark:text-zinc-50 flex items-center gap-1.5 font-sans">
                👑 Agregar Panificado / Producto Especial
              </h3>
              <button
                type="button"
                id="btn-prod-modal-close"
                onClick={() => setShowProductModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Nombre del Producto</label>
                <input
                  id="modal-prod-name"
                  type="text"
                  required
                  placeholder="Por ej: Pan Dulce Especial"
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100 font-semibold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Categoría</label>
                <select
                  id="modal-prod-category"
                  value={prodCategory}
                  onChange={(e) => setProdCategory(e.target.value as CategoryType)}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                >
                  <option value="panes">Panes (loaves)</option>
                  <option value="facturas">Facturas / Dulces</option>
                  <option value="pasteleria">Pastelería y Tortas</option>
                  <option value="bebidas">Cafetaría y Bebidas</option>
                  <option value="salados">Salados y Sándwiches</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Ícono Emojí</label>
                <select
                  id="modal-prod-emoji"
                  value={prodImage}
                  onChange={(e) => setProdImage(e.target.value)}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                >
                  <option value="🥖">🥖 pan flauta / baguette</option>
                  <option value="🥐">🥐 croissant / medialuna</option>
                  <option value="🍞">🍞 pancito</option>
                  <option value="🥯">🥯 bagel / dona</option>
                  <option value="🧁">🧁 muffin / magdalena</option>
                  <option value="🍰">🍰 tarta / torta dulce</option>
                  <option value="🍩">🍩 dona decorada</option>
                  <option value="🥪">🥪 sandwich salado</option>
                  <option value="☕">☕ café caliente</option>
                  <option value="🍊">🍊 exprimido natural</option>
                  <option value="🥨">🥨 vigilantes / cuernitos</option>
                  <option value="🍫">🍫 budín chocolate</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Precio de Venta Mostrador ($)</label>
                <input
                  id="modal-prod-price"
                  type="number"
                  step="0.01"
                  required
                  min="0.05"
                  value={prodPrice}
                  onChange={(e) => setProdPrice(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Costo Estimado Producción ($)</label>
                <input
                  id="modal-prod-cost"
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  value={prodCost}
                  onChange={(e) => setProdCost(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Stock Inicial Horneado</label>
                <input
                  id="modal-prod-stock"
                  type="number"
                  required
                  min="0"
                  value={prodStock}
                  onChange={(e) => setProdStock(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Alerta Quiebre Stock (Mín)</label>
                <input
                  id="modal-prod-minstock"
                  type="number"
                  required
                  min="1"
                  value={prodMinStock}
                  onChange={(e) => setProdMinStock(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            {/* INTERACTIVE FORMULA CREATOR SECTION */}
            <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-2">
              <label className="text-[11px] font-extrabold text-amber-600 dark:text-amber-500 uppercase tracking-wider block">
                Fórmula de Consumo (Ingredientes consumidos por unidad vendida)
              </label>
              
              <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-zinc-800 p-3 rounded-xl divide-y divide-gray-100 dark:divide-zinc-850 space-y-1 bg-gray-50/50 dark:bg-zinc-950/40">
                {ingredients.map(ing => {
                  const activeRecipeItem = selectedRecipeIngredients.find(r => r.ingredientId === ing.id);
                  const isChecked = !!activeRecipeItem;

                  return (
                    <div key={ing.id} className="flex items-center justify-between text-xs py-2 select-none">
                      <div className="flex items-center gap-2">
                        <input
                          id={`modal-recipe-check-${ing.id}`}
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRecipeIngredientItem(ing.id, 0.05)}
                          className="rounded text-amber-500 border-gray-300 focus:ring-amber-500 h-3.5 w-3.5"
                        />
                        <span className="font-semibold text-gray-800 dark:text-zinc-200">{ing.name} ({ing.unit})</span>
                      </div>
                      
                      {isChecked && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400">Gasto:</span>
                          <input
                            id={`modal-recipe-amount-${ing.id}`}
                            type="number"
                            step="0.001"
                            min="0.001"
                            value={activeRecipeItem.quantity}
                            onChange={(e) => updateRecipeIngredientQuantity(ing.id, Number(e.target.value))}
                            className="w-20 font-mono bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 py-1 px-2 rounded-lg text-xs leading-none"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2">
              <button
                type="button"
                id="btn-prod-modal-cancel"
                onClick={() => setShowProductModal(false)}
                className="flex-1 py-3 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-850 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                id="btn-prod-modal-submit"
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Guardar Nuevo Horneado
              </button>
            </div>
          </form>
          </div>
      )}

      {/* FLOATING ACTION LUPA BUTTON FOR BOTH VIEWS */}
      <button
        id="btn-inventory-floating-lupa-search"
        onClick={() => {
          localStorage.setItem('pan_erp_open_search_list', 'true');
          setActiveTab('pos');
        }}
        className="fixed bottom-6 right-6 lg:bottom-8 lg:right-8 z-40 p-4 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer border-2 border-white dark:border-zinc-800 ring-4 ring-amber-550/10 dark:ring-zinc-900 group animate-bounce"
        title="Buscar Panificados (Modo Lista)"
      >
        <Search className="h-6 w-6 group-hover:rotate-12 transition-transform duration-300" />
      </button>

      {selectedProductForBatches && (
        <ProductBatchesModal
          product={selectedProductForBatches}
          onClose={() => setSelectedProductForBatches(null)}
        />
      )}

    </div>
  );
};

interface ProductBatchesModalProps {
  product: Product;
  onClose: () => void;
}

const ProductBatchesModal: React.FC<ProductBatchesModalProps> = ({ product, onClose }) => {
  const {
    batches = [],
    addBatch,
    requestBatchWithdrawal,
    addSystemNotification,
    withdrawalRequests = []
  } = useApp();

  const [newBatchNumber, setNewBatchNumber] = useState(`L-${product.name.slice(0, 3).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`);
  const [newQuantity, setNewQuantity] = useState(50);
  const [newElabDate, setNewElabDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [newExpDate, setNewExpDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (product.durabilityDays || 3));
    return d.toISOString().split('T')[0];
  });
  const [withdrawalMode, setWithdrawalMode] = useState<'manual' | 'automatic'>('manual');
  
  // Show manual rollback triggers
  const [selectedBatchForRollback, setSelectedBatchForRollback] = useState<string | null>(null);
  const [rollbackQty, setRollbackQty] = useState(1);
  const [rollbackReason, setRollbackReason] = useState('Expirado de góndola, retirar lote.');

  // Recalculate expiry day on elab change
  const handleElabChange = (val: string) => {
    setNewElabDate(val);
    const d = new Date(val + 'T00:00:00');
    d.setDate(d.getDate() + (product.durabilityDays || 3));
    setNewExpDate(d.toISOString().split('T')[0]);
  };

  const handleRegisterBatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchNumber.trim() || newQuantity <= 0) {
      addSystemNotification('❌ Datos Incompletos', 'Completa los requerimientos para crear el lote.', 'error');
      return;
    }

    addBatch({
      productId: product.id,
      batchNumber: newBatchNumber,
      quantity: newQuantity,
      stock: newQuantity,
      elaborationDate: newElabDate,
      expiryDate: newExpDate,
      withdrawalMode
    });

    // Reset Form
    setNewBatchNumber(`L-${product.name.slice(0, 3).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`);
    setNewQuantity(50);
    addSystemNotification('📦 Lote Creado', `Se registró lote "${newBatchNumber}" con ${newQuantity} u.`, 'success');
  };

  const activeProductBatches = batches.filter(b => b.productId === product.id);

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-55 p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-gray-150 dark:border-zinc-800 shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden my-auto">
        
        {/* Modal Head */}
        <div className="p-5 border-b border-gray-100 dark:border-zinc-850 flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-zinc-950/25 select-none">
          <div className="flex items-center gap-2.5">
            <span className="text-3xl shrink-0">{product.image}</span>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-gray-855 dark:text-zinc-50">
                Lotes de Producción: {product.name}
              </h3>
              <p className="text-[10px] text-gray-400">
                Control de fecha límite de vida útil ({product.durabilityDays || 0} hs de caducidad)
              </p>
            </div>
          </div>
          <button
            id="btn-batch-modal-x"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-gray-150 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-500 cursor-pointer transition-colors active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Container */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          
          {/* Section 1: Register New Batch */}
          <div className="bg-amber-100/10 dark:bg-amber-950/10 border border-amber-500/10 dark:border-amber-900/10 rounded-2xl p-4 space-y-3.5 select-none">
            <h4 className="font-black text-xs text-amber-800 dark:text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
              <Plus className="h-4 w-4 shrink-0" /> Registrar Producción / Lote Nuevo
            </h4>
            
            <form onSubmit={handleRegisterBatchSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Cód del Lote (Lote-Nº)</label>
                <input
                  id="batch-input-number"
                  type="text"
                  required
                  value={newBatchNumber}
                  onChange={(e) => setNewBatchNumber(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Cantidad Inicial Elaborada</label>
                <input
                  id="batch-input-qty"
                  type="number"
                  min="1"
                  required
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(Number(e.target.value))}
                  className="w-full font-mono bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Elaboración / Ingreso</label>
                <input
                  id="batch-input-elab"
                  type="date"
                  required
                  value={newElabDate}
                  onChange={(e) => handleElabChange(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Fecha de Caducidad Calculada</label>
                <input
                  id="batch-input-exp"
                  type="date"
                  required
                  value={newExpDate}
                  onChange={(e) => setNewExpDate(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase block">Modo de Baja al Caducar</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    id="btn-mode-manual"
                    onClick={() => setWithdrawalMode('manual')}
                    className={`py-2 px-3.5 border rounded-xl font-bold transition-all ${
                      withdrawalMode === 'manual'
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-750 text-gray-600 dark:text-zinc-400'
                    }`}
                  >
                    Manual (A Confirmar por Admin)
                  </button>
                  <button
                    type="button"
                    id="btn-mode-auto"
                    onClick={() => setWithdrawalMode('automatic')}
                    className={`py-2 px-3.5 border rounded-xl font-bold transition-all ${
                      withdrawalMode === 'automatic'
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-750 text-gray-600 dark:text-zinc-400'
                    }`}
                  >
                    Baja Automática por Sistema
                  </button>
                </div>
                <p className="text-[9px] text-gray-400 mt-1">
                  Manual: Requiere retiro manual con aviso. Automático: El sistema genera una solicitud una vez pasada la fecha límite.
                </p>
              </div>

              <button
                type="submit"
                id="btn-batch-register"
                className="sm:col-span-2 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer mt-2"
              >
                Insertar y Sumar al Stock Mostrador ✓
              </button>
            </form>
          </div>

          {/* Section 2: Active Batches Table */}
          <div className="space-y-3">
            <h4 className="font-black text-xs text-gray-800 dark:text-gray-100 uppercase tracking-widest flex items-center gap-1.5 select-none">
              <History className="h-4 w-4 text-gray-400" /> Historial de Lotes Activos
            </h4>

            {activeProductBatches.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-xs italic font-bold select-none">
                No hay lotes activos para este producto. Agrega stock arriba.
              </p>
            ) : (
              <div className="space-y-3.5">
                {activeProductBatches.map(b => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  const todayTime = new Date(todayStr + 'T00:00:00').getTime();
                  const expTime = new Date(b.expiryDate + 'T00:00:00').getTime();
                  const remainingDays = Math.ceil((expTime - todayTime) / (1000 * 60 * 60 * 24));
                  
                  let colorClass = "bg-emerald-500 text-white";
                  let badgeText = "Excelente";
                  if (remainingDays < 0) {
                    colorClass = "bg-red-500 text-white";
                    badgeText = "Caducado";
                  } else if (remainingDays <= 1) {
                    colorClass = "bg-amber-550 text-black";
                    badgeText = "Por Caducar";
                  }

                  const hasPendingRequest = withdrawalRequests.some(r => r.batchId === b.id && r.status === 'pending');

                  return (
                    <div
                      key={b.id}
                      className="bg-gray-50 dark:bg-zinc-950/40 border border-gray-150 dark:border-zinc-800/60 rounded-2xl p-4.5 space-y-3 relative overflow-hidden"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 select-none">
                            <span className="font-extrabold text-sm text-gray-855 dark:text-zinc-150">{b.batchNumber}</span>
                            <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-black ${colorClass}`}>
                              {badgeText}
                            </span>
                            <span className="bg-gray-200 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 rounded px-1 text-[8.5px] font-semibold">
                              Retiro: {b.withdrawalMode === 'automatic' ? 'Auto' : 'Manual'}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-3 text-[10px] text-gray-400 select-none">
                            <span>Ingreso: <strong className="text-zinc-400 font-semibold">{b.elaborationDate}</strong></span>
                            <span>Expira: <strong className="text-zinc-400 font-semibold">{b.expiryDate}</strong></span>
                          </div>
                        </div>

                        {/* Inventory Count */}
                        <div className="bg-white dark:bg-zinc-850 border border-gray-100 dark:border-zinc-800 p-2 rounded-xl text-center min-w-[100px] select-none">
                          <span className="text-[8.5px] font-black uppercase text-gray-400 block tracking-wider">Mostrador</span>
                          <span className="text-xs font-black text-gray-855 dark:text-zinc-100 font-mono">
                            {b.stock}/{b.quantity} u.
                          </span>
                        </div>
                      </div>

                      {/* Display warning or active actions */}
                      {b.stock > 0 && (
                        <div className="pt-2 border-t border-gray-200/50 dark:border-zinc-900/50">
                          {hasPendingRequest ? (
                            <p className="text-[10px] text-amber-600 font-extrabold flex items-center gap-1 bg-amber-500/10 p-2 rounded-xl border border-amber-500/10 select-none">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-bounce" />
                              Solicitud de retiro de mercadería pendiente en el panel de administración.
                            </p>
                          ) : (
                            <>
                              {selectedBatchForRollback === b.id ? (
                                <div className="space-y-2.5 bg-amber-50 dark:bg-zinc-900/30 p-3 rounded-xl border border-amber-200 dark:border-amber-950/40">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-extrabold text-gray-400 uppercase">Cantidad a dar de baja:</label>
                                      <input
                                        id="rollback-qty-input"
                                        type="number"
                                        min="1"
                                        max={b.stock}
                                        value={rollbackQty}
                                        onChange={(e) => setRollbackQty(Math.min(b.stock, Number(e.target.value)))}
                                        className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-2 rounded-lg font-mono focus:outline-none text-zinc-800 dark:text-zinc-100"
                                      />
                                    </div>

                                    <div className="space-y-1">
                                      <label className="text-[9px] font-extrabold text-gray-400 uppercase">Detalle o Motivo:</label>
                                      <input
                                        id="rollback-reason-input"
                                        type="text"
                                        value={rollbackReason}
                                        onChange={(e) => setRollbackReason(e.target.value)}
                                        placeholder="Ej: Securas expira, rancio"
                                        className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-2 rounded-lg focus:outline-none text-zinc-800 dark:text-zinc-100"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex gap-2 text-[10px]">
                                    <button
                                      type="button"
                                      id="btn-cancel-rollback"
                                      onClick={() => setSelectedBatchForRollback(null)}
                                      className="flex-1 py-1.5 rounded-lg bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 font-extrabold cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      id="btn-submit-rollback"
                                      onClick={() => {
                                        requestBatchWithdrawal(b.id, rollbackQty, rollbackReason);
                                        setSelectedBatchForRollback(null);
                                        addSystemNotification('🔔 Solicitud Almacenada', `Se solicitó la baja de ${rollbackQty} u. del lote ${b.batchNumber}`, 'success');
                                      }}
                                      className="flex-1 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-extrabold cursor-pointer transition-colors active:scale-95"
                                    >
                                      Enviar Solicitud
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex justify-end select-none">
                                  <button
                                    type="button"
                                    id={`btn-init-rollback-${b.id}`}
                                    onClick={() => {
                                      setSelectedBatchForRollback(b.id);
                                      setRollbackQty(b.stock);
                                      setRollbackReason('Lote caducado, retirar de gondola de inmediato.');
                                    }}
                                    className="py-1 px-3.5 bg-red-50 hover:bg-red-105 dark:bg-red-950/20 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-[10px] font-black text-red-650 dark:text-red-400 cursor-pointer transition-all active:scale-95"
                                  >
                                    ⚠️ Solicitar Retiro de Merma
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-zinc-850/60 bg-gray-50/50 dark:bg-zinc-955 shrink-0 select-none">
          <p className="text-[10px] text-gray-400 text-center font-semibold">
            Nota: Al aprobarse un retiro preventivo por el admin de la sucursal, el stock pasará a registrarse como desecho histórico.
          </p>
        </div>

      </div>
    </div>
  );
};
