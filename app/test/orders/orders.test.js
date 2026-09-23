var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var orders = require('../../lib/orders');
var lines = require('../../lib/orders/lines');
var invoices = require('../../lib/invoices');

var DATA = path.join(__dirname, '..', '..', 'data');
var seedOrders = JSON.parse(fs.readFileSync(path.join(DATA, 'orders.json'), 'utf8'));
var seedProducts = JSON.parse(fs.readFileSync(path.join(DATA, 'products.json'), 'utf8'));

function tmpStore() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-orders-'));
  ['customers', 'products', 'orders'].forEach(function (name) {
    fs.copyFileSync(path.join(DATA, name + '.json'), path.join(dir, name + '.json'));
  });
  store.open(dir);
}

test.after(function () {
  store.open();
});

test('order numbers: ORD-YYYY-NNNN, legacy rows counted by id', function () {
  assert.equal(orders.orderNumber(2026, 7), 'ORD-2026-0007');
  assert.equal(orders.orderNumber(2026, 12345), 'ORD-2026-12345');
  assert.equal(orders.numberOf(seedOrders[0]), 'ORD-2026-0001');
  assert.equal(orders.numberOf({ id: 3, number: 'ORD-2026-0099', created_at: '2026-01-01' }), 'ORD-2026-0099');

  // all 36 seed orders are from 2026 and unnumbered
  assert.equal(orders.nextSeq(seedOrders, 2026), 37);
  assert.equal(orders.nextSeq(seedOrders, 2025), 1);
  var mixed = seedOrders.concat([{ id: 37, number: 'ORD-2026-0040', created_at: '2026-04-01' }]);
  assert.equal(orders.nextSeq(mixed, 2026), 41);
});

test('lines: price/title snapshot, validation, subtotal without VAT', function () {
  var ok = lines.validateLines([{ product_id: 3, qty: 2, unit_price_kopecks: 1 }, { product_id: '1', qty: '5' }], seedProducts);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.lines, [
    { product_id: 3, title: 'Степлер', qty: 2, unit_price_kopecks: 13750 },
    { product_id: 1, title: 'Папір А4, пачка', qty: 5, unit_price_kopecks: 9000 },
  ]);

  var bad = lines.validateLines([
    { product_id: 14, qty: 1 },
    { product_id: 2, qty: 0 },
    { product_id: 2, qty: 1.5 },
    { product_id: 999, qty: 1 },
    { qty: 1 },
    { product_id: 2, qty: lines.MAX_QTY + 1 },
  ], seedProducts);
  [
    /^line 1: product SKU-1013 is not active/,
    /^line 2: qty must be a positive/,
    /^line 3: qty must be a positive/,
    /^line 4: unknown product 999$/,
    /^line 5: product_id is required$/,
    /^line 6: qty over 9999/,
  ].forEach(function (re, i) {
    assert.match(bad.errors[i], re);
  });
  assert.equal(bad.errors.length, 6);
  assert.deepEqual(lines.validateLines(null, seedProducts).errors, ['order must have at least one line']);

  // subtotal is net: no VAT on orders, it must equal the invoice subtotal
  seedOrders.forEach(function (o) {
    var inv = invoices.totals(o.lines, invoices.VAT_RATE);
    assert.equal(orders.subtotal(o.lines), inv.subtotal_kopecks, 'order ' + o.id);
    assert.ok(inv.total_kopecks > orders.subtotal(o.lines));
  });
});

test('create: numbering, snapshots, 422 for inactive customer and bad input', function (t, done) {
  tmpStore();
  var input = { customer_id: 2, created_at: '2026-04-02', lines: [{ product_id: 5, qty: 4 }], comment: ' before noon ' };
  orders.create(input, 11, function (err, order) {
    assert.ifError(err);
    assert.equal(order.id, 37);
    assert.equal(order.number, 'ORD-2026-0037');
    assert.equal(order.status, 'new');
    assert.equal(order.created_by, 11);
    assert.equal(order.comment, 'before noon');
    assert.deepEqual(order.lines, [{ product_id: 5, title: 'Маркер перманентний', qty: 4, unit_price_kopecks: 9750 }]);
    assert.equal(orders.summarize(order).subtotal_kopecks, 39000);

    orders.create({ customer_id: 8, lines: [{ product_id: 1, qty: 1 }] }, 1, function (err2) {
      assert.equal(err2.status, 422);
      assert.match(err2.message, /customer 8 is not active/);
      orders.create({ customer_id: 'x', created_at: '2026-02-30', lines: [] }, 1, function (err3) {
        assert.equal(err3.status, 422);
        assert.deepEqual(err3.details, ['customer_id is required', 'created_at must be YYYY-MM-DD']);
        done();
      });
    });
  });
});
