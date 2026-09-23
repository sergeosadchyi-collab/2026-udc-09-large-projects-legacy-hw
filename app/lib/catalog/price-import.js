/**
 * Bulk price update from the purchasing department.
 *
 * They send a text file exported from their Excel, one product per line:
 *
 *   sku;new_price_hrn[;note]
 *   SKU-1000;95,50
 *   SKU-1001;101.00;новий постачальник
 *
 * Prices are in HRYVNIAS (not kopecks), with either a comma or a dot as the
 * decimal mark depending on whose laptop exported the file. The separator
 * is always ';' — a comma is the decimal mark here, never a separator.
 *
 * Every applied change is written to price_history (old -> new, who, when).
 * The caller saves 'products' and 'price_history' (see routes.js).
 */
var store = require('../store');
var catalog = require('./index');

var SEP = ';';
var MAX_LINES = 5000;
// A jump of x10 in either direction almost always means someone typed kopecks
// into the hryvnia column (the April 2021 incident). Needs force=true.
var SUSPICIOUS_RATIO = 10;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// local date, YYYY-MM-DD
function toIsoDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// 9550 -> "95,50" (for the human-readable summary only)
function fmtAmount(kopecks) {
  var sign = kopecks < 0 ? '-' : '';
  var k = Math.abs(kopecks);
  return sign + Math.floor(k / 100) + ',' + pad2(k % 100);
}

/**
 * Legacy hryvnia parser, kept from the old admin panel.
 * Accepts "12,50", "12.50", "12,5", "12", "1 250,00" (Excel puts a
 * non-breaking space between thousands) and a trailing "грн".
 * Returns kopecks, or null if the value is not a price.
 * NB: "1.250,00" is rejected on purpose — we cannot tell which mark is which.
 */
function parseHrn(raw) {
  if (raw === undefined || raw === null) return null;
  var s = String(raw).replace(/[\s\u00a0]/g, '');
  s = s.replace(/грн\.?$/i, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return null;
  // Math.round because 19.99 * 100 === 1998.9999999999998
  return Math.round(parseFloat(s.replace(',', '.')) * 100);
}

function isHeader(cols) {
  return /^(sku|артикул|код)$/i.test(cols[0].trim()) && parseHrn(cols[1]) === null;
}

/**
 * Split the file into rows. Pure, no store access.
 * @returns {{ rows: object[], errors: object[] }}
 *   rows:   { line, sku, price_kopecks, note }
 *   errors: { line, text, reason }
 */
function parsePriceFile(text) {
  var rows = [];
  var errors = [];
  var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > MAX_LINES) {
    errors.push({ line: 0, text: '', reason: 'file has more than ' + MAX_LINES + ' lines' });
    return { rows: rows, errors: errors };
  }
  lines.forEach(function (raw, i) {
    var lineNo = i + 1;
    var line = raw.trim();
    if (!line || line.charAt(0) === '#') return;
    var cols = line.split(SEP);
    if (cols.length < 2) {
      errors.push({ line: lineNo, text: line, reason: 'expected "sku;price"' });
      return;
    }
    if (rows.length === 0 && errors.length === 0 && isHeader(cols)) return;
    var sku = catalog.normalizeSku(cols[0]);
    var kopecks = parseHrn(cols[1]);
    if (!sku) {
      errors.push({ line: lineNo, text: line, reason: 'empty sku' });
    } else if (kopecks === null) {
      errors.push({ line: lineNo, text: line, reason: 'bad price "' + cols[1].trim() + '"' });
    } else if (kopecks === 0) {
      // нульова ціна — це не "безкоштовно", це порожня клітинка в Excel
      errors.push({ line: lineNo, text: line, reason: 'zero price' });
    } else {
      rows.push({ line: lineNo, sku: sku, price_kopecks: kopecks, note: (cols[2] || '').trim() });
    }
  });
  return { rows: rows, errors: errors };
}

function deltaPercent(oldK, newK) {
  if (!oldK) return null;
  return Math.round(((newK - oldK) / oldK) * 1000) / 10;
}

// run fn(item, next) for each item one after another
function eachSeries(items, fn, cb) {
  var i = 0;
  (function next(err) {
    if (err) return cb(err);
    if (i >= items.length) return cb(null);
    fn(items[i++], next);
  })();
}

/**
 * Parse and apply a price file.
 * @param {string} text  file contents
 * @param {object} opts  { staffId, date (YYYY-MM-DD), dryRun, force, source }
 * @param {function} cb  (err, report)
 *
 * Report: { dry_run, date, applied, changes[], unchanged[], skipped[], errors[], summary }
 * Nothing is saved to disk here.
 */
function importPrices(text, opts, cb) {
  opts = opts || {};
  var date = opts.date || toIsoDate();
  var parsed = parsePriceFile(text);
  var report = {
    dry_run: !!opts.dryRun,
    date: date,
    applied: 0,
    changes: [],
    unchanged: [],
    skipped: [],
    errors: parsed.errors,
    summary: '',
  };

  store.all('products', function (err, products) {
    if (err) return cb(err);
    var bySku = catalog.indexBySku(products);

    // the same SKU twice in one file: the last line wins
    var lastLine = {};
    parsed.rows.forEach(function (r) {
      lastLine[r.sku] = r.line;
    });

    parsed.rows.forEach(function (r) {
      if (lastLine[r.sku] !== r.line) {
        report.skipped.push({ line: r.line, sku: r.sku, reason: 'duplicate sku, line ' + lastLine[r.sku] + ' wins' });
        return;
      }
      var product = bySku[r.sku];
      if (!product) {
        report.skipped.push({ line: r.line, sku: r.sku, reason: 'unknown sku' });
        return;
      }
      var oldK = product.price_kopecks;
      if (oldK === r.price_kopecks) {
        report.unchanged.push({ line: r.line, sku: r.sku });
        return;
      }
      var ratio = oldK ? r.price_kopecks / oldK : 1;
      if (!opts.force && (ratio >= SUSPICIOUS_RATIO || ratio <= 1 / SUSPICIOUS_RATIO)) {
        report.skipped.push({
          line: r.line,
          sku: r.sku,
          reason: 'suspicious change ' + fmtAmount(oldK) + ' -> ' + fmtAmount(r.price_kopecks) + ' (use force)',
        });
        return;
      }
      report.changes.push({
        line: r.line,
        product_id: product.id,
        sku: product.sku,
        title: product.title,
        inactive: product.active === false,
        old_price_kopecks: oldK,
        new_price_kopecks: r.price_kopecks,
        delta_percent: deltaPercent(oldK, r.price_kopecks),
        note: r.note,
      });
    });

    report.summary = report.changes.map(function (c) {
      return c.sku + ': ' + fmtAmount(c.old_price_kopecks) + ' -> ' + fmtAmount(c.new_price_kopecks);
    }).join('\n');

    if (report.dry_run || !report.changes.length) return cb(null, report);

    // TODO(2021-04): no rollback if one update fails half-way; the caller just
    // does not save, and the cache is reloaded on restart. Good enough so far.
    eachSeries(report.changes, function (c, next) {
      store.update('products', c.product_id, { price_kopecks: c.new_price_kopecks, price_updated_at: date }, function (err2) {
        if (err2) return next(err2);
        var row = {
          product_id: c.product_id,
          sku: c.sku,
          old_price_kopecks: c.old_price_kopecks,
          new_price_kopecks: c.new_price_kopecks,
          changed_at: date,
          changed_by: opts.staffId || null,
          source: opts.source || 'import',
        };
        if (c.note) row.note = c.note;
        store.insert('price_history', row, function (err3) {
          if (err3) return next(err3);
          report.applied++;
          next();
        });
      });
    }, function (err4) {
      cb(err4 || null, err4 ? undefined : report);
    });
  });
}

module.exports = {
  SUSPICIOUS_RATIO: SUSPICIOUS_RATIO,
  parseHrn: parseHrn,
  parsePriceFile: parsePriceFile,
  importPrices: importPrices,
  fmtAmount: fmtAmount,
  toIsoDate: toIsoDate,
};
