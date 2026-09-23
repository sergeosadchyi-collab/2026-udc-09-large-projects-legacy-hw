/**
 * Customer endpoints.
 *
 *   GET   /api/customers                ?q=фрагмент  ?all=1 (include inactive)  ?limit=
 *   GET   /api/customers/:id
 *   POST  /api/customers
 *   PATCH /api/customers/:id            ?force=1 to deactivate with open invoices
 *   GET   /api/customers/:id/invoices   ?status=issued
 *
 * There is no DELETE on purpose: deactivate with PATCH { "active": false }.
 */
'use strict';

var customers = require('./index');
var validate = require('./validate');
var httpError = require('../http/router').httpError;

function parseId(ctx) {
  var id = Number(ctx.params.id);
  return id > 0 && Math.floor(id) === id ? id : null;
}

function yes(v) {
  return v === '1' || v === 'true' || v === 'yes';
}

function short(c) {
  return { id: c.id, name: c.name, edrpou: c.edrpou, city: c.city, email: c.email, active: c.active !== false };
}

// 422 carries the per-field messages; router's done(err) would drop them
function reply(done, status) {
  return function (err, payload) {
    if (err && err.details) return done(null, err.status, { error: err.message, fields: err.details });
    if (err) return done(err);
    done(null, status, payload);
  };
}

function list(req, res, ctx, done) {
  var q = ctx.query || {};
  var opts = {
    q: typeof q.q === 'string' ? q.q : '',
    includeInactive: yes(q.all),
    limit: Math.max(0, parseInt(q.limit, 10) || 0),
  };
  customers.list(opts, function (err, rows) {
    if (err) return done(err);
    done(null, 200, rows.map(short));
  });
}

function one(req, res, ctx, done) {
  var id = parseId(ctx);
  if (!id) return done(httpError(404, 'not found'));
  customers.get(id, function (err, c) {
    if (err) return done(err);
    if (!c) return done(httpError(404, 'not found'));
    // informational only — old rows fail it and that's fine, see validate.js
    c.edrpou_checksum_ok = validate.edrpouChecksumOk(c.edrpou);
    done(null, 200, c);
  });
}

function create(req, res, ctx, done) {
  if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) {
    return done(httpError(400, 'JSON object body required'));
  }
  customers.create(ctx.body, ctx.staffId, reply(done, 201));
}

function patch(req, res, ctx, done) {
  var id = parseId(ctx);
  if (!id) return done(httpError(404, 'not found'));
  if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) {
    return done(httpError(400, 'JSON object body required'));
  }
  var force = yes((ctx.query || {}).force);
  customers.update(id, ctx.body, ctx.staffId, { force: force }, reply(done, 200));
}

function invoicesOf(req, res, ctx, done) {
  var id = parseId(ctx);
  if (!id) return done(httpError(404, 'not found'));
  var q = ctx.query || {};
  customers.invoicesFor(id, { status: q.status }, reply(done, 200));
}

module.exports = [
  { method: 'GET', path: '/api/customers', handler: list },
  { method: 'GET', path: '/api/customers/:id', handler: one },
  { method: 'POST', path: '/api/customers', handler: create },
  { method: 'PATCH', path: '/api/customers/:id', handler: patch },
  { method: 'GET', path: '/api/customers/:id/invoices', handler: invoicesOf },
];
