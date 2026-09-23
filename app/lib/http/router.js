/**
 * Minimal router on top of node's http module.
 *
 * We had Express until 2020; it was removed when the security audit flagged the
 * dependency tree and nobody had time to upgrade. This does just enough.
 *
 * Routes are registered by each module in lib/<module>/routes.js as an array
 * of { method, path, handler }. Paths support ":param" segments.
 * handler(req, res, ctx, done) — ctx has params, query, body, staffId.
 * done(err, status, payload)
 */
var url = require('url');

function compile(path) {
  var names = [];
  var re = path
    .split('/')
    .map(function (seg) {
      if (seg.charAt(0) === ':') {
        names.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp('^' + re + '/?$'), names: names };
}

function Router() {
  this.routes = [];
}

Router.prototype.add = function (method, path, handler) {
  var c = compile(path);
  this.routes.push({ method: method.toUpperCase(), path: path, re: c.re, names: c.names, handler: handler });
};

Router.prototype.addAll = function (list) {
  var self = this;
  (list || []).forEach(function (r) {
    self.add(r.method, r.path, r.handler);
  });
};

Router.prototype.match = function (method, pathname) {
  for (var i = 0; i < this.routes.length; i++) {
    var r = this.routes[i];
    if (r.method !== method) continue;
    var m = r.re.exec(pathname);
    if (!m) continue;
    var params = {};
    r.names.forEach(function (n, k) {
      params[n] = decodeURIComponent(m[k + 1]);
    });
    return { route: r, params: params };
  }
  return null;
};

function send(res, status, payload) {
  if (payload === undefined || payload === null) {
    res.writeHead(status);
    return res.end();
  }
  if (typeof payload === 'string') {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(payload);
  }
  var body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, cb) {
  var chunks = [];
  req.on('data', function (c) {
    chunks.push(c);
  });
  req.on('end', function () {
    if (!chunks.length) return cb(null, null);
    var text = Buffer.concat(chunks).toString('utf8');
    try {
      cb(null, JSON.parse(text));
    } catch (e) {
      cb(new Error('invalid JSON body'));
    }
  });
  req.on('error', cb);
}

/**
 * Staff identify themselves with x-staff-id (the reverse proxy on the old box
 * sets it after LDAP login). Anything without it is rejected.
 */
Router.prototype.handle = function (req, res) {
  var self = this;
  var parsed = url.parse(req.url, true);
  var hit = self.match(req.method, parsed.pathname);
  if (!hit) return send(res, 404, { error: 'not found' });
  var staffId = Number(req.headers['x-staff-id']);
  if (!staffId && hit.route.path.indexOf('/api/') === 0) return send(res, 401, { error: 'staff id required' });
  readBody(req, function (err, body) {
    if (err) return send(res, 400, { error: err.message });
    var ctx = { params: hit.params, query: parsed.query, body: body, staffId: staffId };
    try {
      hit.route.handler(req, res, ctx, function (err2, status, payload) {
        if (err2) {
          var code = err2.status || 500;
          return send(res, code, { error: code === 500 ? 'internal error' : err2.message });
        }
        send(res, status || 200, payload);
      });
    } catch (e) {
      send(res, 500, { error: 'internal error' });
    }
  });
};

function httpError(status, message) {
  var e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { Router: Router, httpError: httpError, send: send };
