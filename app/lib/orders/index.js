/**
 * Orders: creation, numbering, listing.
 *
 * Status changes live in ./status.js, line validation in ./lines.js.
 * Invoices are issued by lib/invoices — never from here.
 */
var store = require('../store');
var lines = require('./lines');
var status = require('./status');

var NUMBER_RE = /^ORD-(\d{4})-(\d{4,})$/;

// same idea as invoices' zero padding, but 4 digits for orders
function pad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

// YYYY-MM-DD in UTC. Local copy on purpose, orders should not depend on the
// rendering helpers.
function toIsoDate(d) {
  d = d || new Date();
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2);
}

function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ORD-2026-0042
function orderNumber(year, seq) {
  return 'ORD-' + year + '-' + pad(seq, 4);
}

/**
 * Orders created before v3.2 have no `number`. Accounting already quotes them
 * as ORD-<year>-<id>, so we derive the same thing instead of migrating the file.
 */
function legacyNumber(order) {
  var year = (order.created_at || '').slice(0, 4) || '0000';
  return orderNumber(year, order.id);
}

function numberOf(order) {
  return order.number || legacyNumber(order);
}

/**
 * Next sequence for the year. Legacy (unnumbered) orders count with their id,
 * otherwise the first numbered order of a year would reuse ORD-YYYY-0001.
 */
function nextSeq(orders, year) {
  var max = 0;
  orders.forEach(function (o) {
    var m = NUMBER_RE.exec(numberOf(o));
    if (m && Number(m[1]) === year && Number(m[2]) > max) max = Number(m[2]);
  });
  return max + 1;
}

/**
 * Short form for lists. Totals are WITHOUT VAT — see lines.subtotal().
 */
function summarize(order) {
  return {
    id: order.id,
    number: numberOf(order),
    customer_id: order.customer_id,
    created_at: order.created_at,
    status: order.status,
    lines_count: (order.lines || []).length,
    subtotal_kopecks: lines.subtotal(order.lines),
  };
}

/**
 * Full form for GET /api/orders/:id. Adds per-line amounts and what the order
 * can move to next, so the (old) order screen can show the right buttons.
 */
function detail(order) {
  var out = Object.assign({}, order);
  out.number = numberOf(order);
  out.lines = (order.lines || []).map(function (l) {
    return Object.assign({}, l, { amount_kopecks: lines.lineAmount(l) });
  });
  out.subtotal_kopecks = lines.subtotal(order.lines);
  out.vat_note = 'VAT is calculated on the invoice';
  out.next_statuses = status.allowedFrom(order.status);
  if (!out.status_history) out.status_history = [];
  return out;
}

/**
 * filter: { status, customer_id, from, to }  (dates inclusive, YYYY-MM-DD)
 */
function list(filter, cb) {
  filter = filter || {};
  var customerId = filter.customer_id ? Number(filter.customer_id) : null;
  store.where('orders', function (o) {
    if (filter.status && o.status !== filter.status) return false;
    if (customerId && o.customer_id !== customerId) return false;
    if (filter.from && o.created_at < filter.from) return false;
    if (filter.to && o.created_at > filter.to) return false;
    return true;
  }, function (err, rows) {
    if (err) return cb(err);
    // newest first; ties by id so seed orders with equal dates stay stable
    rows.sort(function (a, b) {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return b.id - a.id;
    });
    cb(null, rows);
  });
}

function validationError(messages) {
  var e = new Error(messages.join('; '));
  e.status = 422;
  e.details = messages;
  return e;
}

/**
 * Create an order in status 'new'.
 *
 * input: { customer_id, lines: [{ product_id, qty }], created_at?, comment? }
 * Calls back with (err, order). Validation problems come back as an error with
 * status 422 and .details. Does not save — caller calls store.save('orders').
 *
 * This grew from 20 lines in 2018. Split it when you touch it next.
 */
function create(input, staffId, cb) {
  input = input || {};
  var customerId = Number(input.customer_id);
  var createdAt = input.created_at || toIsoDate();
  var problems = [];

  if (!Number.isInteger(customerId) || customerId <= 0) problems.push('customer_id is required');
  if (!isIsoDate(createdAt)) problems.push('created_at must be YYYY-MM-DD');
  if (input.comment != null && typeof input.comment !== 'string') problems.push('comment must be a string');
  if (problems.length) return process.nextTick(function () { cb(validationError(problems)); });

  store.find('customers', customerId, function (err, customer) {
    if (err) return cb(err);
    if (!customer) return cb(validationError(['unknown customer ' + customerId]));
    // inactive = contract ended; they must sign a new one before ordering again
    if (customer.active === false) return cb(validationError(['customer ' + customerId + ' is not active']));

    store.all('products', function (err2, products) {
      if (err2) return cb(err2);
      var checked = lines.validateLines(input.lines, products, createdAt);
      if (checked.errors.length) return cb(validationError(checked.errors));

      store.all('orders', function (err3, orders) {
        if (err3) return cb(err3);
        var year = Number(createdAt.slice(0, 4));
        var row = {
          number: orderNumber(year, nextSeq(orders, year)),
          customer_id: customerId,
          created_at: createdAt,
          created_by: staffId || null,
          status: 'new',
          lines: checked.lines,
          status_history: [],
        };
        if (input.comment) row.comment = input.comment.trim().slice(0, 500);
        store.insert('orders', row, cb);
      });
    });
  });
}

module.exports = {
  orderNumber: orderNumber,
  legacyNumber: legacyNumber,
  numberOf: numberOf,
  nextSeq: nextSeq,
  toIsoDate: toIsoDate,
  isIsoDate: isIsoDate,
  summarize: summarize,
  detail: detail,
  list: list,
  create: create,
  subtotal: lines.subtotal,
  status: status,
};
