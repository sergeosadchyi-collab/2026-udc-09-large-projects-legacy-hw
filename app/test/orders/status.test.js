var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../../lib/store');
var status = require('../../lib/orders/status');

var DATA = path.join(__dirname, '..', '..', 'data');

// copy of the real seed data into a temp dir, so nothing here can write data/
function tmpStore(extraOrders) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-orders-'));
  ['customers', 'products', 'orders'].forEach(function (name) {
    fs.copyFileSync(path.join(DATA, name + '.json'), path.join(dir, name + '.json'));
  });
  var rows = JSON.parse(fs.readFileSync(path.join(dir, 'orders.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'orders.json'), JSON.stringify(rows.concat(extraOrders || [])));
  store.open(dir);
  return dir;
}

test.after(function () {
  store.open();
});

test('transition table: happy path, cancellation, final statuses', function () {
  [['new', 'confirmed'], ['confirmed', 'invoiced'], ['invoiced', 'shipped'], ['shipped', 'closed'],
    ['new', 'cancelled'], ['confirmed', 'cancelled']].forEach(function (p) {
    assert.equal(status.canTransition(p[0], p[1]), true, p.join(' -> '));
  });
  [['invoiced', 'cancelled'], ['shipped', 'cancelled'], ['new', 'shipped'], ['closed', 'new'], ['draft', 'new']].forEach(function (p) {
    assert.equal(status.canTransition(p[0], p[1]), false, p.join(' -> '));
  });
  assert.equal(status.isTerminal('closed'), true);
  assert.equal(status.isTerminal('cancelled'), true);
  assert.deepEqual(status.allowedFrom('bogus'), []);

  var msg = status.checkTransition({ status: 'invoiced', created_at: '2026-03-01' }, 'cancelled');
  assert.match(msg, /from invoiced to cancelled \(allowed: shipped\)/);
  assert.match(status.checkTransition({ status: 'closed' }, 'shipped'), /final status/);
  assert.match(status.checkTransition({ status: 'new' }, 'new'), /already new/);
  assert.match(status.checkTransition({ status: 'new' }, 'lost'), /unknown status/);
});

test('confirmed -> cancelled needs a reason for orders from 2022 on', function () {
  var recent = { id: 1, status: 'confirmed', created_at: '2026-03-01' };
  assert.match(status.checkTransition(recent, 'cancelled'), /reason is required/);
  assert.match(status.checkTransition(recent, 'cancelled', '   '), /reason is required/);
  assert.equal(status.checkTransition(recent, 'cancelled', 'customer changed mind'), null);

  // pre-2022 orders were never asked for a reason and stay exempt
  assert.equal(status.checkTransition({ status: 'confirmed', created_at: '2021-11-30' }, 'cancelled'), null);
  // and 'new' orders never needed one
  assert.equal(status.checkTransition({ status: 'new', created_at: '2026-03-01' }, 'cancelled'), null);
});

test('buildPatch appends history without touching the original row', function () {
  var order = { id: 7, status: 'confirmed', created_at: '2026-03-01' };
  var patch = status.buildPatch(order, 'cancelled', { reason: ' duplicate ', staffId: 3, at: '2026-03-02T10:00:00.000Z' });
  assert.equal(order.status_history, undefined);
  assert.equal(patch.cancel_reason, 'duplicate');
  assert.deepEqual(patch.status_history, [
    { from: 'confirmed', to: 'cancelled', at: '2026-03-02T10:00:00.000Z', staff_id: 3, reason: 'duplicate' },
  ]);

  var withHistory = { status: 'shipped', status_history: [{ from: 'invoiced', to: 'shipped' }] };
  assert.equal(status.buildPatch(withHistory, 'closed', { at: 'x' }).status_history.length, 2);
  assert.equal(withHistory.status_history.length, 1);
});

test('applyTransition on seed data: ship + close, refuse bad moves', function (t, done) {
  tmpStore([{ id: 900, customer_id: 1, created_at: '2021-06-01', status: 'confirmed', lines: [] }]);
  // seed orders are 'invoiced' and have no status_history at all
  status.applyTransition(1, 'shipped', { staffId: 5 }, function (err, order, problem) {
    assert.ifError(err);
    assert.equal(problem, null);
    assert.equal(order.status_history[0].from, 'invoiced');
    status.applyTransition(1, 'closed', function (err2, closed) {
      assert.ifError(err2);
      assert.equal(closed.status, 'closed');
      assert.equal(closed.status_history.length, 2);
      status.applyTransition(2, 'cancelled', { reason: 'too late' }, function (err3, o2, problem3) {
        assert.ifError(err3);
        assert.match(problem3, /cannot move order from invoiced/);
        assert.equal(o2.status, 'invoiced');
        status.applyTransition(900, 'cancelled', {}, function (err4, old, problem4) {
          assert.ifError(err4);
          assert.equal(problem4, null, 'pre-2022 confirmed order cancels without a reason');
          assert.equal(old.cancel_reason, null);
          status.applyTransition(4242, 'shipped', {}, function (err5, missing, problem5) {
            assert.equal(missing, null);
            assert.equal(problem5, 'order not found');
            done();
          });
        });
      });
    });
  });
});
