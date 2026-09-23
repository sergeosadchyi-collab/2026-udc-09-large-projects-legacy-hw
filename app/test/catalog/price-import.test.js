var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var priceImport = require('../../lib/catalog/price-import');

var PRODUCTS = [
  { id: 1, sku: 'SKU-1000', title: 'Папір А4, пачка', unit: 'уп', price_kopecks: 9000, active: true },
  { id: 2, sku: 'SKU-1001', title: 'Картридж чорний', unit: 'шт', price_kopecks: 9500, active: true },
  { id: 3, sku: 'SKU-1002', title: 'Степлер', unit: 'шт', price_kopecks: 13750, active: true },
  { id: 14, sku: 'SKU-1013', title: 'Блок для нотаток', unit: 'шт', price_kopecks: 14250, active: false },
];

function tmpStore(collections) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-catalog-'));
  Object.keys(collections).forEach(function (name) {
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(collections[name]));
  });
  store.open(dir);
  return dir;
}

function run(text, opts, cb) {
  tmpStore({ products: PRODUCTS, price_history: [{ id: 7, product_id: 1, old_price_kopecks: 8500, new_price_kopecks: 9000, changed_at: '2025-03-17' }] });
  priceImport.importPrices(text, opts, function (err, report) {
    if (err) {
      store.open();
      return cb(err);
    }
    store.all('products', function (err2, products) {
      store.all('price_history', function (err3, history) {
        store.open();
        cb(err2 || err3, report, products, history);
      });
    });
  });
}

test('applies changes and records history with who and when', function (t, done) {
  var text = 'SKU-1000;95,50\nSKU-1001;101.00;новий постачальник\nSKU-1013;150,00\n';
  run(text, { staffId: 7, date: '2026-09-20' }, function (err, report, products, history) {
    assert.ifError(err);
    assert.equal(report.applied, 3);
    assert.equal(products[0].price_kopecks, 9550);
    assert.equal(products[0].price_updated_at, '2026-09-20');
    assert.equal(products[1].price_kopecks, 10100);
    // inactive products are updated too, but flagged in the report
    assert.equal(products[3].price_kopecks, 15000);
    assert.deepEqual(report.changes.map(function (c) { return c.inactive; }), [false, false, true]);
    assert.equal(history.length, 4);
    assert.deepEqual(history[1], {
      id: 8,
      product_id: 1,
      sku: 'SKU-1000',
      old_price_kopecks: 9000,
      new_price_kopecks: 9550,
      changed_at: '2026-09-20',
      changed_by: 7,
      source: 'import',
    });
    assert.equal(history[2].note, 'новий постачальник');
    assert.equal(report.changes[0].delta_percent, 6.1);
    assert.equal(report.summary, 'SKU-1000: 90,00 -> 95,50\nSKU-1001: 95,00 -> 101,00\nSKU-1013: 142,50 -> 150,00');
    done();
  });
});

test('dry run reports but changes nothing', function (t, done) {
  run('SKU-1000;95,50\n', { dryRun: true, date: '2026-09-20' }, function (err, report, products, history) {
    assert.ifError(err);
    assert.equal(report.dry_run, true);
    assert.equal(report.changes.length, 1);
    assert.equal(report.applied, 0);
    assert.equal(products[0].price_kopecks, 9000);
    assert.equal(history.length, 1);
    done();
  });
});

test('unknown, unchanged and duplicate SKUs are reported, last duplicate wins', function (t, done) {
  var text = 'SKU-1002;140\nSKU-9999;10,00\nSKU-1001;95,00\nSKU-1002;141,00\n';
  run(text, { date: '2026-09-20' }, function (err, report, products) {
    assert.ifError(err);
    assert.deepEqual(report.skipped, [
      { line: 1, sku: 'SKU-1002', reason: 'duplicate sku, line 4 wins' },
      { line: 2, sku: 'SKU-9999', reason: 'unknown sku' },
    ]);
    assert.deepEqual(report.unchanged, [{ line: 3, sku: 'SKU-1001' }]);
    assert.equal(products[2].price_kopecks, 14100);
    done();
  });
});

test('x10 jumps are held back unless forced (kopecks typed as hryvnias)', function (t, done) {
  run('SKU-1000;9000\n', { date: '2026-09-20' }, function (err, report, products) {
    assert.ifError(err);
    assert.equal(report.applied, 0);
    assert.match(report.skipped[0].reason, /suspicious change 90,00 -> 9000,00/);
    assert.equal(products[0].price_kopecks, 9000);
    run('SKU-1000;9000\n', { date: '2026-09-20', force: true }, function (err2, report2, products2) {
      assert.ifError(err2);
      assert.equal(report2.applied, 1);
      assert.equal(products2[0].price_kopecks, 900000);
      done();
    });
  });
});
