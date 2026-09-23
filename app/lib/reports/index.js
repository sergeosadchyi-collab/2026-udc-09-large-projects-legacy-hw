/**
 * Management reports: revenue by month, receivables aging, top customers,
 * VAT summary.
 *
 * Everything here is a pure function over arrays of rows, so the monthly cron
 * and the HTTP endpoints share it. Loading goes through loadAll() below.
 * Amounts are integer kopecks, like everywhere else.
 */
var store = require('../store');
var dates = require('./dates');

// Drafts never left the building, cancelled ones were reversed by accounting.
var EXCLUDED_STATUSES = ['cancelled', 'draft'];

var AGING_BUCKETS = [
  { key: '0-30', label: '0–30', max: 30 },
  { key: '31-60', label: '31–60', max: 60 },
  { key: '61-90', label: '61–90', max: 90 },
  { key: '90+', label: '90+', max: Infinity },
];

var DEFAULT_TOP_LIMIT = 10;

function countable(inv) {
  return EXCLUDED_STATUSES.indexOf(inv.status) === -1;
}

// from / to are month keys (YYYY-MM), both optional and inclusive
function inRange(iso, opts) {
  var m = dates.monthKey(iso);
  if (opts && opts.from && m < opts.from) return false;
  if (opts && opts.to && m > opts.to) return false;
  return true;
}

function selectInvoices(invoices, opts) {
  return invoices.filter(function (inv) {
    return countable(inv) && inRange(inv.issued_at, opts);
  });
}

/**
 * Load several collections, callback gets them in the same order.
 * loadAll(['invoices', 'customers'], function (err, invoices, customers) {...})
 */
function loadAll(names, cb) {
  var out = [];
  var i = 0;
  (function next() {
    if (i === names.length) return cb.apply(null, [null].concat(out));
    store.all(names[i], function (err, rows) {
      if (err) return cb(err);
      out.push(rows);
      i++;
      next();
    });
  })();
}

// works on an invoice row and on an already aggregated month row
function addRevenue(acc, inv) {
  acc.invoices += inv.invoices === undefined ? 1 : inv.invoices;
  acc.net_kopecks += inv.subtotal_kopecks === undefined ? inv.net_kopecks : inv.subtotal_kopecks;
  acc.vat_kopecks += inv.vat_kopecks;
  acc.gross_kopecks += inv.total_kopecks === undefined ? inv.gross_kopecks : inv.total_kopecks;
  return acc;
}

/**
 * Revenue per calendar month of issue. Empty months between the first and the
 * last one are filled with zeros, otherwise the chart in the old dashboard
 * skipped them and February looked like a great month.
 */
function revenueByMonth(invoices, opts) {
  opts = opts || {};
  var byMonth = {};
  selectInvoices(invoices, opts).forEach(function (inv) {
    var key = dates.monthKey(inv.issued_at);
    byMonth[key] = addRevenue(byMonth[key] || { month: key, label: dates.monthName(key), invoices: 0, net_kopecks: 0, vat_kopecks: 0, gross_kopecks: 0 }, inv);
  });
  var keys = Object.keys(byMonth).sort();
  var first = opts.from || keys[0];
  var last = opts.to || keys[keys.length - 1];
  var rows = [];
  var totals = { invoices: 0, net_kopecks: 0, vat_kopecks: 0, gross_kopecks: 0 };
  for (var k = first; k && k <= last; k = dates.addMonths(k, 1)) {
    var r = byMonth[k] || { month: k, label: dates.monthName(k), invoices: 0, net_kopecks: 0, vat_kopecks: 0, gross_kopecks: 0 };
    rows.push(r);
    addRevenue(totals, r);
  }
  return { report: 'revenue', from: first || null, to: last || null, rows: rows, totals: totals };
}

function bucketIndex(ageDays) {
  for (var i = 0; i < AGING_BUCKETS.length; i++) {
    if (ageDays <= AGING_BUCKETS[i].max) return i;
  }
  return AGING_BUCKETS.length - 1;
}

/**
 * Receivables aging as of a date.
 *
 * Age is counted from issued_at, NOT from due_at — accounting wants it the
 * way the old accounting system's report did it (2019). days_overdue is in the rows for whoever
 * needs the other view.
 *
 * "Unpaid" is computed from payments up to as_of, so an aging for last
 * month-end still shows invoices that were paid after it.
 */
function aging(invoices, payments, customers, asOf) {
  var paidByInvoice = {};
  var hasPayments = {};
  (payments || []).forEach(function (p) {
    hasPayments[p.invoice_id] = true;
    if (p.paid_at > asOf) return;
    paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + p.amount_kopecks;
  });
  var names = {};
  (customers || []).forEach(function (c) {
    names[c.id] = c.name;
  });

  var buckets = AGING_BUCKETS.map(function (b) {
    return { key: b.key, label: b.label, invoices: 0, amount_kopecks: 0 };
  });
  var rows = [];
  var total = 0;

  invoices.forEach(function (inv) {
    if (!countable(inv)) return;
    if (inv.issued_at > asOf) return; // did not exist yet
    // Invoices marked paid by hand before the payments table existed (2020)
    // have no payment rows at all. Trust the status for those.
    if (inv.status === 'paid' && !hasPayments[inv.id]) return;
    var outstanding = inv.total_kopecks - (paidByInvoice[inv.id] || 0);
    if (outstanding <= 0) return;

    var age = dates.daysBetween(inv.issued_at, asOf);
    var overdue = dates.daysBetween(inv.due_at, asOf);
    var b = bucketIndex(age);
    buckets[b].invoices++;
    buckets[b].amount_kopecks += outstanding;
    total += outstanding;
    rows.push({
      invoice_id: inv.id,
      number: inv.number,
      customer_id: inv.customer_id,
      customer: names[inv.customer_id] || '#' + inv.customer_id,
      issued_at: inv.issued_at,
      due_at: inv.due_at,
      age_days: age,
      days_overdue: overdue > 0 ? overdue : 0,
      bucket: AGING_BUCKETS[b].key,
      outstanding_kopecks: outstanding,
    });
  });

  // oldest debt first, that is what people call about
  rows.sort(function (a, b) {
    return b.age_days - a.age_days || (a.number < b.number ? -1 : a.number > b.number ? 1 : 0);
  });
  return { report: 'aging', as_of: asOf, buckets: buckets, rows: rows, total_kopecks: total };
}

/**
 * Customers ranked by net revenue (without VAT). Limit defaults to 5.
 */
function topCustomers(invoices, customers, opts) {
  opts = opts || {};
  var limit = opts.limit || DEFAULT_TOP_LIMIT;
  var byId = {};
  (customers || []).forEach(function (c) {
    byId[c.id] = c;
  });
  var agg = {};
  var grand = 0;
  selectInvoices(invoices, opts).forEach(function (inv) {
    var a = agg[inv.customer_id] || (agg[inv.customer_id] = { customer_id: inv.customer_id, invoices: 0, net_kopecks: 0, gross_kopecks: 0 });
    a.invoices++;
    a.net_kopecks += inv.subtotal_kopecks;
    a.gross_kopecks += inv.total_kopecks;
    grand += inv.subtotal_kopecks;
  });
  var rows = Object.keys(agg)
    .map(function (id) { return agg[id]; })
    .sort(function (a, b) {
      return b.net_kopecks - a.net_kopecks || a.customer_id - b.customer_id;
    })
    .slice(0, limit)
    .map(function (a, i) {
      var c = byId[a.customer_id];
      return {
        rank: i + 1,
        customer_id: a.customer_id,
        name: c ? c.name : '#' + a.customer_id + ' (видалений)',
        edrpou: c ? c.edrpou : null,
        invoices: a.invoices,
        net_kopecks: a.net_kopecks,
        gross_kopecks: a.gross_kopecks,
        share_pct: grand ? Math.round((a.net_kopecks * 1000) / grand) / 10 : 0,
      };
    });
  return { report: 'top-customers', from: opts.from || null, to: opts.to || null, limit: limit, rows: rows, total_net_kopecks: grand };
}

/**
 * VAT per month and rate. diff_kopecks is stored VAT minus VAT recomputed from
 * the subtotal — should be 0; invoices imported from the old system in 2019
 * had VAT typed in by hand, and this is how accounting finds them.
 *
 * TODO(2021-04): tax point should be the first event (payment or shipment),
 * not issued_at. Accounting says it is "fine for now".
 */
function vatSummary(invoices, opts) {
  var groups = {};
  selectInvoices(invoices, opts).forEach(function (inv) {
    var rate = inv.vat_rate == null ? 20 : inv.vat_rate;
    var month = dates.monthKey(inv.issued_at);
    var id = month + '|' + rate;
    var g = groups[id] || (groups[id] = { month: month, label: dates.monthName(month), vat_rate: rate, invoices: 0, base_kopecks: 0, vat_kopecks: 0, diff_kopecks: 0 });
    g.invoices++;
    g.base_kopecks += inv.subtotal_kopecks;
    g.vat_kopecks += inv.vat_kopecks;
    g.diff_kopecks += inv.vat_kopecks - Math.round((inv.subtotal_kopecks * rate) / 100);
  });
  var rows = Object.keys(groups)
    .sort()
    .map(function (id) {
      return groups[id];
    });
  var totals = { base_kopecks: 0, vat_kopecks: 0, diff_kopecks: 0 };
  rows.forEach(function (r) {
    totals.base_kopecks += r.base_kopecks;
    totals.vat_kopecks += r.vat_kopecks;
    totals.diff_kopecks += r.diff_kopecks;
  });
  return { report: 'vat', from: (opts && opts.from) || null, to: (opts && opts.to) || null, rows: rows, totals: totals };
}

module.exports = {
  EXCLUDED_STATUSES: EXCLUDED_STATUSES,
  AGING_BUCKETS: AGING_BUCKETS,
  loadAll: loadAll,
  revenueByMonth: revenueByMonth,
  aging: aging,
  topCustomers: topCustomers,
  vatSummary: vatSummary,
};
