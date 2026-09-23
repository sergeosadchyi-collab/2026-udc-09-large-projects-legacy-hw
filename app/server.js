/**
 * Billing back office — HTTP entry point.
 * npm start -> http://localhost:8080 (port from config/default.json)
 */
var http = require('http');
var Router = require('./lib/http/router').Router;
var config = require('./config/default.json');

// Every module registers its own routes. Order matters only for overlapping paths.
var MODULES = [
  './lib/invoices/routes',
  './lib/customers/routes',
  './lib/catalog/routes',
  './lib/orders/routes',
  './lib/payments/routes',
  './lib/reports/routes',
  './lib/audit/routes',
];

function createServer() {
  var router = new Router();
  MODULES.forEach(function (m) {
    try {
      router.addAll(require(m));
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e;
    }
  });
  router.add('GET', '/health', function (req, res, ctx, done) {
    done(null, 200, { ok: true });
  });
  return http.createServer(function (req, res) {
    router.handle(req, res);
  });
}

if (require.main === module) {
  var port = process.env.PORT || config.server.port;
  createServer().listen(port, function () {
    console.log('billing listening on http://localhost:' + port);
  });
}

module.exports = { createServer: createServer };
