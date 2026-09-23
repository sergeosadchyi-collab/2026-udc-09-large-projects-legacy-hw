'use strict';
/**
 * Catalog: products, price lists, per-product card.
 *
 * Products live in data/products.json, stock in data/stock.json and price
 * changes in data/price_history.json (see ./stock.js and ./price-import.js).
 * Prices are integer kopecks like everywhere else.
 */
var store = require('../store');

/**
 * Price lists are a discount off the base (retail) price.
 * Numbers agreed with sales in 2019; dealer list was added in 2021 for the
 * two regional resellers. Customers do not have a price_list field yet —
 * managers pick the list by hand when they quote.
 */
var PRICE_LISTS = {
  base: { title: 'Роздріб', discount_percent: 0 },
  wholesale: { title: 'Опт', discount_percent: 7 },
  dealer: { title: 'Дилер', discount_percent: 12, round_to: 10 },
};

var HISTORY_ON_CARD = 10;

/**
 * Price of a product in the given list, in kopecks.
 * Dealer prices are rounded DOWN to 10 kopecks — dealers complained about
 * odd kopecks on their invoices (Сергій, 2021). Do not round the others.
 */
function priceFor(product, listCode) {
  var list = PRICE_LISTS[listCode || 'base'];
  if (!list) throw new Error('unknown price list: ' + listCode);
  var p = Math.round((product.price_kopecks * (100 - list.discount_percent)) / 100);
  if (list.round_to) p = Math.floor(p / list.round_to) * list.round_to;
  return p;
}

function allPrices(product) {
  var out = {};
  Object.keys(PRICE_LISTS).forEach(function (code) {
    out[code] = priceFor(product, code);
  });
  return out;
}

function normalizeSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

// sku -> product. Duplicate SKUs should not exist, but products.json was
// edited by hand more than once; the first one wins, like the old admin did.
function indexBySku(products) {
  var map = {};
  products.forEach(function (p) {
    var k = normalizeSku(p.sku);
    if (k && !map[k]) map[k] = p;
  });
  return map;
}

function indexById(rows) {
  var map = {};
  rows.forEach(function (r) {
    map[r.id] = r;
  });
  return map;
}

function matches(product, q) {
  if (!q) return true;
  var needle = String(q).toLowerCase();
  return (
    String(product.title || '').toLowerCase().indexOf(needle) !== -1 ||
    String(product.sku || '').toLowerCase().indexOf(needle) !== -1
  );
}

function shortRow(p) {
  return { id: p.id, sku: p.sku, title: p.title, unit: p.unit, price_kopecks: p.price_kopecks, active: p.active };
}

/**
 * List products for the catalog screen, sorted by title.
 * @param {object} opts  { active: bool|undefined, q: string, priceList: string }
 */
function listProducts(opts, cb) {
  opts = opts || {};
  if (opts.priceList && !PRICE_LISTS[opts.priceList]) {
    return process.nextTick(function () {
      cb(new Error('unknown price list: ' + opts.priceList));
    });
  }
  store.all('products', function (err, rows) {
    if (err) return cb(err);
    var out = rows.filter(function (p) {
      if (opts.active === true && !p.active) return false;
      if (opts.active === false && p.active) return false;
      return matches(p, opts.q);
    });
    out.sort(function (a, b) { return normalizeSku(a.sku) < normalizeSku(b.sku) ? -1 : 1; });
    cb(null, out.map(function (p) {
      var r = shortRow(p);
      if (opts.priceList) {
        r.price_list = opts.priceList;
        r.list_price_kopecks = priceFor(p, opts.priceList);
      }
      return r;
    }));
  });
}

/**
 * Find by numeric id or by SKU ("12" and "SKU-1011" both work — the
 * warehouse scanners send SKUs).
 */
function findProduct(idOrSku, cb) {
  var asNumber = Number(idOrSku);
  if (String(idOrSku).trim() !== '' && !isNaN(asNumber)) return store.find('products', asNumber, cb);
  var sku = normalizeSku(idOrSku);
  store.where('products', function (p) { return normalizeSku(p.sku) === sku; }, function (err, found) {
    if (err) return cb(err);
    cb(null, found[0] || null);
  });
}

function historyFor(productId, historyRows, limit) {
  var mine = historyRows.filter(function (h) { return h.product_id === productId; });
  // newest first; same day -> higher id first
  mine.sort(function (a, b) {
    if (a.changed_at !== b.changed_at) return a.changed_at < b.changed_at ? 1 : -1;
    return b.id - a.id;
  });
  return mine.slice(0, limit || HISTORY_ON_CARD);
}

/**
 * Product card: the product, its price in every list, the stock row and the
 * latest price changes.
 * TODO(2021-06): stock.json has one warehouse per product; when Lviv gets its
 * own stock this has to become an array.
 */
function productCard(idOrSku, cb) {
  findProduct(idOrSku, function (err, product) {
    if (err) return cb(err);
    if (!product) return cb(null, null);
    store.where('stock', function (s) { return s.product_id === product.id; }, function (err2, stockRows) {
      if (err2) return cb(err2);
      store.all('price_history', function (err3, history) {
        if (err3) return cb(err3);
        var card = Object.assign({}, product);
        card.prices = allPrices(product);
        card.stock = stockRows[0] || null;
        card.price_history = historyFor(product.id, history);
        cb(null, card);
      });
    });
  });
}

module.exports = {
  PRICE_LISTS: PRICE_LISTS,
  priceFor: priceFor,
  allPrices: allPrices,
  normalizeSku: normalizeSku,
  indexBySku: indexBySku,
  indexById: indexById,
  listProducts: listProducts,
  findProduct: findProduct,
  historyFor: historyFor,
  productCard: productCard,
};
