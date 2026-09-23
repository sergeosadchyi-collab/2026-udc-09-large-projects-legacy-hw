/**
 * Catalog endpoints: products, price import, low stock.
 */
var store = require('../store');
var catalog = require('./index');
var stock = require('./stock');
var priceImport = require('./price-import');
var httpError = require('../http/router').httpError;

// ~ 5000 lines of "SKU-XXXX;1234,56" is well under this
var MAX_IMPORT_CHARS = 200000;

function flag(v) {
  if (v === undefined || v === '') return undefined;
  return v === '1' || v === 'true' || v === 'yes';
}

// GET /api/products?active=1&q=папір&price_list=wholesale
function list(req, res, ctx, done) {
  var q = ctx.query || {};
  var priceList = q.price_list;
  if (priceList && !catalog.PRICE_LISTS[priceList]) {
    return done(httpError(400, 'unknown price_list, expected one of: ' + Object.keys(catalog.PRICE_LISTS).join(', ')));
  }
  catalog.listProducts({ active: flag(q.active), q: q.q, priceList: priceList }, function (err, rows) {
    if (err) return done(err);
    done(null, 200, rows);
  });
}

// GET /api/products/:id  (id or SKU)
function one(req, res, ctx, done) {
  catalog.productCard(ctx.params.id, function (err, card) {
    if (err) return done(err);
    if (!card) return done(httpError(404, 'not found'));
    done(null, 200, card);
  });
}

/**
 * POST /api/products/price-import
 * body: { text: "sku;price\n...", dry_run: true|false, force: true|false }
 * The UI always does a dry run first and shows the report, then posts again.
 */
function importPrices(req, res, ctx, done) {
  var body = ctx.body || {};
  if (typeof body.text !== 'string' || !body.text.trim()) {
    return done(httpError(400, 'text is required'));
  }
  if (body.text.length > MAX_IMPORT_CHARS) return done(httpError(400, 'file too large'));
  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return done(httpError(400, 'date must be YYYY-MM-DD'));

  var opts = {
    staffId: ctx.staffId,
    dryRun: body.dry_run === true,
    force: body.force === true,
    source: 'import',
    date: body.date, // undocumented, used by support to back-date a correction
  };
  priceImport.importPrices(body.text, opts, function (err, report) {
    if (err) return done(err);
    var nothing = !report.changes.length && !report.unchanged.length && !report.skipped.length;
    if (nothing && report.errors.length) return done(null, 422, report);
    if (report.dry_run || !report.applied) return done(null, 200, report);
    store.save('products', function (err2) {
      if (err2) return done(err2);
      store.save('price_history', function (err3) {
        if (err3) return done(err3);
        done(null, 200, report);
      });
    });
  });
}

// GET /api/stock/low?warehouse=KYIV-1&include_inactive=1
function low(req, res, ctx, done) {
  var q = ctx.query || {};
  var opts = {
    today: priceImport.toIsoDate(),
    warehouse: q.warehouse || null,
    includeInactive: flag(q.include_inactive) === true,
  };
  stock.lowStockReport(opts, function (err, rows) {
    if (err) return done(err);
    done(null, 200, { generated_at: opts.today, count: rows.length, rows: rows });
  });
}

module.exports = [
  { method: 'GET', path: '/api/products', handler: list },
  { method: 'GET', path: '/api/products/:id', handler: one },
  { method: 'POST', path: '/api/products/price-import', handler: importPrices },
  { method: 'GET', path: '/api/stock/low', handler: low },
];
