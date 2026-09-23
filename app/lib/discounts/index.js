/**
 * Loyalty discounts ("знижка постійного клієнта").
 *
 * Tiered discount by the customer's revenue over the last 12 months, see
 * tiers.js. Switched on/off by config/features.json -> loyaltyDiscounts.
 *
 * Nothing calls this module at the moment. It was wired into invoicing in
 * v2.x, unhooked in 2023 when accounting objected; kept for the planned
 * comeback. lib/invoices does NOT apply any discount, whatever the flag says.
 */
var fs = require('fs');
var path = require('path');
var store = require('../store');
var tiers = require('./tiers');

var FEATURES_FILE = path.join(__dirname, '..', '..', 'config', 'features.json');

// customers created before this date stay on the old (2017) programme
var LEGACY_BEFORE = '2019-01-01';

var IGNORED_STATUSES = ['cancelled', 'draft'];

function readFeatures() {
  // read on every call on purpose: ops flip the flag on the box without a restart
  try {
    return JSON.parse(fs.readFileSync(FEATURES_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function isEnabled(features) {
  var f = features || readFeatures();
  return f.loyaltyDiscounts === true;
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

// 2026-03-15 -> 2025-03-15. Only ever compared as a string,
// so 2024-02-29 -> "2023-02-29" is harmless.
function yearAgo(iso) {
  return String(Number(iso.slice(0, 4)) - 1) + iso.slice(4);
}

function isLegacyCustomer(customer) {
  if (!customer || !customer.created_at) return false;
  return customer.created_at < LEGACY_BEFORE;
}

/**
 * Revenue in the window (asOf - 12 months, asOf].
 * Standard mode counts the subtotal (no VAT). Legacy mode counts the total WITH
 * VAT, because that is what v1 did and the old contracts were signed on it.
 * Cancelled and draft invoices are ignored; unpaid ones count.
 */
function revenue12m(invoices, customerId, asOfIso, legacy) {
  var since = yearAgo(asOfIso);
  var sum = 0;
  invoices.forEach(function (inv) {
    if (inv.customer_id !== customerId) return;
    if (IGNORED_STATUSES.indexOf(inv.status) !== -1) return;
    if (!inv.issued_at || inv.issued_at <= since || inv.issued_at > asOfIso) return;
    sum += legacy ? inv.total_kopecks || 0 : inv.subtotal_kopecks || 0;
  });
  return sum;
}

/**
 * Discount on an amount in kopecks.
 * Standard: half-up to a kopeck. Legacy: rounded DOWN to whole hryvnias — v1
 * printed the discount line without kopecks and the old customers are used to it.
 * vatRate is unused since 2.3 (discount goes on the subtotal, before VAT).
 */
function applyDiscount(amountKopecks, percent, legacy, vatRate) {
  var d;
  if (!percent) d = 0;
  else if (legacy) d = Math.floor((amountKopecks * percent) / 10000) * 100;
  else d = Math.round((amountKopecks * percent) / 100);
  return { discount_kopecks: d, net_kopecks: amountKopecks - d };
}

/**
 * Work out a customer's loyalty discount as of a date.
 * @param {object} customer  row from customers.json
 * @param {Array}  invoices  invoices (any customer; filtered here)
 * @param {string} asOfIso   YYYY-MM-DD, defaults to today
 * @param {object} [opts]    { features } — override config/features.json (tests, dry runs)
 */
function discountFor(customer, invoices, asOfIso, opts) {
  opts = opts || {};
  asOfIso = asOfIso || toIsoDate(new Date());
  var result = {
    customer_id: customer ? customer.id : null,
    enabled: isEnabled(opts.features),
    mode: null,
    as_of: asOfIso,
    since: yearAgo(asOfIso),
    revenue_kopecks: 0,
    tier: 'none',
    percent: 0,
    next: null,
  };
  if (!result.enabled || !customer) return result;
  if (customer.active === false) {
    result.reason = 'inactive';
    return result;
  }

  var legacy = isLegacyCustomer(customer);
  result.mode = legacy ? 'legacy' : 'standard';
  result.revenue_kopecks = revenue12m(invoices || [], customer.id, asOfIso, legacy);

  if (legacy) {
    // стара програма: гарантовані 3% навіть без оборотів, не чіпати без бухгалтерії
    var lt = tiers.tierFor(result.revenue_kopecks, tiers.LEGACY);
    result.tier = lt.code;
    result.percent = lt.percent;
    result.next = tiers.toNextTier(result.revenue_kopecks, tiers.LEGACY);
    return result;
  }

  var t = tiers.tierFor(result.revenue_kopecks, tiers.STANDARD);
  result.tier = t.code;
  result.percent = t.percent;
  result.next = tiers.toNextTier(result.revenue_kopecks, tiers.STANDARD);
  return result;
}

// local copy of the money format from the v2 invoice template: "14 379,00 грн"
function fmtAmount(kopecks) {
  var neg = kopecks < 0;
  var abs = Math.abs(kopecks);
  var kop = String(abs % 100);
  if (kop.length < 2) kop = '0' + kop;
  var uah = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + uah + ',' + kop + ' грн';
}

function describe(result) {
  if (!result || !result.percent) return '';
  return 'Знижка постійного клієнта ' + result.percent + '% (оборот за 12 міс.: ' + fmtAmount(result.revenue_kopecks) + ')';
}

/**
 * The negative invoice line v2.x appended to an invoice (see
 * invoices.issueFromOrder — the discount line goes before VAT).
 * Returns null when there is nothing to discount.
 */
function discountLine(result, subtotalKopecks) {
  if (!result || !result.percent) return null;
  var a = applyDiscount(subtotalKopecks, result.percent, result.mode === 'legacy');
  if (!a.discount_kopecks) return null;
  return { title: describe(result), qty: 1, unit_price_kopecks: -a.discount_kopecks };
}

function forCustomer(customerId, asOfIso, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  store.find('customers', customerId, function (err, customer) {
    if (err) return cb(err);
    if (!customer) return cb(new Error('customer ' + customerId + ' not found'));
    store.where('invoices', function (i) { return i.customer_id === customerId; }, function (err2, rows) {
      if (err2) return cb(err2);
      cb(null, discountFor(customer, rows, asOfIso, opts));
    });
  });
}

/**
 * "Who would get what" — the table accounting asked for in 2023 before the
 * unhook. Active customers only, biggest discount first.
 */
function previewAll(asOfIso, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  store.all('customers', function (err, customers) {
    if (err) return cb(err);
    store.all('invoices', function (err2, invoices) {
      if (err2) return cb(err2);
      var rows = customers
        .filter(function (c) { return c.active !== false; })
        .map(function (c) {
          var r = discountFor(c, invoices, asOfIso, opts);
          r.name = c.name;
          r.label = describe(r);
          return r;
        });
      rows.sort(function (a, b) {
        return b.percent - a.percent || b.revenue_kopecks - a.revenue_kopecks;
      });
      cb(null, rows);
    });
  });
}

module.exports = {
  LEGACY_BEFORE: LEGACY_BEFORE,
  isEnabled: isEnabled,
  isLegacyCustomer: isLegacyCustomer,
  yearAgo: yearAgo,
  revenue12m: revenue12m,
  applyDiscount: applyDiscount,
  discountFor: discountFor,
  describe: describe,
  discountLine: discountLine,
  forCustomer: forCustomer,
  previewAll: previewAll,
};
