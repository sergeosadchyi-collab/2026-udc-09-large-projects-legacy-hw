var test = require('node:test');
var assert = require('node:assert/strict');
var search = require('../../lib/customers/search');
var merge = require('../../lib/customers/merge');

var customers = [
  { id: 1, name: 'ТОВ «Зелений Кут»', contact_name: 'Ірина', edrpou: '10000001', active: true },
  { id: 2, name: "ТОВ «Кам'яний Міст»", contact_name: 'Юлія', edrpou: '10000011', active: true },
  { id: 3, name: 'ФОП Зеленюк', contact_name: 'Олена', edrpou: '10000107', active: false },
  { id: 4, name: 'ТОВ "Зелений кут"', contact_name: '', edrpou: '10000062', active: true },
  { id: 5, name: 'ТОВ «Старий Двір»', edrpou: '10000011', active: true, merged_into: 2 },
];

function ids(rows) {
  return rows.map(function (r) { return r.id; });
}

test('search is case-insensitive for Ukrainian letters and ignores quotes', function () {
  assert.deepEqual(ids(search.searchByName(customers, 'ЗЕЛЕН')), [1, 4]);
  assert.deepEqual(ids(search.searchByName(customers, 'зелений кут')), [1, 4]);
  assert.deepEqual(ids(search.searchByName(customers, 'зелен', { includeInactive: true })), [1, 4, 3]);
  assert.deepEqual(search.searchByName(customers, '   '), []);
});

test('search: the three apostrophes are the same letter; contact name is a fallback', function () {
  assert.deepEqual(ids(search.searchByName(customers, 'кам’ян')), [2]);
  assert.deepEqual(ids(search.searchByName(customers, 'Камʼяний')), [2]);
  assert.deepEqual(ids(search.searchByName(customers, "кам'яний міст")), [2]);
  assert.deepEqual(ids(search.searchByName(customers, 'юлія')), [2]);
  assert.deepEqual(ids(search.searchByName(customers, 'олена', { includeInactive: true })), [3]);
});

test('planMerge lists the moves and does not touch its input', function () {
  var data = {
    customers: customers,
    orders: [{ id: 10, customer_id: 4 }, { id: 11, customer_id: 1 }, { id: 12, customer_id: 4 }],
    invoices: [{ id: 20, customer_id: 4, status: 'issued' }, { id: 21, customer_id: 4, status: 'paid' }],
  };
  var before = JSON.stringify(data);
  var plan = merge.planMerge(4, 1, data);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.counts, { orders: 2, invoices: 2 });
  assert.deepEqual(plan.changes, [
    { collection: 'orders', id: 10, patch: { customer_id: 1 } },
    { collection: 'orders', id: 12, patch: { customer_id: 1 } },
    { collection: 'invoices', id: 20, patch: { customer_id: 1 } },
    { collection: 'invoices', id: 21, patch: { customer_id: 1 } },
    { collection: 'customers', id: 4, patch: { active: false, merged_into: 1 } },
  ]);
  assert.equal(plan.warnings.length, 2); // different ЄДРПОУ + 1 open invoice
  assert.match(plan.warnings[0], /ЄДРПОУ differ/);
});

test('planMerge refuses nonsense merges', function () {
  var data = { customers: customers, orders: [], invoices: [] };
  function err(s, t) {
    var p = merge.planMerge(s, t, data);
    assert.equal(p.changes.length, 0);
    return p.errors.join('; ');
  }
  assert.match(err(1, 1), /into itself/);
  assert.match(err(99, 1), /source customer 99 not found/);
  assert.match(err(1, 3), /inactive/);
  assert.match(err(1, 5), /merged into 2/);
  assert.match(err(5, 1), /already merged/);
});
