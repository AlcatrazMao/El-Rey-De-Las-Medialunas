import { describe, it, expect } from 'vitest';

/**
 * Tests para la validación de items en apps/pos-pc/src/components/documents/
 * CreateRemitoModal.tsx (change "Document Types / Comprobantes").
 *
 * Mismo criterio que posViewCuitGuard.test.ts: sin RTL instalado, replicamos
 * la derivación pura tal cual vive en CreateRemitoModal.tsx (líneas 36-39):
 *
 *   const validItems = items.filter(it => it.product_id && it.quantity > 0);
 *   if (validItems.length === 0) { setErr('Agregá al menos un producto con
 *   cantidad válida'); return; }
 *
 * Se requiere al menos 1 item con product_id truthy y quantity > 0 antes de
 * permitir el submit — items con cantidad 0/negativa o sin producto elegido
 * se descartan silenciosamente del payload (no bloquean por sí solos si hay
 * al menos otro item válido).
 */

interface RemitoLineDraft {
  product_id: string;
  quantity: number;
  description: string;
}

function getValidRemitoItems(items: RemitoLineDraft[]): RemitoLineDraft[] {
  return items.filter(it => it.product_id && it.quantity > 0);
}

function canSubmitRemito(items: RemitoLineDraft[]): { canSubmit: boolean; error: string | null } {
  const validItems = getValidRemitoItems(items);
  if (validItems.length === 0) {
    return { canSubmit: false, error: 'Agregá al menos un producto con cantidad válida' };
  }
  return { canSubmit: true, error: null };
}

describe('CreateRemitoModal: validación de items antes de submit', () => {
  it('sin items — bloquea el submit', () => {
    const { canSubmit, error } = canSubmitRemito([]);
    expect(canSubmit).toBe(false);
    expect(error).toBe('Agregá al menos un producto con cantidad válida');
  });

  it('1 item con quantity=0 — bloquea (no cuenta como válido)', () => {
    const { canSubmit } = canSubmitRemito([{ product_id: 'prod_1', quantity: 0, description: '' }]);
    expect(canSubmit).toBe(false);
  });

  it('1 item con quantity negativa — bloquea', () => {
    const { canSubmit } = canSubmitRemito([{ product_id: 'prod_1', quantity: -5, description: '' }]);
    expect(canSubmit).toBe(false);
  });

  it('1 item sin product_id (string vacío) — bloquea aunque quantity > 0', () => {
    const { canSubmit } = canSubmitRemito([{ product_id: '', quantity: 3, description: '' }]);
    expect(canSubmit).toBe(false);
  });

  it('1 item válido (product_id + quantity > 0) — permite el submit', () => {
    const { canSubmit, error } = canSubmitRemito([{ product_id: 'prod_1', quantity: 1, description: '' }]);
    expect(canSubmit).toBe(true);
    expect(error).toBeNull();
  });

  it('mezcla de items válidos e inválidos — permite el submit (basta con 1 válido)', () => {
    const items: RemitoLineDraft[] = [
      { product_id: '', quantity: 5, description: '' },
      { product_id: 'prod_2', quantity: 0, description: '' },
      { product_id: 'prod_3', quantity: 2, description: 'línea ok' },
    ];
    const { canSubmit } = canSubmitRemito(items);
    expect(canSubmit).toBe(true);
  });

  it('todos los items inválidos — bloquea aunque haya varias líneas', () => {
    const items: RemitoLineDraft[] = [
      { product_id: '', quantity: 5, description: '' },
      { product_id: 'prod_2', quantity: 0, description: '' },
      { product_id: '', quantity: -1, description: '' },
    ];
    const { canSubmit } = canSubmitRemito(items);
    expect(canSubmit).toBe(false);
  });

  it('getValidRemitoItems filtra correctamente el subconjunto que se manda al payload', () => {
    const items: RemitoLineDraft[] = [
      { product_id: 'prod_1', quantity: 2, description: 'a' },
      { product_id: '', quantity: 3, description: 'b' },
      { product_id: 'prod_3', quantity: 0, description: 'c' },
    ];
    const valid = getValidRemitoItems(items);
    expect(valid).toHaveLength(1);
    expect(valid[0].product_id).toBe('prod_1');
  });
});
