/**
 * Order lines: validation against the product catalog and price snapshots.
 *
 * A line in orders.json looks like
 *   { product_id, title, qty, unit_price_kopecks }
 * lib/invoices copies title / qty / unit_price_kopecks onto the invoice, so do
 * not rename these fields.
 */

// у старому експорті в 1С кількість була 4-значна, більше ніхто не просив
var MAX_QTY = 9999;

function indexById(rows) {
  var map = {};
  (rows || []).forEach(function (r) {
    map[r.id] = r;
  });
  return map;
}

function toInt(v) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return typeof v === 'number' && Number.isInteger(v) ? v : NaN;
}

/**
 * Validate raw lines from a request against products.json.
 *
 * Returns { errors: [...], lines: [...] }. `lines` are only meaningful when
 * errors is empty. Prices come from the product at order time — clients used to
 * send unit_price_kopecks themselves (the 2019 desktop app did), we ignore that
 * field now. The snapshot is what gets invoiced even if the catalog price
 * changes afterwards.
 *
 * Duplicate product ids are allowed on purpose: the warehouse wants separate
 * lines when a customer adds more of the same item later (see seed order #3).
 */
function validateLines(rawLines, products, today) {
  var errors = [];
  var out = [];
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { errors: ['order must have at least one line'], lines: [] };
  }
  var byId = indexById(products);

  rawLines.forEach(function (raw, i) {
    var n = i + 1;
    if (!raw || typeof raw !== 'object') {
      errors.push('line ' + n + ': not an object');
      return;
    }
    var productId = toInt(raw.product_id);
    var qty = toInt(raw.qty);
    var product = byId[productId];

    if (isNaN(productId)) {
      errors.push('line ' + n + ': product_id is required');
      return;
    }
    if (!product) {
      errors.push('line ' + n + ': unknown product ' + productId);
      return;
    }
    if (product.active === false) {
      errors.push('line ' + n + ': product ' + product.sku + ' is not active');
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      errors.push('line ' + n + ': qty must be a positive whole number');
      return;
    }
    if (qty > MAX_QTY) {
      errors.push('line ' + n + ': qty over ' + MAX_QTY + ', split the order');
      return;
    }
    if (typeof product.price_kopecks !== 'number' || product.price_kopecks <= 0) {
      // should not happen, catalog rejects it — but the 2020 import had zeros
      errors.push('line ' + n + ': product ' + product.sku + ' has no price');
      return;
    }
    out.push(snapshot(product, qty));
  });

  return { errors: errors, lines: out };
}

function snapshot(product, qty) {
  return {
    product_id: product.id,
    title: product.title,
    qty: qty,
    unit_price_kopecks: product.price_kopecks,
  };
}

function lineAmount(line) {
  return line.qty * line.unit_price_kopecks;
}

/**
 * Order subtotal in kopecks, WITHOUT VAT.
 * VAT belongs to invoices (lib/invoices totals(), rounded on the subtotal) —
 * do not add it here, or invoices and orders will disagree by exactly the VAT.
 * TODO(2021): sales keep asking for a gross column on the order screen; if we do
 * it, call invoices.totals() instead of copying the VAT math.
 */
function subtotal(lines) {
  var sum = 0;
  (lines || []).forEach(function (l) {
    sum += lineAmount(l);
  });
  return sum;
}

module.exports = {
  MAX_QTY: MAX_QTY,
  validateLines: validateLines,
  snapshot: snapshot,
  lineAmount: lineAmount,
  subtotal: subtotal,
};
