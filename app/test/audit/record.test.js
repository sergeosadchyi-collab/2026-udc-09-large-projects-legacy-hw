var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var audit = require('../../lib/audit');

// audit.log is created on demand, so point at a directory that does not exist yet
function tmpAudit() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-audit-'));
  var dir = path.join(root, 'nested', 'out');
  audit.open(dir);
  return { root: root, dir: dir, log: path.join(dir, 'audit.log') };
}

function cleanup(t, tmp) {
  t.after(function () {
    audit.open();
    audit.setClock(null);
    fs.rmSync(tmp.root, { recursive: true, force: true });
  });
}

function at(iso) {
  return function () { return new Date(iso); };
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(function (l) {
    return JSON.parse(l);
  });
}

test('diff keeps only changed fields, masks secrets, compares nested values whole', function () {
  var before = { id: 3, status: 'issued', updated_at: '2026-03-01', iban: 'X1', lines: [{ qty: 1 }] };
  var after = { id: 3, status: 'paid', updated_at: '2026-03-05', iban: 'X2', lines: [{ qty: 2 }], paid_at: '2026-03-05' };
  assert.deepEqual(audit.diff(before, after), {
    status: { from: 'issued', to: 'paid' },
    iban: { from: '***', to: '***' },
    lines: { from: [{ qty: 1 }], to: [{ qty: 2 }] },
    paid_at: { from: null, to: '2026-03-05' },
  });
  assert.deepEqual(audit.diff({ a: [1, 2] }, { a: [1, 2] }), {});
  assert.deepEqual(audit.diff(null, { id: 9, name: 'N' }), { id: { from: null, to: 9 }, name: { from: null, to: 'N' } });
  assert.deepEqual(audit.diff({ id: 9 }, null), { id: { from: 9, to: null } });
});

test('record creates the directory, appends one JSON line per change, skips no-ops', function (t, done) {
  var tmp = tmpAudit();
  cleanup(t, tmp);
  audit.setClock(at('2026-03-02T09:14:07.120Z'));
  audit.record(7, 'update', 'invoices', 12, { status: 'issued' }, { status: 'paid' }, function (err, entry) {
    assert.ifError(err);
    assert.equal(entry.ts, '2026-03-02T09:14:07.120Z');
    audit.record(0, 'create', 'payments', 5, null, { amount_kopecks: 100 }, function (err2) {
      assert.ifError(err2);
      var lines = readLines(tmp.log);
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], {
        ts: '2026-03-02T09:14:07.120Z',
        staff_id: 7,
        action: 'update',
        entity: 'invoices',
        entity_id: 12,
        changes: { status: { from: 'issued', to: 'paid' } },
      });
      assert.equal(lines[1].staff_id, 0);
      assert.equal(lines[1].action, 'create');
      // no-op save (only updated_at moved) is not logged
      audit.record(1, 'update', 'customers', 1, { name: 'A', updated_at: '1' }, { name: 'A', updated_at: '2' }, function (err3, noop) {
        assert.ifError(err3);
        assert.equal(noop, null);
        assert.equal(readLines(tmp.log).length, 2);
        audit.record(1, 'update', '', 1, {}, { a: 1 }, function (err4) {
          assert.match(err4.message, /entity/);
          done();
        });
      });
    });
  });
});

test('parallel records all land, one per line', function (t, done) {
  var tmp = tmpAudit();
  cleanup(t, tmp);
  var left = 25;
  for (var i = 1; i <= 25; i++) {
    audit.record(3, 'update', 'orders', i, { status: 'new' }, { status: 'confirmed' }, function (err) {
      assert.ifError(err);
      if (--left) return;
      var ids = readLines(tmp.log).map(function (e) { return e.entity_id; });
      assert.equal(ids.length, 25);
      assert.equal(new Set(ids).size, 25);
      done();
    });
  }
});

test('query by entity/id and by date range, skipping a corrupt line', function (t, done) {
  var tmp = tmpAudit();
  cleanup(t, tmp);
  var rows = [
    ['2026-01-10T10:00:00Z', 'invoices', 1],
    ['2026-02-15T10:00:00Z', 'invoices', 2],
    ['2026-02-20T23:59:59Z', 'invoices', 1],
    ['2026-03-01T00:00:00Z', 'customers', 1],
  ];
  (function next(i) {
    if (i < rows.length) {
      audit.setClock(at(rows[i][0]));
      return audit.record(2, 'update', rows[i][1], rows[i][2], { s: 0 }, { s: i + 1 }, function (err) {
        assert.ifError(err);
        next(i + 1);
      });
    }
    fs.appendFileSync(tmp.log, '{"ts":"2026-02-1\n');
    audit.history('invoices', '1', function (err, found) {
      assert.ifError(err);
      assert.deepEqual(found.map(function (e) { return e.ts.slice(0, 10); }), ['2026-01-10', '2026-02-20']);
      audit.between('2026-02-01', new Date('2026-02-20T12:00:00Z'), function (err2, feb) {
        assert.ifError(err2);
        assert.equal(feb.length, 2);
        audit.query({ entity: 'customers', from: '2026-03-01', to: '2026-03-01' }, function (err3, mar) {
          assert.ifError(err3);
          assert.equal(mar.length, 1);
          assert.equal(mar[0].entity_id, 1);
          done();
        });
      });
    });
  })(0);
});
