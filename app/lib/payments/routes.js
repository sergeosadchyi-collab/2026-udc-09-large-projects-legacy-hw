/**
 * Payment endpoints.
 */
var store = require('../store');
var payments = require('./index');
var httpError = require('../http/router').httpError;

function byDateDesc(a, b) {
  if (a.paid_at !== b.paid_at) return a.paid_at < b.paid_at ? 1 : -1;
  return b.id - a.id;
}

// GET /api/payments?invoice_id=7&from=2026-03-01&to=2026-03-31
function list(req, res, ctx, done) {
  store.all('payments', function (err, rows) {
    if (err) return done(err);
    var q = ctx.query;
    if (q.invoice_id) rows = rows.filter(function (r) { return r.invoice_id === Number(q.invoice_id); });
    if (q.from) rows = rows.filter(function (r) { return r.paid_at >= q.from; });
    if (q.to) rows = rows.filter(function (r) { return r.paid_at <= q.to; });
    if (q.method) rows = rows.filter(function (r) { return r.method === q.method; });
    done(null, 200, rows.sort(byDateDesc));
  });
}

/**
 * POST /api/payments/import  { text: "<KB-2 statement>", dry_run: true|false }
 * dry_run (or ?dry_run=1) only returns the plan.
 */
function importStatement(req, res, ctx, done) {
  var body = ctx.body || {};
  if (typeof body.text !== 'string' || !body.text.trim()) return done(httpError(400, 'text is required'));
  var dryRun = body.dry_run === true || ctx.query.dry_run === '1';

  payments.prepareImport(body.text, {}, function (err, plan) {
    if (err && err.status === 422) return done(null, 422, { error: err.message, details: err.details });
    if (err) return done(err);
    if (dryRun) return done(null, 200, { applied: false, plan: plan });
    payments.apply(plan, { staffId: ctx.staffId }, function (err2, counts) {
      if (err2) return done(err2);
      done(null, 201, { applied: true, counts: counts, totals: plan.totals, decisions: plan.decisions });
    });
  });
}

// GET /api/payments/unmatched         open ones
// GET /api/payments/unmatched?all=1   including resolved
function unmatched(req, res, ctx, done) {
  store.all(payments.UNMATCHED, function (err, rows) {
    if (err) return done(err);
    if (ctx.query.all !== '1') rows = rows.filter(function (r) { return r.status === 'open'; });
    rows.sort(function (a, b) {
      return a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.id - b.id;
    });
    done(null, 200, rows);
  });
}

module.exports = [
  { method: 'GET', path: '/api/payments', handler: list },
  { method: 'POST', path: '/api/payments/import', handler: importStatement },
  { method: 'GET', path: '/api/payments/unmatched', handler: unmatched },
];
