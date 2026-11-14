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
  Pencil,
  LayoutGrid,
  Table,
  SlidersHorizontal,
  ArrowUpDown,
  CheckCircle2,
  History,
  ArrowLeftRight
} from 'lucide-react';
import * as React from 'react'
import { useState, useEffect, useMemo } from 'react';

import { useApp } from '../AppContext';
import { useProductForm } from '../hooks/useProductForm';
import { useRequests } from '../hooks/useRequests';
import { syncStockMovementToD1 } from '../services/d1-sync';
import type { Ingredient, Product, ProductGroup, CategoryType, ProductBatch } from '../types';
import { exportIngredientsToCSV } from '../utils/exportUtils';
import { formatCurrency } from '../utils/format';

import { ImagePicker } from './ImagePicker';
import { BatchPanel } from './inventory/BatchPanel';
import { KardexPanel } from './inventory/KardexPanel';
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

  const [activeSubTab, setActiveSubTab] = useState<'insumos' | 'productos' | 'kardex' | 'caducidad' | 'mermas'>('insumos');
  const [selectedProductForBatches, setSelectedProductForBatches] = useState<Product | null>(null);
  const [expandedGroupsFor, setExpandedGroupsFor] = useState<string | null>(null);
  const [mermasFilter, setMermasFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [productKind, setProductKind] = useState('all');

  // Selector de vista: Tarjetas vs Tabla Densa ERP
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    try {
      return (localStorage.getItem('pan_erp_inventory_view_mode') as 'cards' | 'table') || 'table';
    } catch {
      return 'table';
    }
  });

  const handleSetViewMode = (mode: 'cards' | 'table') => {
    setViewMode(mode);
    try {
      localStorage.setItem('pan_erp_inventory_view_mode', mode);
    } catch {}
  };

  // Filtros avanzados y ordenamiento
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'out_of_stock' | 'critical' | 'optimal'>('all');
  const [sortBy, setSortBy] = useState<string>('name_asc');

  // Edición rápida inline de precios y costos
  const [inlineEditing, setInlineEditing] = useState<{ productId: string; price: string; cost: string } | null>(null);
  const [inlineFeedbackId, setInlineFeedbackId] = useState<string | null>(null);

  const startInlineEdit = (prod: Product) => {
    setInlineEditing({
      productId: prod.id,
      price: String(prod.price),
      cost: String(prod.cost),
    });
  };

  const cancelInlineEdit = () => {
    setInlineEditing(null);
  };

  const saveInlineEdit = (prod: Product) => {
    if (!inlineEditing || inlineEditing.productId !== prod.id) return;
    const numPrice = parseFloat(inlineEditing.price);
    const numCost = parseFloat(inlineEditing.cost);
    if (isNaN(numPrice) || numPrice < 0 || isNaN(numCost) || numCost < 0) {
      addSystemNotification('Valores inválidos', 'Ingresá valores numéricos válidos mayores o iguales a 0.', 'warning');
      return;
    }
    updateProduct(prod.id, { price: numPrice, cost: numCost });
    setInlineEditing(null);
    setInlineFeedbackId(prod.id);
    setTimeout(() => setInlineFeedbackId(null), 2500);
    addSystemNotification('Precios Actualizados', `Se actualizaron los precios de "${prod.name}" (Precio: ${formatCurrency(numPrice)}, Costo: ${formatCurrency(numCost)}).`, 'success');
  };

  // Modal de Ajustar Stock con Persistencia a D1
  interface AdjustStockState {
    product: Product;
    type: 'delta' | 'physical';
    deltaQty: string;
    physicalQty: string;
    reason: 'Conteo físico' | 'Ingreso de producción' | 'Merma / Desecho' | 'Rotura' | 'Ajuste administrativo';
    notes: string;
    batchId?: string;
  }
  const [adjustingStock, setAdjustingStock] = useState<AdjustStockState | null>(null);
  const [adjustFeedbackId, setAdjustFeedbackId] = useState<string | null>(null);
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);

  const openAdjustStockModal = (
    prod: Product,
    defaultReason?: AdjustStockState['reason'],
    defaultDelta?: number,
    defaultNotes?: string,
    batchId?: string
  ) => {
    setAdjustingStock({
      product: prod,
      type: 'delta',
      deltaQty: defaultDelta !== undefined ? String(defaultDelta) : '10',
      physicalQty: String(prod.stock),
      reason: defaultReason ?? 'Conteo físico',
      notes: defaultNotes ?? '',
      batchId,
    });
  };

  const handleConfirmAdjustStock = async () => {
    if (!adjustingStock) return;
    const { product, type, deltaQty, physicalQty, reason, notes, batchId } = adjustingStock;

    let delta = 0;
    let newStock = product.stock;

    if (type === 'delta') {
      const parsedDelta = parseFloat(deltaQty);
      if (isNaN(parsedDelta) || parsedDelta === 0) {
        addSystemNotification('Cantidad inválida', 'Ingresá una cantidad válida distinta de 0.', 'warning');
        return;
      }
      delta = parsedDelta;
      newStock = Math.max(0, parseFloat((product.stock + delta).toFixed(3)));
    } else {
      const parsedPhysical = parseFloat(physicalQty);
      if (isNaN(parsedPhysical) || parsedPhysical < 0) {
        addSystemNotification('Conteo inválido', 'Ingresá un conteo físico válido mayor o igual a 0.', 'warning');
        return;
      }
      delta = parseFloat((parsedPhysical - product.stock).toFixed(3));
      newStock = parsedPhysical;
    }

    if (delta === 0) {
      addSystemNotification('Sin cambios', 'El stock físico coincide con el stock registrado.', 'info');
      setAdjustingStock(null);
      return;
    }

    setIsSubmittingAdjust(true);
    try {
      // 1. Optimistic update local product stock
      updateProductStock(product.id, newStock);

      // 1.1 If adjusting a specific batch, update the batch's stock too
      if (batchId) {
        setBatches(prev => prev.map(b => {
          if (b.id === batchId) {
            const updatedStock = Math.max(0, b.stock + delta);
            return {
              ...b,
              stock: updatedStock,
              status: updatedStock === 0 ? 'withdrawn' : b.status,
            };
          }
          return b;
        }));
      }

      // 2. Map reason to movement_type
      let movementType = 'adjustment_in';
      if (reason === 'Ingreso de producción') {
        movementType = 'production_in';
      } else if (reason === 'Merma / Desecho' || reason === 'Rotura') {
        movementType = 'waste_out';
      } else if (delta < 0) {
        movementType = 'adjustment_out';
      }

      // 3. Persist to D1 via syncStockMovementToD1
      await syncStockMovementToD1({
        product_id: product.id,
        branch_id: activeUser.branchId || '',
        movement_type: movementType,
        quantity: Math.abs(delta),
        reason,
        notes: notes.trim() || undefined,
        unit_cost_at_time: product.cost,
      });

      setAdjustFeedbackId(product.id);
      setTimeout(() => setAdjustFeedbackId(null), 3000);

      addSystemNotification(
        'Stock Actualizado',
        `Se ajustó el stock de "${product.name}" (${delta > 0 ? `+${delta}` : delta} ${product.unit ?? 'u'}). Nuevo stock: ${newStock} ${product.unit ?? 'u'}.`,
        'success'
      );
      setAdjustingStock(null);
    } catch {
      addSystemNotification(
        'Ajuste guardado localmente',
        `El stock de "${product.name}" se actualizó localmente (${newStock} ${product.unit ?? 'u'}). Pendiente de sync con el servidor.`,
        'info'
      );
      setAdjustingStock(null);
    } finally {
      setIsSubmittingAdjust(false);
    }
  };

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

  const getBatchExpiryDays = (batch: ProductBatch) => {
    if (!batch.expiryDate) return 999;
    const expDateObj = new Date(batch.expiryDate + 'T00:00:00');
    if (isNaN(expDateObj.getTime())) return 999;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = expDateObj.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getBatchLifeProgress = (batch: ProductBatch, prod?: Product) => {
    const elab = batch.elaborationDate ? new Date(batch.elaborationDate + 'T00:00:00') : new Date();
    const exp = batch.expiryDate ? new Date(batch.expiryDate + 'T00:00:00') : new Date();
    const totalDays = Math.max(1, Math.round((exp.getTime() - elab.getTime()) / (1000 * 60 * 60 * 24)));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const elapsedDays = Math.round((today.getTime() - elab.getTime()) / (1000 * 60 * 60 * 24));
    const percent = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
    return {
      totalDays,
      elapsedDays,
      percent,
    };
  };

  const getPrioritizedBatches = () => {
    // Lotes activos con stock > 0 o en estado activo
    const activeBatches = batches.filter(
      (b) => (b.stock > 0 || b.status === 'active') && b.status !== 'withdrawn'
    );

    activeBatches.sort((a, b) => {
      const daysA = getBatchExpiryDays(a);
      const daysB = getBatchExpiryDays(b);

      if (daysA !== daysB) {
        return daysA - daysB; // Vencidos y por vencer primero
      }

      const prodA = products.find((p) => p.id === a.productId);
      const prodB = products.find((p) => p.id === b.productId);

      if (priorityCriteria === 'precio') {
        return (prodB?.price ?? 0) - (prodA?.price ?? 0);
      } else if (priorityCriteria === 'unidades') {
        return b.stock - a.stock;
      } else if (priorityCriteria === 'categoria') {
        const isA_Prio = prodA?.category === priorityCategory ? 1 : 0;
        const isB_Prio = prodB?.category === priorityCategory ? 1 : 0;
        return isB_Prio - isA_Prio;
      }

      return 0;
    });

    return activeBatches;
  };

  const getProductExpiryDays = (prod: Product) => {
    if (!prod.elaborationDate || prod.durabilityDays === undefined) return 999;
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
  const [prodSupplier, setProdSupplier] = useState('');
  const [prodTaxRate, setProdTaxRate] = useState(0);
  const [prodAttributes, setProdAttributes] = useState('');
  const [prodDescription, setProdDescription] = useState('');
  const [prodBarcode, setProdBarcode] = useState('');
  const [prodMaxStock, setProdMaxStock] = useState(500);
  const [prodShelfLife, setProdShelfLife] = useState(2);
  const [prodStorage, setProdStorage] = useState('');
  const [prodProducible, setProdProducible] = useState(true);

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
          unit: editingProduct.unit,
        }
      : {}
  ), [editingProduct]);

  // Reset all fields on both edit and create; never carry metadata across products.
  useEffect(() => {
    setProdSupplier(editingProduct?.supplier ?? '');
    setProdTaxRate(editingProduct?.taxRate ?? 21);
    setProdAttributes(editingProduct?.attributes ?? '');
    setProdDescription(editingProduct?.description ?? '');
    setProdBarcode(editingProduct?.barcode ?? '');
    setProdMaxStock(editingProduct?.maxStock ?? 500);
    setProdShelfLife(editingProduct?.durabilityDays ?? 2);
    setProdStorage(editingProduct?.storageInstructions ?? '');
    setProdProducible(editingProduct?.isProducible ?? true);
  }, [editingProduct, showProductModal]);

  const productForm = useProductForm((payload) => {
    const details = {
      supplier: prodSupplier, taxRate: prodTaxRate, attributes: prodAttributes,
      description: prodDescription, barcode: prodBarcode, maxStock: prodMaxStock,
      durabilityDays: prodShelfLife, storageInstructions: prodStorage, isProducible: prodProducible,
    };
    if (editingProduct) {
      updateProduct(editingProduct.id, {
        name: payload.name,
        category: payload.category,
        price: payload.price,
        cost: payload.cost,
        minStock: payload.minStock,
        image: payload.image,
        code: payload.code,
        unit: payload.unit,
        ...details,
      });
    } else {
      addProduct({ ...payload, ...details });
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

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    finishedProducts.forEach(p => {
      if (p.category && p.category.trim()) {
        cats.add(p.category.trim());
      }
    });
    return Array.from(cats).sort();
  }, [finishedProducts]);

  const filteredAndSortedProducts = useMemo(() => {
    return finishedProducts
      .filter(p => productKind === 'all' || (productKind === 'production' ? p.isProducible : !p.isProducible))
      .filter(p => {
        if (selectedCategoryFilter === 'all') return true;
        return (p.category ?? '').toLowerCase() === selectedCategoryFilter.toLowerCase();
      })
      .filter(p => {
        if (stockStatusFilter === 'all') return true;
        if (stockStatusFilter === 'out_of_stock') return p.stock <= 0;
        if (stockStatusFilter === 'critical') return p.stock > 0 && p.stock <= p.minStock;
        if (stockStatusFilter === 'optimal') return p.stock > p.minStock;
        return true;
      })
      .filter(p => [p.name, p.code, p.barcode, p.supplier].some(value => value?.toLowerCase().includes(searchQuery.toLowerCase())))
      .sort((a, b) => {
        const marginA = a.price > 0 ? ((a.price - a.cost) / a.price) * 100 : 0;
        const marginB = b.price > 0 ? ((b.price - b.cost) / b.price) * 100 : 0;

        switch (sortBy) {
          case 'stock_asc': return a.stock - b.stock;
          case 'stock_desc': return b.stock - a.stock;
          case 'price_desc': return b.price - a.price;
          case 'price_asc': return a.price - b.price;
          case 'margin_desc': return marginB - marginA;
          case 'margin_asc': return marginA - marginB;
          case 'name_asc': return a.name.localeCompare(b.name);
          case 'name_desc': return b.name.localeCompare(a.name);
          case 'code_asc': return (a.code ?? '').localeCompare(b.code ?? '');
          default: return 0;
        }
      });
  }, [finishedProducts, productKind, selectedCategoryFilter, stockStatusFilter, searchQuery, sortBy]);

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
              <Plus className="h-4 w-4" /> Registrar Producto
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
            Productos / Reventa
          </button>
          <button
            id="btn-subtab-kardex"
            onClick={() => setActiveSubTab('kardex')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'kardex'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Kardex / Movimientos
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
            placeholder="Nombre, código o proveedor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg py-2 pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-800 dark:text-zinc-100"
          />
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
        </div>
      </div>

      {activeSubTab === 'productos' && (
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-850 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs select-none">
          {/* Filtros avanzados y ordenamiento */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-zinc-300">
              <SlidersHorizontal className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-bold">Filtros:</span>
            </div>

            {/* Clasificación */}
            <select
              id="filter-product-kind"
              aria-label="Filtrar clasificación"
              value={productKind}
              onChange={e => setProductKind(e.target.value)}
              className="text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg py-1.5 px-2.5 text-gray-800 dark:text-zinc-200 font-medium focus:ring-1 focus:ring-amber-500 outline-none"
            >
              <option value="all">Todos los tipos</option>
              <option value="production">Elaboración propia</option>
              <option value="resale">Reventa / comprado</option>
            </select>

            {/* Categoría */}
            <select
              id="filter-category"
              aria-label="Filtrar por categoría"
              value={selectedCategoryFilter}
              onChange={e => setSelectedCategoryFilter(e.target.value)}
              className="text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg py-1.5 px-2.5 text-gray-800 dark:text-zinc-200 font-medium focus:ring-1 focus:ring-amber-500 outline-none"
            >
              <option value="all">Todas las categorías</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            {/* Estado de Stock */}
            <select
              id="filter-stock-status"
              aria-label="Filtrar por estado de stock"
              value={stockStatusFilter}
              onChange={e => setStockStatusFilter(e.target.value as any)}
              className="text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg py-1.5 px-2.5 text-gray-800 dark:text-zinc-200 font-medium focus:ring-1 focus:ring-amber-500 outline-none"
            >
              <option value="all">Estado: Todos</option>
              <option value="out_of_stock">⚠️ Agotados (Stock &le; 0)</option>
              <option value="critical">⏳ Críticos (Stock &le; Mín)</option>
              <option value="optimal">✅ Óptimos</option>
            </select>

            {/* Ordenamiento dinámico */}
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />
              <select
                id="select-sort-by"
                aria-label="Ordenar productos"
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg py-1.5 px-2.5 text-gray-800 dark:text-zinc-200 font-medium focus:ring-1 focus:ring-amber-500 outline-none"
              >
                <option value="stock_asc">Menor stock primero</option>
                <option value="stock_desc">Mayor stock primero</option>
                <option value="price_desc">Mayor precio primero</option>
                <option value="price_asc">Menor precio primero</option>
                <option value="margin_desc">Mayor margen % primero</option>
                <option value="margin_asc">Menor margen % primero</option>
                <option value="name_asc">Nombre (A &rarr; Z)</option>
                <option value="name_desc">Nombre (Z &rarr; A)</option>
                <option value="code_asc">Código</option>
              </select>
            </div>
          </div>

          {/* Selector de Vista: Tarjetas Visuales vs Tabla Densa ERP */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 font-medium hidden sm:inline">
              {filteredAndSortedProducts.length} productos
            </span>
            <div className="bg-gray-100 dark:bg-zinc-950 p-0.5 rounded-xl flex border border-gray-200 dark:border-zinc-800">
              <button
                id="btn-view-cards"
                type="button"
                onClick={() => handleSetViewMode('cards')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
                }`}
                title="Vista de Tarjetas Visuales"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Tarjetas</span>
              </button>
              <button
                id="btn-view-table"
                type="button"
                onClick={() => handleSetViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
                }`}
                title="Vista de Tabla Densa ERP"
              >
                <Table className="h-3.5 w-3.5" />
                <span>Tabla Densa ERP</span>
              </button>
            </div>
          </div>
        </div>
      )}
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
                            <button
                              id={`btn-adjust-stock-insumo-${prod.id}`}
                              onClick={() => openAdjustStockModal(prod)}
                              className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-[10px] font-bold text-white cursor-pointer ml-1 shadow-xs"
                              title="Ajustar stock de insumo con persistencia a D1"
                            >
                              Ajustar Stock
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

      {/* TABLA DENSA ERP */}
      {activeSubTab === 'productos' && viewMode === 'table' && (
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" id="table-products-erp">
              <thead className="bg-gray-50 dark:bg-zinc-950 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none border-b border-gray-100 dark:border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Código</th>
                  <th className="py-3 px-4">Producto</th>
                  <th className="py-3 px-4">Categoría</th>
                  <th className="py-3 px-4 text-right">Costo ($)</th>
                  <th className="py-3 px-4 text-right">Precio ($)</th>
                  <th className="py-3 px-4 text-center">Margen %</th>
                  <th className="py-3 px-4 text-right">Stock Actual</th>
                  <th className="py-3 px-4 text-right">Mínimo</th>
                  <th className="py-3 px-4 text-center">Estado</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-800 dark:text-zinc-200">
                {filteredAndSortedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-gray-400 dark:text-zinc-500 font-medium">
                      No se encontraron productos con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedProducts.map(prod => {
                    const isOutOfStock = prod.stock <= 0;
                    const isAlert = prod.stock <= prod.minStock;
                    const isEditing = inlineEditing?.productId === prod.id;
                    const isRecentlyUpdated = inlineFeedbackId === prod.id || adjustFeedbackId === prod.id;

                    const effectiveCost = isEditing ? parseFloat(inlineEditing.cost) || 0 : prod.cost;
                    const effectivePrice = isEditing ? parseFloat(inlineEditing.price) || 0 : prod.price;
                    const margin = effectivePrice > 0 ? ((effectivePrice - effectiveCost) / effectivePrice) * 100 : 0;

                    let marginBadgeColor = 'text-gray-400 bg-gray-100 dark:bg-zinc-800';
                    if (effectivePrice > 0) {
                      if (margin >= 40) marginBadgeColor = 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/30';
                      else if (margin >= 20) marginBadgeColor = 'text-amber-700 bg-amber-100 dark:bg-amber-950/30';
                      else marginBadgeColor = 'text-red-700 bg-red-100 dark:bg-red-950/30';
                    }

                    return (
                      <tr
                        key={prod.id}
                        id={`product-erp-row-${prod.id}`}
                        className={`hover:bg-gray-50/60 dark:hover:bg-zinc-850/40 transition-colors ${
                          isRecentlyUpdated ? 'bg-emerald-50/30 dark:bg-emerald-950/20' : ''
                        } ${isOutOfStock ? 'bg-red-50/20 dark:bg-red-950/10' : ''}`}
                      >
                        {/* Código */}
                        <td className="py-3 px-4 font-mono text-[11px] text-gray-500 dark:text-zinc-400">
                          {prod.code || prod.id.slice(0, 8)}
                        </td>

                        {/* Producto */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xl shrink-0" role="img" aria-hidden="true">{prod.image}</span>
                            <div>
                              <div className="font-bold text-gray-855 dark:text-zinc-100 flex items-center gap-1.5">
                                <span>{prod.name}</span>
                                {isRecentlyUpdated && (
                                  <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-600 font-extrabold bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
                                    <CheckCircle2 className="h-2.5 w-2.5" /> Actualizado
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
                                <span>{prod.isProducible ? 'Elaboración propia' : 'Reventa'}</span>
                                {prod.barcode && <span>• EAN: {prod.barcode}</span>}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Categoría */}
                        <td className="py-3 px-4">
                          <span className="text-[10px] bg-amber-100/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-400 px-2 py-0.5 rounded uppercase font-bold">
                            {prod.category}
                          </span>
                        </td>

                        {/* Costo (Inline Editable) */}
                        <td className="py-3 px-4 text-right font-mono">
                          {isEditing ? (
                            <input
                              id={`input-inline-cost-${prod.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              value={inlineEditing.cost}
                              onChange={e => setInlineEditing({ ...inlineEditing, cost: e.target.value })}
                              className="w-20 text-right text-xs bg-amber-50 dark:bg-zinc-800 border border-amber-400 dark:border-amber-600 rounded px-1.5 py-1 font-mono focus:outline-none"
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={() => startInlineEdit(prod)}
                              className="cursor-pointer hover:underline hover:text-amber-600"
                              title="Click para editar costo rápido"
                            >
                              {formatCurrency(prod.cost)}
                            </span>
                          )}
                        </td>

                        {/* Precio (Inline Editable) */}
                        <td className="py-3 px-4 text-right font-mono">
                          {isEditing ? (
                            <input
                              id={`input-inline-price-${prod.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              value={inlineEditing.price}
                              onChange={e => setInlineEditing({ ...inlineEditing, price: e.target.value })}
                              className="w-20 text-right text-xs bg-amber-50 dark:bg-zinc-800 border border-amber-400 dark:border-amber-600 rounded px-1.5 py-1 font-mono font-bold text-emerald-600 focus:outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => startInlineEdit(prod)}
                              className="cursor-pointer hover:underline font-extrabold text-emerald-600 dark:text-emerald-400"
                              title="Click para editar precio rápido"
                            >
                              {formatCurrency(prod.price)}
                            </span>
                          )}
                        </td>

                        {/* Margen % */}
                        <td className="py-3 px-4 text-center font-mono">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold ${marginBadgeColor}`}>
                            {margin.toFixed(1)}%
                          </span>
                        </td>

                        {/* Stock Actual */}
                        <td className="py-3 px-4 text-right font-mono">
                          <span className={`font-extrabold text-sm ${isOutOfStock ? 'text-red-600' : isAlert ? 'text-amber-600' : 'text-gray-800 dark:text-zinc-50'}`}>
                            {prod.stock} {prod.unit ?? 'u'}
                          </span>
                        </td>

                        {/* Stock Mínimo */}
                        <td className="py-3 px-4 text-right font-mono text-gray-400 text-xs">
                          {prod.minStock} {prod.unit ?? 'u'}
                        </td>

                        {/* Estado Semáforo */}
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                            isOutOfStock
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/30'
                              : isAlert
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/20'
                          }`}>
                            {isOutOfStock ? '🔴 AGOTADO' : isAlert ? '⚠️ CRÍTICO' : '🟢 ÓPTIMO'}
                          </span>
                        </td>

                        {/* Acciones */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 select-none">
                            {isEditing ? (
                              <>
                                <button
                                  id={`btn-save-inline-${prod.id}`}
                                  onClick={() => saveInlineEdit(prod)}
                                  className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white cursor-pointer shadow-xs"
                                  title="Guardar precio y costo"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  id={`btn-cancel-inline-${prod.id}`}
                                  onClick={cancelInlineEdit}
                                  className="p-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-zinc-700 text-gray-700 dark:text-zinc-200 cursor-pointer"
                                  title="Cancelar edición"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  id={`btn-edit-inline-${prod.id}`}
                                  onClick={() => startInlineEdit(prod)}
                                  className="p-1.5 rounded-lg bg-gray-100 hover:bg-amber-100 dark:bg-zinc-800 dark:hover:bg-amber-950/30 text-gray-600 hover:text-amber-700 dark:text-zinc-300 dark:hover:text-amber-400 cursor-pointer"
                                  title="Edición rápida de precio y costo"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  id={`btn-adjust-stock-${prod.id}`}
                                  onClick={() => openAdjustStockModal(prod)}
                                  className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-300 cursor-pointer"
                                  title="Ajustar stock con persistencia en D1"
                                >
                                  Ajustar Stock
                                </button>
                                <button
                                  id={`btn-manage-batches-${prod.id}`}
                                  onClick={() => setSelectedProductForBatches(prod)}
                                  className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 cursor-pointer"
                                  title="Gestionar lotes FEFO"
                                >
                                  <Package className="h-3.5 w-3.5" />
                                </button>
                                {(activeUser.role === 'admin' || (activeUser.role as string) === 'owner') && (
                                  <button
                                    id={`btn-edit-product-${prod.id}`}
                                    onClick={() => openEditProductModal(prod)}
                                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 cursor-pointer"
                                    title="Editar ficha completa"
                                  >
                                    <SlidersHorizontal className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </>
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
      )}

      {/* TARJETAS VISUALES */}
      {activeSubTab === 'productos' && viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedProducts.map(prod => {
            const isAlert = prod.stock <= prod.minStock;
            const hasRecipe = prod.ingredients && prod.ingredients.length > 0;
            const isRecentlyUpdated = inlineFeedbackId === prod.id || adjustFeedbackId === prod.id;

            return (
              <div
                key={prod.id}
                className={`p-4 rounded-2xl border bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800 shadow-xs flex flex-col justify-between ${
                  isAlert ? 'border-l-4 border-l-red-500' : ''
                } ${isRecentlyUpdated ? 'ring-2 ring-emerald-500' : ''}`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl" role="img" aria-hidden="true">{prod.image}</span>
                      <div>
                        <h3 className="font-extrabold text-sm text-gray-855 dark:text-zinc-50 flex items-center gap-1.5">
                          <span>{prod.name}</span>
                          {isRecentlyUpdated && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-600 font-extrabold bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Actualizado
                            </span>
                          )}
                        </h3>
                        <span className="text-[10px] bg-amber-100/60 dark:bg-amber-950/20 text-amber-801 dark:text-amber-400 px-1.5 py-0.5 rounded uppercase font-bold text-[9px]">
                          {prod.category}
                        </span>
                      </div>
                    </div>
                    
                    <div className="text-right flex items-start gap-1.5">
                      <div>
                        <p className="text-xs font-extrabold text-emerald-500">{formatCurrency(prod.price)} / {prod.unit ?? 'unit'}</p>
                        <p className="text-[10px] text-gray-500">{prod.isProducible ? 'Elaboración propia' : 'Reventa'}</p>
                        {prod.localOnly && <p className="text-[10px] font-bold text-amber-600" title="Este producto no está confirmado en D1. Revisá la cola de sincronización antes de seguir vendiéndolo.">Pendiente en D1</p>}
                        <p className="text-[9px] text-gray-400 leading-tight">Costo: {formatCurrency(prod.cost)} / {prod.unit ?? 'unit'}</p>
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
                        {prod.stock} {prod.unit ?? 'unit'}
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
                    id={`btn-adjust-stock-${prod.id}`}
                    onClick={() => openAdjustStockModal(prod)}
                    className="w-full py-2 px-3 text-center bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-200"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Ajustar Stock (D1)
                  </button>

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
                        exp.setDate(exp.getDate() + (prod.durabilityDays ?? 3));
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

      {activeSubTab === 'kardex' && (
        <KardexPanel onAdjustStock={openAdjustStockModal} />
      )}

      {activeSubTab === 'caducidad' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
          
          {/* Main List of Expiries */}
          <div className="lg:col-span-2 space-y-4">
            
            <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2 pb-3 border-b border-gray-100 dark:border-zinc-800">
                <div>
                  <h3 className="font-extrabold text-sm text-gray-800 dark:text-zinc-100 uppercase tracking-wider">Línea de Alerta por Vencimiento de Lotes Reales</h3>
                  <p className="text-[11px] text-gray-450 mt-0.5">Control de vida útil FEFO de lotes activos ordenado según criterio de prioridad.</p>
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

              {/* Batches Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50/50 dark:bg-zinc-950 text-[10px] uppercase font-bold text-gray-400 select-none">
                    <tr className="border-b border-gray-100 dark:border-zinc-850">
                      <th className="py-3 px-2">Producto</th>
                      <th className="py-3 px-2">Lote</th>
                      <th className="py-3 px-2 text-center">Stock</th>
                      <th className="py-3 px-2">Elaborado</th>
                      <th className="py-3 px-2">Vencimiento</th>
                      <th className="py-3 px-2">Vida Útil (Progreso)</th>
                      <th className="py-3 px-2">Estado</th>
                      <th className="py-3 px-2 text-right">Acciones Rápidas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-800 dark:text-zinc-200">
                    {(() => {
                      const prioritizedBatches = getPrioritizedBatches();
                      const filteredBatches = prioritizedBatches.filter((batch) => {
                        if (!searchQuery.trim()) return true;
                        const prod = products.find((p) => p.id === batch.productId);
                        const matchProd = prod?.name.toLowerCase().includes(searchQuery.toLowerCase());
                        const matchBatch = batch.batchNumber.toLowerCase().includes(searchQuery.toLowerCase());
                        return matchProd || matchBatch;
                      });

                      if (filteredBatches.length === 0) {
                        return (
                          <tr>
                            <td colSpan={8} className="text-center py-12 text-zinc-400 font-bold">
                              <div className="flex flex-col items-center justify-center gap-2">
                                <Package className="h-8 w-8 text-gray-300 dark:text-zinc-700" />
                                <p className="text-sm">No hay lotes activos registrados con control de caducidad.</p>
                                <p className="text-[11px] text-gray-400 font-normal">
                                  Los lotes horneados o producidos aparecerán aquí para control de vida útil FEFO.
                                </p>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return filteredBatches.map((batch) => {
                        const prod = products.find((p) => p.id === batch.productId);
                        const daysLeft = getBatchExpiryDays(batch);
                        const isExpired = daysLeft < 0;
                        const isCriticalRange = daysLeft >= 0 && daysLeft <= priorityAlertDays;
                        const { percent } = getBatchLifeProgress(batch, prod);

                        return (
                          <tr
                            key={batch.id}
                            id={`batch-expiry-row-${batch.id}`}
                            className={`hover:bg-gray-50/50 dark:hover:bg-zinc-850/20 ${
                              isExpired
                                ? 'bg-red-50/10 dark:bg-red-950/10'
                                : isCriticalRange
                                ? 'bg-amber-50/10 dark:bg-amber-950/10'
                                : ''
                            }`}
                          >
                            {/* Producto */}
                            <td className="py-4 px-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xl inline-block" role="img" aria-label={prod?.name || 'Producto'}>
                                  {prod?.image || '📦'}
                                </span>
                                <div>
                                  <p className="font-extrabold text-gray-850 dark:text-zinc-100 leading-none">
                                    {prod?.name || 'Producto no identificado'}
                                  </p>
                                  {prod?.category && (
                                    <p className="text-[9px] text-gray-400 font-mono mt-1">
                                      {prod.category.toUpperCase()}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Lote */}
                            <td className="py-4 px-2">
                              <span className="inline-block px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-zinc-700">
                                {batch.batchNumber}
                              </span>
                            </td>

                            {/* Stock del lote */}
                            <td className="py-4 px-2 text-center font-mono font-bold text-xs text-gray-800 dark:text-zinc-200">
                              {batch.stock} <span className="text-[10px] font-sans text-gray-400">{prod?.unit ?? 'u'}</span>
                            </td>

                            {/* Elaborado */}
                            <td className="py-4 px-2 text-gray-550 dark:text-zinc-400 font-mono italic text-[11px]">
                              {batch.elaborationDate || '—'}
                            </td>

                            {/* Vencimiento */}
                            <td className="py-4 px-2 text-gray-600 dark:text-zinc-300 font-mono font-bold text-[11px]">
                              {batch.expiryDate || '—'}
                            </td>

                            {/* Barra de progreso de vida útil */}
                            <td className="py-4 px-2">
                              <div className="w-36 space-y-1 select-none">
                                <div className="flex items-center justify-between text-[10px]">
                                  <span
                                    className={`font-mono font-extrabold ${
                                      isExpired
                                        ? 'text-red-500'
                                        : isCriticalRange
                                        ? 'text-amber-500'
                                        : 'text-emerald-600'
                                    }`}
                                  >
                                    {isExpired
                                      ? `${Math.abs(daysLeft)}d Vencido`
                                      : daysLeft === 0
                                      ? '¡Vence hoy!'
                                      : `${daysLeft}d restantes`}
                                  </span>
                                  <span className="text-gray-400 font-mono text-[9px]">{percent}%</span>
                                </div>
                                <div className="w-full bg-gray-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden border border-gray-200 dark:border-zinc-700/60">
                                  <div
                                    className={`h-full transition-all duration-300 rounded-full ${
                                      isExpired
                                        ? 'bg-red-500'
                                        : isCriticalRange
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(8, percent))}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* Estado Badge */}
                            <td className="py-4 px-2">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-extrabold whitespace-nowrap ${
                                  isExpired
                                    ? 'bg-red-100 text-red-700 dark:bg-red-950/30'
                                    : isCriticalRange
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20'
                                }`}
                              >
                                {isExpired ? '🚨 VENCIDO' : isCriticalRange ? '⏳ POR VENCER' : '✅ FRESCO'}
                              </span>
                            </td>

                            {/* Acciones Rápidas */}
                            <td className="py-4 px-2 text-right">
                              <div className="flex justify-end items-center gap-1.5 select-none">
                                {batch.stock > 0 && prod ? (
                                  <>
                                    <button
                                      id={`btn-offer-batch-${batch.id}`}
                                      onClick={() => {
                                        const discountedPrice = prod.price * 0.5;
                                        setBatches(prev =>
                                          prev.map(b => (b.id === batch.id ? { ...b, stock: Math.max(0, b.stock - 1) } : b))
                                        );
                                        updateProductStock(prod.id, Math.max(0, prod.stock - 1));
                                        addSystemNotification(
                                          '💰 Liquidación 50%',
                                          `Venta Promo -50%: Lote ${batch.batchNumber} de "${prod.name}" relevado a ${formatCurrency(discountedPrice)} por fecha límite.`,
                                          'success'
                                        );
                                      }}
                                      className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[9px] font-extrabold cursor-pointer transition-transform duration-100 transform active:scale-95 shadow-xs whitespace-nowrap"
                                      title="Simula una orden de venta rápida a mitad de precio para liquidar este lote"
                                    >
                                      Oferta -50%
                                    </button>

                                    <button
                                      id={`btn-waste-batch-${batch.id}`}
                                      onClick={() => {
                                        openAdjustStockModal(
                                          prod,
                                          'Merma / Desecho',
                                          -batch.stock,
                                          `Merma por vencimiento del lote ${batch.batchNumber}`,
                                          batch.id
                                        );
                                      }}
                                      className="px-2 py-1 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40 rounded text-[9px] font-extrabold cursor-pointer transition-transform duration-100 transform active:scale-95 whitespace-nowrap"
                                      title="Abrir ajuste de stock para registrar merma por vencimiento de este lote"
                                    >
                                      Registrar merma
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-[10px] text-gray-400 font-medium">Lote agotado</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      });
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
                    step="0.001"
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
                  step="0.001"
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

            <div className="grid grid-cols-3 gap-3">
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
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Unidad de Medida</label>
                <select
                  id="modal-prod-unit"
                  value={productForm.fields.unit}
                  onChange={(e) => productForm.setters.setUnit(e.target.value as Product['unit'])}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                >
                  <option value="unit">Unidad</option>
                  <option value="kg">Kilogramo (kg)</option>
                  <option value="g">Gramo (g)</option>
                  <option value="l">Litro (l)</option>
                  <option value="ml">Mililitro (ml)</option>
                  <option value="dozen">Docena</option>
                  <option value="pack">Pack</option>
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
                    step="0.001"
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
                    step="0.001"
                  type="number"
                  required
                  min="0"
                  value={productForm.fields.minStock}
                  onChange={(e) => productForm.setters.setMinStock(Number(e.target.value))}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <fieldset className="space-y-3 border-t border-gray-200 dark:border-zinc-700 pt-3">
              <legend className="text-xs font-bold">Ficha del producto</legend>
              <p className="text-xs text-gray-500">Precio, costo y stock se expresan por la unidad seleccionada. Cambiarla no convierte cantidades anteriores.</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">Clasificación
                  <select aria-label="Clasificación del producto" value={prodProducible ? 'produccion' : 'reventa'} onChange={e => setProdProducible(e.target.value === 'produccion')} className="w-full border rounded-lg p-2 bg-white dark:bg-zinc-800">
                    <option value="produccion">Elaboración propia</option><option value="reventa">Reventa / comprado</option>
                  </select>
                </label>
                <label className="text-xs">Código de barras
                  <input aria-label="Código de barras" maxLength={128} value={prodBarcode} onChange={e => setProdBarcode(e.target.value)} className="w-full border rounded-lg p-2 bg-white dark:bg-zinc-800" />
                </label>
                <label className="text-xs">Stock máximo ({productForm.fields.unit})
                  <input aria-label="Stock máximo" type="number" min={productForm.fields.minStock} max="10000000" step="0.001" required value={prodMaxStock} onChange={e => setProdMaxStock(Number(e.target.value))} className="w-full border rounded-lg p-2 bg-white dark:bg-zinc-800" />
                </label>
                <label className="text-xs">Vida útil (días)
                  <input aria-label="Vida útil en días" type="number" min="0" max="36500" step="1" required value={prodShelfLife} onChange={e => setProdShelfLife(Number(e.target.value))} className="w-full border rounded-lg p-2 bg-white dark:bg-zinc-800" />
                </label>
                <label className="text-xs col-span-2">Descripción / ingredientes / alérgenos
                  <textarea aria-label="Descripción del producto" maxLength={2000} value={prodDescription} onChange={e => setProdDescription(e.target.value)} className="w-full border rounded-lg p-2 bg-white dark:bg-zinc-800" />
                </label>
                <label className="text-xs col-span-2">Conservación
                  <input aria-label="Conservación" maxLength={2000} placeholder="Ej.: refrigerado, envase cerrado" value={prodStorage} onChange={e => setProdStorage(e.target.value)} className="w-full border rounded-lg p-2 bg-white dark:bg-zinc-800" />
                </label>
              </div>
              <p className="text-xs text-gray-500">La vida útil es una referencia del producto. Controlá el vencimiento real en cada lote.</p>
            </fieldset>

            {/* Advanced fields */}
            <details className="group">
              <summary className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-amber-600 select-none py-1">
                Campos avanzados
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Proveedor</label>
                  <input
                    type="text"
                    value={prodSupplier}
                    onChange={e => setProdSupplier(e.target.value)}
                    placeholder="Nombre del proveedor"
                    className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Tasa de IVA %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={prodTaxRate}
                    onChange={e => setProdTaxRate(Number(e.target.value))}
                    placeholder="0 = Exento"
                    className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Presentación / Variantes / Observaciones</label>
                  <input
                    type="text"
                    value={prodAttributes}
                    onChange={e => setProdAttributes(e.target.value)}
                    placeholder='Ej: {"color":"rojo","tamaño":"grande"}'
                    className="w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100 font-mono"
                  />
                </div>
              </div>
            </details>

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
                {editingProduct ? 'Guardar Cambios' : 'Guardar Producto'}
              </button>
            </div>
          </form>
          </div>
      )}

      {/* FLOATING ACTION LUPA BUTTON FOR INVENTORY */}
      <button
        id="btn-inventory-floating-lupa-search"
        onClick={() => {
          const searchInput = document.getElementById('stock-search') as HTMLInputElement | null;
          if (searchInput) {
            searchInput.focus();
            searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }}
        className="fixed bottom-6 right-6 lg:bottom-8 lg:right-8 z-40 p-4 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer border-2 border-white dark:border-zinc-800 ring-4 ring-amber-550/10 dark:ring-zinc-900 group animate-bounce"
        title="Buscar en inventario"
        aria-label="Buscar en inventario"
      >
        <Search className="h-6 w-6 group-hover:rotate-12 transition-transform duration-300" />
      </button>

      {selectedProductForBatches && (
        <BatchPanel
          product={selectedProductForBatches}
          onClose={() => setSelectedProductForBatches(null)}
        />
      )}

      {/* MODAL DE AJUSTE DE STOCK CON PERSISTENCIA A D1 */}
      {adjustingStock && (
        <div
          id="modal-adjust-stock"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between border-b pb-3 border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl" role="img" aria-hidden="true">{adjustingStock.product.image}</span>
                <div>
                  <h3 className="font-extrabold text-base text-gray-855 dark:text-zinc-50 leading-tight">
                    Ajustar Stock
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-zinc-400 font-medium">
                    {adjustingStock.product.name}
                  </p>
                </div>
              </div>
              <button
                id="btn-close-adjust-modal"
                onClick={() => setAdjustingStock(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Current Stock Banner */}
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3 flex items-center justify-between">
              <span className="text-xs text-amber-800 dark:text-amber-300 font-bold">Stock Actual en Sistema:</span>
              <span className="text-sm font-extrabold font-mono text-amber-900 dark:text-amber-200">
                {adjustingStock.product.stock} {adjustingStock.product.unit ?? 'u'}
              </span>
            </div>

            {/* Linked Batch Banner */}
            {adjustingStock.batchId && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-xl p-2.5 flex items-center justify-between text-xs">
                <span className="text-red-800 dark:text-red-300 font-bold">Lote Vinculado:</span>
                <span className="font-mono font-extrabold text-red-900 dark:text-red-200">
                  {batches.find(b => b.id === adjustingStock.batchId)?.batchNumber || adjustingStock.batchId}
                </span>
              </div>
            )}

            {/* Mode Selector Tabs: Delta vs Conteo Físico */}
            <div className="bg-gray-100 dark:bg-zinc-950 p-1 rounded-xl flex border border-gray-200 dark:border-zinc-800 select-none">
              <button
                id="tab-adjust-mode-delta"
                type="button"
                onClick={() => setAdjustingStock({ ...adjustingStock, type: 'delta' })}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
                  adjustingStock.type === 'delta'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-gray-500 dark:text-zinc-400 hover:text-gray-800'
                }`}
              >
                Ingreso / Egreso (&plusmn;)
              </button>
              <button
                id="tab-adjust-mode-physical"
                type="button"
                onClick={() => setAdjustingStock({ ...adjustingStock, type: 'physical' })}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
                  adjustingStock.type === 'physical'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-gray-500 dark:text-zinc-400 hover:text-gray-800'
                }`}
              >
                Conteo Físico Real
              </button>
            </div>

            {/* Input according to mode */}
            {adjustingStock.type === 'delta' ? (
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                  Cantidad a Sumar o Restar ({adjustingStock.product.unit ?? 'u'})
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="input-adjust-delta-qty"
                    type="number"
                    step="any"
                    value={adjustingStock.deltaQty}
                    onChange={e => setAdjustingStock({ ...adjustingStock, deltaQty: e.target.value })}
                    placeholder="Ej: +10 o -5"
                    className="flex-1 text-sm bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl p-2.5 font-mono font-bold focus:ring-1 focus:ring-amber-500 outline-none text-gray-855 dark:text-zinc-100"
                  />
                  <div className="flex items-center gap-1">
                    {[-10, -1, 10, 50].map(v => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setAdjustingStock({ ...adjustingStock, deltaQty: String(v) })}
                        className="px-2 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 hover:bg-amber-100 hover:text-amber-800 cursor-pointer border border-gray-200 dark:border-zinc-700"
                      >
                        {v > 0 ? `+${v}` : v}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Resulting stock preview */}
                {(() => {
                  const d = parseFloat(adjustingStock.deltaQty);
                  const result = isNaN(d) ? adjustingStock.product.stock : Math.max(0, adjustingStock.product.stock + d);
                  return (
                    <p className="text-[11px] text-gray-500 font-medium">
                      Stock Resultante:&nbsp;
                      <span className="font-extrabold font-mono text-gray-800 dark:text-zinc-200">
                        {result.toFixed(2)} {adjustingStock.product.unit ?? 'u'}
                      </span>
                    </p>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                  Conteo Físico Real Encontrado ({adjustingStock.product.unit ?? 'u'})
                </label>
                <input
                  id="input-adjust-physical-qty"
                  type="number"
                  step="any"
                  min="0"
                  value={adjustingStock.physicalQty}
                  onChange={e => setAdjustingStock({ ...adjustingStock, physicalQty: e.target.value })}
                  placeholder="0"
                  className="w-full text-sm bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl p-2.5 font-mono font-bold focus:ring-1 focus:ring-amber-500 outline-none text-gray-855 dark:text-zinc-100"
                />
                {(() => {
                  const p = parseFloat(adjustingStock.physicalQty);
                  const diff = isNaN(p) ? 0 : parseFloat((p - adjustingStock.product.stock).toFixed(3));
                  return (
                    <p className="text-[11px] text-gray-500 font-medium">
                      Diferencia de Ajuste:&nbsp;
                      <span className={`font-extrabold font-mono ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-emerald-500' : 'text-gray-400'}`}>
                        {diff > 0 ? `+${diff}` : diff} {adjustingStock.product.unit ?? 'u'}
                      </span>
                    </p>
                  );
                })()}
              </div>
            )}

            {/* Motivo Selector (Obligatorio) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                Motivo del Ajuste (Obligatorio)
              </label>
              <select
                id="select-adjust-reason"
                value={adjustingStock.reason}
                onChange={e => setAdjustingStock({ ...adjustingStock, reason: e.target.value as any })}
                className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl p-2.5 font-semibold focus:ring-1 focus:ring-amber-500 outline-none text-gray-855 dark:text-zinc-100"
              >
                <option value="Conteo físico">Conteo físico</option>
                <option value="Ingreso de producción">Ingreso de producción</option>
                <option value="Merma / Desecho">Merma / Desecho</option>
                <option value="Rotura">Rotura</option>
                <option value="Ajuste administrativo">Ajuste administrativo</option>
              </select>
            </div>

            {/* Observaciones (Opcional) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                Observaciones / Justificación (Opcional)
              </label>
              <input
                id="input-adjust-notes"
                type="text"
                value={adjustingStock.notes}
                onChange={e => setAdjustingStock({ ...adjustingStock, notes: e.target.value })}
                placeholder="Detalle de auditoría o motivo del movimiento..."
                className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl p-2.5 focus:ring-1 focus:ring-amber-500 outline-none text-gray-855 dark:text-zinc-100"
              />
            </div>

            {/* Modal Actions */}
            <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2">
              <button
                type="button"
                id="btn-adjust-cancel"
                onClick={() => setAdjustingStock(null)}
                disabled={isSubmittingAdjust}
                className="flex-1 py-2.5 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="btn-adjust-confirm"
                onClick={handleConfirmAdjustStock}
                disabled={isSubmittingAdjust}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md flex items-center justify-center gap-1.5"
              >
                {isSubmittingAdjust ? (
                  <span>Guardando en D1...</span>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Confirmar Ajuste</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
