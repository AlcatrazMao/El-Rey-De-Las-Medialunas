import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(resolve('apps/pos-pc/package.json'));
const { createElement, act, useState } = require('react');
const { createRoot } = require('react-dom/client');

const state = vi.hoisted(() => ({ updateProduct: vi.fn(), addProduct: vi.fn(), products: [{
  id: 'p1', name: 'Pan por peso', code: 'PAN', category: 'panes', price: 100, cost: 40,
  stock: 2.5, minStock: .5, image: '🥖', unit: 'kg', ingredients: [], taxRate: 0,
  supplier: 'Molino', attributes: 'Integral', maxStock: 10, durabilityDays: 2, storageInstructions: 'Frío',
}] }));
vi.mock('../../../apps/pos-pc/src/AppContext', () => ({ useApp: () => ({
  products: state.products, ingredients: [], batches: [], activeUser: { role: 'admin' },
  updateProduct: state.updateProduct, addProduct: state.addProduct, addSystemNotification: vi.fn(),
}) }));
vi.mock('../../../apps/pos-pc/src/hooks/useRequests', () => ({ useRequests: () => ({ requests: [] }) }));
vi.mock('../../../apps/pos-pc/src/components/ImagePicker', () => ({ ImagePicker: () => null }));
vi.mock('../../../apps/pos-pc/src/components/inventory/BatchPanel', () => ({ BatchPanel: () => null }));
vi.mock('../../../apps/pos-pc/src/components/ProductGroupsEditor', () => ({ ProductGroupsEditor: () => null }));
import { InventoryView } from '../../../apps/pos-pc/src/components/InventoryView';
import { CartItemList } from '../../../apps/pos-pc/src/components/pos/CartItemList';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(InventoryView)); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function click(selector: string) { await act(async () => { container.querySelector<HTMLButtonElement>(selector)!.click(); }); }
describe('actual inventory form', () => {
  it('reopens kg product with stored unit and submits all details, including exempt VAT', async () => {
    await click('#btn-subtab-productos'); await click('#btn-edit-product-p1');
    expect(container.querySelector<HTMLSelectElement>('#modal-prod-unit')!.value).toBe('kg');
    const form = container.querySelector('#modal-prod-unit')!.closest('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(state.updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ unit: 'kg', supplier: 'Molino', taxRate: 0, maxStock: 10, durabilityDays: 2, attributes: 'Integral', storageInstructions: 'Frío' }));
  });
  it('allows changing the saved unit from kg to g', async () => {
    await click('#btn-subtab-productos'); await click('#btn-edit-product-p1');
    const select = container.querySelector<HTMLSelectElement>('#modal-prod-unit')!;
    await act(async () => { select.value = 'g'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { select.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(state.updateProduct.mock.calls[0][1].unit).toBe('g');
  });
  it('edits 0.250 kg in the actual cart and shows Agregar when emptied', async () => {
    let currentCart: { quantity: number }[] = [];
    function CartHarness() {
      const [cart, setCart] = useState([{ product: state.products[0], quantity: 1, unitPrice: 100 }]);
      currentCart = cart;
      return createElement(CartItemList, { cart, setCart, decreaseQuantity: vi.fn(), addUnitToCart: vi.fn(), playBeep: vi.fn(), onEmptyClick: vi.fn() });
    }
    await act(async () => root.render(createElement(CartHarness)));
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, '0.250');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(currentCart[0].quantity).toBe(.25);
    await click('#btn-cart-minus-p1-0');
    expect(currentCart).toHaveLength(0);
    expect(container.textContent).toContain('Agregar');
  });
});
