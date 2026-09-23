var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var audit = require('../../lib/audit');
var routes = require('../../lib/audit/routes');

// call the handler directly, no server
function get(query, cb) {
  routes[0].handler({}, {}, { query: query, params: {}, staffId: 1 }, cb);
}

test('GET /api/audit validates entity and dates', function (t, done) {
  assert.deepEqual(routes.map(function (r) { return r.method + ' ' + r.path; }), ['GET /api/audit']);
  var cases = [
    [{}, /entity is required/],
    [{ entity: '../etc' }, /bad entity/],
    [{ entity: 'invoices', from: '01.03.2026' }, /from must be/],
    [{ entity: 'invoices', to: '2026-02-31x' }, /to must be/],
    [{ entity: 'invoices', from: '2026-03-02', to: '2026-03-01' }, /after/],
  ];
  (function next(i) {
    if (i >= cases.length) return done();
    get(cases[i][0], function (err) {
      assert.equal(err.status, 400);
      assert.match(err.message, cases[i][1]);
      next(i + 1);
    });
  })(0);
});

test('GET /api/audit?entity=&id= returns that row history, newest first', function (t, done) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-audit-routes-'));
  audit.open(dir);
  t.after(function () {
    audit.open();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  var lines = [
    ['2026-03-01T10:00:00Z', 12, 'issued'],
    ['2026-03-02T10:00:00Z', 13, 'issued'],
    ['2026-03-09T10:00:00Z', 12, 'paid'],
  ].map(function (s) {
    return JSON.stringify({ ts: s[0], staff_id: 4, action: 'update', entity: 'invoices', entity_id: s[1], changes: { status: { from: 'draft', to: s[2] } } });
  });
  fs.writeFileSync(path.join(dir, 'audit.log'), lines.join('\n') + '\n');

  get({ entity: 'invoices', id: '12' }, function (err, status, rows) {
    assert.ifError(err);
    assert.equal(status, 200);
    assert.deepEqual(rows.map(function (r) { return r.changes.status.to; }), ['paid', 'issued']);
    get({ entity: 'invoices', from: '2026-03-02', to: '2026-03-02' }, function (err2, status2, rows2) {
      assert.ifError(err2);
      assert.deepEqual(rows2.map(function (r) { return r.entity_id; }), [13]);
      done();
    });
  });
});
