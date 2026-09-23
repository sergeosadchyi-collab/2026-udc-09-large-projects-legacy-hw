var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var routes = require('../../lib/customers/routes');
var customers = require('../../lib/customers');

var SEED = path.join(__dirname, '..', '..', 'data');

// fresh copy of the real seed data for every test, so saves never hit data/
function useSeedCopy(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-customers-'));
  ['customers', 'orders', 'invoices', 'payments'].forEach(function (n) {
    fs.copyFileSync(path.join(SEED, n + '.json'), path.join(dir, n + '.json'));
  });
  store.open(dir);
  t.after(function () {
    store.open();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function call(method, routePath, ctx) {
  var route = routes.filter(function (r) { return r.method === method && r.path === routePath; })[0];
  assert.ok(route, 'no route ' + method + ' ' + routePath);
  ctx = Object.assign({ params: {}, query: {}, body: null, staffId: 7 }, ctx);
  return new Promise(function (resolve) {
    route.handler(null, null, ctx, function (err, status, payload) {
      resolve({ status: err ? err.status || 500 : status, payload: err ? { error: err.message } : payload });
    });
  });
}

test('list, search and get work on the seeded customers', async function (t) {
  useSeedCopy(t);
  var r = await call('GET', '/api/customers', {});
  assert.equal(r.status, 200);
  assert.equal(r.payload.length, 11); // id 8 is inactive
  r = await call('GET', '/api/customers', { query: { all: '1' } });
  assert.equal(r.payload.length, 12);
  r = await call('GET', '/api/customers', { query: { q: 'кам’ян' } });
  assert.deepEqual(r.payload.map(function (c) { return c.id; }), [11]);
  r = await call('GET', '/api/customers/:id', { params: { id: '2' } });
  assert.equal(r.status, 200);
  assert.equal(r.payload.name, 'ТОВ «Липовий Цвіт»');
  assert.equal(r.payload.edrpou_checksum_ok, false);
  r = await call('GET', '/api/customers/:id', { params: { id: 'abc' } });
  assert.equal(r.status, 404);
});

test('invoices of a customer come with paid amounts and totals', async function (t) {
  useSeedCopy(t);
  var r = await call('GET', '/api/customers/:id/invoices', { params: { id: '1' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.payload.invoices.map(function (i) { return i.id; }).sort(), [1, 13, 25]);
  var paid = r.payload.invoices.filter(function (i) { return i.id === 1; })[0];
  assert.equal(paid.paid_kopecks, paid.total_kopecks);
  assert.equal(r.payload.totals.count, 3);
  assert.equal(r.payload.totals.outstanding, customers.fmtAmount(r.payload.totals.outstanding_kopecks));
  assert.equal(customers.fmtAmount(579305), '5793.05');
  r = await call('GET', '/api/customers/:id/invoices', { params: { id: '99' } });
  assert.equal(r.status, 404);
});

test('PATCH on a grandfathered customer (failing ЄДРПОУ) still works', async function (t) {
  var dir = useSeedCopy(t);
  var r = await call('PATCH', '/api/customers/:id', { params: { id: '2' }, body: { name: ' ТОВ «Липовий Цвіт Плюс» ', edrpou: '10000002' } });
  assert.equal(r.status, 200);
  assert.equal(r.payload.name, 'ТОВ «Липовий Цвіт Плюс»');
  assert.equal(r.payload.edrpou, '10000002');
  assert.equal(r.payload.updated_by, 7);
  assert.equal('edrpou_unchecked' in r.payload, false);

  r = await call('PATCH', '/api/customers/:id', { params: { id: '2' }, body: { edrpou: '10000003' } });
  assert.equal(r.status, 422);
  assert.equal(r.payload.fields[0].field, 'edrpou');
  r = await call('PATCH', '/api/customers/:id', { params: { id: '2' }, body: { edrpou: '10000003', edrpou_unchecked: true } });
  assert.equal(r.status, 200);
  assert.equal(r.payload.edrpou_unchecked, true);
  r = await call('PATCH', '/api/customers/:id', { params: { id: '2' }, body: { edrpou: '10000107' } });
  assert.equal(r.payload.edrpou_unchecked, false);
  // written to the temp copy, not to data/
  var onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'customers.json'), 'utf8'));
  assert.equal(onDisk[1].edrpou, '10000107');
});

test('POST creates a customer; bad input is 422, a duplicate ЄДРПОУ is 409', async function (t) {
  useSeedCopy(t);
  var r = await call('POST', '/api/customers', { body: null });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/customers', { body: { name: '', edrpou: '123', email: 'x' } });
  assert.equal(r.status, 422);
  assert.deepEqual(r.payload.fields.map(function (f) { return f.field; }).sort(), ['edrpou', 'email', 'name']);
  r = await call('POST', '/api/customers', { body: { name: 'ТОВ «Дублікат»', edrpou: '10000001' } });
  assert.equal(r.status, 409);

  r = await call('POST', '/api/customers', {
    body: { id: 500, name: ' ТОВ «Нова Хвиля» ', edrpou: '1000 0107', email: 'New@Example.invalid', active: false },
  });
  assert.equal(r.status, 201);
  assert.equal(r.payload.id, 13); // client-supplied id is ignored
  assert.equal(r.payload.name, 'ТОВ «Нова Хвиля»');
  assert.equal(r.payload.edrpou, '10000107');
  assert.equal(r.payload.email, 'new@example.invalid');
  assert.equal(r.payload.active, true);
  assert.equal(r.payload.created_by, 7);
  assert.equal('edrpou_unchecked' in r.payload, false);
});

test('deactivation with open invoices needs force=1; activation does not', async function (t) {
  useSeedCopy(t);
  var r = await call('PATCH', '/api/customers/:id', { params: { id: '2' }, body: { active: false } });
  assert.equal(r.status, 409);
  assert.match(r.payload.error, /3 open invoice/);
  r = await call('PATCH', '/api/customers/:id', { params: { id: '2' }, query: { force: '1' }, body: { active: false } });
  assert.equal(r.status, 200);
  assert.equal(r.payload.active, false);
  // id 8 is inactive in the seed data and has open invoices — re-activating is fine
  r = await call('PATCH', '/api/customers/:id', { params: { id: '8' }, body: { active: true } });
  assert.equal(r.status, 200);
  assert.equal(r.payload.active, true);
  r = await call('PATCH', '/api/customers/:id', { params: { id: '404' }, body: { name: 'X' } });
  assert.equal(r.status, 404);
});
