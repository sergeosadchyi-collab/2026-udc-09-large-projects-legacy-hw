var test = require('node:test');
var assert = require('node:assert/strict');
var stock = require('../../lib/catalog/stock');

var products = {
  1: { id: 1, sku: 'SKU-1000', title: 'Папір А4, пачка', unit: 'уп', active: true },
  2: { id: 2, sku: 'SKU-1001', title: 'Картридж чорний', unit: 'шт', active: true },
  3: { id: 3, sku: 'SKU-1002', title: 'Степлер', unit: 'шт', active: true },
  14: { id: 14, sku: 'SKU-1013', title: 'Блок для нотаток', unit: 'шт', active: false },
};

var rows = [
  { id: 1, product_id: 1, warehouse: 'KYIV-1', qty_on_hand: 100, qty_reserved: 10, reorder_level: 20, updated_at: '2026-09-01' },
  { id: 2, product_id: 2, warehouse: 'KYIV-1', qty_on_hand: 12, qty_reserved: 4, reorder_level: 10, updated_at: '2026-06-30' },
  { id: 3, product_id: 3, warehouse: 'LVIV-2', qty_on_hand: 10, qty_reserved: 0, reorder_level: 10, updated_at: '2026-09-01' },
  { id: 4, product_id: 14, warehouse: 'KYIV-1', qty_on_hand: 0, qty_reserved: 0, reorder_level: 5, updated_at: '2026-09-01' },
  { id: 5, product_id: 99, warehouse: 'KYIV-1', qty_on_hand: 0, qty_reserved: 0, reorder_level: 5, updated_at: '2020-01-01' },
];

test('low stock: at or below reorder level, biggest shortfall first, stale counts flagged', function () {
  var report = stock.lowStock(rows, products, {}, { today: '2026-09-23' });
  assert.deepEqual(
    report.map(function (r) { return [r.sku, r.available, r.shortfall, r.stale]; }),
    [['SKU-1001', 8, 2, true], ['SKU-1002', 10, 0, false]],
  );
});

test('low stock: confirmed orders, inactive products, warehouses and orphan rows', function () {
  var orders = [
    { id: 1, status: 'confirmed', lines: [{ product_id: 1, qty: 70 }, { product_id: 3, qty: 2 }] },
    { id: 2, status: 'confirmed', lines: [{ product_id: 1, qty: 5 }] },
    { id: 3, status: 'invoiced', lines: [{ product_id: 1, qty: 50 }] },
    { id: 4, status: 'draft', lines: [{ product_id: 2, qty: 7 }] },
  ];
  var reserved = stock.reservedByOrders(orders);
  assert.deepEqual(reserved, { 1: 75, 3: 2 });
  assert.deepEqual(stock.reservedByOrders(undefined), {});
  var report = stock.lowStock(rows, products, reserved, { today: '2026-09-23' });
  assert.deepEqual(
    report.map(function (r) { return [r.sku, r.available, r.qty_in_orders]; }),
    [['SKU-1000', 15, 75], ['SKU-1001', 8, 0], ['SKU-1002', 8, 2]],
  );
  var withInactive = stock.lowStock(rows, products, {}, { includeInactive: true });
  assert.deepEqual(withInactive.map(function (r) { return r.sku; }), ['SKU-1013', 'SKU-1001', 'SKU-1002']);
  var lviv = stock.lowStock(rows, products, {}, { warehouse: 'LVIV-2' });
  assert.deepEqual(lviv.map(function (r) { return r.sku; }), ['SKU-1002']);
  assert.equal(lviv[0].stale, false); // no "today" given
});
