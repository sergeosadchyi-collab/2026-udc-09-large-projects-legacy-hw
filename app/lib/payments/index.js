/**
 * Payments: importing bank statements.
 *
 * Two steps on purpose:
 *   prepareImport(text) — parse + match, reads the store, writes NOTHING,
 *                         returns a plan you can show to a human;
 *   apply(plan)         — writes the plan: payments, paid invoices,
 *                         customer credits, the unmatched queue.
 *
 * NOTE: no locking between the two. If two people import the same statement
 * at the same time, bank_ref only saves you if the first one was already
 * applied. Happened once (2022). Just don't.
 */
var store = require('../store');
var statement = require('./statement');
var matcher = require('./matcher');

var UNMATCHED = 'payments_unmatched';
var CREDITS = 'customer_credits';

// we don't have async.series since the npm purge, so here it is again
function series(tasks, cb) {
  var i = 0;
  (function next(err) {
    if (err || i === tasks.length) return cb(err || null);
    var task = tasks[i++];
    task(next);
  })();
}

function loadData(cb) {
  var data = {};
  var names = { invoices: 'invoices', payments: 'payments', customers: 'customers', unmatched: UNMATCHED };
  var tasks = Object.keys(names).map(function (key) {
    return function (next) {
      store.all(names[key], function (err, rows) {
        data[key] = rows;
        next(err);
      });
    };
  });
  series(tasks, function (err) {
    cb(err, data);
  });
}

/**
 * @param {string} text   statement file contents (KB-2, see statement.js)
 * @param {object} [opts] { today }
 * @param {function} cb   (err, plan); err.status = 422 + err.details for a broken file
 */
function prepareImport(text, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  var parsed = statement.parseStatement(text);
  if (parsed.errors.length) {
    var e = new Error('statement rejected: ' + parsed.errors.length + ' error(s)');
    e.status = 422;
    e.details = parsed.errors;
    return process.nextTick(function () { cb(e); });
  }
  loadData(function (err, data) {
    if (err) return cb(err);
    cb(null, matcher.planPayments(parsed, data, { today: opts.today }));
  });
}

/**
 * Write a plan made by prepareImport.
 * @param {object} plan
 * @param {object} [opts] { staffId } — stamped on every row we insert
 * @param {function} cb  (err, counts)
 */
function apply(plan, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  var stamp = { imported_by: opts.staffId || null };
  var tasks = [];
  var counts = { payments: 0, invoices_paid: 0, credits: 0, unmatched: 0 };

  function inserts(collection, rows, counter) {
    rows.forEach(function (row) {
      tasks.push(function (next) {
        store.insert(collection, Object.assign({}, row, stamp), function (err) {
          counts[counter]++;
          next(err);
        });
      });
    });
  }

  inserts('payments', plan.payments, 'payments');
  plan.invoiceUpdates.forEach(function (u) {
    tasks.push(function (next) {
      store.update('invoices', u.id, u.patch, function (err, updated) {
        if (!err && !updated) err = new Error('invoice ' + u.id + ' disappeared while importing');
        counts.invoices_paid++;
        next(err);
      });
    });
  });
  inserts(CREDITS, plan.credits, 'credits');
  inserts(UNMATCHED, plan.unmatched, 'unmatched');

  // save only what we touched, one after another (save is async)
  var touched = [['payments', plan.payments], ['invoices', plan.invoiceUpdates], [CREDITS, plan.credits], [UNMATCHED, plan.unmatched]];
  touched.forEach(function (t) {
    if (t[1].length) tasks.push(function (next) { store.save(t[0], next); });
  });

  series(tasks, function (err) {
    if (err) return cb(err);
    cb(null, counts);
  });
}

module.exports = {
  UNMATCHED: UNMATCHED,
  CREDITS: CREDITS,
  prepareImport: prepareImport,
  apply: apply,
};
