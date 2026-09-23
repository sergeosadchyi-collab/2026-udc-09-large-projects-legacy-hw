var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var routes = require('../../lib/orders/routes');

var DATA = path.join(__dirname, '..', '..', 'data');

function tmpStore() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-orders-routes-'));
  ['customers', 'products', 'orders'].forEach(function (name) {
    fs.copyFileSync(path.join(DATA, name + '.json'), path.join(dir, name + '.json'));
  });
  store.open(dir);
  return dir;
}

// call a route handler the way the router does, without a server
function call(method, p, ctx) {
  var r = routes.filter(function (x) { return x.method === method && x.path === p; })[0];
  assert.ok(r, 'route ' + method + ' ' + p);
  var full = Object.assign({ params: {}, query: {}, body: null, staffId: 4 }, ctx);
  return new Promise(function (resolve) {
    r.handler(null, null, full, function (err, status, payload) {
      if (err) return resolve({ status: err.status || 500, error: err.message });
      resolve({ status: status, body: payload });
    });
  });
}

test.after(function () {
  store.open();
});

test('GET /api/orders and /api/orders/:id on seed data', async function () {
  tmpStore();
  assert.equal(routes.length, 4);
  var r = await call('GET', '/api/orders', { query: { status: 'invoiced', customer_id: '1' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.length > 0);
  r.body.forEach(function (o) {
    assert.equal(o.customer_id, 1);
    assert.match(o.number, /^ORD-2026-\d{4}$/);
  });
  for (var i = 1; i < r.body.length; i++) assert.ok(r.body[i - 1].created_at >= r.body[i].created_at);
  assert.equal((await call('GET', '/api/orders', { query: { status: 'lost' } })).status, 400);
  assert.equal((await call('GET', '/api/orders', { query: { from: '03/01/2026' } })).status, 400);

  var one = await call('GET', '/api/orders/:id', { params: { id: '2' } });
  assert.equal(one.body.number, 'ORD-2026-0002');
  assert.deepEqual(one.body.next_statuses, ['shipped']);
  assert.equal(one.body.lines[0].amount_kopecks, 5 * 15250);
  assert.equal(one.body.subtotal_kopecks, 5 * 15250 + 19 * 2750);
  assert.equal((await call('GET', '/api/orders/:id', { params: { id: '999' } })).status, 404);
  assert.equal((await call('GET', '/api/orders/:id', { params: { id: 'abc' } })).status, 400);
});

test('POST /api/orders creates and persists, then the status route walks it', async function () {
  var dir = tmpStore();
  var created = await call('POST', '/api/orders', { body: { customer_id: 3, created_at: '2026-05-10', lines: [{ product_id: 9, qty: 2 }] } });
  assert.equal(created.status, 201);
  assert.equal(created.body.number, 'ORD-2026-0037');
  assert.equal(created.body.subtotal_kopecks, 17500);
  var onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'orders.json'), 'utf8'));
  assert.equal(onDisk.length, 37);
  assert.equal(onDisk[36].created_by, 4);
  assert.equal((await call('POST', '/api/orders', { body: null })).status, 400);
  var bad = await call('POST', '/api/orders', { body: { customer_id: 3, lines: [{ product_id: 9, qty: -1 }] } });
  assert.equal(bad.status, 422);

  var p = '/api/orders/:id/status';
  var id = String(created.body.id);
  assert.equal((await call('POST', p, { params: { id: id }, body: { status: 'confirmed' } })).body.status, 'confirmed');
  var noReason = await call('POST', p, { params: { id: id }, body: { status: 'cancelled' } });
  assert.equal(noReason.status, 409);
  assert.match(noReason.error, /reason is required/);
  var cancelled = await call('POST', p, { params: { id: id }, body: { status: 'cancelled', reason: 'customer closed the office' } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.cancel_reason, 'customer closed the office');
  assert.equal(cancelled.body.status_history.length, 2);
  assert.equal(cancelled.body.status_history[1].staff_id, 4);
  assert.equal((await call('POST', p, { params: { id: id }, body: { status: 'new' } })).status, 409);
});

test('status route refuses to set invoiced by hand and rejects junk', async function () {
  tmpStore();
  var p = '/api/orders/:id/status';
  var r = await call('POST', p, { params: { id: '1' }, body: { status: 'invoiced' } });
  assert.equal(r.status, 409);
  assert.match(r.error, /POST \/api\/orders\/:id\/invoice/);
  assert.equal((await call('POST', p, { params: { id: '1' }, body: null })).status, 400);
  assert.equal((await call('POST', p, { params: { id: '1' }, body: { status: 'paid' } })).status, 400);
  assert.equal((await call('POST', p, { params: { id: '1' }, body: { status: 'shipped', reason: 42 } })).status, 400);
  assert.equal((await call('POST', p, { params: { id: '404' }, body: { status: 'shipped' } })).status, 404);
});
