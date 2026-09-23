var test = require('node:test');
var assert = require('node:assert/strict');
var reports = require('../../lib/reports');

function inv(id, customerId, status, issuedAt, subtotal, extra) {
  var vat = Math.round(subtotal * 0.2);
  return Object.assign(
    {
      id: id,
      number: 'INV-T-' + id,
      customer_id: customerId,
      status: status,
      issued_at: issuedAt,
      due_at: issuedAt, // due dates only matter for days_overdue
      vat_rate: 20,
      subtotal_kopecks: subtotal,
      vat_kopecks: vat,
      total_kopecks: subtotal + vat,
    },
    extra,
  );
}

var customers = [
  { id: 1, name: 'ТОВ «Тестовий Ліс»', edrpou: '10000901' },
  { id: 2, name: 'ФОП Тест-2', edrpou: '10000902' },
];

var invoices = [
  inv(1, 1, 'issued', '2026-01-10', 10000),
  inv(2, 2, 'paid', '2026-01-20', 50000),
  inv(3, 1, 'cancelled', '2026-01-25', 99900),
  inv(4, 1, 'draft', '2026-03-05', 77700),
  inv(5, 2, 'issued', '2026-03-01', 20000),
  inv(6, 3, 'issued', '2025-11-15', 30000),
];

var payments = [
  { id: 1, invoice_id: 2, amount_kopecks: 60000, paid_at: '2026-02-05' },
  { id: 2, invoice_id: 5, amount_kopecks: 10000, paid_at: '2026-03-10' },
];

test('revenue: skips cancelled and drafts, fills empty months with zeros', function () {
  var r = reports.revenueByMonth(invoices);
  assert.deepEqual(
    r.rows.map(function (x) { return [x.month, x.invoices, x.net_kopecks]; }),
    [['2025-11', 1, 30000], ['2025-12', 0, 0], ['2026-01', 2, 60000], ['2026-02', 0, 0], ['2026-03', 1, 20000]],
  );
  assert.equal(r.rows[2].label, 'січень 2026');
  assert.deepEqual(r.totals, { invoices: 4, net_kopecks: 110000, vat_kopecks: 22000, gross_kopecks: 132000 });

  var ranged = reports.revenueByMonth(invoices, { from: '2026-01', to: '2026-02' });
  assert.deepEqual(ranged.rows.map(function (x) { return x.month; }), ['2026-01', '2026-02']);
  assert.equal(ranged.totals.gross_kopecks, 72000);
});

test('aging: buckets by age from issue date, partial payments reduce the debt', function () {
  var a = reports.aging(invoices, payments, customers, '2026-03-31');
  var byNumber = {};
  a.rows.forEach(function (r) { byNumber[r.number] = r; });

  assert.equal(byNumber['INV-T-2'], undefined, 'paid before as_of');
  assert.equal(byNumber['INV-T-3'], undefined, 'cancelled');
  assert.equal(byNumber['INV-T-4'], undefined, 'draft');
  assert.equal(byNumber['INV-T-5'].age_days, 30);
  assert.equal(byNumber['INV-T-5'].bucket, '0-30');
  assert.equal(byNumber['INV-T-5'].outstanding_kopecks, 14000);
  assert.equal(byNumber['INV-T-1'].bucket, '61-90');
  assert.equal(byNumber['INV-T-6'].bucket, '90+');
  assert.equal(byNumber['INV-T-6'].customer, '#3');
  assert.deepEqual(a.rows.map(function (r) { return r.number; }), ['INV-T-6', 'INV-T-1', 'INV-T-5']);
  assert.deepEqual(a.buckets.map(function (b) { return b.amount_kopecks; }), [14000, 0, 12000, 36000]);
  assert.equal(a.total_kopecks, 62000);
});

test('aging: bucket edges are 30/31, 60/61, 90/91 days', function () {
  var asOf = '2026-06-30';
  var edge = [30, 31, 60, 61, 90, 91].map(function (days, i) {
    var d = new Date(Date.UTC(2026, 5, 30 - days)).toISOString().slice(0, 10);
    return inv(100 + i, 1, 'issued', d, 1000);
  });
  var a = reports.aging(edge, [], customers, asOf);
  var got = {};
  a.rows.forEach(function (r) { got[r.age_days] = r.bucket; });
  assert.deepEqual(got, { 30: '0-30', 31: '31-60', 60: '31-60', 61: '61-90', 90: '61-90', 91: '90+' });
});

test('aging as of an earlier date; hand-marked paid invoices', function () {
  var a = reports.aging(invoices, payments, customers, '2026-01-31');
  assert.deepEqual(a.rows.map(function (r) { return r.number; }).sort(), ['INV-T-1', 'INV-T-2', 'INV-T-6']);
  var two = a.rows.filter(function (r) { return r.number === 'INV-T-2'; })[0];
  assert.equal(two.outstanding_kopecks, 60000);
  assert.equal(two.customer, 'ФОП Тест-2');

  // marked paid by hand, no payment rows at all: trust the status
  var old = [inv(1, 1, 'paid', '2020-05-01', 10000), inv(2, 1, 'issued', '2020-05-01', 10000)];
  var b = reports.aging(old, [], customers, '2020-06-01');
  assert.deepEqual(b.rows.map(function (r) { return r.invoice_id; }), [2]);
});

test('top customers: ranked by net revenue, share in percent, unknown customers labelled', function () {
  var t = reports.topCustomers(invoices, customers);
  assert.deepEqual(t.rows.map(function (r) { return r.customer_id; }), [2, 3, 1]);
  assert.equal(t.rows[0].net_kopecks, 70000);
  assert.equal(t.rows[0].share_pct, 63.6);
  assert.equal(t.rows[1].name, '#3 (видалений)');
  assert.equal(t.rows[1].edrpou, null);
  assert.equal(t.total_net_kopecks, 110000);
  assert.equal(reports.topCustomers(invoices, customers, { limit: 1 }).rows.length, 1);
});

test('VAT summary: per month and rate, flags hand-typed VAT', function () {
  var list = invoices.concat([inv(7, 1, 'issued', '2026-03-20', 10000, { vat_kopecks: 1999, total_kopecks: 11999 })]);
  var v = reports.vatSummary(list, { from: '2026-03' });
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].label, 'березень 2026');
  assert.equal(v.rows[0].invoices, 2);
  assert.equal(v.rows[0].base_kopecks, 30000);
  assert.equal(v.rows[0].vat_kopecks, 5999);
  assert.equal(v.totals.diff_kopecks, -1);
});
