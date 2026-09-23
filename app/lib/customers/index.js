/**
 * Customers: CRUD over data/customers.json, activate/deactivate and the
 * invoice list of one customer. Merging duplicates is in merge.js.
 *
 * Rows look like:
 *   { id, name, contact_name, edrpou, email, city, created_at, active,
 *     [edrpou_unchecked], [merged_into], [updated_at], [updated_by] }
 * Rows are never deleted — a customer is deactivated or merged instead.
 */
var store = require('../store');
var invoices = require('../invoices');
var validate = require('./validate');
var search = require('./search');

// what staff may send in POST/PATCH; anything else in the body is ignored
var EDITABLE = ['name', 'contact_name', 'edrpou', 'email', 'city', 'active', 'edrpou_unchecked'];

// same idea as httpError in lib/http/router.js, but we need .details for 422
function userError(status, message, details) {
  var e = new Error(message);
  e.status = status;
  if (details) e.details = details;
  return e;
}

// UTC date, like the rest of the app. Yes, it is "yesterday" before 03:00 Kyiv time.
function toIsoDate(d) {
  return (d || new Date()).toISOString().slice(0, 10);
}

// 579300 -> "5793.00" — the old admin UI wants a plain string, no spaces, no грн
function fmtAmount(kopecks) {
  var sign = kopecks < 0 ? '-' : '';
  var k = Math.abs(kopecks);
  var rest = k % 100;
  return sign + Math.floor(k / 100) + '.' + (rest < 10 ? '0' : '') + rest;
}

function pick(obj, keys) {
  var out = {};
  keys.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  });
  return out;
}

function clean(fields) {
  var f = pick(fields || {}, EDITABLE);
  ['name', 'contact_name', 'city'].forEach(function (k) {
    if (typeof f[k] === 'string') f[k] = f[k].trim();
  });
  if (typeof f.email === 'string') f.email = f.email.trim().toLowerCase();
  if ('edrpou' in f) f.edrpou = validate.cleanEdrpou(f.edrpou);
  return f;
}

/**
 * @param {object} opts { q, includeInactive, limit }
 */
function list(opts, cb) {
  opts = opts || {};
  store.all('customers', function (err, rows) {
    if (err) return cb(err);
    rows = rows.filter(function (c) { return !c.merged_into; });
    if (opts.q) return cb(null, search.searchByName(rows, opts.q, opts));
    if (!opts.includeInactive) rows = rows.filter(function (c) { return c.active !== false; });
    rows.sort(function (a, b) { return a.id - b.id; });
    if (opts.limit) rows = rows.slice(0, opts.limit);
    cb(null, rows);
  });
}

// returns a copy — callers like to decorate it, and the store hands out cached rows
function get(id, cb) {
  store.find('customers', id, function (err, c) {
    if (err) return cb(err);
    cb(null, c ? Object.assign({}, c) : null);
  });
}

function create(fields, staffId, cb) {
  var f = clean(fields);
  var errors = validate.validateNew(f);
  if (errors.length) return cb(userError(422, 'validation failed', errors));
  store.where('customers', function (c) {
    return c.edrpou === f.edrpou && c.active !== false && !c.merged_into;
  }, function (err, same) {
    if (err) return cb(err);
    if (same.length) return cb(userError(409, 'active customer with this ЄДРПОУ already exists: id ' + same[0].id));
    var row = {
      name: f.name,
      contact_name: f.contact_name || '',
      edrpou: f.edrpou,
      email: f.email || '',
      city: f.city || '',
      created_at: toIsoDate(),
      active: true,
      created_by: staffId || null,
    };
    if (!validate.edrpouChecksumOk(f.edrpou)) row.edrpou_unchecked = true;
    store.insert('customers', row, function (err2, saved) {
      if (err2) return cb(err2);
      store.save('customers', function (err3) {
        if (err3) return cb(err3);
        cb(null, saved);
      });
    });
  });
}

// "open" = issued and not yet paid. Drafts don't exist for customers yet.
function openInvoices(customerId, cb) {
  store.where('invoices', function (inv) {
    return inv.customer_id === customerId && inv.status === 'issued';
  }, cb);
}

/**
 * PATCH a customer. opts.force lets a deactivation through even with open
 * invoices (accounting wants to be asked first, 2022).
 */
function update(id, fields, staffId, opts, cb) {
  store.find('customers', id, function (err, existing) {
    if (err) return cb(err);
    if (!existing) return cb(userError(404, 'not found'));
    if (existing.merged_into) return cb(userError(409, 'customer was merged into ' + existing.merged_into));
    var patch = clean(fields);
    var errors = validate.validatePatch(existing, patch);
    if (errors.length) return cb(userError(422, 'validation failed', errors));

    // edrpou_unchecked is only an override for a changed code, never set directly
    var forced = patch.edrpou_unchecked === true;
    delete patch.edrpou_unchecked;
    if ('edrpou' in patch) {
      if (patch.edrpou === existing.edrpou) {
        delete patch.edrpou;
      } else if (validate.edrpouChecksumOk(patch.edrpou)) {
        if (existing.edrpou_unchecked) patch.edrpou_unchecked = false;
      } else if (forced) {
        patch.edrpou_unchecked = true;
      }
    }
    if (patch.active === existing.active || (patch.active === true && existing.active === undefined)) {
      delete patch.active;
    }

    function write() {
      patch.updated_at = toIsoDate();
      patch.updated_by = staffId || null;
      store.update('customers', id, patch, function (err3, row) {
        if (err3) return cb(err3);
        store.save('customers', function (err4) {
          if (err4) return cb(err4);
          cb(null, row);
        });
      });
    }

    if (patch.active !== false || (opts && opts.force)) return write();
    openInvoices(id, function (err2, open) {
      if (err2) return cb(err2);
      if (open.length) {
        return cb(userError(409, 'customer has ' + open.length + ' open invoice(s); pass force=1 to deactivate anyway'));
      }
      write();
    });
  });
}

function activate(id, staffId, cb) {
  update(id, { active: true }, staffId, {}, cb);
}

function deactivate(id, staffId, opts, cb) {
  update(id, { active: false }, staffId, opts, cb);
}

/**
 * Invoices of one customer with what has been paid on each, newest first.
 * @param {object} opts { status, today } — today is YYYY-MM-DD, for tests
 */
function invoicesFor(id, opts, cb) {
  var today = opts.today || toIsoDate();
  store.find('customers', id, function (err, customer) {
    if (err) return cb(err);
    if (!customer) return cb(userError(404, 'not found'));
    store.where('invoices', function (inv) { return inv.customer_id === id; }, function (err2, rows) {
      if (err2) return cb(err2);
      store.all('payments', function (err3, payments) {
        if (err3) return cb(err3);
        var paid = {};
        payments.forEach(function (p) {
          paid[p.invoice_id] = (paid[p.invoice_id] || 0) + p.amount_kopecks;
        });
        if (opts.status) rows = rows.filter(function (r) { return r.status === opts.status; });
        rows.sort(function (a, b) {
          if (a.issued_at !== b.issued_at) return a.issued_at < b.issued_at ? 1 : -1;
          return b.id - a.id;
        });
        var totals = { count: rows.length, total_kopecks: 0, paid_kopecks: 0, outstanding_kopecks: 0, overdue_count: 0 };
        var out = rows.map(function (inv) {
          var p = paid[inv.id] || 0;
          var overdue = invoices.isOverdue(inv, today);
          if (inv.status !== 'cancelled') {
            totals.total_kopecks += inv.total_kopecks;
            totals.paid_kopecks += p;
          }
          if (inv.status === 'issued') totals.outstanding_kopecks += Math.max(0, inv.total_kopecks - p);
          if (overdue) totals.overdue_count++;
          return {
            id: inv.id,
            number: inv.number,
            issued_at: inv.issued_at,
            due_at: inv.due_at,
            status: inv.status,
            total_kopecks: inv.total_kopecks,
            paid_kopecks: p,
            overdue: overdue,
          };
        });
        totals.outstanding = fmtAmount(totals.outstanding_kopecks);
        cb(null, { customer_id: id, name: customer.name, active: customer.active !== false, invoices: out, totals: totals });
      });
    });
  });
}

module.exports = {
  EDITABLE: EDITABLE,
  list: list,
  get: get,
  create: create,
  update: update,
  activate: activate,
  deactivate: deactivate,
  invoicesFor: invoicesFor,
  fmtAmount: fmtAmount,
  toIsoDate: toIsoDate,
};
