#!/usr/bin/env node
/*
 * ###########################################################################
 * #  ONE-OFF DATA FIX. ALREADY APPLIED ON PROD ON 2022-08-09.               #
 * #  DO NOT RUN AGAIN. DO NOT ADD TO CRON. DO NOT "IMPROVE".                 #
 * ###########################################################################
 *
 * The July 2022 CRM import created duplicate customers (same ЄДРПОУ, name
 * typed slightly differently). For every group below we keep the oldest
 * record, move its orders and invoices to it and deactivate the duplicates.
 * The list was checked by hand with accounting (BILL-317) — it is NOT derived
 * from the data on purpose, some "duplicates" by ЄДРПОУ are real branches.
 *
 * Payments reference invoices, not customers, so they need nothing.
 *
 *   node bin/fix-2022-duplicate-customers.js           # dry run, prints the plan
 *   node bin/fix-2022-duplicate-customers.js --apply   # rewrites data/*.json
 */
var store = require('../lib/store');

// keep: the surviving customer id; drop: ids created by the broken import
var DUPLICATES = [
  { keep: 2, drop: [131, 158] },
  { keep: 4, drop: [140] },
  { keep: 5, drop: [133, 149, 166] },
  { keep: 9, drop: [152] },
  { keep: 11, drop: [137, 171] },
];

var NOTE = 'merged by fix-2022-duplicate-customers (BILL-317)';

// yes, there is one of these in every script. no, nobody moved it to lib/
function series(tasks, cb) {
  var i = 0;
  (function next(err) {
    if (err || i >= tasks.length) return cb(err);
    tasks[i++](next);
  })();
}

function plan(customers, orders, invoices) {
  var byId = {};
  customers.forEach(function (c) { byId[c.id] = c; });
  var steps = [];
  DUPLICATES.forEach(function (group) {
    var keeper = byId[group.keep];
    if (!keeper) {
      console.log('!! keeper ' + group.keep + ' not found, whole group skipped');
      return;
    }
    group.drop.forEach(function (dropId) {
      var dup = byId[dropId];
      if (!dup) {
        console.log('   ' + dropId + ' -> ' + group.keep + ': not found (already merged?)');
        return;
      }
      if (dup.edrpou !== keeper.edrpou) {
        // happened twice during the dry run in 2022 — check by hand, never force
        console.log('!! ' + dropId + ' -> ' + group.keep + ': ЄДРПОУ differs (' + dup.edrpou + ' vs ' + keeper.edrpou + '), skipped');
        return;
      }
      var o = orders.filter(function (r) { return r.customer_id === dropId; });
      var inv = invoices.filter(function (r) { return r.customer_id === dropId; });
      console.log('   ' + dropId + ' -> ' + group.keep + ': ' + o.length + ' order(s), ' + inv.length + ' invoice(s)');
      steps.push({ keep: group.keep, drop: dropId, orders: o, invoices: inv });
    });
  });
  return steps;
}

function apply(steps, cb) {
  var tasks = [];
  steps.forEach(function (s) {
    s.orders.forEach(function (o) {
      tasks.push(function (next) { store.update('orders', o.id, { customer_id: s.keep }, next); });
    });
    s.invoices.forEach(function (inv) {
      tasks.push(function (next) { store.update('invoices', inv.id, { customer_id: s.keep }, next); });
    });
    tasks.push(function (next) {
      store.update('customers', s.drop, { active: false, merged_into: s.keep, note: NOTE }, next);
    });
  });
  ['customers', 'orders', 'invoices'].forEach(function (name) {
    tasks.push(function (next) { store.save(name, next); });
  });
  series(tasks, cb);
}

function run(argv, cb) {
  var doApply = argv.indexOf('--apply') !== -1;
  store.all('customers', function (err, customers) {
    if (err) return cb(err);
    store.all('orders', function (err2, orders) {
      if (err2) return cb(err2);
      store.all('invoices', function (err3, invoices) {
        if (err3) return cb(err3);
        console.log(doApply ? 'APPLYING:' : 'DRY RUN (pass --apply to write):');
        var steps = plan(customers, orders, invoices);
        if (!steps.length) {
          console.log('nothing to do');
          return cb(null, steps);
        }
        if (!doApply) return cb(null, steps);
        apply(steps, function (err4) {
          if (err4) return cb(err4);
          console.log('merged ' + steps.length + ' duplicate(s)');
          cb(null, steps);
        });
      });
    });
  });
}

if (require.main === module) {
  run(process.argv.slice(2), function (err) {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
}

module.exports = { DUPLICATES: DUPLICATES, plan: plan, run: run };
