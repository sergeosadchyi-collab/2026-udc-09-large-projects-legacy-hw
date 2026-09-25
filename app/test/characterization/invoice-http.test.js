/**
 * BILL-482 characterization — consumer #1b: the same invoice over HTTP.
 *
 * The ticket names the URL (/invoices/INV-2026-00007), so the whole path is
 * pinned, not just the renderer: the route is PUBLIC (no x-staff-id, unlike
 * /api/*, see lib/http/router.js — the check only fires for /api/ paths) and
 * it answers text/html.
 *
 * Read by: a HUMAN. Expected to change in Task C — but only in the dates.
 *
 * NB: the server is closed from t.after() and the request is promisified, so
 * a failing assertion cannot leave the listener open and hang `node --test`.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var http = require('http');
var createServer = require('../../server').createServer;
var store = require('../../lib/store');
var render = require('../../lib/invoices/render');

/** Start a server on an ephemeral port; always closed by t.after(). */
function listen(t) {
  var server = createServer();
  t.after(function () {
    return new Promise(function (resolve) {
      server.close(resolve);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, function () {
      resolve(server);
    });
  });
}

function get(server, path, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.get({ port: server.address().port, path: path, headers: headers || {} }, function (res) {
      var chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

function fixture(number) {
  var invoice = store.loadSync('invoices').filter(function (i) {
    return i.number === number;
  })[0];
  var customer = store.loadSync('customers').filter(function (c) {
    return c.id === invoice.customer_id;
  })[0];
  return { invoice: invoice, customer: customer };
}

test('characterization: GET /invoices/:number is public and returns the rendered HTML', async function (t) {
  var server = await listen(t);
  var res = await get(server, '/invoices/INV-2026-00007');
  var f = fixture('INV-2026-00007');

  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  // no x-staff-id was sent and the page still rendered
  assert.equal(res.body, render.renderInvoiceHtml(f.invoice, f.customer));
  // BILL-482: customer-facing dates are DD.MM.YYYY (data: 2026-03-07 / 2026-03-21)
  assert.match(res.body, /Сплатити до: <b>21\.03\.2026<\/b>/);
});

test('characterization: /api/* still needs x-staff-id (unchanged by the ticket)', async function (t) {
  var server = await listen(t);
  var res = await get(server, '/api/invoices');
  assert.equal(res.status, 401);
});

