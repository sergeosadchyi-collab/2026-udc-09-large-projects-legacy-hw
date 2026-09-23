var test = require('node:test');
var assert = require('node:assert/strict');
var matcher = require('../../lib/payments/matcher');

function data() {
  return {
    customers: [
      { id: 1, name: 'ТОВ «Зелений Кут»', edrpou: '10000001' },
      { id: 2, name: 'ТОВ «Липовий Цвіт»', edrpou: '10000002' },
    ],
    invoices: [
      { id: 1, number: 'INV-2026-00001', customer_id: 1, total_kopecks: 10000, status: 'paid' },
      { id: 2, number: 'INV-2026-00002', customer_id: 1, total_kopecks: 20000, status: 'issued' },
      { id: 3, number: 'INV-2026-00003', customer_id: 2, total_kopecks: 30000, status: 'issued' },
      { id: 4, number: 'INV-2026-00004', customer_id: 2, total_kopecks: 30000, status: 'issued' },
      { id: 5, number: 'INV-2026-00005', customer_id: 1, total_kopecks: 5000, status: 'cancelled' },
    ],
    payments: [{ id: 1, invoice_id: 1, amount_kopecks: 10000, paid_at: '2026-03-01', method: 'card' }],
    unmatched: [],
  };
}

var seq = 0;
function entry(amount, purpose, extra) {
  seq++;
  return Object.assign(
    { line: seq, date: '2026-03-10', direction: 'CR', amount_kopecks: amount, payer_edrpou: null, payer_name: 'X', bank_ref: 'R' + seq, purpose: purpose },
    extra || {},
  );
}

function plan(entries, d) {
  return matcher.planPayments({ header: {}, entries: entries }, d || data(), { today: '2026-03-20' });
}

test('extractInvoiceRefs tolerates the usual ways people write the number', function () {
  var ex = matcher.extractInvoiceRefs;
  assert.deepEqual(ex('Оплата INV-2026-00007'), ['INV-2026-00007']);
  assert.deepEqual(ex('INV 2026 00007'), ['INV-2026-00007']);
  assert.deepEqual(ex('за рах. inv-2026-7, ПДВ'), ['INV-2026-00007']);
  assert.deepEqual(ex('рах.INV/2026/00009 та inv2026-17'), ['INV-2026-00009', 'INV-2026-00017']);
  assert.deepEqual(ex('INV-2026-00004 (inv-2026-4)'), ['INV-2026-00004']);
  assert.deepEqual(ex('договір 17/2019, без ПДВ'), []);
  assert.deepEqual(ex('INV-2026-0000123'), [], 'too many digits is not a number we issue');
});

test('payment by invoice number closes the invoice and does not touch the input rows', function () {
  var d = data();
  var before = JSON.parse(JSON.stringify(d));
  var p = plan([entry(20000, 'Оплата INV-2026-00002')], d);
  assert.deepEqual(d, before);
  assert.equal(p.decisions[0].outcome, 'matched');
  assert.equal(p.payments.length, 1);
  assert.equal(p.payments[0].invoice_id, 2);
  assert.equal(p.payments[0].method, 'bank');
  assert.deepEqual(p.invoiceUpdates, [{ id: 2, number: 'INV-2026-00002', patch: { status: 'paid', paid_at: '2026-03-10' } }]);
});

test('partial payment, then the rest later in the same statement', function () {
  var p = plan([entry(5000, 'аванс INV-2026-00002'), entry(15000, 'доплата inv-2026-2')]);
  assert.deepEqual(p.decisions.map(function (x) { return x.outcome; }), ['partial', 'matched']);
  assert.equal(p.invoiceUpdates.length, 1);
  assert.equal(p.invoiceUpdates[0].id, 2);
});

test('overpayment becomes customer credit', function () {
  var p = plan([entry(25000, 'INV-2026-00002', { payer_edrpou: '10000001' })]);
  assert.equal(p.decisions[0].outcome, 'overpaid');
  assert.equal(p.payments[0].amount_kopecks, 20000);
  assert.deepEqual(p.credits.map(function (c) { return [c.customer_id, c.amount_kopecks, c.reason]; }), [[1, 5000, 'overpayment']]);
  assert.equal(p.totals.credit_kopecks, 5000);
});

test('one transfer for two invoices is split in the order they are named', function () {
  var p = plan([entry(35000, 'рахунки INV-2026-00003, INV-2026-00002')]);
  assert.deepEqual(p.payments.map(function (x) { return [x.invoice_id, x.amount_kopecks]; }), [[3, 30000], [2, 5000]]);
  assert.equal(p.decisions[0].outcome, 'partial');
});

test('amount fallback: unique match only, payer narrows it down', function () {
  var p = plan([
    entry(20000, 'оплата за товар'),
    entry(30000, 'оплата'),
    entry(30000, 'оплата', { payer_edrpou: '10000001' }),
  ]);
  assert.equal(p.decisions[0].outcome, 'matched');
  assert.equal(p.payments[0].matched_by, 'amount');
  assert.equal(p.decisions[1].outcome, 'unmatched');
  assert.match(p.decisions[1].detail, /ambiguous_amount/);
  // customer 1 has no open 300.00 invoice; customer 2's invoices are not theirs to pay by amount
  assert.match(p.decisions[2].detail, /^no_match/);
  assert.equal(p.unmatched.length, 2);
});

test('paid, cancelled and unknown invoices go to the unmatched queue', function () {
  var p = plan([entry(10000, 'INV-2026-00001'), entry(5000, 'INV-2026-00005'), entry(777, 'INV-2026-00099')]);
  var reasons = p.unmatched.map(function (u) { return u.reason; });
  assert.deepEqual(reasons, ['invoice_not_open', 'invoice_not_open', 'unknown_invoice']);
  assert.equal(p.unmatched[0].status, 'open');
  assert.equal(p.unmatched[0].queued_at, '2026-03-20');
  assert.equal(p.payments.length, 0);
});

test('debits and already imported bank refs are skipped', function () {
  var d = data();
  d.payments.push({ id: 2, invoice_id: 3, amount_kopecks: 100, paid_at: '2026-03-02', method: 'bank', bank_ref: 'OLD1' });
  d.unmatched.push({ id: 1, bank_ref: 'OLD2', amount_kopecks: 1, status: 'open' });
  var p = plan(
    [
      entry(500, 'Комісія банку', { direction: 'DR' }),
      entry(20000, 'INV-2026-00002', { bank_ref: 'OLD1' }),
      entry(20000, 'INV-2026-00002', { bank_ref: 'OLD2' }),
      entry(20000, 'INV-2026-00002', { bank_ref: 'NEW1' }),
      entry(20000, 'INV-2026-00002', { bank_ref: 'NEW1' }),
    ],
    d,
  );
  assert.deepEqual(p.decisions.map(function (x) { return x.outcome; }), ['skipped', 'skipped', 'skipped', 'matched', 'skipped']);
  assert.equal(p.payments.length, 1);
});
