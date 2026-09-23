#!/usr/bin/env node
/**
 * Import a bank statement (KB-2 fixed-width, see lib/payments/statement.js).
 *
 *   node bin/import-statement.js <file> [--apply] [--json] [--data-dir <dir>]
 *   Dry run by default: prints the plan, writes nothing.
 *
 * Used to run from cron with --apply at 07:00. Switched to manual after the
 * bank sent the same file twice in one night (2022); bank_ref catches that now,
 * but nobody turned cron back on.
 */
var fs = require('fs');
var store = require('../lib/store');
var payments = require('../lib/payments');

function fmtAmount(kopecks) {
  var sign = kopecks < 0 ? '-' : '';
  var k = Math.abs(kopecks);
  var rest = String(k % 100);
  return sign + Math.floor(k / 100) + '.' + (rest.length < 2 ? '0' + rest : rest);
}

function col(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function usage() {
  console.error('usage: import-statement.js <file> [--apply] [--json] [--data-dir <dir>]');
  process.exit(2);
}

var args = process.argv.slice(2);
var file = null;
var opts = { apply: false, json: false, dataDir: null };
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--apply') opts.apply = true;
  else if (args[i] === '--json') opts.json = true;
  else if (args[i] === '--data-dir') opts.dataDir = args[++i];
  else if (args[i].charAt(0) === '-') usage();
  else file = args[i];
}
if (!file) usage();
if (opts.dataDir) store.open(opts.dataDir);

var text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (e) {
  console.error('cannot read ' + file + ': ' + e.message);
  process.exit(1);
}

payments.prepareImport(text, function (err, plan) {
  if (err) {
    console.error(err.message);
    (err.details || []).forEach(function (d) {
      console.error('  line ' + d.line + ': ' + d.message);
    });
    process.exit(1);
  }
  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log('Statement ' + plan.statement.account + '  ' + plan.statement.from + ' .. ' + plan.statement.to);
    plan.decisions.forEach(function (d) {
      console.log(
        col(d.line, 4) + col(d.date, 12) + col(fmtAmount(d.amount_kopecks), 12) + col(d.outcome, 11) +
          col(d.invoices.join(','), 32) + d.detail,
      );
    });
    var t = plan.totals;
    console.log(
      'received ' + fmtAmount(t.received_kopecks) + ', booked ' + fmtAmount(t.booked_kopecks) +
        ', credit ' + fmtAmount(t.credit_kopecks) + ', unmatched ' + fmtAmount(t.unmatched_kopecks),
    );
  }
  if (!opts.apply) {
    if (!opts.json) console.log('(dry run — nothing written, use --apply)');
    return;
  }
  payments.apply(plan, { staffId: Number(process.env.STAFF_ID) || null }, function (err2, counts) {
    if (err2) throw err2;
    // stderr with --json so the JSON on stdout stays parseable
    (opts.json ? console.error : console.log)('applied: ' + JSON.stringify(counts));
  });
});
