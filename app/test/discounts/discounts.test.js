var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var discounts = require('../../lib/discounts');

var ON = { features: { loyaltyDiscounts: true } };
var AS_OF = '2026-03-31';

var oldCustomer = { id: 1, name: 'ТОВ «Зелений Кут»', created_at: '2017-01-10', active: true };
var newCustomer = { id: 3, name: 'ФОП Приклад-1', created_at: '2019-03-12', active: true };

var invoices = [
  { id: 1, customer_id: 3, issued_at: '2026-03-03', status: 'issued', subtotal_kopecks: 600000, total_kopecks: 720000 },
  { id: 2, customer_id: 3, issued_at: '2025-03-31', status: 'paid', subtotal_kopecks: 900000, total_kopecks: 1080000 },
  { id: 3, customer_id: 3, issued_at: '2025-04-01', status: 'paid', subtotal_kopecks: 400000, total_kopecks: 480000 },
  { id: 4, customer_id: 3, issued_at: '2026-03-10', status: 'cancelled', subtotal_kopecks: 5000000, total_kopecks: 6000000 },
  { id: 5, customer_id: 3, issued_at: '2026-04-01', status: 'issued', subtotal_kopecks: 5000000, total_kopecks: 6000000 },
  { id: 6, customer_id: 3, issued_at: '2026-03-20', status: 'draft', subtotal_kopecks: 100000, total_kopecks: 120000 },
  { id: 7, customer_id: 1, issued_at: '2026-03-01', status: 'issued', subtotal_kopecks: 750000, total_kopecks: 900000 },
];

test('legacy cutoff is 2019-01-01; yearAgo keeps the day', function () {
  assert.equal(discounts.isLegacyCustomer({ created_at: '2018-12-31' }), true);
  assert.equal(discounts.isLegacyCustomer({ created_at: '2019-01-01' }), false);
  assert.equal(discounts.isLegacyCustomer({}), false);
  assert.equal(discounts.yearAgo('2026-03-31'), '2025-03-31');
  assert.equal(discounts.yearAgo('2024-02-29'), '2023-02-29');
});

test('revenue12m: window, statuses and VAT basis', function () {
  // window is (2025-03-31, 2026-03-31]; cancelled, draft and future invoices are out
  assert.equal(discounts.revenue12m(invoices, 3, AS_OF, false), 1000000);
  // legacy mode counts totals with VAT
  assert.equal(discounts.revenue12m(invoices, 3, AS_OF, true), 1200000);
  assert.equal(discounts.revenue12m(invoices, 1, AS_OF, true), 900000);
  assert.equal(discounts.revenue12m(invoices, 99, AS_OF, false), 0);
});

test('applyDiscount: kopeck half-up vs legacy whole hryvnias', function () {
  assert.deepEqual(discounts.applyDiscount(123456, 3), { discount_kopecks: 3704, net_kopecks: 119752 });
  assert.deepEqual(discounts.applyDiscount(123456, 3, true), { discount_kopecks: 3700, net_kopecks: 119756 });
  assert.deepEqual(discounts.applyDiscount(123456, 0), { discount_kopecks: 0, net_kopecks: 123456 });
});

test('shipped config keeps loyalty discounts switched off', function () {
  assert.equal(discounts.isEnabled(), false);
  assert.equal(discounts.isEnabled({ loyaltyDiscounts: true }), true);
  var r = discounts.discountFor(newCustomer, invoices, AS_OF);
  assert.equal(r.enabled, false);
  assert.equal(r.percent, 0);
  assert.equal(r.mode, null);
});

test('discountFor: standard vs legacy customers, inactive get nothing', function () {
  var std = discounts.discountFor(newCustomer, invoices, AS_OF, ON);
  assert.equal(std.mode, 'standard');
  assert.equal(std.tier, 'silver');
  assert.equal(std.percent, 3);
  assert.deepEqual(std.next, { code: 'gold', percent: 5, missing_kopecks: 1500000 });

  var old = discounts.discountFor(oldCustomer, invoices, AS_OF, ON);
  assert.equal(old.mode, 'legacy');
  assert.equal(old.revenue_kopecks, 900000);
  assert.equal(old.tier, 'legacy-base');
  assert.equal(old.percent, 3);

  var gone = discounts.discountFor(Object.assign({}, newCustomer, { active: false }), invoices, AS_OF, ON);
  assert.equal(gone.percent, 0);
  assert.equal(gone.reason, 'inactive');
});

test('discountLine: negative line with a readable title', function () {
  var r = discounts.discountFor(newCustomer, invoices, AS_OF, ON);
  var line = discounts.discountLine(r, 482750);
  assert.equal(line.qty, 1);
  assert.equal(line.unit_price_kopecks, -14483);
  assert.equal(line.title, 'Знижка постійного клієнта 3% (оборот за 12 міс.: 10 000,00 грн)');
  assert.equal(discounts.discountLine({ percent: 0 }, 482750), null);
});

test('forCustomer reads customers and invoices from the store', function (t, done) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-discounts-'));
  fs.writeFileSync(path.join(dir, 'customers.json'), JSON.stringify([oldCustomer, newCustomer]));
  fs.writeFileSync(path.join(dir, 'invoices.json'), JSON.stringify(invoices));
  store.open(dir);
  discounts.forCustomer(3, AS_OF, ON, function (err, r) {
    assert.ifError(err);
    assert.equal(r.customer_id, 3);
    assert.equal(r.revenue_kopecks, 1000000);
    discounts.forCustomer(42, AS_OF, function (err2) {
      assert.match(err2.message, /customer 42 not found/);
      store.open();
      done();
    });
  });
});
