var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var routes = require('../../lib/catalog/routes');

var DATA = path.join(__dirname, '..', '..', 'data');

// copy of the seeded collections, so nothing writes into data/
function seededStore() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-catalog-routes-'));
  ['products', 'stock', 'price_history', 'orders'].forEach(function (name) {
    fs.copyFileSync(path.join(DATA, name + '.json'), path.join(dir, name + '.json'));
  });
  store.open(dir);
  return dir;
}

function handler(method, p) {
  for (var i = 0; i < routes.length; i++) {
    if (routes[i].method === method && routes[i].path === p) return routes[i].handler;
  }
  throw new Error('no route ' + method + ' ' + p);
}

function call(method, p, ctx, cb) {
  var full = Object.assign({ params: {}, query: {}, body: null, staffId: 3 }, ctx);
  handler(method, p)(null, null, full, cb);
}

test('GET /api/products filters and adds the price list; card by id or SKU', function (t, done) {
  seededStore();
  call('GET', '/api/products', { query: { active: '1', q: 'а4', price_list: 'wholesale' } }, function (err0, status, rows) {
    assert.ifError(err0);
    assert.equal(status, 200);
    assert.deepEqual(
      rows.map(function (r) { return [r.sku, r.list_price_kopecks]; }),
      [['SKU-1000', 8370], ['SKU-1006', 14183], ['SKU-1019', 3953]],
    );
    // card: by SKU (any case), with stock, prices per list and history
    call('GET', '/api/products/:id', { params: { id: 'sku-1002' } }, function (err, status2, card) {
      assert.ifError(err);
      assert.equal(card.id, 3);
      assert.equal(card.stock.product_id, 3);
      assert.equal(card.prices.dealer, 12100);
      assert.ok(card.price_history.length >= 1);
      assert.equal(card.price_history[0].new_price_kopecks, card.price_kopecks);
      call('GET', '/api/products/:id', { params: { id: '404' } }, function (err2) {
        store.open();
        assert.equal(err2.status, 404);
        done();
      });
    });
  });
});

test('POST /api/products/price-import saves products and history to disk', function (t, done) {
  var dir = seededStore();
  var body = { text: 'sku;price\nSKU-1000;95,50\nSKU-1001;9,50\nSKU-1019;42.50\n' };
  call('POST', '/api/products/price-import', { body: body, staffId: 12 }, function (err, status, report) {
    store.open();
    assert.ifError(err);
    assert.equal(status, 200);
    assert.equal(report.applied, 1);
    assert.equal(report.skipped.length, 1); // 95,00 -> 9,50 is a x10 drop
    assert.equal(report.unchanged.length, 1);
    var products = JSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8'));
    var history = JSON.parse(fs.readFileSync(path.join(dir, 'price_history.json'), 'utf8'));
    assert.equal(products[0].price_kopecks, 9550);
    var last = history[history.length - 1];
    assert.equal(last.sku, 'SKU-1000');
    assert.equal(last.changed_by, 12);
    done();
  });
});

test('bad input: unknown price list, empty or unparseable import, bad date', function (t, done) {
  seededStore();
  call('GET', '/api/products', { query: { price_list: 'vip' } }, function (err0) {
    assert.equal(err0.status, 400);
    call('POST', '/api/products/price-import', { body: {} }, function (err) {
      assert.equal(err.status, 400);
      call('POST', '/api/products/price-import', { body: { text: 'garbage\n' } }, function (err2, status, report) {
        assert.ifError(err2);
        assert.equal(status, 422);
        assert.equal(report.errors.length, 1);
        call('POST', '/api/products/price-import', { body: { text: 'SKU-1000;1', date: '23.09.2026' } }, function (err3) {
          store.open();
          assert.equal(err3.status, 400);
          done();
        });
      });
    });
  });
});

test('GET /api/stock/low works on the seeded data', function (t, done) {
  seededStore();
  call('GET', '/api/stock/low', {}, function (err, status, payload) {
    store.open();
    assert.ifError(err);
    assert.equal(payload.count, payload.rows.length);
    assert.ok(payload.count > 0);
    payload.rows.forEach(function (r) {
      assert.ok(r.available <= r.reorder_level);
      assert.notEqual(r.sku, 'SKU-1013'); // inactive
    });
    done();
  });
});
