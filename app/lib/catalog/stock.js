/**
 * Stock levels (data/stock.json) and the low-stock report for purchasing.
 *
 * One row per product:
 *   { id, product_id, warehouse, qty_on_hand, qty_reserved, reorder_level, updated_at }
 * The warehouse team updates qty_on_hand after the monthly count; the rest of
 * the month it drifts. qty_reserved is typed in by the warehouse as well.
 */
var store = require('../store');
var catalog = require('./index');

// a count older than this is shown as "stale" in the report
var STALE_AFTER_DAYS = 45;

function daysBetween(fromIso, toIso) {
  var a = Date.parse(fromIso + 'T00:00:00Z');
  var b = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/**
 * Quantity reserved by confirmed (not yet invoiced) orders, per product_id.
 * TODO(2021-11): ask the warehouse whether their qty_reserved already
 * includes these. Until then we subtract both, better to reorder early.
 */
function reservedByOrders(orders) {
  var out = {};
  (orders || []).forEach(function (o) {
    if (o.status !== 'confirmed') return;
    (o.lines || []).forEach(function (l) {
      if (!l.product_id) return;
      out[l.product_id] = (out[l.product_id] || 0) + (Number(l.qty) || 0);
    });
  });
  return out;
}

function available(row, extraReserved) {
  return (row.qty_on_hand || 0) - (row.qty_reserved || 0) - (extraReserved || 0);
}

/**
 * Build the low-stock report. Pure.
 * @param {object[]} stockRows
 * @param {object} productsById
 * @param {object} reserved      product_id -> qty, see reservedByOrders()
 * @param {object} opts          { today, warehouse, includeInactive }
 * @returns {object[]} rows sorted by shortfall, biggest first
 */
function lowStock(stockRows, productsById, reserved, opts) {
  opts = opts || {};
  var out = [];
  stockRows.forEach(function (s) {
    var p = productsById[s.product_id];
    if (!p) return; // orphan rows from products deleted in 2020
    if (!opts.includeInactive && p.active === false) return;
    if (opts.warehouse && s.warehouse !== opts.warehouse) return;
    var inOrders = reserved[s.product_id] || 0;
    var avail = available(s, inOrders);
    if (avail > s.reorder_level) return;
    out.push({
      product_id: p.id,
      sku: p.sku,
      title: p.title,
      unit: p.unit,
      warehouse: s.warehouse,
      qty_on_hand: s.qty_on_hand,
      qty_reserved: s.qty_reserved,
      qty_in_orders: inOrders,
      available: avail,
      reorder_level: s.reorder_level,
      shortfall: s.reorder_level - avail,
      counted_at: s.updated_at,
      stale: opts.today ? daysBetween(s.updated_at, opts.today) > STALE_AFTER_DAYS : false,
    });
  });
  return out.sort(function (a, b) {
    if (b.shortfall !== a.shortfall) return b.shortfall - a.shortfall;
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  });
}

/**
 * Loads stock, products and orders and builds the report.
 */
function lowStockReport(opts, cb) {
  store.all('stock', function (err, stockRows) {
    if (err) return cb(err);
    store.all('products', function (err2, products) {
      if (err2) return cb(err2);
      store.all('orders', function (err3, orders) {
        if (err3) return cb(err3);
        var rows = lowStock(stockRows, catalog.indexById(products), reservedByOrders(orders), opts);
        cb(null, rows);
      });
    });
  });
}

module.exports = {
  STALE_AFTER_DAYS: STALE_AFTER_DAYS,
  reservedByOrders: reservedByOrders,
  available: available,
  lowStock: lowStock,
  lowStockReport: lowStockReport,
};
