/**
 * Client for the pdf-render service (HTML in, PDF out; headless Chrome inside).
 *
 *   POST {base}/v1/render   { html, options, meta }  -> application/pdf
 *   GET  {base}/health                                 -> { ok: true }
 *
 * Invoices were rendered from templates/invoice.hbs via ./templates and the
 * resulting HTML posted here. The service lived on the old VM next to Mongo and
 * was switched off in November 2020; invoices are plain HTML since then.
 *
 * TODO(2021-03): delete this + templates.js once accounting confirms nobody
 * needs PDFs any more. — С.
 */
var http = require('http');
var https = require('https');
var templates = require('./templates');
var config = require('../../config/default.json');

var DEFAULT_URL = 'http://pdf-render.example.invalid:7070';
var RETRYABLE_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'];

// config.pdf was removed from default.json with the service; keep the fallback
var pdfConfig = config.pdf || {};

function PdfClient(opts) {
  opts = opts || {};
  this.baseUrl = opts.baseUrl || process.env.PDF_RENDER_URL || pdfConfig.url || DEFAULT_URL;
  this.apiKey = opts.apiKey || process.env.PDF_RENDER_KEY || '';
  this.timeoutMs = opts.timeoutMs || pdfConfig.timeoutMs || 20000;
  this.retries = opts.retries !== undefined ? opts.retries : 3;
  this.paper = opts.paper || 'A4';
}

/**
 * Build the request without sending it (handy for logging what we'd send).
 */
PdfClient.prototype.buildRequest = function (method, pathname, payload) {
  var u = new URL(pathname, this.baseUrl);
  var body = payload ? Buffer.from(JSON.stringify(payload), 'utf8') : null;
  var headers = {
    Accept: method === 'GET' ? 'application/json' : 'application/pdf',
    'User-Agent': 'prykladpostach-billing/2.x',
  };
  if (body) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = body.length;
  }
  if (this.apiKey) headers['X-Api-Key'] = this.apiKey;
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    method: method,
    headers: headers,
    body: body,
  };
};

PdfClient.prototype._send = function (req, cb) {
  var transport = req.protocol === 'https:' ? https : http;
  var finished = false;
  function once(err, status, headers, buf) {
    if (finished) return;
    finished = true;
    cb(err, status, headers, buf);
  }
  var r = transport.request(
    { hostname: req.hostname, port: req.port, path: req.path, method: req.method, headers: req.headers },
    function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { once(null, res.statusCode, res.headers, Buffer.concat(chunks)); });
      res.on('error', once);
    }
  );
  r.setTimeout(this.timeoutMs, function () {
    var e = new Error('pdf-render timeout after ' + this.timeoutMs + 'ms');
    e.code = 'ETIMEDOUT';
    r.destroy(e);
  }.bind(this));
  r.on('error', once);
  if (req.body) r.write(req.body);
  r.end();
};

function isRetryable(err, status) {
  if (err) return RETRYABLE_CODES.indexOf(err.code) !== -1;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

// 500ms, 1s, 2s, 4s... capped; jitter so the three app nodes don't sync up
function backoff(attempt) {
  var base = Math.min(500 * Math.pow(2, attempt), 8000);
  return base + Math.floor(Math.random() * 250);
}

PdfClient.prototype._withRetry = function (req, cb) {
  var self = this;
  var attempt = 0;
  (function go() {
    self._send(req, function (err, status, headers, buf) {
      if (isRetryable(err, status) && attempt < self.retries) {
        var wait = backoff(attempt++);
        console.warn('[pdf-render] ' + (err ? err.code : 'HTTP ' + status) + ', retry #' + attempt + ' in ' + wait + 'ms');
        return setTimeout(go, wait);
      }
      if (err) return cb(err);
      if (status >= 400) {
        var e = new Error('pdf-render HTTP ' + status + ': ' + buf.toString('utf8').slice(0, 200));
        e.status = status;
        return cb(e);
      }
      cb(null, buf, headers);
    });
  })();
};

PdfClient.prototype.renderHtml = function (html, meta, cb) {
  if (typeof meta === 'function') {
    cb = meta;
    meta = {};
  }
  var req = this.buildRequest('POST', '/v1/render', {
    html: html,
    options: {
      format: this.paper,
      printBackground: true,
      margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '20mm' },
    },
    meta: meta || {},
  });
  this._withRetry(req, function (err, buf) {
    if (err) return cb(err);
    // the service sometimes answered 200 with an HTML error page
    if (buf.slice(0, 4).toString('latin1') !== '%PDF') {
      return cb(new Error('pdf-render returned something that is not a PDF (' + buf.length + ' bytes)'));
    }
    cb(null, buf);
  });
};

/**
 * Invoice PDF. View model mirrors what templates/invoice.hbs expected.
 */
PdfClient.prototype.renderInvoice = function (invoice, customer, cb) {
  var self = this;
  var model = {
    company: config.company,
    customer: customer || {},
    invoice: invoice,
    lines: (invoice.lines || []).map(function (l, i) {
      return { n: i + 1, title: l.title, qty: l.qty, price: l.unit_price_kopecks, sum: l.qty * l.unit_price_kopecks };
    }),
    paid: invoice.status === 'paid',
  };
  templates.render('invoice', model, function (err, html) {
    if (err) return cb(err);
    self.renderHtml(html, { doc: 'invoice', number: invoice.number }, cb);
  });
};

// used by the old /status page; never errors, just says up or down
PdfClient.prototype.health = function (cb) {
  this._send(this.buildRequest('GET', '/health'), function (err, status) {
    cb(null, !err && status === 200, err ? err.message : 'HTTP ' + status);
  });
};

module.exports = {
  PdfClient: PdfClient,
  createClient: function (opts) { return new PdfClient(opts); },
  isRetryable: isRetryable,
  backoff: backoff,
  DEFAULT_URL: DEFAULT_URL,
};
