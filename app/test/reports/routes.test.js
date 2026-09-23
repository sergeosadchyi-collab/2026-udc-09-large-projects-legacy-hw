var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var routes = require('../../lib/reports/routes');

var DATA = {
  customers: [{ id: 1, name: 'ТОВ «Тестовий Ліс»', edrpou: '10000901' }, { id: 2, name: 'ФОП Тест-2', edrpou: '10000902' }],
  invoices: [
    { id: 1, number: 'INV-2026-00001', customer_id: 1, status: 'issued', issued_at: '2026-02-01', due_at: '2026-02-15', vat_rate: 20, subtotal_kopecks: 10000, vat_kopecks: 2000, total_kopecks: 12000 },
    { id: 2, number: 'INV-2026-00002', customer_id: 2, status: 'paid', issued_at: '2026-03-02', due_at: '2026-03-16', vat_rate: 20, subtotal_kopecks: 40000, vat_kopecks: 8000, total_kopecks: 48000 },
    { id: 3, number: 'INV-2026-00003', customer_id: 2, status: 'cancelled', issued_at: '2026-03-03', due_at: '2026-03-17', vat_rate: 20, subtotal_kopecks: 5000, vat_kopecks: 1000, total_kopecks: 6000 },
  ],
  payments: [{ id: 1, invoice_id: 2, amount_kopecks: 48000, paid_at: '2026-03-10', method: 'bank' }],
};

function handler(p) {
  return routes.filter(function (r) { return r.path === p; })[0].handler;
}

// Calls a handler the way the router does; resolves with whatever came out.
function call(p, query, cb) {
  var res = {
    headers: null,
    writeHead: function (status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end: function (body) {
      cb({ status: this.status, type: this.headers['content-type'], body: body });
    },
  };
  handler(p)({}, res, { query: query, params: {} }, function (err, status, payload) {
    if (err) return cb({ status: err.status || 500, error: err.message });
    cb({ status: status, body: payload });
  });
}

test.before(function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-reports-'));
  Object.keys(DATA).forEach(function (name) {
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(DATA[name]));
  });
  store.open(dir);
});

test.after(function () {
  store.open();
});

test('JSON endpoints: revenue, top customers with limit, vat with from/to', function (t, done) {
  call('/api/reports/revenue', {}, function (out) {
    assert.equal(out.status, 200);
    assert.deepEqual(out.body.rows.map(function (r) { return r.label + ':' + r.gross_kopecks; }), ['лютий 2026:12000', 'березень 2026:48000']);
    call('/api/reports/top-customers', { limit: '1' }, function (out2) {
      assert.deepEqual(out2.body.rows.map(function (r) { return r.name; }), ['ФОП Тест-2']);
      call('/api/reports/vat', { from: '2026-03', to: '2026-03' }, function (out3) {
        assert.equal(out3.body.totals.vat_kopecks, 8000);
        done();
      });
    });
  });
});

test('aging as text/plain, respects as_of', function (t, done) {
  call('/api/reports/aging', { as_of: '2026-03-05', format: 'text' }, function (out) {
    assert.equal(out.status, 200);
    assert.equal(out.type, 'text/plain; charset=utf-8');
    assert.match(out.body, /станом на 2026-03-05/);
    assert.match(out.body, /INV-2026-00001/);
    assert.match(out.body, /INV-2026-00002/, 'paid only on 03-10');
    assert.doesNotMatch(out.body, /INV-2026-00003/);
    done();
  });
});

test('bad parameters are 400s', function (t, done) {
  var cases = [
    ['/api/reports/aging', { as_of: '2026-02-30' }],
    ['/api/reports/aging', { as_of: '31.03.2026' }],
    ['/api/reports/top-customers', { limit: '0' }],
    ['/api/reports/top-customers', { limit: '2.5' }],
    ['/api/reports/revenue', { from: '2026-04', to: '2026-01' }],
    ['/api/reports/vat', { from: 'March' }],
    ['/api/reports/revenue', { format: 'xml' }],
  ];
  var left = cases.length;
  cases.forEach(function (c) {
    call(c[0], c[1], function (out) {
      assert.equal(out.status, 400, c[0] + ' ' + JSON.stringify(c[1]));
      if (--left === 0) done();
    });
  });
});
