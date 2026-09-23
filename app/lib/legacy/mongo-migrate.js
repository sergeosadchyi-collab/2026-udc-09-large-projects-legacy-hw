#!/usr/bin/env node
/**
 * ONE-OFF, 2020-11: MongoDB -> data/*.json, run once during the move off the
 * old VM. Kept for reference ("what if we have to redo it").
 *
 * Input is mongoexport output, one Extended JSON document per line:
 *   mongoexport --db billing --collection invoices --out dump/invoices.json
 *
 *   node lib/legacy/mongo-migrate.js dump/ [--out data/] [--force]
 *
 * - ObjectId -> sequential integer id per collection (ordered by createdAt)
 * - refs (customerId, productId, orderId, invoiceId) remapped the same way
 * - $date -> YYYY-MM-DD in Kyiv time (Mongo stored UTC, invoices issued after
 *   22:00 used to show the previous day)
 * - Decimal128 hryvnias -> integer kopecks; camelCase -> snake_case
 * - anything not listed in MAPPERS is dropped (okpo, source, __v, ...)
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ORDER = ['customers', 'products', 'orders', 'invoices', 'payments'];
var TZ = 'Europe/Kiev'; // needs full-icu on Node 12, we ran it with --icu-data-dir

// ---- Extended JSON ---------------------------------------------------------

function unwrap(v) {
  if (Array.isArray(v)) return v.map(unwrap);
  if (v === null || typeof v !== 'object') return v;
  if ('$oid' in v) return String(v.$oid);
  if ('$date' in v) {
    var d = v.$date;
    if (d && typeof d === 'object' && '$numberLong' in d) return new Date(Number(d.$numberLong));
    return new Date(d);
  }
  if ('$numberDecimal' in v) return { decimal: String(v.$numberDecimal) };
  if ('$numberLong' in v || '$numberInt' in v || '$numberDouble' in v) {
    return Number(v.$numberLong || v.$numberInt || v.$numberDouble);
  }
  var out = {};
  Object.keys(v).forEach(function (k) { out[k] = unwrap(v[k]); });
  return out;
}

function readDump(file) {
  if (!fs.existsSync(file)) return [];
  var docs = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line, i) {
    if (!line.trim()) return;
    try {
      docs.push(unwrap(JSON.parse(line)));
    } catch (e) {
      throw new Error(path.basename(file) + ':' + (i + 1) + ': ' + e.message);
    }
  });
  return docs;
}

// ---- value conversions (local copies, the shared helpers didn't exist yet) --

function toIsoDate(value) {
  if (!value) return null;
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: TZ }); // sv-SE gives YYYY-MM-DD
}

// Decimal128 "1234.5" -> 123450. У документах до 2018 ціна — звичайний double.
function toKopecks(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  var s = String(value.decimal !== undefined ? value.decimal : value).trim();
  var neg = s.charAt(0) === '-';
  if (neg) s = s.slice(1);
  var parts = s.split('.');
  var frac = ((parts[1] || '') + '00').slice(0, 2);
  var n = Number(parts[0] || '0') * 100 + Number(frac);
  return neg ? -n : n;
}

// ---- id remapping ----------------------------------------------------------

function assignIds(docs) {
  var sorted = docs.slice().sort(function (a, b) {
    var ta = a.createdAt ? a.createdAt.getTime() : 0;
    var tb = b.createdAt ? b.createdAt.getTime() : 0;
    return ta - tb || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
  });
  var map = {};
  sorted.forEach(function (doc, i) { map[doc._id] = i + 1; });
  return { map: map, sorted: sorted };
}

function lineOf(item, ids) {
  return {
    product_id: ids.products[item.productId] || null,
    title: item.title || item.name,
    qty: Number(item.qty || item.quantity || 0),
    unit_price_kopecks: toKopecks(item.price),
  };
}

var MAPPERS = {
  customers: function (doc) {
    return {
      name: doc.name,
      contact_name: doc.contactName || doc.contact || '',
      edrpou: doc.edrpou || doc.okpo || '',
      email: doc.email || '',
      city: (doc.address && doc.address.city) || doc.city || '',
      created_at: toIsoDate(doc.createdAt),
      active: doc.deleted !== true,
    };
  },
  products: function (doc) {
    return {
      sku: doc.sku,
      title: doc.title,
      unit: doc.unit || 'шт',
      price_kopecks: toKopecks(doc.price),
      active: doc.archived !== true,
    };
  },
  orders: function (doc, ids) {
    return {
      customer_id: ids.customers[doc.customerId],
      created_at: toIsoDate(doc.createdAt),
      status: doc.status === 'billed' ? 'invoiced' : doc.status,
      lines: (doc.items || []).map(function (it) { return lineOf(it, ids); }),
    };
  },
  invoices: function (doc, ids) {
    return {
      number: doc.number,
      order_id: ids.orders[doc.orderId] || null,
      customer_id: ids.customers[doc.customerId],
      issued_at: toIsoDate(doc.issuedAt || doc.createdAt),
      due_at: toIsoDate(doc.dueAt),
      vat_rate: doc.vatRate !== undefined ? Number(doc.vatRate) : 20,
      subtotal_kopecks: toKopecks(doc.subtotal),
      vat_kopecks: toKopecks(doc.vat),
      total_kopecks: toKopecks(doc.total),
      status: doc.status,
      lines: (doc.items || []).map(function (it) { return lineOf(it, ids); }),
    };
  },
  payments: function (doc, ids) {
    return {
      invoice_id: ids.invoices[doc.invoiceId],
      amount_kopecks: toKopecks(doc.amount),
      paid_at: toIsoDate(doc.paidAt || doc.createdAt),
      method: doc.source === 'clientbank' || doc.source === 'statement' ? 'bank' : doc.source || 'bank',
    };
  },
};

/**
 * @param {object} dumps  collection -> array of unwrapped docs
 * @returns {{ data: object, warnings: string[] }}
 */
function migrate(dumps) {
  var ids = {};
  var data = {};
  var warnings = [];
  ORDER.forEach(function (name) {
    var a = assignIds(dumps[name] || []);
    ids[name] = a.map;
    data[name] = [];
    a.sorted.forEach(function (doc) {
      var row = MAPPERS[name](doc, ids);
      var missing = 'customer_id' in row && !row.customer_id ? 'customer ' + doc.customerId
        : name === 'payments' && !row.invoice_id ? 'invoice ' + doc.invoiceId : null;
      if (missing) return warnings.push(name + ' ' + doc._id + ': ' + missing + ' not found, skipped');
      // NB: ids keep gaps where rows were skipped, nobody cared
      data[name].push(Object.assign({ id: a.map[doc._id] }, row));
    });
  });
  return { data: data, warnings: warnings };
}

function main(argv) {
  var dumpDir = argv[0];
  var outIdx = argv.indexOf('--out');
  var outDir = outIdx !== -1 ? argv[outIdx + 1] : path.join(__dirname, '..', '..', 'data');
  var force = argv.indexOf('--force') !== -1;
  if (!dumpDir) {
    console.error('usage: mongo-migrate.js <dump dir> [--out dir] [--force]');
    process.exit(2);
  }
  var dumps = {};
  ORDER.forEach(function (name) {
    dumps[name] = readDump(path.join(dumpDir, name + '.json'));
    console.log('read ' + name + ': ' + dumps[name].length);
  });
  var result = migrate(dumps);
  result.warnings.forEach(function (w) { console.warn('WARN ' + w); });
  var clash = ORDER.map(function (n) { return path.join(outDir, n + '.json'); }).filter(function (f) { return fs.existsSync(f); });
  if (clash.length && !force) {
    console.error(clash.join(', ') + ': already there, refusing to overwrite (use --force)');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  ORDER.forEach(function (name) {
    fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(result.data[name], null, 2) + '\n', 'utf8');
    console.log('wrote ' + name + ': ' + result.data[name].length);
  });
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { migrate: migrate, unwrap: unwrap, toKopecks: toKopecks, toIsoDate: toIsoDate };
