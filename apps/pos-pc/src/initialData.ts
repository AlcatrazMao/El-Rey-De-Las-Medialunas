import { Ingredient, Product, Sale, Expense, User, PushNotification, PaymentGateway } from './types';

export const INITIAL_INGREDIENTS: Ingredient[] = [
  { id: 'ing_harina', name: 'Harina de Trigo 0000', stock: 150, unit: 'kg', minStock: 30, unitCost: 1.2 },
  { id: 'ing_azucar', name: 'Azúcar Refinada', stock: 65, unit: 'kg', minStock: 15, unitCost: 1.5 },
  { id: 'ing_levadura', name: 'Levadura Fresca', stock: 12, unit: 'kg', minStock: 3, unitCost: 4.8 },
  { id: 'ing_manteca', name: 'Manteca (Mantequilla)', stock: 45, unit: 'kg', minStock: 10, unitCost: 6.5 },
  { id: 'ing_leche', name: 'Leche Entera', stock: 80, unit: 'L', minStock: 15, unitCost: 1.0 },
  { id: 'ing_huevos', name: 'Huevos de Campo', stock: 360, unit: 'unidades', minStock: 60, unitCost: 0.15 },
  { id: 'ing_chocolate', name: 'Chocolate de Cobertura', stock: 18, unit: 'kg', minStock: 5, unitCost: 12.0 },
  { id: 'ing_sal', name: 'Sal Fina', stock: 25, unit: 'kg', minStock: 5, unitCost: 0.8 },
  { id: 'ing_dulce_leche', name: 'Dulce de Leche Repostero', stock: 50, unit: 'kg', minStock: 12, unitCost: 3.5 }
];

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod_pan_flauta',
    name: 'Pan Flauta (Baguette)',
    category: 'panes',
    price: 2.20,
    cost: 0.60,
    stock: 120,
    minStock: 30,
    image: '🥖',
    code: '7791234560011',
    ingredients: [
      { ingredientId: 'ing_harina', quantity: 0.25 },
      { ingredientId: 'ing_levadura', quantity: 0.01 },
      { ingredientId: 'ing_sal', quantity: 0.005 }
    ],
    elaborationDate: '2026-06-05',
    durabilityDays: 2
  },
  {
    id: 'prod_felipe',
    name: 'Mignon / Felipe o Pancito',
    category: 'panes',
    price: 0.40,
    cost: 0.12,
    stock: 450,
    minStock: 100,
    image: '🍞',
    code: '7791234560028',
    ingredients: [
      { ingredientId: 'ing_harina', quantity: 0.05 },
      { ingredientId: 'ing_levadura', quantity: 0.002 },
      { ingredientId: 'ing_sal', quantity: 0.001 }
    ],
    elaborationDate: '2026-06-05',
    durabilityDays: 1
  },
  {
    id: 'prod_medialuna_manteca',
    name: 'Medialuna de Manteca',
    category: 'facturas',
    price: 0.90,
    cost: 0.35,
    stock: 280,
    minStock: 50,
    image: '🥐',
    code: '7791234560035',
    ingredients: [
      { ingredientId: 'ing_harina', quantity: 0.04 },
      { ingredientId: 'ing_manteca', quantity: 0.02 },
      { ingredientId: 'ing_azucar', quantity: 0.01 },
      { ingredientId: 'ing_levadura', quantity: 0.001 }
    ],
    elaborationDate: '2026-06-04',
    durabilityDays: 2
  },
  {
    id: 'prod_vigilante',
    name: 'Vigilante con Almíbar',
    category: 'facturas',
    price: 0.90,
    cost: 0.30,
    stock: 150,
    minStock: 40,
    image: '🥨',
    code: '7791234560042',
    ingredients: [
      { ingredientId: 'ing_harina', quantity: 0.04 },
      { ingredientId: 'ing_manteca', quantity: 0.015 },
      { ingredientId: 'ing_azucar', quantity: 0.012 },
      { ingredientId: 'ing_levadura', quantity: 0.001 }
    ],
    elaborationDate: '2026-06-05',
    durabilityDays: 2
  },
  {
    id: 'prod_torta_frutilla',
    name: 'Tarta de Frutillas con Crema',
    category: 'pasteleria',
    price: 18.50,
    cost: 7.20,
    stock: 12,
    minStock: 3,
    image: '🍰',
    code: '7791234560059',
    ingredients: [
      { ingredientId: 'ing_harina', quantity: 0.3 },
      { ingredientId: 'ing_manteca', quantity: 0.15 },
      { ingredientId: 'ing_huevos', quantity: 4 },
      { ingredientId: 'ing_azucar', quantity: 0.2 },
      { ingredientId: 'ing_leche', quantity: 0.25 }
    ],
    elaborationDate: '2026-06-03',
    durabilityDays: 3
  },
  {
    id: 'prod_budin_repostero',
    name: 'Budín Húmedo de Chocolate',
    category: 'pasteleria',
    price: 8.90,
    cost: 3.10,
    stock: 24,
    minStock: 6,
    image: '🍫',
    code: '7791234560066',
    ingredients: [
      { ingredientId: 'ing_harina', quantity: 0.2 },
      { ingredientId: 'ing_chocolate', quantity: 0.15 },
      { ingredientId: 'ing_huevos', quantity: 3 },
      { ingredientId: 'ing_azucar', quantity: 0.15 },
      { ingredientId: 'ing_manteca', quantity: 0.1 }
    ],
    elaborationDate: '2026-06-01',
    durabilityDays: 5
  },
  {
    id: 'prod_sand_miga',
    name: 'Sándwich de Miga (JyQ x6)',
    category: 'salados',
    price: 12.00,
    cost: 4.80,
    stock: 45,
    minStock: 10,
    image: '🥪',
    code: '7791234560073',
    ingredients: [
      { ingredientId: 'ing_harina', quantity: 0.15 },
      { ingredientId: 'ing_manteca', quantity: 0.02 }
    ],
    elaborationDate: '2026-06-05',
    durabilityDays: 1
  },
  {
    id: 'prod_cafe',
    name: 'Café Espresso Premium',
    category: 'bebidas',
    price: 2.50,
    cost: 0.50,
    stock: 200,
    minStock: 20,
    image: '☕',
    code: '7791234560080',
    ingredients: [],
    elaborationDate: '2026-06-05',
    durabilityDays: 30
  },
  {
    id: 'prod_jugo',
    name: 'Jugo Naranja Exprimido',
    category: 'bebidas',
    price: 3.20,
    cost: 0.90,
    stock: 60,
    minStock: 15,
    image: '🍊',
    code: '7791234560097',
    ingredients: [],
    elaborationDate: '2026-06-05',
    durabilityDays: 1
  }
];

export const INITIAL_SALES: Sale[] = [
  {
    id: 'sale_1',
    invoiceNumber: 'FC-A-0001-0000341',
    date: '2026-06-04T08:30:00Z',
    items: [
      { productId: 'prod_pan_flauta', name: 'Pan Flauta (Baguette)', quantity: 2, price: 2.20, subtotal: 4.40 },
      { productId: 'prod_medialuna_manteca', name: 'Medialuna de Manteca', quantity: 12, price: 0.90, subtotal: 10.80 },
      { productId: 'prod_cafe', name: 'Café Espresso Premium', quantity: 2, price: 2.50, subtotal: 5.00 }
    ],
    total: 20.20,
    tax: 3.50,
    paymentMethod: 'efectivo',
    paymentStatus: 'completed',
    operatorRole: 'Cajero',
    operatorName: 'Rodrigo Gómez',
    customerName: 'Juan Pérez'
  },
  {
    id: 'sale_2',
    invoiceNumber: 'FC-A-0001-0000342',
    date: '2026-06-04T09:15:00Z',
    items: [
      { productId: 'prod_torta_frutilla', name: 'Tarta de Frutillas con Crema', quantity: 1, price: 18.50, subtotal: 18.50 }
    ],
    total: 18.50,
    tax: 3.21,
    paymentMethod: 'tarjeta',
    paymentStatus: 'completed',
    operatorRole: 'Cajero',
    operatorName: 'Rodrigo Gómez',
    customerName: 'Laura Martinez'
  },
  {
    id: 'sale_3',
    invoiceNumber: 'FC-B-0001-0000343',
    date: '2026-06-04T11:45:00Z',
    items: [
      { productId: 'prod_sand_miga', name: 'Sándwich de Miga (JyQ x6)', quantity: 2, price: 12.00, subtotal: 24.00 },
      { productId: 'prod_jugo', name: 'Jugo Naranja Exprimido', quantity: 2, price: 3.20, subtotal: 6.40 }
    ],
    total: 30.40,
    tax: 5.28,
    paymentMethod: 'mercado_pago',
    paymentStatus: 'completed',
    operatorRole: 'Admin',
    operatorName: 'Carlos Pastor (Dueño)',
    customerName: 'Sonia Díaz'
  },
  {
    id: 'sale_4',
    invoiceNumber: 'FC-B-0001-0000344',
    date: '2026-06-04T12:30:00Z',
    items: [
      { productId: 'prod_medialuna_manteca', name: 'Medialuna de Manteca', quantity: 6, price: 0.90, subtotal: 5.40 }
    ],
    total: 5.40,
    tax: 0.94,
    paymentMethod: 'paypal',
    paymentStatus: 'failed', // Failed simulated transaction for push notification alerts!
    operatorRole: 'Cajero',
    operatorName: 'Rodrigo Gómez',
    customerName: 'Cliente Anónimo'
  },
  {
    id: 'sale_5',
    invoiceNumber: 'FC-A-0001-0000345',
    date: '2026-06-04T14:10:00Z',
    items: [
      { productId: 'prod_felipe', name: 'Mignon / Felipe o Pancito', quantity: 15, price: 0.40, subtotal: 6.00 }
    ],
    total: 6.00,
    tax: 1.04,
    paymentMethod: 'efectivo',
    paymentStatus: 'completed',
    operatorRole: 'Cajero',
    operatorName: 'Rodrigo Gómez'
  }
];

export const INITIAL_EXPENSES: Expense[] = [
  {
    id: 'exp_1',
    concept: 'Compra de 200kg Harina',
    category: 'materia_prima',
    amount: 240.00,
    date: '2026-06-03T10:00:00Z',
    paymentMethod: 'Transferencia Bancaria'
  },
  {
    id: 'exp_2',
    concept: 'Alquiler Local Mensual',
    category: 'alquiler',
    amount: 800.00,
    date: '2026-06-01T08:00:00Z',
    paymentMethod: 'Débit'
  },
  {
    id: 'exp_3',
    concept: 'Factura de Electricidad (Trifásica Horno)',
    category: 'servicios',
    amount: 185.50,
    date: '2026-06-02T15:30:00Z',
    paymentMethod: 'Débito'
  },
  {
    id: 'exp_4',
    concept: 'Sueldo Ayudante Panadero',
    category: 'salarios',
    amount: 600.00,
    date: '2026-06-01T17:00:00Z',
    paymentMethod: 'Transferencia Bancaria'
  }
];

export const USERS: User[] = [
  {
    id: 'user_admin',
    name: 'Carlos Pastor (Dueño)',
    role: 'admin',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    customPanels: ['widget_facturacion', 'widget_inventario', 'widget_contabilidad', 'widget_alertas', 'widget_historico']
  },
  {
    id: 'user_cajero',
    name: 'Rodrigo Gómez (Caja)',
    role: 'cajero',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    customPanels: ['widget_facturacion', 'widget_alertas']
  },
  {
    id: 'user_panadero',
    name: 'Marta Pérez (Maestra)',
    role: 'panadero',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
    customPanels: ['widget_inventario', 'widget_alertas']
  }
];

export const INITIAL_NOTIFICATIONS: PushNotification[] = [
  {
    id: 'not_1',
    title: '⚠️ Insuficiente Stock: Harina 0000',
    message: 'El stock de Harina de Trigo 0000 ha bajado del mínimo de 30 kg. Stock actual: 28 kg.',
    type: 'warning',
    timestamp: '2026-06-04T10:11:00Z',
    read: false
  },
  {
    id: 'not_2',
    title: '❌ Transacción de Pago Fallida',
    message: 'Un intento de cobro con PayPal por un valor de $5.40 ha sido rechazado por el emisor de la tarjeta.',
    type: 'error',
    timestamp: '2026-06-04T12:30:10Z',
    read: false
  },
  {
    id: 'not_3',
    title: '✅ Sincronización Completa',
    message: 'La base de datos en la nube está completamente sincronizada con 3 dispositivos activos.',
    type: 'success',
    timestamp: '2026-06-04T23:50:00Z',
    read: true
  }
];

export const PAYMENT_GATEWAYS: PaymentGateway[] = [
  { id: 'gate_stripe', name: 'Stripe', logo: '💳', status: 'active', chargeFee: 2.9 },
  { id: 'gate_mp', name: 'Mercado Pago', logo: '🤝', status: 'active', chargeFee: 3.4 },
  { id: 'gate_paypal', name: 'PayPal Express', logo: '🌐', status: 'active', chargeFee: 3.9 }
];
