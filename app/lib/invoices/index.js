/**
 * Invoices: issuing from an order, totals, numbering.
 */
var store = require('../store');

var VAT_RATE = 20; // percent
var PAYMENT_TERM_DAYS = 14;

function addDays(iso, days) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * VAT is computed on the subtotal and rounded half-up to a kopeck.
 * (Accounting asked for this in 2018 — do not "fix" to per-line VAT.)
 */
function totals(lines, vatRate) {
  var subtotal = 0;
  lines.forEach(function (l) {
    subtotal += l.qty * l.unit_price_kopecks;
  });
  var vat = Math.round((subtotal * vatRate) / 100);
  return { subtotal_kopecks: subtotal, vat_kopecks: vat, total_kopecks: subtotal + vat };
}

// INV-2026-00042
function invoiceNumber(year, seq) {
  var s = String(seq);
  while (s.length < 5) s = '0' + s;
  return 'INV-' + year + '-' + s;
}

function nextSeq(invoices, year) {
  var max = 0;
  invoices.forEach(function (inv) {
    var m = /^INV-(\d{4})-(\d{5})$/.exec(inv.number || '');
    if (m && Number(m[1]) === year && Number(m[2]) > max) max = Number(m[2]);
  });
  return max + 1;
}

/**
 * Issue an invoice for an order.
 * @param {object} order   row from orders.json (with .lines)
 * @param {string} issuedAt YYYY-MM-DD
 */
function issueFromOrder(order, issuedAt, cb) {
  store.all('invoices', function (err, invoices) {
    if (err) return cb(err);
    var year = Number(issuedAt.slice(0, 4));
    var t = totals(order.lines, VAT_RATE);
    var inv = {
      number: invoiceNumber(year, nextSeq(invoices, year)),
      order_id: order.id,
      customer_id: order.customer_id,
      issued_at: issuedAt,
      due_at: addDays(issuedAt, PAYMENT_TERM_DAYS),
      vat_rate: VAT_RATE,
      subtotal_kopecks: t.subtotal_kopecks,
      vat_kopecks: t.vat_kopecks,
      total_kopecks: t.total_kopecks,
      status: 'issued',
      lines: order.lines.map(function (l) {
        return { title: l.title, qty: l.qty, unit_price_kopecks: l.unit_price_kopecks };
      }),
    };
    store.insert('invoices', inv, cb);
  });
}

function isOverdue(invoice, todayIso) {
  return invoice.status !== 'paid' && invoice.status !== 'cancelled' && invoice.due_at < todayIso;
}

module.exports = {
  VAT_RATE: VAT_RATE,
  PAYMENT_TERM_DAYS: PAYMENT_TERM_DAYS,
  totals: totals,
  invoiceNumber: invoiceNumber,
  issueFromOrder: issueFromOrder,
  isOverdue: isOverdue,
  addDays: addDays,
};
