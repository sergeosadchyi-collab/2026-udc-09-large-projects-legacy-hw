/**
 * Order endpoints.
 *
 * POST /api/orders/:id/invoice is NOT here — it lives in lib/invoices/routes.js
 * because it creates the invoice and flips the order to 'invoiced' in one go.
 */
var store = require('../store');
var orders = require('./index');
var status = require('./status');
var httpError = require('../http/router').httpError;

function parseId(raw) {
  var id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function first(v) {
  // ?status=a&status=b comes in as an array from url.parse
  return Array.isArray(v) ? v[0] : v;
}

function list(req, res, ctx, done) {
  var q = ctx.query || {};
  var filter = {
    status: first(q.status),
    customer_id: first(q.customer_id),
    from: first(q.from),
    to: first(q.to),
  };
  if (filter.status && !status.isStatus(filter.status)) {
    return done(httpError(400, 'unknown status: ' + filter.status));
  }
  if (filter.customer_id && !parseId(filter.customer_id)) return done(httpError(400, 'bad customer_id'));
  if ((filter.from && !orders.isIsoDate(filter.from)) || (filter.to && !orders.isIsoDate(filter.to))) {
    return done(httpError(400, 'from/to must be YYYY-MM-DD'));
  }
  orders.list(filter, function (err, rows) {
    if (err) return done(err);
    var limit = Math.min(Number(first(q.limit)) || 200, 1000);
    done(null, 200, rows.slice(0, limit).map(orders.summarize));
  });
}

function one(req, res, ctx, done) {
  var id = parseId(ctx.params.id);
  if (!id) return done(httpError(400, 'bad order id'));
  store.find('orders', id, function (err, order) {
    if (err) return done(err);
    if (!order) return done(httpError(404, 'not found'));
    done(null, 200, orders.detail(order));
  });
}

function create(req, res, ctx, done) {
  if (!ctx.body || typeof ctx.body !== 'object') return done(httpError(400, 'JSON body required'));
  orders.create(ctx.body, ctx.staffId, function (err, order) {
    // validation errors are 422 with all problems joined — old clients only read .error
    if (err) return done(err);
    store.save('orders', function (err2) {
      if (err2) return done(err2);
      done(null, 201, orders.detail(order));
    });
  });
}

/**
 * body: { status, reason? }
 */
function setStatus(req, res, ctx, done) {
  var id = parseId(ctx.params.id);
  if (!id) return done(httpError(400, 'bad order id'));
  var body = ctx.body || {};
  var to = body.status;
  if (!to || typeof to !== 'string') return done(httpError(400, 'status is required'));
  if (!status.isStatus(to)) return done(httpError(400, 'unknown status: ' + to));
  if (status.SYSTEM_ONLY[to]) {
    return done(httpError(409, "status '" + to + "' is set by " + status.SYSTEM_ONLY[to]));
  }
  if (body.reason != null && typeof body.reason !== 'string') return done(httpError(400, 'reason must be a string'));

  var opts = { reason: body.reason, staffId: ctx.staffId };
  status.applyTransition(id, to, opts, function (err, order, problem) {
    if (err) return done(err);
    if (!order) return done(httpError(404, 'not found'));
    if (problem) return done(httpError(409, problem));
    store.save('orders', function (err2) {
      if (err2) return done(err2);
      done(null, 200, orders.detail(order));
    });
  });
}

module.exports = [
  { method: 'GET', path: '/api/orders', handler: list },
  { method: 'GET', path: '/api/orders/:id', handler: one },
  { method: 'POST', path: '/api/orders', handler: create },
  { method: 'POST', path: '/api/orders/:id/status', handler: setStatus },
];
