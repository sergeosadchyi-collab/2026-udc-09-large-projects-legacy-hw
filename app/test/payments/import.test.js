var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var payments = require('../../lib/payments');
var routes = require('../../lib/payments/routes');

var DATA = path.join(__dirname, '..', '..', 'data');
var SAMPLE = fs.readFileSync(path.join(DATA, 'statements', '2026-03-sample.txt'), 'utf8');

var tmpDirs = [];

// copy of the seeded collections in a temp dir — never write into the real data/
function tmpData() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-payments-'));
  tmpDirs.push(dir);
  ['customers', 'invoices', 'payments'].forEach(function (name) {
    fs.copyFileSync(path.join(DATA, name + '.json'), path.join(dir, name + '.json'));
  });
  store.open(dir);
  return dir;
}

function readJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
}

function handler(method, p) {
  return routes.filter(function (r) { return r.method === method && r.path === p; })[0].handler;
}

function call(h, ctx, cb) {
  h({}, {}, Object.assign({ params: {}, query: {}, body: null, staffId: 7 }, ctx), cb);
}

test.afterEach(function () {
  store.open();
  tmpDirs.splice(0).forEach(function (d) {
    fs.rmSync(d, { recursive: true, force: true });
  });
});

test('prepareImport returns a plan and writes nothing', function (t, done) {
  var dir = tmpData();
  var before = fs.readdirSync(dir).map(function (f) { return f + fs.readFileSync(path.join(dir, f), 'utf8'); });
  payments.prepareImport(SAMPLE, { today: '2026-03-21' }, function (err, plan) {
    assert.ifError(err);
    assert.equal(plan.decisions.length, 14);
    assert.equal(plan.unmatched.length, 3);
    assert.equal(plan.credits.length, 1);
    var t2 = plan.totals;
    assert.equal(t2.booked_kopecks + t2.credit_kopecks + t2.unmatched_kopecks, t2.received_kopecks);
    var after = fs.readdirSync(dir).map(function (f) { return f + fs.readFileSync(path.join(dir, f), 'utf8'); });
    assert.deepEqual(after, before);
    done();
  });
});

test('apply writes payments, paid invoices, credit and queue; a re-import is a no-op', function (t, done) {
  var dir = tmpData();
  payments.prepareImport(SAMPLE, { today: '2026-03-21' }, function (err, plan) {
    assert.ifError(err);
    payments.apply(plan, { staffId: 3 }, function (err2, counts) {
      assert.ifError(err2);
      assert.deepEqual(counts, { payments: 11, invoices_paid: 10, credits: 1, unmatched: 3 });

      var inv4 = readJson(dir, 'invoices').filter(function (i) { return i.id === 4; })[0];
      assert.equal(inv4.status, 'paid');
      assert.equal(inv4.paid_at, '2026-03-13');
      var rows = readJson(dir, 'payments');
      assert.equal(rows.length, 6 + 11);
      assert.equal(rows[rows.length - 1].imported_by, 3);
      assert.equal(readJson(dir, 'customer_credits')[0].amount_kopecks, 77000);
      assert.equal(readJson(dir, 'payments_unmatched').length, 3);

      payments.prepareImport(SAMPLE, function (err3, again) {
        assert.ifError(err3);
        assert.deepEqual(again.decisions.map(function (d) { return d.outcome; }), new Array(14).fill('skipped'));
        done();
      });
    });
  });
});

test('POST /api/payments/import validates input and supports dry_run', function (t, done) {
  tmpData();
  var imp = handler('POST', '/api/payments/import');
  call(imp, { body: {} }, function (err) {
    assert.equal(err.status, 400);
    call(imp, { body: { text: 'D garbage' } }, function (err2, status, payload) {
      assert.ifError(err2);
      assert.equal(status, 422);
      assert.ok(payload.details.length > 0);
      call(imp, { body: { text: SAMPLE, dry_run: true } }, function (err3, status3, payload3) {
        assert.ifError(err3);
        assert.equal(status3, 200);
        assert.equal(payload3.applied, false);
        assert.equal(payload3.plan.payments.length, 11);
        done();
      });
    });
  });
});

test('import over HTTP handler, then the unmatched queue and payment list', function (t, done) {
  tmpData();
  call(handler('POST', '/api/payments/import'), { body: { text: SAMPLE } }, function (err, status, payload) {
    assert.ifError(err);
    assert.equal(status, 201);
    assert.equal(payload.counts.unmatched, 3);
    call(handler('GET', '/api/payments/unmatched'), {}, function (err2, s2, queue) {
      assert.ifError(err2);
      assert.deepEqual(queue.map(function (u) { return u.reason; }), ['invoice_not_open', 'no_match', 'unknown_invoice']);
      assert.equal(queue[0].imported_by, 7);
      call(handler('GET', '/api/payments'), { query: { invoice_id: '4' } }, function (err3, s3, list) {
        assert.ifError(err3);
        assert.deepEqual(list.map(function (p) { return p.amount_kopecks; }), [150200, 100000]);
        done();
      });
    });
  });
});
