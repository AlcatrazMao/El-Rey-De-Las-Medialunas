import {
  Download,
  Plus,
  Package,
  Wheat,
  Activity,
  AlertTriangle,
  Search,
  X,
  Check,
  ShieldAlert,
  Layers,
  Pencil
} from 'lucide-react';
import * as React from 'react'
import { useState, useEffect, useMemo } from 'react';

import { useApp } from '../AppContext';
import { useProductForm } from '../hooks/useProductForm';
import { useRequests } from '../hooks/useRequests';
import type { Ingredient, Product, ProductGroup, CategoryType} from '../types';
import { exportIngredientsToCSV } from '../utils/exportUtils';
import { formatCurrency } from '../utils/format';

import { ImagePicker } from './ImagePicker';
import { BatchPanel } from './inventory/BatchPanel';
import { ProductGroupsEditor } from './ProductGroupsEditor';

// SECURITY/UX: gateo del botón "Editar" de insumos según la matriz real de
// permisos (packages/shared/src/constants/permissions.ts, módulo `inventory`,
// acción "update"). A diferencia de `products` (donde sólo admin/owner
// pueden editar), el módulo `inventory` también habilita a supervisor y
// warehouse — reflejamos exactamente esa matriz acá en vez de asumir que es
// el mismo criterio que productos. El cast a string es el mismo patrón ya
// usado para 'owner' en este archivo: el tipo local UserRole no incluye los
// roles reales que emite el backend (owner/supervisor/warehouse/production).
function canManageInventory(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner' || role === 'supervisor' || role === 'warehouse';
}

export const InventoryView: React.FC = () => {
  const {
    ingredients,
    products,
    addProduct,
    updateProduct,
    updateProductStock,
    addBatch,
    requestBatchWithdrawal,
    addSystemNotification,
    setActiveTab,
    batches = [],
    setBatches,
    activeUser,
    updateProductGroups
  } = useApp();
  // Fuente real de mermas: solicitudes type==='waste' del sistema de Solicitudes.
  // La aprobación/rechazo de mermas vive únicamente en AdminRequestsView; acá el
  // tab de mermas es sólo lectura (monitoreo + KPIs).
  const { requests: erpRequests } = useRequests();

  const [activeSubTab, setActiveSubTab] = useState<'insumos' | 'productos' | 'caducidad' | 'mermas'>('insumos');
  const [selectedProductForBatches, setSelectedProductForBatches] = useState<Product | null>(null);
  const [expandedGroupsFor, setExpandedGroupsFor] = useState<string | null>(null);
  const [mermasFilter, setMermasFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Expiry Priority States
  const [priorityCriteria, setPriorityCriteria] = useState<'categoria' | 'precio' | 'unidades'>(() => {
    try { return (localStorage.getItem('pan_erp_criteria') as 'categoria' | 'precio' | 'unidades') || 'categoria'; } catch { return 'categoria'; }
  });
  const [priorityAlertDays, setPriorityAlertDays] = useState<number>(() => {
    try { const saved = localStorage.getItem('pan_erp_alert_days'); return saved ? Number(saved) : 2; } catch { return 2; }
  });
  const [localAlertDays, setLocalAlertDays] = useState<number>(priorityAlertDays);
  const [priorityCategory, setPriorityCategory] = useState<string>(() => {
    try { return localStorage.getItem('pan_erp_prio_cat') || 'pasteleria'; } catch { return 'pasteleria'; }
  });

  const handleSavePriorityConfig = (criteria: 'categoria' | 'precio' | 'unidades', days: number, cat: string, notify = true) => {
    const safeDays = Math.max(1, isNaN(days) ? 2 : days);
    setPriorityCriteria(criteria);
    setPriorityAlertDays(safeDays);
    setLocalAlertDays(safeDays);
    setPriorityCategory(cat);
    localStorage.setItem('pan_erp_criteria', criteria);
    localStorage.setItem('pan_erp_alert_days', safeDays.toString());
    localStorage.setItem('pan_erp_prio_cat', cat);
    if (notify) addSystemNotification('⚙️ Prioridades Guardadas', `Se priorizaron alertas de caducidad por: ${criteria.toUpperCase()}`, 'success');
  };

  const getProductExpiryDays = (prod: Product) => {
    if (!prod.elaborationDate || !prod.durabilityDays) return 999;
    const elaborDateObj = new Date(prod.elaborationDate + 'T00:00:00');
    if (isNaN(elaborDateObj.getTime())) return 999;
    const expiryDateObj = new Date(elaborDateObj.getTime());
    expiryDateObj.setDate(expiryDateObj.getDate() + prod.durabilityDays);
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const diffTime = expiryDateObj.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getPrioritizedExpiryProducts = () => {
    const list = products.filter(p => p.durabilityDays !== undefined && !p.isRawMaterial);
    
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
  
  // Insumo creation/edit form modal — el mismo modal se reutiliza para editar
  // cuando `editingIngredient` !== null (mismo patrón que showProductModal /
  // editingProduct más abajo).
  // El tab "insumos" ahora lista `products` reales con is_raw_material=1 (no el
  // array local Ingredient[]). El modal crea/edita esos products vía
  // addProduct/updateProduct con isRawMaterial:true. `insumoUnit` usa las
  // unidades de Product (products.unit CHECK en D1), no las de Ingredient.
  type ProductUnit = NonNullable<Product['unit']>;
  const [showInsumoModal, setShowInsumoModal] = useState(false);
  const [editingRawMaterial, setEditingRawMaterial] = useState<Product | null>(null);
  const [insumoName, setInsumoName] = useState('');
  const [insumoUnit, setInsumoUnit] = useState<ProductUnit>('kg');
  const [insumoStock, setInsumoStock] = useState(10);
  const [insumoMinStock, setInsumoMinStock] = useState(5);
  const [insumoCost, setInsumoCost] = useState(1.5);

  const closeInsumoModal = () => {
    setInsumoName('');
    setInsumoUnit('kg');
    setInsumoStock(10);
    setInsumoMinStock(5);
    setInsumoCost(1.5);
    setShowInsumoModal(false);
    setEditingRawMaterial(null);
  };

  const openEditInsumoModal = (prod: Product) => {
    setEditingRawMaterial(prod);
    setInsumoName(prod.name);
    setInsumoUnit(prod.unit ?? 'kg');
    setInsumoStock(prod.stock);
    setInsumoMinStock(prod.minStock);
    setInsumoCost(prod.cost);
    setShowInsumoModal(true);
  };

  // Mapea las unidades del array local Ingredient (kg/g/L/ml/unidades) a las
  // unidades válidas de Product (kg/g/l/ml/unit/…). Usado tanto por la
  // migración a la nube como por cualquier lectura del catálogo viejo.
  const mapIngredientUnitToProductUnit = (u: Ingredient['unit']): ProductUnit => {
    switch (u) {
      case 'L': return 'l';
      case 'unidades': return 'unit';
      case 'kg': return 'kg';
      case 'g': return 'g';
      case 'ml': return 'ml';
      default: return 'unit';
    }
  };

  // Categoría por defecto para insumos migrados/creados: 'panes' es una
  // CategoryType válida ya existente. No aparece en caja porque isRawMaterial
  // los excluye del catálogo vendible.
  const RAW_MATERIAL_DEFAULT_CATEGORY: CategoryType = 'panes';
  const RAW_MATERIAL_ICON = '🌾';

  // Product creation form modal & dynamic recipe builder — state encapsulado
  // en `useProductForm`. La visibilidad del modal sigue siendo state local
  // porque la usa el render de InventoryView, no la lógica del formulario.
  // Reutilizamos el mismo modal para editar: `editingProduct` !== null indica
  // modo edición. `useProductForm` ya soportaba `defaults` (pensado para esto)
  // — sólo faltaba: 1) alimentar esos defaults con el producto a editar,
  // 2) forzar un reset() para que los inputs tomen esos valores (los defaults
  // sólo se aplican al primer montaje del hook), y 3) bifurcar el submit entre
  // addProduct/updateProduct según el modo.
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const productFormDefaults = useMemo(() => (
    editingProduct
      ? {
          name: editingProduct.name,
          category: editingProduct.category,
          price: editingProduct.price,
          cost: editingProduct.cost,
          minStock: editingProduct.minStock,
          image: editingProduct.image,
          code: editingProduct.code,
          stock: editingProduct.stock,
        }
      : {}
  ), [editingProduct]);

  const productForm = useProductForm((payload) => {
    if (editingProduct) {
      updateProduct(editingProduct.id, {
        name: payload.name,
        category: payload.category,
        price: payload.price,
        cost: payload.cost,
        minStock: payload.minStock,
        image: payload.image,
        code: payload.code,
      });
    } else {
      addProduct(payload);
    }
    setShowProductModal(false);
    setEditingProduct(null);
  }, productFormDefaults);

  // Los defaults de useProductForm sólo se aplican al montar el hook (useState
  // lazy init) — para que abrir el modal en modo edición precargue los campos
  // del producto seleccionado, forzamos un reset() cuando cambia editingProduct.
  // Sin el `if`: también se resetea cuando editingProduct vuelve a null (cierre
  // sin guardar), así el form no arrastra los datos del producto editado hacia
  // el próximo alta (productFormDefaults ya es {} en ese render, por lo que
  // reset() aplica FALLBACK_DEFAULTS).
  useEffect(() => {
    productForm.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- productForm.reset es estable (useCallback sin deps); sólo nos interesa reaccionar al producto seleccionado
  }, [editingProduct]);

  const closeProductModal = () => {
    productForm.reset();
    setShowProductModal(false);
    setEditingProduct(null);
  };

  const openEditProductModal = (prod: Product) => {
    setEditingProduct(prod);
    setShowProductModal(true);
  };

  // Handle raw-material (insumo) addition or edit. Ahora escribe sobre
  // `products` reales (isRawMaterial:true, isProducible:false) vía
  // addProduct/updateProduct, no sobre el array local Ingredient[]. El precio
  // de venta va en 0: un insumo no se vende directo en caja.
  const handleCreateInsumoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!insumoName.trim()) return;

    if (editingRawMaterial) {
      updateProduct(editingRawMaterial.id, {
        name: insumoName,
        unit: insumoUnit,
        minStock: Number(insumoMinStock),
        cost: Number(insumoCost),
        isRawMaterial: true,
        isProducible: false,
      });
    } else {
      addProduct({
        name: insumoName,
        category: RAW_MATERIAL_DEFAULT_CATEGORY,
        price: 0,
        cost: Number(insumoCost),
        stock: Number(insumoStock),
        minStock: Number(insumoMinStock),
        image: RAW_MATERIAL_ICON,
        ingredients: [],
        isRawMaterial: true,
        isProducible: false,
        unit: insumoUnit,
      });
    }

    // Reset fields
    setInsumoName('');
    setInsumoUnit('kg');
    setInsumoStock(10);
    setInsumoMinStock(5);
    setInsumoCost(1.5);
    setShowInsumoModal(false);
    setEditingRawMaterial(null);
  };

  // Quick replenish helper — un insumo es un Product real, así que su stock se
  // ajusta con updateProductStock (mismo mecanismo directo que ya usa el resto
  // del archivo para ajustar Product.stock, p. ej. en el tab de caducidad),
  // no con updateIngredientStock (array local).
  const triggerIncrementStockVal = (prod: Product, incAmount: number) => {
    updateProductStock(prod.id, prod.stock + incAmount);
    addSystemNotification(
      '🔄 Stock de Insumo Actualizado',
      `Se sumaron ${incAmount} ${prod.unit ?? 'u'} a "${prod.name}". Nuevo stock: ${prod.stock + incAmount}.`,
      'info'
    );
  };

  // Insumos reales = products con is_raw_material. Productos terminados = el resto.
  const rawMaterials = products.filter(p => p.isRawMaterial === true);
  const finishedProducts = products.filter(p => !p.isRawMaterial);

  // Insumos locales (array viejo) que todavía NO tienen equivalente creado en
  // `products` (match por nombre normalizado). Fuente pendiente de migración.
  const pendingMigrationIngredients = ingredients.filter(
    ing => !rawMaterials.some(
      rm => rm.name.trim().toLowerCase() === ing.name.trim().toLowerCase()
    )
  );

  const handleMigrateInsumosToCloud = () => {
    const pending = pendingMigrationIngredients;
    if (pending.length === 0) return;

    let migrated = 0;
    const failed: string[] = [];

    for (const ing of pending) {
      try {
        addProduct({
          name: ing.name,
          category: RAW_MATERIAL_DEFAULT_CATEGORY,
          price: 0,
          cost: ing.unitCost,
          stock: 0,
          minStock: ing.minStock,
          image: RAW_MATERIAL_ICON,
          ingredients: [],
          isRawMaterial: true,
          isProducible: false,
          unit: mapIngredientUnitToProductUnit(ing.unit),
        });
        migrated++;
      } catch {
        // Error por ítem: registramos cuál falló y seguimos con el resto del lote.
        failed.push(ing.name);
      }
    }

    addSystemNotification(
      '☁️ Migración de Insumos',
      failed.length === 0
        ? `${migrated} insumo(s) migrado(s) a la nube correctamente.`
        : `${migrated} insumo(s) migrado(s), ${failed.length} falló(aron): ${failed.join(', ')}.`,
      failed.length === 0 ? 'success' : 'warning'
    );
  };

  const currentIngredientsInventoryValue = rawMaterials.reduce((sum, prod) => sum + (prod.stock * prod.cost), 0);
  const currentProductsInventoryValue = finishedProducts.reduce((sum, prod) => sum + (prod.stock * prod.price), 0);
  const totalLowStockInsumos = rawMaterials.filter(p => p.stock <= p.minStock).length;
  const totalLowStockProducts = finishedProducts.filter(p => p.stock <= p.minStock).length;

  // Mermas (type==='waste') mapeadas a filas de sólo lectura. El estado ERP se
  // colapsa a 3 buckets de monitoreo: pending / approved / rejected. Los datos
  // del lote y la cantidad viajan en metadata.
  const wasteRows = useMemo(() => {
    return erpRequests
      .filter(r => r.type === 'waste')
      .map(r => {
        const bucket: 'pending' | 'approved' | 'rejected' | 'other' =
          r.status === 'pending_approval' ? 'pending'
          : (r.status === 'approved' || r.status === 'completed') ? 'approved'
          : r.status === 'rejected' ? 'rejected'
          : 'other';
        return {
          id: r.id,
          productName: products.find(p => p.id === r.metadata?.product_id)?.name ?? r.title,
          batchNumber: batches.find(b => b.id === r.metadata?.batch_id)?.batchNumber ?? '—',
          quantity: r.metadata?.quantity ?? 0,
          reason: r.metadata?.reason ?? r.description ?? '',
          bucket,
          date: r.created_at,
          requestedBy: r.created_by_role,
          adminMemo: r.rejection_reason ?? r.admin_note ?? '',
        };
      });
  }, [erpRequests, products, batches]);

  const wasteTotals = useMemo(() => ({
    total:    wasteRows.length,
    pending:  wasteRows.filter(r => r.bucket === 'pending').length,
    approved: wasteRows.filter(r => r.bucket === 'approved').length,
    rejected: wasteRows.filter(r => r.bucket === 'rejected').length,
  }), [wasteRows]);

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
        <div className="space-y-4">
        {/* Banner de migración: mientras existan insumos locales (array viejo)
            sin equivalente en `products`, ofrecemos migrarlos a la nube. */}
        {pendingMigrationIngredients.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Download className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-amber-800 dark:text-amber-300">Insumos locales sin sincronizar</p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                  Hay {pendingMigrationIngredients.length} insumo(s) en el catálogo local que todavía no existen como producto real en la nube.
                </p>
              </div>
            </div>
            <button
              id="btn-migrate-insumos-cloud"
              onClick={handleMigrateInsumosToCloud}
              className="py-2 px-4 rounded-xl text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 cursor-pointer flex items-center gap-1.5 shadow-sm h-9 shrink-0 transition-all"
            >
              <Download className="h-4 w-4" /> Migrar insumos a la nube ({pendingMigrationIngredients.length} pendientes)
            </button>
          </div>
        )}
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
                  <th className="py-4 px-5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-800 dark:text-zinc-200">
                {rawMaterials
                  .filter(prod => prod.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(prod => {
                    const unitLabel = prod.unit ?? 'u';
                    const isAlert = prod.stock <= prod.minStock;
                    const stockPercentage = Math.min((prod.stock / (prod.minStock * 3)) * 100, 100);

                    return (
                      <tr key={prod.id} className={`hover:bg-gray-50/50 dark:hover:bg-zinc-855/30 ${isAlert ? 'bg-red-50/10' : ''}`}>
                        <td className="py-4 px-5">
                          <div>
                            <p className="font-bold text-gray-855 dark:text-zinc-100">{prod.name}</p>
                            <p className="text-[10px] text-gray-450 dark:text-zinc-500 font-mono italic">ID: {prod.id}</p>
                          </div>
                        </td>
                        <td className="py-4 px-5 font-mono">{formatCurrency(prod.cost)}</td>
                        <td className="py-4 px-5 capitalize text-gray-500 font-medium">{unitLabel}</td>
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
                              {prod.stock.toFixed(2)} {unitLabel}
                            </span>
                            <div className="w-24 bg-gray-100 dark:bg-zinc-800 h-1.5 rounded-full mt-1 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isAlert ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${stockPercentage}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-gray-400 block mt-0.5 leading-none">Mín: {prod.minStock} {unitLabel}</span>
                          </div>
                        </td>
                        <td className="py-4 px-5 text-right">
                          <div className="flex items-center justify-end gap-1 select-none">
                            <button
                              id={`btn-replenish-10-${prod.id}`}
                              onClick={() => triggerIncrementStockVal(prod, 10)}
                              className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 text-[10px] font-bold text-amber-700 dark:text-amber-400 cursor-pointer"
                              title="Suma 10 unidades al stock físico del insumo de inmediato"
                            >
                              +10 {unitLabel}
                            </button>
                            <button
                              id={`btn-replenish-50-${prod.id}`}
                              onClick={() => triggerIncrementStockVal(prod, 50)}
                              className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 text-[10px] font-bold text-amber-700 dark:text-amber-400 cursor-pointer"
                              title="Suma 50 unidades al stock físico del insumo de inmediato"
                            >
                              +50 {unitLabel}
                            </button>
                          </div>
                        </td>
                        <td className="py-4 px-5 text-right">
                          {canManageInventory(activeUser.role) && (
                            <button
                              id={`btn-edit-insumo-${prod.id}`}
                              onClick={() => openEditInsumoModal(prod)}
                              className="p-1.5 rounded-lg bg-gray-50 hover:bg-amber-100 dark:bg-zinc-850 dark:hover:bg-amber-950/30 text-gray-500 hover:text-amber-700 dark:text-zinc-400 dark:hover:text-amber-400 cursor-pointer transition-colors"
                              title="Editar insumo"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {activeSubTab === 'productos' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {finishedProducts
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
                        <span className="text-2xl" role="img" aria-hidden="true">{prod.image}</span>
                        <div>
                          <h3 className="font-extrabold text-sm text-gray-855 dark:text-zinc-50">{prod.name}</h3>
                          <span className="text-[10px] bg-amber-100/60 dark:bg-amber-950/20 text-amber-801 dark:text-amber-400 px-1.5 py-0.5 rounded uppercase font-bold text-[9px]">
                            {prod.category}
                          </span>
                        </div>
                      </div>
                      
                      <div className="text-right flex items-start gap-1.5">
                        <div>
                          <p className="text-xs font-extrabold text-emerald-500">{formatCurrency(prod.price)}</p>
                          <p className="text-[9px] text-gray-400 leading-tight">Costo: {formatCurrency(prod.cost)}</p>
                        </div>
                        {/* 'owner' no está en el tipo UserRole pero el backend lo emite — cast
                            explícito para que la comparación no rompa el typecheck. */}
                        {(activeUser.role === 'admin' || (activeUser.role as string) === 'owner') && (
                          <button
                            id={`btn-edit-product-${prod.id}`}
                            onClick={() => openEditProductModal(prod)}
                            className="p-1.5 rounded-lg bg-gray-50 hover:bg-amber-100 dark:bg-zinc-850 dark:hover:bg-amber-950/30 text-gray-500 hover:text-amber-700 dark:text-zinc-400 dark:hover:text-amber-400 cursor-pointer transition-colors"
                            title="Editar producto"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
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
                                {recipe.quantity} {originalIng?.unit ?? ''}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-[10px] text-gray-400 italic">No requiere insumos directos (venta directa de terceros)</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-1 select-none space-y-2">
                    <button
                      id={`btn-manage-batches-${prod.id}`}
                      onClick={() => setSelectedProductForBatches(prod)}
                      className="w-full py-2 px-3 text-center bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all active:scale-95 duration-200"
                    >
                      <Package className="h-3.5 w-3.5 animate-bounce" />
                      Gestionar Lotes (Activos: {batches.filter(b => b.productId === prod.id && b.status === 'active' && b.stock > 0).length})
                    </button>

                    <button
                      id={`btn-manage-groups-${prod.id}`}
                      onClick={() => setExpandedGroupsFor(prev => (prev === prod.id ? null : prod.id))}
                      className="w-full py-2 px-3 text-center bg-white dark:bg-zinc-850 border border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-200"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {expandedGroupsFor === prod.id ? 'Ocultar grupos' : 'Configurar grupos'}
                      {(prod.groups?.length ?? 0) > 0 && (
                        <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-black">
                          {prod.groups!.length}
                        </span>
                      )}
                    </button>

                    {expandedGroupsFor === prod.id && (
                      <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/40 rounded-xl p-3 mt-2">
                        <ProductGroupsEditor
                          product={prod}
                          onSave={(groups: ProductGroup[]) => {
                            updateProductGroups(prod.id, groups);
                            addSystemNotification(
                              '✅ Grupos actualizados',
                              `Se guardaron ${groups.length} presentación(es) para "${prod.name}".`,
                              'success'
                            );
                            setExpandedGroupsFor(null);
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Increment finished baked good stock counts directly */}
                  <div className="mt-4 pt-3 border-t border-gray-150 dark:border-zinc-800 flex items-center gap-2 select-none">
                    {([10, 50] as const).map(qty => (
                      <button
                        key={qty}
                        id={`btn-prod-replenish-${qty}-${prod.id}`}
                        onClick={() => {
                          const today = new Date().toISOString().split('T')[0];
                          const exp = new Date();
                          exp.setDate(exp.getDate() + (prod.durabilityDays || 3));
                          addBatch({
                            productId: prod.id,
                            batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
                            quantity: qty,
                            stock: qty,
                            elaborationDate: today,
                            expiryDate: exp.toISOString().split('T')[0],
                            withdrawalMode: 'automatic',
                          });
                        }}
                        className="flex-1 py-1 px-1 text-center bg-gray-50 hover:bg-gray-105 dark:bg-zinc-850 dark:hover:bg-zinc-800 rounded text-[10px] font-bold text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-zinc-750 cursor-pointer animate-btn"
                        title={`Horneada: suma ${qty} unidades con nuevo lote FEFO`}
                      >
                        Sumar +{qty} {prod.image}
                      </button>
                    ))}
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
                    {(() => {
                      const expiryProducts = getPrioritizedExpiryProducts();
                      return expiryProducts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-zinc-400 font-bold">
                          No hay productos elaborados registrados con control de caducidad.
                        </td>
                      </tr>
                    ) : (
                      expiryProducts
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
                                          // FEFO: find the batch with the nearest expiry and deduct 1 from it
                                          const activeBatchesForProd = batches.filter(b => b.productId === prod.id && b.status === 'active' && b.stock > 0);
                                          if (activeBatchesForProd.length > 0) {
                                            const fefoB = [...activeBatchesForProd].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];
                                            setBatches(prev => prev.map(b => b.id === fefoB.id ? { ...b, stock: Math.max(0, b.stock - 1) } : b));
                                          } else {
                                            setBatches(prev => prev.map(b => b.productId === prod.id ? { ...b, stock: 0 } : b));
                                          }
                                          updateProductStock(prod.id, Math.max(0, prod.stock - 1));
                                          addSystemNotification(
                                            '💰 Liquidación 50%',
                                            `Venta Promo -50%: ${prod.name} relevado a ${formatCurrency(discountedPrice)} por fecha límite.`,
                                            'success'
                                          );
                                        }}
                                        className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[9px] font-extrabold cursor-pointer transition-transform duration-100 transform active:scale-95 shadow-xs"
                                        title="Simula una orden de venta rápida a mitad de precio"
                                      >
                                        Oferta -50%
                                      </button>

                                      <button
                                        onClick={() => {
                                          const productBatches = batches.filter(b => b.productId === prod.id && b.status === 'active' && b.stock > 0);
                                          if (productBatches.length > 0) {
                                            const oldest = [...productBatches].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];
                                            void requestBatchWithdrawal(oldest.id, oldest.stock, 'Merma por vencimiento de caducidad — solicitud generada automáticamente.').catch(() =>
                                              addSystemNotification('⚠️ Merma no registrada', `No se pudo registrar la baja de "${prod.name}". Reintentá.`, 'warning'),
                                            );
                                          } else {
                                            // Zero out any remaining batches for this product to keep state in sync
                                            setBatches(prev => prev.map(b => b.productId === prod.id ? { ...b, stock: 0 } : b));
                                            updateProductStock(prod.id, 0);
                                            addSystemNotification('🗑️ Merma Descontada', `Se registraron ${prod.stock} u. de merma desperdiciada para "${prod.name}".`, 'warning');
                                          }
                                        }}
                                        className="px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 rounded text-[9px] font-extrabold cursor-pointer transition-transform duration-100 transform active:scale-95"
                                        title="Dar de baja unidades restantes por merma de caducidad (requiere aprobación de admin)"
                                      >
                                        Desechar
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        const today = new Date().toISOString().split('T')[0];
                                        const exp = new Date();
                                        exp.setDate(exp.getDate() + (prod.durabilityDays || 3));
                                        addBatch({
                                          productId: prod.id,
                                          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
                                          quantity: 50,
                                          stock: 50,
                                          elaborationDate: today,
                                          expiryDate: exp.toISOString().split('T')[0],
                                          withdrawalMode: 'automatic',
                                        });
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
                    );
                    })()}
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
                        onClick={() => handleSavePriorityConfig(opt.id as 'categoria' | 'precio' | 'unidades', priorityAlertDays, priorityCategory)}
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
                        value={localAlertDays}
                        onChange={(e) => setLocalAlertDays(Number(e.target.value))}
                        onBlur={(e) => {
                          const days = Math.max(1, parseInt(e.target.value, 10) || priorityAlertDays);
                          handleSavePriorityConfig(priorityCriteria, days, priorityCategory);
                        }}
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
              <h4 className="text-2xl font-black text-gray-855 dark:text-zinc-50 mt-1">{wasteTotals.total}</h4>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-950 p-4 rounded-2xl shadow-xs">
              <p className="text-[10px] font-extrabold text-amber-650 dark:text-amber-500 uppercase tracking-widest">Pendientes</p>
              <h4 className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-1 font-mono">
                {wasteTotals.pending}
              </h4>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-950 p-4 rounded-2xl shadow-xs">
              <p className="text-[10px] font-extrabold text-emerald-650 dark:text-emerald-500 uppercase tracking-widest">Aprobados</p>
              <h4 className="text-2xl font-black text-emerald-700 dark:text-emerald-405 mt-1 font-mono">
                {wasteTotals.approved}
              </h4>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-950 p-4 rounded-2xl shadow-xs">
              <p className="text-[10px] font-extrabold text-red-650 dark:text-red-550 uppercase tracking-widest">Rechazados</p>
              <h4 className="text-2xl font-black text-red-705 dark:text-red-400 mt-1 font-mono">
                {wasteTotals.rejected}
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
            {wasteRows
              .filter(r => mermasFilter === 'all' || r.bucket === mermasFilter)
              .filter(r => !searchQuery || r.productName.toLowerCase().includes(searchQuery.toLowerCase()))
              .length === 0 ? (
              <div className="bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800 rounded-2xl text-center py-12 text-gray-400 font-bold select-none">
                Ninguna solicitud de baja coincide con este filtro.
              </div>
            ) : (
              wasteRows
                .filter(r => mermasFilter === 'all' || r.bucket === mermasFilter)
                .filter(r => !searchQuery || r.productName.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(req => {
                  const isPending = req.bucket === 'pending';
                  const isApproved = req.bucket === 'approved';
                  const isRejected = req.bucket === 'rejected';
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
                            <div className="text-center py-4 bg-amber-500/10 rounded-2xl border border-amber-300 dark:border-amber-950 p-3 select-none text-xs">
                              <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto mb-1.5 animate-bounce" />
                              <p className="text-[10px] font-extrabold text-amber-705 dark:text-amber-400">
                                Pendiente de aprobación
                              </p>
                              <p className="text-[9px] text-gray-400 mt-1 leading-normal font-sans">
                                Enviada al Panel de Solicitudes para su autorización formal y retiro por administración.
                              </p>
                            </div>
                          ) : (
                            <div className={`p-4 rounded-xl border text-xs leading-normal select-none ${
                              isApproved
                                ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                                : isRejected
                                ? 'bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-300'
                                : 'bg-gray-500/5 border-gray-300/30 text-gray-600 dark:text-zinc-300'
                            }`}>
                              <div className="flex items-center gap-1.5 font-extrabold pb-2 mb-2 border-b border-gray-100 dark:border-zinc-800 uppercase text-[9px] tracking-wider">
                                {isApproved ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                                    <span>Solicitud Aprobada (Mermado)</span>
                                  </>
                                ) : isRejected ? (
                                  <>
                                    <X className="h-3.5 w-3.5 text-red-500" />
                                    <span>Solicitud Desestimada</span>
                                  </>
                                ) : (
                                  <span>En proceso</span>
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

      {/* MODAL 1: ADD OR EDIT INSUMO */}
      {showInsumoModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in">
          <form
            onSubmit={handleCreateInsumoSubmit}
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-800 max-w-sm w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2.5 border-gray-100 dark:border-zinc-800">
              <h3 className="font-extrabold text-base text-gray-850 dark:text-zinc-50 flex items-center gap-1.5">
                <Wheat className="h-4.5 w-4.5 text-amber-500" />
                {editingRawMaterial ? <>✏️ Editar Insumo: {editingRawMaterial.name}</> : <>Registrar Materia Prima</>}
              </h3>
              <button
                type="button"
                id="btn-insumo-modal-close"
                onClick={closeInsumoModal}
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
                  onChange={(e) => setInsumoUnit(e.target.value as ProductUnit)}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                >
                  <option value="kg">kilogramos (kg)</option>
                  <option value="g">gramos (g)</option>
                  <option value="l">litros (L)</option>
                  <option value="ml">mililitros (ml)</option>
                  <option value="unit">unidades (u)</option>
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
              {/* Stock inicial sólo aplica al crear: una vez que el insumo existe, el
                  stock físico se gestiona vía los botones de reposición dedicados
                  (updateProductStock), no reescribiéndolo desde este modal —
                  mismo criterio que el modal de productos con editingProduct. */}
              {!editingRawMaterial && (
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
              )}

              <div className={`space-y-1 ${editingRawMaterial ? 'col-span-2' : ''}`}>
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
                onClick={closeInsumoModal}
                className="flex-1 py-3 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-850 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                id="btn-insumo-modal-submit"
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                {editingRawMaterial ? 'Guardar Cambios' : 'Guardar Insumo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: ADD NEW BAKERY PRODUCT & ATTACH DYNAMIC INGREDIENTS FORMULA */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in dialog-overlay">
          <form
            onSubmit={productForm.handleSubmit}
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-800 max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b pb-2.5 border-gray-100 dark:border-zinc-800">
              <h3 className="font-extrabold text-base text-gray-850 dark:text-zinc-50 flex items-center gap-1.5 font-sans">
                {editingProduct ? <>✏️ Editar Producto: {editingProduct.name}</> : <>👑 Agregar Panificado / Producto Especial</>}
              </h3>
              <button
                type="button"
                id="btn-prod-modal-close"
                onClick={closeProductModal}
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
                  value={productForm.fields.name}
                  onChange={(e) => productForm.setters.setName(e.target.value)}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100 font-semibold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Categoría</label>
                <select
                  id="modal-prod-category"
                  value={productForm.fields.category}
                  onChange={(e) => productForm.setters.setCategory(e.target.value as CategoryType)}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                >
                  <option value="panes">Panes Artesanales</option>
                  <option value="facturas">Facturas / Dulces</option>
                  <option value="pasteleria">Pastelería y Tortas</option>
                  <option value="bebidas">Cafetaría y Bebidas</option>
                  <option value="salados">Salados y Sándwiches</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Ícono / Imagen</label>
                <ImagePicker value={productForm.fields.image} onChange={productForm.setters.setImage} />
              </div>
            </div>

            {editingProduct && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Código de Barras</label>
                  <input
                    id="modal-prod-code"
                    type="text"
                    placeholder="Código de barras"
                    value={productForm.fields.code}
                    onChange={(e) => productForm.setters.setCode(e.target.value)}
                    className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100 font-mono"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Precio de Venta Mostrador ($)</label>
                <input
                  id="modal-prod-price"
                  type="number"
                  step="0.01"
                  required
                  min="0.05"
                  value={productForm.fields.price}
                  onChange={(e) => productForm.setters.setPrice(Number(e.target.value))}
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
                  value={productForm.fields.cost}
                  onChange={(e) => productForm.setters.setCost(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Stock inicial sólo aplica al crear: una vez que el producto existe,
                  el stock se gestiona vía lotes/reposición dedicados (updateProductStock,
                  BatchPanel), no reescribiéndolo desde este modal. */}
              {!editingProduct && (
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Stock Inicial Horneado</label>
                  <input
                    id="modal-prod-stock"
                    type="number"
                    required
                    min="0"
                    value={productForm.fields.stock}
                    onChange={(e) => productForm.setters.setStock(Number(e.target.value))}
                    className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Alerta Quiebre Stock (Mín)</label>
                <input
                  id="modal-prod-minstock"
                  type="number"
                  required
                  min="1"
                  value={productForm.fields.minStock}
                  onChange={(e) => productForm.setters.setMinStock(Number(e.target.value))}
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
                  const activeRecipeItem = productForm.recipe.items.find(r => r.ingredientId === ing.id);
                  const isChecked = !!activeRecipeItem;

                  return (
                    <div key={ing.id} className="flex items-center justify-between text-xs py-2 select-none">
                      <div className="flex items-center gap-2">
                        <input
                          id={`modal-recipe-check-${ing.id}`}
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => productForm.recipe.toggle(ing.id, 1)}
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
                            onChange={(e) => productForm.recipe.setQuantity(ing.id, Number(e.target.value))}
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
                onClick={closeProductModal}
                className="flex-1 py-3 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-850 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                id="btn-prod-modal-submit"
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                {editingProduct ? 'Guardar Cambios' : 'Guardar Nuevo Horneado'}
              </button>
            </div>
          </form>
          </div>
      )}

      {/* FLOATING ACTION LUPA BUTTON FOR BOTH VIEWS */}
      <button
        id="btn-inventory-floating-lupa-search"
        onClick={() => {
          try { localStorage.setItem('pan_erp_open_search_list', 'true'); } catch { /* storage full */ }
          setActiveTab('pos');
        }}
        className="fixed bottom-6 right-6 lg:bottom-8 lg:right-8 z-40 p-4 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer border-2 border-white dark:border-zinc-800 ring-4 ring-amber-550/10 dark:ring-zinc-900 group animate-bounce"
        title="Buscar Panificados (Modo Lista)"
      >
        <Search className="h-6 w-6 group-hover:rotate-12 transition-transform duration-300" />
      </button>

      {selectedProductForBatches && (
        <BatchPanel
          product={selectedProductForBatches}
          onClose={() => setSelectedProductForBatches(null)}
        />
      )}

    </div>
  );
};
