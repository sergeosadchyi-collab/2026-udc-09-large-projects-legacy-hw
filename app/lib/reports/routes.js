/**
 * Report endpoints. JSON by default, ?format=text for the fixed-width table.
 *
 *   GET /api/reports/revenue?from=2026-01&to=2026-03
 *   GET /api/reports/aging?as_of=2026-03-31
 *   GET /api/reports/top-customers?limit=5&from=2026-01
 *   GET /api/reports/vat?from=2026-03&to=2026-03
 */
var reports = require('./index');
var render = require('./render');
var dates = require('./dates');
var httpError = require('../http/router').httpError;

var MAX_LIMIT = 100;

// The router only knows JSON and HTML; text/plain is written here directly.
function sendText(res, text) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function reply(res, ctx, report, done) {
  var fmt = ctx.query.format || 'json';
  if (fmt === 'text' || fmt === 'txt') return sendText(res, render.renderText(report));
  if (fmt !== 'json') return done(httpError(400, 'format must be json or text'));
  done(null, 200, report);
}

// returns an error message or null; fills opts.from / opts.to
function readRange(query, opts) {
  if (query.from) {
    if (!dates.isMonthKey(query.from)) return 'from must be YYYY-MM';
    opts.from = query.from;
  }
  if (query.to) {
    if (!dates.isMonthKey(query.to)) return 'to must be YYYY-MM';
    opts.to = query.to;
  }
  if (opts.from && opts.to && opts.from > opts.to) return 'from is after to';
  return null;
}

function revenue(req, res, ctx, done) {
  var opts = {};
  var bad = readRange(ctx.query, opts);
  if (bad) return done(httpError(400, bad));
  reports.loadAll(['invoices'], function (err, invoices) {
    if (err) return done(err);
    reply(res, ctx, reports.revenueByMonth(invoices, opts), done);
  });
}

function aging(req, res, ctx, done) {
  var asOf = ctx.query.as_of || dates.todayIso();
  if (!dates.isIsoDate(asOf)) return done(httpError(400, 'as_of must be YYYY-MM-DD'));
  reports.loadAll(['invoices', 'payments', 'customers'], function (err, invoices, payments, customers) {
    if (err) return done(err);
    reply(res, ctx, reports.aging(invoices, payments, customers, asOf), done);
  });
}

function topCustomers(req, res, ctx, done) {
  var opts = {};
  var bad = readRange(ctx.query, opts);
  if (bad) return done(httpError(400, bad));
  if (ctx.query.limit !== undefined) {
    var n = Number(ctx.query.limit);
    if (!(n >= 1 && n <= MAX_LIMIT && Math.floor(n) === n)) return done(httpError(400, 'limit must be 1..' + MAX_LIMIT));
    opts.limit = n;
  }
  reports.loadAll(['invoices', 'customers'], function (err, invoices, customers) {
    if (err) return done(err);
    reply(res, ctx, reports.topCustomers(invoices, customers, opts), done);
  });
}

function vat(req, res, ctx, done) {
  var opts = {};
  var bad = readRange(ctx.query, opts);
  if (bad) return done(httpError(400, bad));
  reports.loadAll(['invoices'], function (err, invoices) {
    if (err) return done(err);
    reply(res, ctx, reports.vatSummary(invoices, opts), done);
  });
}

module.exports = [
  { method: 'GET', path: '/api/reports/revenue', handler: revenue },
  { method: 'GET', path: '/api/reports/aging', handler: aging },
  { method: 'GET', path: '/api/reports/top-customers', handler: topCustomers },
  { method: 'GET', path: '/api/reports/vat', handler: vat },
];
