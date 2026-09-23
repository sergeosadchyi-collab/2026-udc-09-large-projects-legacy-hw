/**
 * Invoice endpoints.
 */
var store = require('../store');
var invoices = require('./index');
var render = require('./render');
var httpError = require('../http/router').httpError;

function list(req, res, ctx, done) {
  store.all('invoices', function (err, rows) {
    if (err) return done(err);
    var status = ctx.query.status;
    if (status) rows = rows.filter(function (r) { return r.status === status; });
    done(null, 200, rows.map(function (r) {
      return { id: r.id, number: r.number, customer_id: r.customer_id, issued_at: r.issued_at, due_at: r.due_at, total_kopecks: r.total_kopecks, status: r.status };
    }));
  });
}

function one(req, res, ctx, done) {
  store.find('invoices', Number(ctx.params.id), function (err, inv) {
    if (err) return done(err);
    if (!inv) return done(httpError(404, 'not found'));
    done(null, 200, inv);
  });
}

function html(req, res, ctx, done) {
  store.where('invoices', function (i) { return i.number === ctx.params.number; }, function (err, found) {
    if (err) return done(err);
    if (!found.length) return done(httpError(404, 'not found'));
    store.find('customers', found[0].customer_id, function (err2, customer) {
      if (err2) return done(err2);
      done(null, 200, render.renderInvoiceHtml(found[0], customer));
    });
  });
}

function issue(req, res, ctx, done) {
  store.find('orders', Number(ctx.params.id), function (err, order) {
    if (err) return done(err);
    if (!order) return done(httpError(404, 'order not found'));
    if (order.status !== 'confirmed') return done(httpError(409, 'order must be confirmed first'));
    var today = (ctx.body && ctx.body.issued_at) || new Date().toISOString().slice(0, 10);
    invoices.issueFromOrder(order, today, function (err2, inv) {
      if (err2) return done(err2);
      store.update('orders', order.id, { status: 'invoiced' }, function (err3) {
        if (err3) return done(err3);
        store.save('orders', function () {
          store.save('invoices', function () {
            done(null, 201, inv);
          });
        });
      });
    });
  });
}

module.exports = [
  { method: 'GET', path: '/api/invoices', handler: list },
  { method: 'GET', path: '/api/invoices/:id', handler: one },
  { method: 'POST', path: '/api/orders/:id/invoice', handler: issue },
  { method: 'GET', path: '/invoices/:number', handler: html },
];
