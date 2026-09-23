var test = require('node:test');
var assert = require('node:assert/strict');
var invoices = require('../lib/invoices');
var render = require('../lib/invoices/render');

var customer = { id: 1, name: 'ТОВ «Зелений Кут»', edrpou: '10000001' };
var invoice = {
  number: 'INV-2026-00007',
  issued_at: '2026-03-09',
  due_at: '2026-03-23',
  vat_rate: 20,
  subtotal_kopecks: 100000,
  vat_kopecks: 20000,
  total_kopecks: 120000,
  lines: [{ title: 'Папір А4, пачка', qty: 4, unit_price_kopecks: 25000 }],
};

test('totals: VAT on the subtotal, rounded half-up', function () {
  var t = invoices.totals([{ qty: 3, unit_price_kopecks: 3333 }], 20);
  assert.deepEqual(t, { subtotal_kopecks: 9999, vat_kopecks: 2000, total_kopecks: 11999 });
});

test('invoiceNumber is zero-padded', function () {
  assert.equal(invoices.invoiceNumber(2026, 42), 'INV-2026-00042');
});

test('due date is 14 days after issue', function () {
  assert.equal(invoices.addDays('2026-03-09', invoices.PAYMENT_TERM_DAYS), '2026-03-23');
});

test('isOverdue ignores paid and cancelled', function () {
  assert.equal(invoices.isOverdue({ status: 'issued', due_at: '2026-03-01' }, '2026-03-02'), true);
  assert.equal(invoices.isOverdue({ status: 'paid', due_at: '2026-03-01' }, '2026-03-02'), false);
  assert.equal(invoices.isOverdue({ status: 'cancelled', due_at: '2026-03-01' }, '2026-03-02'), false);
});

test('rendered invoice shows number, customer, dates and totals', function () {
  var html = render.renderInvoiceHtml(invoice, customer);
  assert.match(html, /Рахунок-фактура № INV-2026-00007/);
  assert.match(html, /ЄДРПОУ 10000001/);
  assert.match(html, /Дата: <b>03\/09\/2026<\/b>/);
  assert.match(html, /Сплатити до: <b>03\/23\/2026<\/b>/);
  assert.match(html, /До сплати: 1 200,00 грн/);
});

test('rendered invoice escapes HTML in customer names', function () {
  var html = render.renderInvoiceHtml(invoice, { name: '<script>x</script>' });
  assert.ok(html.indexOf('<script>x') === -1);
});
