import { describe, it, expect, vi, afterEach } from 'vitest';

// Replica de la lógica de unicidad de batchNumber implementada en
// apps/pos-pc/src/components/inventory/BatchPanel.tsx →
// handleRegisterBatchSubmit. Mantener una versión pura permite testear sin
// montar React: la regla de negocio es la misma.
interface BatchLike {
  productId: string;
  batchNumber: string;
}

/**
 * Devuelve un batchNumber único para el (productId). Si el candidato colisiona
 * con un lote del MISMO producto, agrega un sufijo aleatorio (3 chars base36).
 * Lotes de OTROS productos no entran en el conflicto — el espacio de unicidad
 * es por producto.
 */
function resolveUniqueBatchNumber(
  candidate: string,
  productId: string,
  batches: BatchLike[],
  randomSuffix: () => string = () => Math.random().toString(36).slice(2, 5).toUpperCase()
): { batchNumber: string; renamed: boolean } {
  const collides = batches.some(
    (b) => b.productId === productId && b.batchNumber === candidate
  );
  if (!collides) return { batchNumber: candidate, renamed: false };
  return { batchNumber: `${candidate}-${randomSuffix()}`, renamed: true };
}

describe('BatchPanel — batchNumber uniqueness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acepta un número nuevo cuando no hay colisión', () => {
    const batches: BatchLike[] = [
      { productId: 'p1', batchNumber: 'L-CRO-AB12CD' },
    ];
    const out = resolveUniqueBatchNumber('L-CRO-XY99ZZ', 'p1', batches);
    expect(out.batchNumber).toBe('L-CRO-XY99ZZ');
    expect(out.renamed).toBe(false);
  });

  it('regenera con sufijo si el número colisiona en el MISMO producto', () => {
    const batches: BatchLike[] = [
      { productId: 'p1', batchNumber: 'L-CRO-AB12CD' },
    ];
    const out = resolveUniqueBatchNumber(
      'L-CRO-AB12CD',
      'p1',
      batches,
      () => 'Z9X'
    );
    expect(out.renamed).toBe(true);
    expect(out.batchNumber).toBe('L-CRO-AB12CD-Z9X');
    expect(out.batchNumber).not.toBe('L-CRO-AB12CD');
  });

  it('acepta sin renombrar si el conflicto es en OTRO producto', () => {
    const batches: BatchLike[] = [
      { productId: 'p2', batchNumber: 'L-CRO-AB12CD' }, // mismo número pero otro producto
    ];
    const out = resolveUniqueBatchNumber('L-CRO-AB12CD', 'p1', batches);
    expect(out.batchNumber).toBe('L-CRO-AB12CD');
    expect(out.renamed).toBe(false);
  });

  it('la regeneración produce un valor distinto del original incluso si el sufijo es corto', () => {
    const batches: BatchLike[] = [
      { productId: 'p1', batchNumber: 'L-X' },
    ];
    const out = resolveUniqueBatchNumber('L-X', 'p1', batches, () => 'ABC');
    expect(out.batchNumber).not.toBe('L-X');
    expect(out.batchNumber.startsWith('L-X-')).toBe(true);
    expect(out.batchNumber.length).toBeGreaterThan('L-X'.length);
  });

  it('maneja el caso de batches vacíos', () => {
    const out = resolveUniqueBatchNumber('L-CRO-001', 'p1', []);
    expect(out.batchNumber).toBe('L-CRO-001');
    expect(out.renamed).toBe(false);
  });

  it('múltiples colisiones en el mismo producto: cada llamada genera un sufijo nuevo', () => {
    const batches: BatchLike[] = [
      { productId: 'p1', batchNumber: 'L-CRO-DUP' },
    ];
    const suffixes = ['AAA', 'BBB', 'CCC'];
    let i = 0;
    const next = () => suffixes[i++];

    const r1 = resolveUniqueBatchNumber('L-CRO-DUP', 'p1', batches, next);
    const r2 = resolveUniqueBatchNumber('L-CRO-DUP', 'p1', batches, next);
    const r3 = resolveUniqueBatchNumber('L-CRO-DUP', 'p1', batches, next);

    expect(r1.batchNumber).toBe('L-CRO-DUP-AAA');
    expect(r2.batchNumber).toBe('L-CRO-DUP-BBB');
    expect(r3.batchNumber).toBe('L-CRO-DUP-CCC');
    expect(new Set([r1.batchNumber, r2.batchNumber, r3.batchNumber]).size).toBe(3);
  });

  it('el sufijo random real (Math.random base36) produce valores no vacíos y alfanuméricos', () => {
    const batches: BatchLike[] = [
      { productId: 'p1', batchNumber: 'L-X' },
    ];
    // Sin mock — usamos el random real para verificar la forma del sufijo.
    const out = resolveUniqueBatchNumber('L-X', 'p1', batches);
    expect(out.renamed).toBe(true);
    const suffix = out.batchNumber.slice('L-X-'.length);
    expect(suffix.length).toBeGreaterThan(0);
    expect(/^[A-Z0-9]+$/.test(suffix)).toBe(true);
  });
});
