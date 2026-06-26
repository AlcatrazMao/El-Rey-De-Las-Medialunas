import {
  ShoppingCart,
  ScanBarcode,
  Search,
  Plus,
  Minus,
  Trash2,
  Cpu,
  ReceiptText,
  CreditCard,
  X,
  Printer,
  FileDown,
  CircleAlert,
  LayoutGrid,
  List,
} from 'lucide-react';
import * as React from 'react'
import { useState, useEffect, useRef } from 'react';

import { useApp } from '../AppContext';
import { getSettings } from '../hooks/useSettings';
import type { CategoryType, Product, ProductGroup, Sale } from '../types';
import { printTicketOrInvoice } from '../utils/exportUtils';
import { formatCurrency } from '../utils/format';
import { calcularPrecioUnitarioGrupo } from '../utils/productGroups';

import { GroupSelectorModal } from './GroupSelectorModal';
import { CartItemList } from './pos/CartItemList';

export const POSView: React.FC = () => {
  const {
    products,
    addSale,
    addSystemNotification,
    currentCashSession,
    setActiveTab,
    selectedSellerId,
    customers,
    addCustomer
  } = useApp();

  const posSettings = getSettings();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedCategory, _setSelectedCategory] = useState<CategoryType | 'todos'>('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<{
    product: Product;
    quantity: number;
    unitPrice: number;
    presentation?: string;
    admite_acum_desc?: 0 | 1;
  }[]>([]);
  const [groupSelectorProduct, setGroupSelectorProduct] = useState<Product | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>(
    (posSettings.pos?.defaultPaymentMethod as Sale['paymentMethod']) ?? 'efectivo'
  );
  const [selectedDiscount, setSelectedDiscount] = useState<number>(0);
  const [customerName, setCustomerName] = useState('');
  const [customerDoc, setCustomerDoc] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [fiscalType, setFiscalType] = useState<'consumidor_final' | 'exento' | 'responsable_inscripto' | 'monotributista'>('consumidor_final');

  // Quick search inline states
  const [quickSearch, setQuickSearch] = useState('');
  const [showQuickResults, setShowQuickResults] = useState(false);

  // Selection Modal states
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [modalSelectedCategory, setModalSelectedCategory] = useState<CategoryType | 'todos' | null>(null);
  const [modalMode, setModalMode] = useState<'list' | 'visual'>(
    (posSettings.pos?.defaultViewMode as 'list' | 'visual') ?? 'visual'
  );
  const [modalSortKey, setModalSortKey] = useState<'monto' | 'orden' | 'fecha_elaboracion' | null>(null);
  const [modalSortOrder, setModalSortOrder] = useState<'asc' | 'desc'>('asc');

  // New customer mini-modal states
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', email: '' });

  // Barcode scanner (HID keyboard emulator detection)
  const barcodeBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const barcodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Rate-limit: si el mismo código llega 2x en <800ms (doble disparo del scanner físico),
  // ignoramos el segundo para que no se agregue duplicado al carrito.
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  // Stable refs so the keydown listener always gets the latest closures without re-subscribing
  const addToCartRef = useRef<((product: Product) => void) | null>(null);
  const productsRef = useRef(products);
  const addSystemNotificationRef = useRef(addSystemNotification);
  productsRef.current = products;
  addSystemNotificationRef.current = addSystemNotification;

  // Simulation states
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [latestInvoice, setLatestInvoice] = useState<Sale | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [processingStatusText, setProcessingStatusText] = useState('');

  const pendingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const safeTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    pendingTimeoutsRef.current.push(id);
    return id;
  };
  useEffect(() => () => { pendingTimeoutsRef.current.forEach(clearTimeout); }, []);

  // Mount guard: si el componente se desmonta durante un flujo asíncrono
  // (delays del pago, scanner demo) evitamos efectos secundarios como
  // commitear una venta sobre estado ya inválido.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Refs para todos los flags de modales abiertos — el handler de scanner no
  // debe procesar teclas mientras hay un overlay capturando la atención del
  // operador (selección masiva, alta de cliente, ticket impreso). Usamos refs
  // para no re-suscribir el listener cada vez que cambia un modal.
  const showSelectionModalRef = useRef(showSelectionModal);
  const showNewCustomerModalRef = useRef(showNewCustomerModal);
  const showInvoiceModalRef = useRef(showInvoiceModal);
  const showCustomerDropdownRef = useRef(showCustomerDropdown);
  showSelectionModalRef.current = showSelectionModal;
  showNewCustomerModalRef.current = showNewCustomerModal;
  showInvoiceModalRef.current = showInvoiceModal;
  showCustomerDropdownRef.current = showCustomerDropdown;

  // Real barcode scanner: HID scanners emulate keyboard, spitting digits at ~5ms/char then Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard: si hay un modal/overlay abierto, no procesamos el scanner.
      // El usuario está interactuando con otro flujo y agregar al carrito
      // sería sorpresivo / corrompería el modal abierto.
      if (
        showSelectionModalRef.current ||
        showNewCustomerModalRef.current ||
        showInvoiceModalRef.current ||
        showCustomerDropdownRef.current
      ) {
        return;
      }

      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = barcodeBufferRef.current.trim();
        barcodeBufferRef.current = '';
        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
        if (code.length >= 3) {
          const found = productsRef.current.find(p => p.code === code || p.code.endsWith(code));
          if (found) {
            // Rate-limit: ignorar mismo código en <800ms (doble disparo físico)
            const nowTs = Date.now();
            const last = lastScanRef.current;
            if (last && last.code === code && nowTs - last.at < 800) {
              return;
            }
            lastScanRef.current = { code, at: nowTs };
            addToCartRef.current?.(found);
            addSystemNotificationRef.current('📷 Código escaneado', `Lector leyó: ${code} → ${found.name}`, 'success');
          } else {
            addSystemNotificationRef.current('⚠️ Código no encontrado', `Barcode "${code}" no coincide con ningún producto`, 'warning');
          }
        }
        return;
      }

      // If too long since last key, reset buffer (human typing vs scanner burst)
      if (gap > 100) barcodeBufferRef.current = '';

      if (e.key.length === 1) barcodeBufferRef.current += e.key;

      // Safety reset: clear buffer if no Enter arrives within 500ms
      if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
      barcodeTimerRef.current = setTimeout(() => { barcodeBufferRef.current = ''; }, 500);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
    };
  }, []);

  // Limpiar buffer del barcode scanner cuando el usuario cambia de pestaña/ventana.
  // Sin esto, un buffer parcialmente llenado antes de perder el foco corrompe el
  // próximo scan al volver (el Enter llega con chars de ambas sesiones mezclados).
  useEffect(() => {
    const clearBuffer = () => {
      barcodeBufferRef.current = '';
      lastKeyTimeRef.current = 0;
    };
    window.addEventListener('blur', clearBuffer);
    return () => window.removeEventListener('blur', clearBuffer);
  }, []);

  // Quick search inline — filtro en tiempo real para el buscador del POS principal
  const quickSearchResults = quickSearch.trim().length >= 1
    ? products.filter(p =>
        p.name.toLowerCase().includes(quickSearch.toLowerCase()) ||
        p.code.includes(quickSearch)
      ).slice(0, 8)
    : [];

  // Auto-add si hay exactamente 1 resultado de quick search y la query tiene al menos 2 chars
  useEffect(() => {
    if (quickSearchResults.length === 1 && quickSearch.trim().length >= 2) {
      addToCart(quickSearchResults[0]);
      setQuickSearch('');
      setShowQuickResults(false);
    }
  // Intencionalmente solo depende del count y la query para evitar re-runs al cambiar cart
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSearchResults.length, quickSearch]);

  // Audio Beep generator
  const playBeep = (freq = 880, duration = 0.08) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitAudioContext fallback for Safari
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      osc.addEventListener('ended', () => { audioCtx.close().catch(() => {}); });
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // audio blocked until user gesture
    }
  };

  useEffect(() => {
    try {
      const shouldOpen = localStorage.getItem('pan_erp_open_search_list');
      if (shouldOpen === 'true') {
        localStorage.removeItem('pan_erp_open_search_list');
        setModalMode('visual');
        setModalSelectedCategory('todos');
        setSearchQuery('');
        setShowSelectionModal(true);
        playBeep(705, 0.05);
      }
    } catch { /* storage unavailable */ }
  }, []);

  if (!currentCashSession) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center space-y-6 max-w-md mx-auto bg-gradient-to-b from-amber-500/5 via-white to-gray-50/20 dark:from-zinc-950/20 dark:via-zinc-900/40 dark:to-zinc-950/10 border border-amber-305/30 dark:border-zinc-800 rounded-3xl shadow-sm my-8">
        <div className="p-4 bg-amber-500/10 text-amber-550 dark:text-amber-450 rounded-full animate-pulse">
          <CircleAlert className="w-12 h-12" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-extrabold text-gray-805 dark:text-zinc-100 uppercase tracking-tight">
            ⚠️ Registro de Caja Cerrado
          </h3>
          <p className="text-xs text-gray-450 dark:text-zinc-400 leading-relaxed font-semibold">
            Para registrar una nueva venta (POS) y emitir facturas, es obligatorio habilitar primero el turno diario de caja declarando el saldo de cambio inicial.
          </p>
        </div>

        <button
          onClick={() => setActiveTab('caja')}
          className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl cursor-pointer shadow-md shadow-amber-500/10 transition-transform active:scale-95 text-center block"
        >
          Habilitar Apertura de Caja 🏦
        </button>
      </div>
    );
  }

  const categoriesList: { id: CategoryType | 'todos'; label: string; icon: string }[] = [
    { id: 'todos', label: 'Todos', icon: '🍪' },
    { id: 'panes', label: 'Panes', icon: '🥖' },
    { id: 'facturas', label: 'Facturas', icon: '🥐' },
    { id: 'pasteleria', label: 'Repostería', icon: '🍰' },
    { id: 'salados', label: 'Salados', icon: '🥪' },
    { id: 'bebidas', label: 'Bebidas', icon: '☕' }
  ];

  // Helper helper to calculate product expiry
  const getExpiryStatus = (elaborationDate?: string, durabilityDays?: number) => {
    if (!elaborationDate || !durabilityDays) return { status: 'unknown', text: 'N/A', daysRemaining: 999 };
    const elaborDateObj = new Date(elaborationDate + 'T00:00:00');
    if (isNaN(elaborDateObj.getTime())) return { status: 'unknown', text: 'N/A', daysRemaining: 999 };
    const expiryDateObj = new Date(elaborDateObj.getTime());
    expiryDateObj.setDate(expiryDateObj.getDate() + durabilityDays);
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const diffTime = expiryDateObj.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return { status: 'expired', text: `Vencido (hace ${Math.abs(diffDays)}d)`, daysRemaining: diffDays };
    } else if (diffDays === 0) {
      return { status: 'expires_today', text: 'Vence hoy ⚠️', daysRemaining: diffDays };
    } else if (diffDays === 1) {
      return { status: 'warning', text: 'Vence mañana ⏳', daysRemaining: diffDays };
    } else {
      return { status: 'ok', text: `${diffDays} días rest.`, daysRemaining: diffDays };
    }
  };

  const getSortedModalProducts = () => {
    let list = [...products];
    
    // filter by category in modal
    if (modalSelectedCategory && modalSelectedCategory !== 'todos') {
      list = list.filter(p => p.category === modalSelectedCategory);
    }
    
    // apply sorting if key is active
    if (modalSortKey) {
      list.sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;
        if (modalSortKey === 'monto') {
          valA = a.price;
          valB = b.price;
        } else if (modalSortKey === 'orden') {
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
        } else if (modalSortKey === 'fecha_elaboracion') {
          // Products without an elaboration date sort to the bottom of asc /
          // top of desc by using the epoch as a predictable lower bound. Was
          // a hardcoded 2026-06-01 which silently aged into being recent.
          valA = a.elaborationDate || '1970-01-01';
          valB = b.elaborationDate || '1970-01-01';
        }
        
        if (valA < valB) return modalSortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return modalSortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return list;
  };

  const renderProductGrid = (productsList: Product[]) => {
    if (productsList.length === 0) {
      return (
        <div className="text-center py-12 text-gray-400 font-bold">
          Ningún panificado en esta categoría.
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {productsList.map(prod => {
          const inStock = prod.stock > 0;
          const lowStock = prod.stock <= (prod.minStock || 5);
          const quantityInCart = cart.filter(item => item.product.id === prod.id).reduce((s, i) => s + i.quantity, 0);
          return (
            <button
              key={prod.id}
              onClick={() => { addToCart(prod); playBeep(800, 0.05); }}
              className={`relative flex flex-col justify-between text-left p-3 rounded-2xl border transition-all active:scale-97 cursor-pointer ${
                !inStock
                  ? 'bg-red-50/40 dark:bg-red-950/10 border-red-200 dark:border-red-900/40 hover:bg-red-50/60'
                  : lowStock
                  ? 'bg-amber-50/40 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900/60 hover:bg-amber-50/70'
                  : 'bg-white dark:bg-zinc-850 hover:bg-orange-50/30 dark:hover:bg-zinc-800 border-amber-100/40 dark:border-zinc-850/50 hover:border-amber-200 shadow-xs'
              }`}
            >
              {quantityInCart > 0 && (
                <span className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center">
                  {quantityInCart}
                </span>
              )}
              <div className="text-2xl mb-1" role="img" aria-label={prod.name}>{prod.image}</div>
              <div>
                <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mb-1 ${
                  !inStock ? 'bg-red-100 text-red-700' : lowStock ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {!inStock ? 'SIN STOCK' : `${prod.stock}u`}
                </span>
                <p className="font-extrabold text-xs text-gray-800 dark:text-zinc-100 leading-snug line-clamp-2">{prod.name}</p>
              </div>
              <span className="text-sm font-extrabold text-amber-600 dark:text-amber-500 mt-2">{formatCurrency(prod.price)}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderProductList = (productsList: Product[]) => {
    if (productsList.length === 0) {
      return (
        <div className="text-center py-12 text-gray-400 font-bold">
          Ningún panificado coincide con el filtro de búsqueda.
        </div>
      );
    }

    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs animate-fade-in">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-950 text-[10px] uppercase font-bold text-gray-400 select-none">
              <tr className="border-b border-gray-150 dark:border-zinc-800">
                <th className="py-3 px-4">Panificado</th>
                <th className="py-3 px-4 text-center hidden sm:table-cell">Stock / Caducidad</th>
                <th className="py-3 px-3 text-right">Precio</th>
                <th className="py-3 px-4 text-center">Cantidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-855 dark:text-zinc-200">
              {productsList.map(prod => {
                const isLowStock = prod.stock <= (prod.minStock || 5);
                const isNegativeStock = prod.stock < 0;
                const exp = getExpiryStatus(prod.elaborationDate, prod.durabilityDays);
                const quantityInCart = cart.filter(item => item.product.id === prod.id).reduce((s, i) => s + i.quantity, 0);

                return (
                  <tr
                    key={prod.id}
                    className={`hover:bg-amber-50/5 dark:hover:bg-amber-955/2 transition-colors ${
                      quantityInCart > 0
                        ? 'bg-amber-50/10 dark:bg-amber-950/10'
                        : ''
                    }`}
                  >
                    {/* Column 1: Panificado */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl shrink-0" role="img" aria-label={prod.name}>
                          {prod.image}
                        </span>
                        <div>
                          <p className="font-extrabold text-xs text-gray-855 dark:text-zinc-50 leading-tight">
                            {prod.name}
                          </p>
                          <span className="inline-block mt-0.5 text-[8px] tracking-wide uppercase px-1.5 py-0.5 rounded font-black bg-amber-100/60 dark:bg-amber-950/20 text-amber-805 dark:text-amber-400 leading-none">
                            {prod.category}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Stock & Caducidad (Rojo/Amarillo/Verde) */}
                    <td className="py-3 px-4 text-center hidden sm:table-cell">
                      <div className="flex flex-col items-center justify-center gap-1 select-none">
                        <span className={`inline-block text-[10px] font-black px-2.5 py-0.5 rounded-full ${
                          isNegativeStock
                            ? 'bg-red-600 text-white'
                            : isLowStock
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/30'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/10'
                        }`}>
                          {isNegativeStock ? `⚠️ ${prod.stock}` : `${prod.stock} u.`}
                        </span>
                        
                        {prod.durabilityDays ? (
                          <span className={`inline-flex items-center gap-1.5 text-[8.5px] px-1.5 py-0.5 rounded-sm font-black ${
                            exp.daysRemaining < 0
                              ? 'bg-red-500/10 text-red-650'
                              : exp.daysRemaining <= 1
                              ? 'bg-amber-500/10 text-amber-700'
                              : 'bg-emerald-500/10 text-emerald-650'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              exp.daysRemaining < 0
                                ? 'bg-red-500'
                                : exp.daysRemaining <= 1
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`} />
                            {exp.daysRemaining < 0
                              ? 'Caducado'
                              : exp.daysRemaining <= 1
                              ? 'Por Caducar'
                              : 'Excelente'}
                          </span>
                        ) : (
                          <span className="text-[8px] text-gray-400 font-bold uppercase px-1">Excelente</span>
                        )}
                      </div>
                    </td>

                    {/* Column 3: Precio */}
                    <td className="py-3 px-3 text-right">
                      <span className="font-mono text-xs font-black text-amber-700 dark:text-amber-405">
                        {formatCurrency(prod.price)}
                      </span>
                    </td>

                    {/* Column 4: Acciones / Cantidad */}
                    <td className="py-3 px-4 text-center select-none">
                      <div className="flex items-center justify-center gap-1.5">
                        {quantityInCart > 0 ? (
                          <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 p-0.5 rounded-xl border border-gray-200 dark:border-zinc-700">
                            {/* Decrement Button */}
                            <button
                              id={`btn-modal-qty-dec-${prod.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                decreaseQuantity(prod.id);
                                playBeep(600, 0.05);
                              }}
                              className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-zinc-400 cursor-pointer transition-colors active:scale-95"
                              title="Restar 1 unidad"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            
                            <span className="font-mono text-xs font-black text-gray-855 dark:text-zinc-100 px-2 min-w-[20px] text-center">
                              {quantityInCart}
                            </span>

                            {/* Increment Button — stock no bloquea (offline-first) */}
                            <button
                              id={`btn-modal-qty-inc-${prod.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                addToCart(prod);
                                playBeep(1105, 0.05);
                              }}
                              className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-zinc-400 cursor-pointer transition-colors active:scale-95"
                              title="Sumar 1 unidad"
                            >
                              <Plus className="h-3 w-3" />
                            </button>

                            {/* Delete Button */}
                            <button
                              id={`btn-modal-qty-del-${prod.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromCart(prod.id);
                                playBeep(500, 0.08);
                              }}
                              className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 text-gray-450 hover:text-red-650 dark:text-zinc-500 dark:hover:text-red-400 cursor-pointer transition-colors ml-0.5"
                              title="Quitar de la venta"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            id={`btn-modal-quick-add-${prod.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCart(prod);
                              playBeep(1105, 0.07);
                            }}
                            className={`py-1 px-3.5 rounded-xl border text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all hover:scale-105 active:scale-95 ${
                              prod.stock <= 0
                                ? 'border-red-300 dark:border-red-900 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                                : 'border-amber-300 dark:border-amber-900 bg-amber-50 hover:bg-amber-100 dark:bg-amber-955/20 dark:hover:bg-amber-955/45 text-amber-805 dark:text-amber-400'
                            }`}
                            title={prod.stock <= 0 ? 'Stock no garantizado — la venta procede igual' : 'Agregar al carrito'}
                          >
                            {prod.stock <= 0 ? '⚠ Agregar' : 'Agregar +'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Filosofía: NUNCA bloquear una venta por stock. Si está en <= 0, mostramos
  // un warning visual pero permitimos agregar al carrito. El sistema es
  // offline-first y el stock puede estar desactualizado.
  const warnIfNoStock = (product: Product) => {
    if (product.stock <= 0) {
      addSystemNotification(
        '⚠️ Stock no garantizado',
        `${product.name}: stock reportado ${product.stock}. La venta procede igual — verificá físicamente si hace falta.`,
        'warning',
      );
      playBeep(360, 0.12);
    }
  };

  // Add item to POS cart — if the product has groups configured, opens the
  // selector modal first. The modal then calls addUnitToCart / addGroupToCart.
  const addToCart = (product: Product) => {
    warnIfNoStock(product);

    if ((product.groups?.length ?? 0) > 0) {
      setGroupSelectorProduct(product);
      playBeep(800, 0.05);
      return;
    }

    addUnitToCart(product);
  };

  // Add a single unit (no group / "Unidad" selection)
  const addUnitToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id && !item.presentation);
      if (existing) {
        playBeep(600, 0.05);
        return prev.map(item =>
          item === existing ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      playBeep(1000, 0.05);
      return [...prev, { product, quantity: 1, unitPrice: product.price }];
    });
  };

  // Add a group (presentation) line to the cart. Each group selection is a NEW
  // cart line — even if user already has the same group; this matches POS UX
  // expectations ("agregar otra docena").
  const addGroupToCart = (product: Product, group: ProductGroup) => {
    const unitPrice = calcularPrecioUnitarioGrupo(product.price, group);
    setCart(prev => {
      playBeep(1100, 0.07);
      return [
        ...prev,
        {
          product,
          quantity: group.cantidad,
          unitPrice,
          presentation: group.nombre,
          admite_acum_desc: group.admite_acum_desc,
        },
      ];
    });
  };
  // Keep ref current so the barcode listener always calls the latest closure
  addToCartRef.current = addToCart;

  // Remove or subtract item (operates on the first matching line — unit line preferred)
  const decreaseQuantity = (productId: string) => {
    setCart(prev => {
      const idx = prev.findIndex(item => item.product.id === productId && !item.presentation);
      const targetIdx = idx >= 0 ? idx : prev.findIndex(item => item.product.id === productId);
      if (targetIdx < 0) return prev;
      const existing = prev[targetIdx];
      playBeep(400, 0.05);
      if (existing.quantity === 1) {
        return prev.filter((_, i) => i !== targetIdx);
      }
      return prev.map((item, i) =>
        i === targetIdx ? { ...item, quantity: item.quantity - 1 } : item
      );
    });
  };

  const removeFromCart = (productId: string, presentation?: string) => {
    playBeep(300, 0.1);
    if (presentation === undefined) {
      // Remove ALL lines for this product (used by the "table" delete button)
      setCart(prev => prev.filter(item => item.product.id !== productId));
      return;
    }
    setCart(prev => prev.filter(item => !(item.product.id === productId && (item.presentation ?? null) === presentation)));
  };

  // Demo: simula un scan con producto al azar (solo para pruebas sin hardware)
  const startBarcodeScanSimulation = () => {
    if (isScanning) return;
    setIsScanning(true);
    playBeep(350, 0.1);

    safeTimeout(() => {
      if (!isMountedRef.current) return;
      const randomProduct = products[Math.floor(Math.random() * products.length)];
      if (randomProduct) {
        addToCart(randomProduct);
        addSystemNotification('🧪 Test scan (demo)', `Código simulado: ${randomProduct.code} → ${randomProduct.name}`, 'info');
        playBeep(1200, 0.08);
      }
      setIsScanning(false);
    }, 1200);
  };

  // Calculate prices — precios con IVA incluido, se extrae: tax = total - total/(1+rate)
  // Use unitPrice (snapshot with group discount already baked in) instead of product.price.
  const cartSubtotal = cart.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
  const cartIvaRate = posSettings.fiscal.ivaRate;

  // Config del método de pago seleccionado
  const pmConfig = posSettings.paymentMethods?.find(m => m.id === paymentMethod);
  const acumulaDescuentos = pmConfig?.acumulaDescuentos ?? false;
  // Si el método de pago NO acumula descuentos, los anulamos en el cálculo del POS.
  const effectiveDiscount = acumulaDescuentos ? selectedDiscount : 0;

  // Solo aplica el descuento manual sobre las líneas que admiten acumulación
  // (sin presentation = siempre admiten; con presentation = depende de admite_acum_desc).
  const eligibleSubtotal = cart.reduce((acc, item) => {
    const admits = !item.presentation || item.admite_acum_desc === 1;
    return admits ? acc + item.unitPrice * item.quantity : acc;
  }, 0);
  const discountAmount = effectiveDiscount > 0 ? parseFloat((eligibleSubtotal * effectiveDiscount / 100).toFixed(2)) : 0;
  const afterDiscount = parseFloat((cartSubtotal - discountAmount).toFixed(2));

  // Lista de precios: igual que el descuento manual, queda anulada si el método no acumula.
  const activePriceList = pmConfig?.linkedPriceListId
    ? (posSettings.priceLists.find(pl => pl.id === pmConfig.linkedPriceListId) ?? null)
    : null;
  const priceListDiscountPercent = acumulaDescuentos ? (activePriceList?.discountPercent ?? 0) : 0;
  const priceListAdjustmentAmount = priceListDiscountPercent !== 0
    ? parseFloat((afterDiscount * priceListDiscountPercent / 100).toFixed(2))
    : 0;
  const afterPriceList = parseFloat((afterDiscount - priceListAdjustmentAmount).toFixed(2));

  // Ajuste automático por método de pago (nuevo modelo: recargo | descuento | none)
  const adjustmentType = pmConfig?.adjustmentType ?? 'none';
  const adjustmentPercent = pmConfig?.adjustmentPercent ?? 0;
  let paymentAdjustmentAmount = 0;
  if (adjustmentType === 'recargo' && adjustmentPercent > 0) {
    paymentAdjustmentAmount = parseFloat((afterPriceList * adjustmentPercent / 100).toFixed(2));
  } else if (adjustmentType === 'descuento' && adjustmentPercent > 0) {
    paymentAdjustmentAmount = -parseFloat((afterPriceList * adjustmentPercent / 100).toFixed(2));
  }
  const cartTotal = parseFloat((afterPriceList + paymentAdjustmentAmount).toFixed(2));
  const cartTax = parseFloat((cartTotal - cartTotal / (1 + cartIvaRate)).toFixed(2));

  // Create new customer from mini-modal
  const handleCreateCustomer = () => {
    if (!newCustomerForm.name.trim()) return;
    const newId = addCustomer({
      name: newCustomerForm.name.trim(),
      email: newCustomerForm.email.trim(),
      phone: newCustomerForm.phone.trim(),
      address: '',
      tax_id: '',
      type: 'consumidor_final',
      condicion_fiscal: 'consumidor_final',
      price_list_number: 1,
      credit_limit: 0,
      status: 'active',
      notes: '',
    });
    setCustomerName(newCustomerForm.name.trim());
    setSelectedCustomerId(newId);
    setNewCustomerForm({ name: '', phone: '', email: '' });
    setShowNewCustomerModal(false);
  };

  // Process transaction
  const handlePayment = async () => {
    if (cart.length === 0) {
      addSystemNotification('⚠️ Carrito Vacío', 'Agrega algún producto para iniciar el cobro.', 'info');
      return;
    }

    // Snapshot cart before delays — prevents race condition if user modifies cart during processing
    const cartSnapshot = cart.map(item => ({
      productId: item.product.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      presentation: item.presentation,
      admite_acum_desc: item.admite_acum_desc,
    }));

    setIsProcessingPayment(true);
    setProcessingStatusText('Conectando con pasarela...');
    playBeep(520, 0.1);

    const gatewayNames: Record<Sale['paymentMethod'], string> = {
      efectivo: 'Efectivo en Caja',
      qr: 'QR / Transferencia',
      tarjeta: 'Stripe API Gateway',
      transferencia: 'Transferencia Bancaria',
    };

    // Idempotency key: se genera UNA vez al iniciar el cobro y se asocia a la venta.
    // Si el cajero reintenta (por timeout, doble-click, red caída), el backend
    // deduplica usando esta misma key.
    const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // Short UI delay so the "procesando" state is visually perceptible without
    // adding meaningful latency to every sale. Was 1000ms+1500ms — purely
    // theatrical, now trimmed to a single perceptible frame each.
    safeTimeout(() => {
      // Si el componente se desmontó durante el delay (usuario navegó a otra
      // vista), abortamos el flujo: no toquemos state ni emitamos efectos.
      if (!isMountedRef.current) return;
      setProcessingStatusText(`Autorizando cargo con ${gatewayNames[paymentMethod]}...`);
      playBeep(650, 0.1);

      safeTimeout(() => {
        // Componente desmontado: NO commiteamos la venta. Sería sorpresivo
        // descontar stock / generar comprobante sin operador presente.
        if (!isMountedRef.current) return;
        // Execute sale operations using the snapshot taken at payment start
        const result = addSale(
          cartSnapshot,
          paymentMethod,
          customerDoc,
          customerName,
          selectedCustomerId || undefined,
          selectedSellerId || undefined,
          selectedDiscount,
          priceListDiscountPercent,
          idempotencyKey,
        );

        setIsProcessingPayment(false);

        if (result.success && result.invoice) {
          setLatestInvoice(result.invoice);
          setShowInvoiceModal(true);
          // Print ticket automatically on sound success
          printTicketOrInvoice(result.invoice, 'receipt');
          // Clear Cart and customer state
          setCart([]);
          setCustomerDoc('');
          setCustomerName('');
          setSelectedCustomerId(null);
          setCustomerSearch('');
          setSelectedDiscount(0);
        } else {
          // Validaciones de negocio fallidas (carrito vacío, producto inexistente, etc).
          // NUNCA bloqueamos por stock — esos son warnings.
          const msg = result.error?.message ?? 'Error de validación al procesar la venta.';
          addSystemNotification('❌ Venta no procesada', msg, 'error');
        }
      }, 150);
    }, 150);
  };

  // Filter products list
  const filteredProducts = products.filter(prod => {
    const matchesCategory = selectedCategory === 'todos' || prod.category === selectedCategory;
    const matchesSearch = prod.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          prod.code.includes(searchQuery);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex flex-col gap-6 min-h-[calc(100vh-140px)] transition-all duration-300">


      {/* RIGHT COLUMN: POS CHECKOUT CART PANEL (Nueva Venta) */}
      <div className="w-full max-w-5xl mx-auto min-w-0 min-h-0 bg-white dark:bg-zinc-900 border border-orange-100 dark:border-zinc-800 rounded-2xl shadow-xs overflow-visible pb-[380px]">

        {/* Scrollable area — header, search, fiscal, cart, subtotals, payment, discount */}
        <div className="p-5">

        {/* Header detail */}
        <div className="flex items-center justify-between border-b pb-3 border-gray-100 dark:border-zinc-800 mb-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-amber-500" />
            <h2 className="font-extrabold text-gray-800 dark:text-zinc-100 text-base">Nueva Venta</h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Mini toggle Visual/Lista */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-1">
              <button
                onClick={() => setModalMode('visual')}
                className={`p-1.5 rounded ${modalMode === 'visual' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
                title="Vista visual"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setModalMode('list')}
                className={`p-1.5 rounded ${modalMode === 'list' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
                title="Vista lista"
              >
                <List className="h-4 w-4" />
              </button>
            </div>

            {/* Lupa button */}
            <button
              id="btn-trigger-search-modal"
              onClick={() => {
                setModalSelectedCategory(null);
                setSearchQuery('');
                setShowSelectionModal(true);
                playBeep(705, 0.05);
              }}
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl border border-amber-200 dark:border-zinc-850 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-xs"
              title="Seleccionar Panificados"
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Buscar</span>
            </button>

            {/* Scanner HID siempre activo — indicador de estado */}
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold" title="Lector USB activo — apuntá y escaneá">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Scanner
              </span>
              <button
                id="btn-scan-trigger"
                onClick={startBarcodeScanSimulation}
                disabled={isScanning}
                className={`px-3 py-2 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
                  isScanning
                    ? 'bg-amber-100 text-amber-700 animate-pulse border-amber-300'
                    : 'bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 text-white hover:opacity-90 border-transparent shadow-xs'
                }`}
                title="Simula un scan con producto aleatorio (para probar sin hardware)"
              >
                <ScanBarcode className="h-4 w-4" />
                {isScanning ? 'Escaneando...' : 'Test Scan'}
              </button>
            </div>

            <span className="text-xs bg-amber-100 dark:bg-amber-950/40 text-amber-805 dark:text-amber-400 font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
              Nº Comp: Auto-Gen
            </span>
          </div>
        </div>

        {/* Quick search inline */}
        <div className="relative mb-3">
          <div className="flex items-center bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 gap-2 focus-within:border-amber-500 transition-colors">
            <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Búsqueda rápida por nombre o código..."
              value={quickSearch}
              onChange={e => {
                setQuickSearch(e.target.value);
                setShowQuickResults(true);
              }}
              onFocus={() => setShowQuickResults(true)}
              onBlur={() => setTimeout(() => setShowQuickResults(false), 150)}
              className="bg-transparent flex-1 text-sm text-gray-800 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 outline-none"
            />
            {quickSearch && (
              <button onClick={() => { setQuickSearch(''); setShowQuickResults(false); }}>
                <X className="h-4 w-4 text-gray-400 hover:text-white" />
              </button>
            )}
          </div>

          {showQuickResults && quickSearchResults.length > 1 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
              {quickSearchResults.map(product => (
                <button
                  key={product.id}
                  onMouseDown={() => {
                    addToCart(product);
                    setQuickSearch('');
                    setShowQuickResults(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 text-left transition-colors"
                >
                  <span className="text-sm text-white">{product.name}</span>
                  <span className="text-xs text-amber-400">{formatCurrency(product.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>



        {/* Cart Item rows list */}
        <CartItemList
          cart={cart}
          setCart={setCart}
          decreaseQuantity={decreaseQuantity}
          addUnitToCart={addUnitToCart}
          playBeep={playBeep}
          onEmptyClick={() => {
            setModalMode('visual');
            setModalSelectedCategory('todos');
            setSearchQuery('');
            setShowSelectionModal(true);
            playBeep(705, 0.05);
          }}
        />


        </div>{/* end scrollable area */}

        {/* Footer sticky — tipo cliente + pago + resumen + COBRAR */}
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/97 dark:bg-zinc-900/97 backdrop-blur-sm border-t border-gray-100 dark:border-zinc-800 p-4" style={{ maxWidth: '64rem', marginLeft: 'auto', marginRight: 'auto' }}>
          <div className="grid grid-cols-2 gap-4 mb-3">

            {/* Izquierda: tipo cliente + datos cliente + pago + descuento */}
            <div className="space-y-2">

              {/* Tipo fiscal */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-gray-400 dark:text-zinc-500 uppercase tracking-wider min-w-[44px]">Tipo</span>
                <select
                  value={fiscalType}
                  onChange={e => setFiscalType(e.target.value as typeof fiscalType)}
                  className="flex-1 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-800 dark:text-zinc-100 focus:outline-none focus:border-amber-500 transition-colors cursor-pointer"
                >
                  <option value="consumidor_final">Consumidor Final</option>
                  <option value="exento">IVA Exento</option>
                  <option value="responsable_inscripto">Responsable Inscripto</option>
                  <option value="monotributista">Monotributista</option>
                </select>
              </div>

              {/* Cliente */}
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-black text-gray-400 dark:text-zinc-500 uppercase tracking-wider min-w-[44px] mt-1.5">Cliente</span>
                <div className="flex-1 relative">
                  {customerName ? (
                    <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5">
                      <span className="text-xs font-bold text-gray-800 dark:text-zinc-100 truncate flex-1">{customerName}</span>
                      {customerDoc && <span className="text-[10px] text-gray-400 shrink-0">({customerDoc})</span>}
                      <button
                        onClick={() => { setCustomerName(''); setCustomerDoc(''); setCustomerSearch(''); setSelectedCustomerId(null); }}
                        className="text-gray-400 hover:text-red-500 shrink-0 cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        placeholder="Buscar cliente..."
                        value={customerSearch}
                        onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                        onFocus={() => setShowCustomerDropdown(true)}
                        className="w-full text-xs bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-zinc-100 focus:outline-none focus:border-amber-500"
                      />
                      {showCustomerDropdown && (
                        <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
                          <button
                            onClick={() => { setCustomerName('Consumidor Final'); setCustomerDoc(''); setShowCustomerDropdown(false); setCustomerSearch(''); }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800"
                          >
                            👤 Consumidor Final
                          </button>
                          {customers.filter(c => {
                            const q = customerSearch.toLowerCase();
                            return (
                              (c.name ?? '').toLowerCase().includes(q) ||
                              (c.tax_id ?? '').toLowerCase().includes(q) ||
                              (c.email ?? '').toLowerCase().includes(q) ||
                              (c.phone ?? '').toLowerCase().includes(q)
                            );
                          }).slice(0, 5).map(c => (
                            <button
                              key={c.id}
                              onClick={() => { setCustomerName(c.name); setCustomerDoc(c.tax_id); setSelectedCustomerId(c.id); setShowCustomerDropdown(false); setCustomerSearch(''); }}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-zinc-800 border-t border-gray-100 dark:border-zinc-800"
                            >
                              <div className="font-bold">{c.name}</div>
                              {c.tax_id && <div className="text-gray-400">CUIT: {c.tax_id}</div>}
                            </button>
                          ))}
                          <button
                            onClick={() => { setShowCustomerDropdown(false); setCustomerSearch(''); setShowNewCustomerModal(true); }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 border-t border-gray-100 dark:border-zinc-800"
                          >
                            + Crear nuevo cliente
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Credit warning compacto */}
              {selectedCustomerId && (() => {
                const sc = customers.find(c => c.id === selectedCustomerId);
                if (!sc || sc.credit_limit <= 0) return null;
                const overLimit = sc.current_debt >= sc.credit_limit;
                const nearLimit = !overLimit && sc.current_debt / sc.credit_limit >= 0.8;
                if (!overLimit && !nearLimit) return null;
                return (
                  <div className={`ml-[52px] text-[9px] font-bold px-2 py-1 rounded-lg ${overLimit ? 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400' : 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400'}`}>
                    {overLimit ? `⛔ Límite excedido: ${formatCurrency(sc.current_debt)} / ${formatCurrency(sc.credit_limit)}` : `⚠ Cerca del límite: ${formatCurrency(sc.current_debt)} / ${formatCurrency(sc.credit_limit)}`}
                  </div>
                );
              })()}

              {/* Método de pago */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-gray-400 dark:text-zinc-500 uppercase tracking-wider min-w-[44px]">Pago</span>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value as Sale['paymentMethod'])}
                  className="flex-1 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-800 dark:text-zinc-100 focus:outline-none focus:border-amber-500 transition-colors cursor-pointer"
                >
                  {posSettings.paymentMethods.filter(pm => pm.enabled).map(pm => (
                    <option key={pm.id} value={pm.id}>{pm.label}</option>
                  ))}
                </select>
                {adjustmentType !== 'none' && adjustmentPercent > 0 && (
                  <span className={`text-[9px] font-bold shrink-0 ${adjustmentType === 'recargo' ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {adjustmentType === 'recargo' ? '▲' : '▼'}{adjustmentPercent}%
                  </span>
                )}
              </div>

              {/* Descuento */}
              {posSettings.discountConfig?.availablePercents?.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-gray-400 dark:text-zinc-500 uppercase tracking-wider min-w-[44px]">Desc.</span>
                  <select
                    value={selectedDiscount}
                    onChange={e => setSelectedDiscount(Number(e.target.value))}
                    className="flex-1 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-800 dark:text-zinc-100 focus:outline-none focus:border-amber-500 transition-colors cursor-pointer"
                  >
                    <option value={0}>Sin descuento</option>
                    {posSettings.discountConfig.availablePercents.map(pct => (
                      <option key={pct} value={pct}>- {pct}%</option>
                    ))}
                  </select>
                  {selectedDiscount > 0 && !acumulaDescuentos && (
                    <span className="text-[9px] text-gray-400 italic shrink-0">No acumula</span>
                  )}
                </div>
              )}

            </div>

            {/* Derecha: resumen */}
            <div className="bg-gray-50 dark:bg-zinc-950 rounded-xl border border-gray-100 dark:border-zinc-800 p-3 flex flex-col">
              <div className="space-y-1.5 flex-1 text-xs">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal</span>
                  <span className="font-semibold text-gray-700 dark:text-zinc-300">{formatCurrency(cartSubtotal)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold">
                    <span>Descuento ({effectiveDiscount}%)</span>
                    <span>- {formatCurrency(discountAmount)}</span>
                  </div>
                )}
                {activePriceList && priceListAdjustmentAmount !== 0 && (
                  <div className={`flex justify-between font-bold ${priceListDiscountPercent > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    <span className="truncate mr-2">{activePriceList.name}</span>
                    <span className="shrink-0">{priceListDiscountPercent > 0 ? `- ${formatCurrency(priceListAdjustmentAmount)}` : `+ ${formatCurrency(Math.abs(priceListAdjustmentAmount))}`}</span>
                  </div>
                )}
                {adjustmentType === 'recargo' && paymentAdjustmentAmount > 0 && (
                  <div className="flex justify-between text-amber-600 dark:text-amber-400 font-bold">
                    <span>Recargo ({adjustmentPercent}%)</span>
                    <span>+ {formatCurrency(paymentAdjustmentAmount)}</span>
                  </div>
                )}
                {adjustmentType === 'descuento' && paymentAdjustmentAmount < 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold">
                    <span>Desc. pago ({adjustmentPercent}%)</span>
                    <span>- {formatCurrency(Math.abs(paymentAdjustmentAmount))}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-400">
                  <span>IVA ({(cartIvaRate * 100).toFixed(0)}%)</span>
                  <span>{formatCurrency(cartTax)}</span>
                </div>
              </div>
              <div className="border-t border-gray-200 dark:border-zinc-800 mt-2 pt-2 flex justify-between items-baseline gap-2">
                <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Total</span>
                <span className="text-2xl font-black text-amber-600 dark:text-amber-400 tabular-nums leading-none">{formatCurrency(cartTotal)}</span>
              </div>
            </div>

          </div>

          {/* COBRAR */}
          <button
            id="btn-pos-checkout"
            onClick={handlePayment}
            disabled={cart.length === 0 || isProcessingPayment}
            className={`w-full py-4 rounded-2xl text-base font-extrabold flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-md transform hover:-translate-y-0.5 active:translate-y-0 ${
              cart.length === 0
                ? 'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-600 cursor-not-allowed shadow-none'
                : 'bg-amber-900 hover:bg-amber-800 text-white border-b-4 border-amber-950'
            }`}
          >
            {isProcessingPayment ? (
              <>
                <Cpu className="h-5 w-5 animate-spin" />
                <span>{processingStatusText}</span>
              </>
            ) : (
              <>
                <CreditCard className="h-5 w-5" />
                <span>COBRAR {formatCurrency(cartTotal)}</span>
              </>
            )}
          </button>
        </div>

      </div>

      {/* MODAL / POPUP: TRANSACTION CONFIRMATION / PRINT PREVIEW */}
      {showInvoiceModal && latestInvoice && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-800 max-w-sm w-full overflow-hidden flex flex-col">
            
            {/* Header state banner */}
            <div className={`p-5 text-center text-white ${latestInvoice.paymentStatus === 'completed' ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-gradient-to-r from-red-500 to-red-600'}`}>
              <button
                id="btn-modal-close-upper"
                onClick={() => setShowInvoiceModal(false)}
                className="absolute top-3 right-3 text-white/80 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="bg-white/20 p-3 rounded-full w-14 h-14 mx-auto flex items-center justify-center border border-white/20 mb-2">
                <ReceiptText className="h-8 w-8 text-white" />
              </div>

              <h3 className="font-extrabold text-lg leading-tight uppercase font-sans">
                {latestInvoice.paymentStatus === 'completed' ? '¡Operación Exitosa!' : '¡Transacción Declinada!'}
              </h3>
              <p className="text-[10px] text-white/80 mt-1 uppercase tracking-widest">
                Comp: {latestInvoice.invoiceNumber}
              </p>
            </div>

            {/* Simulated Receipt paper layout */}
            <div className="p-5 flex-1 overflow-y-auto max-h-[50vh] bg-amber-50/20 dark:bg-zinc-950/20 text-xs font-mono">
               <div className="text-center font-sans">
                <p className="font-extrabold uppercase">🥐 El Rey De Las Medialunas 🥐</p>
                <p className="text-[10px] text-gray-400">Factura electrónica · POS</p>
                <p className="text-[9px] text-gray-400 mt-1">Sincronizado vía Nube ERP</p>
              </div>

              <div className="border-b border-dashed border-gray-300 dark:border-zinc-800 my-3" />
              
              <div className="space-y-1">
                <p>Fecha: {new Date(latestInvoice.date).toLocaleString('es-AR')}</p>
                <p>Operador: {latestInvoice.operatorName}</p>
                <p>Cliente: {latestInvoice.customerName || 'Consumidor Final'}</p>
                {latestInvoice.customerDoc && <p>CUIT/DNI: {latestInvoice.customerDoc}</p>}
                <p>Método: {latestInvoice.paymentMethod.replace('_', ' ').toUpperCase()}</p>
              </div>

              <div className="border-b border-dashed border-gray-300 dark:border-zinc-800 my-3" />

              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-zinc-800 pb-1">
                    <th>Detalle</th>
                    <th className="text-right">Sub</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/40">
                  {latestInvoice.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-1">{item.name} x{item.quantity}</td>
                      <td className="text-right py-1">{formatCurrency(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-b border-dashed border-gray-300 dark:border-zinc-800 my-3" />

              <div className="space-y-1 font-sans">
                <div className="flex justify-between">
                  <span>Neto Gravado:</span>
                  <span>{formatCurrency(latestInvoice.total - latestInvoice.tax)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{`IVA Incluido (${(posSettings.fiscal.ivaRate * 100).toFixed(0)}%):`}</span>
                  <span>{formatCurrency(latestInvoice.tax)}</span>
                </div>
                <div className="flex justify-between text-base font-extrabold border-t pt-1.5 border-amber-200">
                  <span>TOTAL COMPRA:</span>
                  <span>{formatCurrency(latestInvoice.total)}</span>
                </div>
              </div>

              {latestInvoice.paymentStatus === 'failed' && (
                <div className="mt-3 bg-red-150 text-red-800 border border-red-300 p-2 rounded-lg font-sans text-center">
                  <p className="font-extrabold flex items-center justify-center gap-1"><CircleAlert className="h-3.5 w-3.5" /> ERROR PASARELA</p>
                  <p className="text-[10px] mt-0.5">El banco rechazó la transacción. No se descontó inventario.</p>
                </div>
              )}
            </div>

            {/* Bottom print control triggers */}
            <div className="p-4 bg-gray-50 dark:bg-zinc-950 flex items-center gap-2 border-t border-gray-100 dark:border-zinc-800">
              <button
                id="btn-print-receipt"
                onClick={() => printTicketOrInvoice(latestInvoice, 'receipt')}
                className="flex-1 py-2 px-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 hover:bg-gray-100 dark:hover:bg-zinc-800 text-xs font-bold text-gray-750 dark:text-zinc-200 cursor-pointer flex items-center justify-center gap-1.5"
                title="Genera impresión de ticket en papel de 80mm térmica"
              >
                <Printer className="h-4 w-4" /> Imp. Papel (Sim)
              </button>

              <button
                id="btn-print-invoice"
                onClick={() => printTicketOrInvoice(latestInvoice, 'invoice')}
                className="flex-1 py-2 px-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 hover:bg-gray-100 dark:hover:bg-zinc-800 text-xs font-bold text-gray-750 dark:text-zinc-200 cursor-pointer flex items-center justify-center gap-1.5"
                title="Genera factura electrónica formal en formato A4 PDF listo para imprimir o enviar"
              >
                <FileDown className="h-4 w-4" /> Ticket Digital (PDF)
              </button>
            </div>

            <div className="p-3 bg-gray-100 dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-850">
              <button
                id="btn-modal-close-bottom"
                onClick={() => setShowInvoiceModal(false)}
                className="w-full py-2.5 bg-zinc-900 dark:bg-zinc-200 dark:text-zinc-955 text-white rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer transition-opacity"
              >
                Cerrar Comprobante
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SELECTION MODAL: 🥖 Selección de Panificados */}
      {showSelectionModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in" onClick={() => setShowSelectionModal(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-gray-150 dark:border-zinc-800 max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            
            {/* Header */}
            <div className="p-4 border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl" role="img" aria-label="bread">🥖</span>
                <div>
                  <h3 className="font-extrabold text-base text-gray-850 dark:text-zinc-50">Selección de Panificados</h3>
                  <p className="text-[10px] text-gray-400">Escoge productos para añadir al ticket de venta</p>
                </div>
              </div>
              <button
                id="btn-close-selection-modal"
                onClick={() => setShowSelectionModal(false)}
                className="p-1.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-500 hover:text-gray-700 dark:hover:text-zinc-200 cursor-pointer transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Persistence search & scanner simulation inside modal */}
            <div className="p-4 bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-850 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  id="modal-pos-search"
                  type="text"
                  placeholder="Buscar por nombre o cod..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl py-3 pl-10 pr-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-800 dark:text-zinc-100 font-semibold"
                />
                <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 font-bold"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                id="btn-modal-scan-trigger"
                onClick={startBarcodeScanSimulation}
                disabled={isScanning}
                className={`px-4 py-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none ${
                  isScanning
                    ? 'bg-amber-100 text-amber-700 animate-pulse border-amber-300'
                    : 'bg-zinc-950 dark:bg-zinc-100 dark:text-zinc-900 text-white hover:opacity-90 border-transparent shadow-xs'
                }`}
                title="Simula un scan con producto aleatorio (para probar sin hardware)"
              >
                <ScanBarcode className="h-4 w-4" />
                <span>{isScanning ? 'Escaneando...' : 'Test Scan'}</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 bg-amber-50/10 dark:bg-zinc-950/20">
              {modalMode === 'list' ? (
                /* ── MODO LISTA: todos los productos en tabla directamente ── */
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                      {searchQuery
                        ? `Resultados de búsqueda (${filteredProducts.length})`
                        : `Todos los productos (${products.length})`}
                    </span>
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="text-[10px] text-amber-600 dark:text-amber-400 font-bold hover:underline cursor-pointer"
                      >
                        Limpiar filtro
                      </button>
                    )}
                  </div>
                  {renderProductList(searchQuery ? filteredProducts : products)}
                </div>
              ) : (
                /* ── MODO VISUAL: categorías → grid de productos ── */
                <>
                  {searchQuery ? (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Resultados ({filteredProducts.length})</span>
                        <button onClick={() => setSearchQuery('')} className="text-[10px] text-amber-600 font-bold hover:underline cursor-pointer">Limpiar</button>
                      </div>
                      {renderProductList(filteredProducts)}
                    </div>
                  ) : modalSelectedCategory === null ? (
                    /* Categorías como cards */
                    <div>
                      <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3">Filtrar por Categoría</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {categoriesList.map(cat => {
                          const count = cat.id === 'todos' ? products.length : products.filter(p => p.category === cat.id).length;
                          return (
                            <button
                              key={cat.id}
                              id={`btn-modal-cat-card-${cat.id}`}
                              onClick={() => { setModalSelectedCategory(cat.id); playBeep(800, 0.05); }}
                              className="p-5 rounded-3xl border bg-white dark:bg-zinc-900 border-gray-150 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-500 text-left flex flex-col justify-between h-32 cursor-pointer transition-all duration-305 transform hover:-translate-y-1 active:scale-97 hover:shadow-md group shadow-xs"
                            >
                              <div className="flex justify-between items-start w-full">
                                <span className="text-3xl filter drop-shadow-xs transition-transform group-hover:scale-110" role="img" aria-label={cat.label}>{cat.icon}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-extrabold bg-gray-100 dark:bg-zinc-800 text-gray-500">{count}</span>
                              </div>
                              <div>
                                <p className="font-extrabold text-sm text-gray-850 dark:text-zinc-100 capitalize">{cat.label}</p>
                                <p className="text-[10px] text-gray-400 font-medium leading-none mt-0.5">Explorar menú →</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* Grid de productos en categoría seleccionada */
                    <div>
                      <div className="flex flex-col gap-2 pb-3 border-b border-gray-150 dark:border-zinc-800 mb-3">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => { setModalSelectedCategory(null); playBeep(600, 0.05); }}
                            className="text-xs font-extrabold text-amber-600 dark:text-amber-500 hover:text-amber-700 bg-amber-50 dark:bg-zinc-900 border border-amber-200 dark:border-zinc-800 px-3 py-1.5 rounded-xl cursor-pointer flex items-center gap-1 transition-colors"
                          >
                            ← Volver a Categorías
                          </button>
                          <span className="text-xs font-black text-gray-800 dark:text-zinc-50 capitalize bg-gray-100 dark:bg-zinc-800 px-3 py-1 rounded-lg">
                            {modalSelectedCategory === 'todos' ? 'Todos' : `Categoría: ${modalSelectedCategory}`}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 dark:bg-zinc-950 p-2 rounded-xl border border-gray-150 dark:border-zinc-850 mt-1 select-none">
                          <span className="text-[10px] font-bold text-gray-550 uppercase tracking-wider">Ordenar:</span>
                          <div className="flex items-center gap-1">
                            {([
                              { id: 'monto', label: '💵 Precio' },
                              { id: 'orden', label: '🔤 Nombre' },
                              { id: 'fecha_elaboracion', label: '📅 Elaboración' }
                            ] as const).map(col => {
                              const isSorted = modalSortKey === col.id;
                              return (
                                <button
                                  key={col.id}
                                  onClick={() => {
                                    if (isSorted) { setModalSortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); }
                                    else { setModalSortKey(col.id as 'monto' | 'orden' | 'fecha_elaboracion'); setModalSortOrder('asc'); }
                                    playBeep(900, 0.05);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border transition-all cursor-pointer ${isSorted ? 'bg-amber-500 text-white border-amber-600 shadow-sm' : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 border-gray-200 dark:border-zinc-800'}`}
                                >
                                  {col.label} {isSorted && (modalSortOrder === 'asc' ? '▲' : '▼')}
                                </button>
                              );
                            })}
                            {modalSortKey && (
                              <button onClick={() => { setModalSortKey(null); setModalSortOrder('asc'); }} className="text-[10px] font-bold text-red-500 px-1.5 hover:underline cursor-pointer">Limpiar</button>
                            )}
                          </div>
                        </div>
                      </div>
                      {renderProductGrid(getSortedModalProducts())}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Quick checkout summary footer inside the selection modal */}
            <div className="p-4 border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 flex items-center justify-between">
              <div className="text-left font-sans">
                <p className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wider leading-none">Elementos en ticket</p>
                <p className="text-sm font-extrabold text-gray-800 dark:text-zinc-100 mt-1 leading-none">
                  {cart.reduce((s, c) => s + c.quantity, 0)} unidades / <span className="text-amber-600 dark:text-amber-500 font-black">{formatCurrency(cartTotal)}</span>
                </p>
              </div>
              
              <button
                id="btn-selection-modal-done"
                onClick={() => setShowSelectionModal(false)}
                className="py-2.5 px-5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black shadow-md cursor-pointer transition-all hover:-translate-y-0.5 active:scale-95"
              >
                Cerrar y Ver Ticket
              </button>
            </div>

          </div>
        </div>
      )}

      {/* GROUP SELECTOR MODAL */}
      {groupSelectorProduct && (
        <GroupSelectorModal
          product={groupSelectorProduct}
          onSelectUnit={() => {
            addUnitToCart(groupSelectorProduct);
            setGroupSelectorProduct(null);
          }}
          onSelectGroup={(g) => {
            addGroupToCart(groupSelectorProduct, g);
            setGroupSelectorProduct(null);
          }}
          onClose={() => setGroupSelectorProduct(null)}
        />
      )}

      {/* FLOATING ACTION LUPA BUTTON — above the sticky cobrar footer */}
      <button
        id="btn-floating-lupa-search"
        onClick={() => {
          setModalMode('visual');
          setModalSelectedCategory(null);
          setSearchQuery('');
          setShowSelectionModal(true);
          playBeep(705, 0.05);
        }}
        className="fixed bottom-28 right-6 lg:bottom-36 lg:right-8 z-50 p-4 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer border-2 border-white dark:border-zinc-800 ring-4 ring-amber-550/10 dark:ring-zinc-900 group"
        title="Buscar Panificados (Modo Lista)"
      >
        <Search className="h-6 w-6 group-hover:rotate-12 transition-transform duration-300" />
      </button>

      {/* MODAL: Nuevo Cliente */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-50">Nuevo Cliente</h3>
              <button onClick={() => setShowNewCustomerModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Nombre *</label>
                <input
                  autoFocus
                  type="text"
                  value={newCustomerForm.name}
                  onChange={e => setNewCustomerForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreateCustomer()}
                  placeholder="Nombre completo"
                  className="w-full mt-1 text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Teléfono</label>
                <input
                  type="tel"
                  value={newCustomerForm.phone}
                  onChange={e => setNewCustomerForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="Ej: 1100000000"
                  className="w-full mt-1 text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={newCustomerForm.email}
                  onChange={e => setNewCustomerForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="cliente@ejemplo.com"
                  className="w-full mt-1 text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowNewCustomerModal(false)}
                className="flex-1 py-2.5 text-xs font-bold text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700 rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateCustomer}
                disabled={!newCustomerForm.name.trim()}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all cursor-pointer"
              >
                Crear cliente
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
