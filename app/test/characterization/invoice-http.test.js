/**
 * BILL-482 characterization — consumer #1b: the same invoice over HTTP.
 *
 * The ticket names the URL (/invoices/INV-2026-00007), so the whole path is
 * pinned, not just the renderer: the route is PUBLIC (no x-staff-id, unlike
 * /api/*, see lib/http/router.js — the check only fires for /api/ paths) and
 * it answers text/html.
 *
 * Read by: a HUMAN. Expected to change in Task C — but only in the dates.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var http = require('http');
var createServer = require('../../server').createServer;
var store = require('../../lib/store');
var render = require('../../lib/invoices/render');

function get(server, path, headers, cb) {
  var port = server.address().port;
  http.get({ port: port, path: path, headers: headers || {} }, function (res) {
    var chunks = [];
    res.on('data', function (c) {
      chunks.push(c);
    });
    res.on('end', function () {
      cb(res, Buffer.concat(chunks).toString('utf8'));
    });
  });
}

test('characterization: GET /invoices/:number is public and returns the rendered HTML', function (t, done) {
  var server = createServer().listen(0, function () {
    get(server, '/invoices/INV-2026-00007', null, function (res, body) {
      var invoice = store.loadSync('invoices').filter(function (i) {
        return i.number === 'INV-2026-00007';
      })[0];
      var customer = store.loadSync('customers').filter(function (c) {
        return c.id === invoice.customer_id;
      })[0];

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
      // no x-staff-id was sent and the page still rendered
      assert.equal(body, render.renderInvoiceHtml(invoice, customer));
      assert.match(body, /Сплатити до: <b>03\/21\/2026<\/b>/);

      server.close(done);
    });
  });
});

test('characterization: /api/* still needs x-staff-id (unchanged by the ticket)', function (t, done) {
  var server = createServer().listen(0, function () {
    get(server, '/api/invoices', null, function (res) {
      assert.equal(res.statusCode, 401);
      server.close(done);
    });
  });
});

