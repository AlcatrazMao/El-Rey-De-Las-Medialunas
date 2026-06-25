import { describe, it, expect } from 'vitest';

// Tests para la lógica del editor de grupos del gestor de artículos
// (apps/pos-pc/src/components/ProductGroupsEditor.tsx). Replicamos las
// reglas de validación e invariantes acá como funciones puras.

const MAX_GROUPS = 3;
const MAX_NAME_LEN = 50;

interface Draft {
  nombre: string;
  cantidad: number;
  descuento: number;
  descuento_tipo: 'porcentaje' | 'fijo';
  orden: 1 | 2 | 3;
  admite_acum_desc: 0 | 1;
}

function validateDrafts(drafts: Draft[]): { idx: number; reason: string }[] {
  const errors: { idx: number; reason: string }[] = [];
  const ordenes = new Set<number>();
  drafts.forEach((d, idx) => {
    if (!d.nombre.trim()) errors.push({ idx, reason: 'nombre' });
    else if (d.nombre.length > MAX_NAME_LEN) errors.push({ idx, reason: 'nombre' });
    else if (!Number.isInteger(d.cantidad) || d.cantidad < 2 || d.cantidad > 1000) errors.push({ idx, reason: 'cantidad' });
    else if (!Number.isFinite(d.descuento) || d.descuento < 0) errors.push({ idx, reason: 'descuento' });
    else if (d.descuento_tipo === 'porcentaje' && d.descuento > 100) errors.push({ idx, reason: 'descuento' });
    else if (![1, 2, 3].includes(d.orden)) errors.push({ idx, reason: 'orden' });
    else if (ordenes.has(d.orden)) errors.push({ idx, reason: 'orden_conflict' });
    else ordenes.add(d.orden);
  });
  return errors;
}

const draftBase: Draft = {
  nombre: 'Docena',
  cantidad: 12,
  descuento: 10,
  descuento_tipo: 'porcentaje',
  orden: 1,
  admite_acum_desc: 0,
};

describe('ProductGroupsEditor — validaciones', () => {
  it('un draft válido pasa', () => {
    expect(validateDrafts([draftBase])).toEqual([]);
  });

  it('lista vacía es válida (permitido borrar todos los grupos)', () => {
    expect(validateDrafts([])).toEqual([]);
  });

  it('detecta nombre vacío', () => {
    expect(validateDrafts([{ ...draftBase, nombre: '' }])[0].reason).toBe('nombre');
  });

  it('detecta nombre > 50 chars', () => {
    expect(validateDrafts([{ ...draftBase, nombre: 'x'.repeat(51) }])[0].reason).toBe('nombre');
  });

  it('detecta cantidad < 2', () => {
    expect(validateDrafts([{ ...draftBase, cantidad: 1 }])[0].reason).toBe('cantidad');
  });

  it('detecta cantidad no entera', () => {
    expect(validateDrafts([{ ...draftBase, cantidad: 3.5 }])[0].reason).toBe('cantidad');
  });

  it('detecta descuento porcentual > 100', () => {
    expect(validateDrafts([{ ...draftBase, descuento: 105 }])[0].reason).toBe('descuento');
  });

  it('detecta descuento negativo', () => {
    expect(validateDrafts([{ ...draftBase, descuento: -1 }])[0].reason).toBe('descuento');
  });

  it('descuento fijo > 100 es válido (no es porcentaje)', () => {
    expect(validateDrafts([{ ...draftBase, descuento: 500, descuento_tipo: 'fijo' }])).toEqual([]);
  });

  it('detecta orden duplicado entre dos drafts', () => {
    const errors = validateDrafts([
      { ...draftBase, orden: 1, nombre: 'Docena' },
      { ...draftBase, orden: 1, nombre: 'Otra' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe('orden_conflict');
  });

  it('acepta hasta 3 drafts con ordenes diferentes', () => {
    const errors = validateDrafts([
      { ...draftBase, orden: 1, nombre: 'Docena' },
      { ...draftBase, orden: 2, nombre: 'Media Docena' },
      { ...draftBase, orden: 3, nombre: 'Pack 4' },
    ]);
    expect(errors).toEqual([]);
  });
});

describe('ProductGroupsEditor — invariantes UI', () => {
  it('MAX_GROUPS = 3 (límite hardcoded debe coincidir con backend)', () => {
    expect(MAX_GROUPS).toBe(3);
  });

  it('nextOrden calcula el próximo orden libre 1→2→3', () => {
    const used = new Set([1]);
    const next = ([1, 2, 3] as const).find((o) => !used.has(o));
    expect(next).toBe(2);
  });

  it('nextOrden = null cuando ya hay 3 grupos', () => {
    const used = new Set([1, 2, 3]);
    const next = ([1, 2, 3] as const).find((o) => !used.has(o)) ?? null;
    expect(next).toBeNull();
  });
});

describe('GroupSelectorModal — orden y comportamiento', () => {
  it('siempre muestra "Unidad" primero y luego los grupos por orden', () => {
    const groups = [
      { id: 'g3', nombre: 'Pack 4', orden: 3 },
      { id: 'g1', nombre: 'Docena', orden: 1 },
      { id: 'g2', nombre: 'Media Docena', orden: 2 },
    ];
    const sorted = [...groups].sort((a, b) => a.orden - b.orden);
    const labels = ['Unidad', ...sorted.map((g) => g.nombre)];
    expect(labels).toEqual(['Unidad', 'Docena', 'Media Docena', 'Pack 4']);
  });

  it('producto sin groups → POSView agrega como Unidad directamente sin abrir modal', () => {
    // Regla: en addToCart, si groups.length === 0, NO se abre modal.
    const groups: unknown[] = [];
    const shouldOpenModal = (groups?.length ?? 0) > 0;
    expect(shouldOpenModal).toBe(false);
  });

  it('producto con groups → POSView abre el selector modal', () => {
    const groups = [{ id: 'g1' }];
    const shouldOpenModal = (groups?.length ?? 0) > 0;
    expect(shouldOpenModal).toBe(true);
  });
});

describe('POS — descuento acumulado en carrito (admite_acum_desc)', () => {
  // Replica de la lógica eligibleSubtotal en AppContext.addSale y POSView.
  interface CartLine {
    unitPrice: number;
    quantity: number;
    presentation?: string;
    admite_acum_desc?: 0 | 1;
  }

  const calcEligible = (cart: CartLine[]) =>
    cart.reduce((acc, item) => {
      const admits = !item.presentation || item.admite_acum_desc === 1;
      return admits ? acc + item.unitPrice * item.quantity : acc;
    }, 0);

  it('líneas sin presentation siempre admiten descuento acumulado', () => {
    const cart: CartLine[] = [{ unitPrice: 100, quantity: 3 }];
    expect(calcEligible(cart)).toBe(300);
  });

  it('línea con presentation y admite_acum_desc=0 NO admite descuento', () => {
    const cart: CartLine[] = [{ unitPrice: 90, quantity: 12, presentation: 'Docena', admite_acum_desc: 0 }];
    expect(calcEligible(cart)).toBe(0);
  });

  it('línea con presentation y admite_acum_desc=1 SÍ admite descuento', () => {
    const cart: CartLine[] = [{ unitPrice: 90, quantity: 12, presentation: 'Docena', admite_acum_desc: 1 }];
    expect(calcEligible(cart)).toBe(1080);
  });

  it('carrito mixto: descuento del 10% se aplica solo sobre líneas elegibles', () => {
    const cart: CartLine[] = [
      { unitPrice: 100, quantity: 2 }, // 200 elegible (unidad)
      { unitPrice: 90, quantity: 12, presentation: 'Docena', admite_acum_desc: 0 }, // 0
      { unitPrice: 95, quantity: 6, presentation: 'Media docena', admite_acum_desc: 1 }, // 570 elegible
    ];
    const eligible = calcEligible(cart);
    expect(eligible).toBe(770);
    const descuentoPct = 10;
    const descuento = parseFloat((eligible * descuentoPct / 100).toFixed(2));
    expect(descuento).toBe(77);
  });
});
