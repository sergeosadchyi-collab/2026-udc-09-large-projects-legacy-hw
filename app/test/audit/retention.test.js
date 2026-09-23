var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var audit = require('../../lib/audit');
var retention = require('../../lib/audit/retention');

function entry(ts, id) {
  return JSON.stringify({ ts: ts, staff_id: 1, action: 'update', entity: 'invoices', entity_id: id, changes: {} });
}

function seed(t, lines) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-audit-ret-'));
  fs.writeFileSync(path.join(dir, 'audit.log'), lines.join('\n') + '\n');
  audit.open(dir);
  audit.setClock(function () {
    return new Date('2026-06-15T03:10:00Z');
  });
  t.after(function () {
    audit.open();
    audit.setClock(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function lineCount(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
}

test('rotate moves old entries into monthly archive files and keeps the rest', function (t, done) {
  var dir = seed(t, [
    entry('2026-01-05T08:00:00.000Z', 1),
    entry('2026-01-31T23:30:00.000Z', 2),
    entry('2026-02-10T08:00:00.000Z', 3),
    'not json at all',
    entry('2026-05-20T08:00:00.000Z', 4),
  ]);
  retention.rotate(90, function (err, r) {
    assert.ifError(err);
    assert.equal(r.archived, 3);
    assert.equal(r.kept, 2);
    assert.deepEqual(r.months, ['2026-01', '2026-02']);
    assert.equal(r.cutoff, '2026-03-17T03:10:00.000Z');
    assert.equal(lineCount(path.join(dir, 'audit-archive', '2026-01.jsonl')), 2);
    assert.equal(lineCount(path.join(dir, 'audit-archive', '2026-02.jsonl')), 1);
    var left = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8');
    assert.match(left, /not json at all/);
    assert.equal(audit.parseLog(left).entries[0].entity_id, 4);
    assert.equal(fs.existsSync(path.join(dir, 'audit.log.tmp')), false);
    done();
  });
});

test('a second run appends to the month file instead of overwriting it', function (t, done) {
  var dir = seed(t, [entry('2026-01-05T08:00:00.000Z', 1)]);
  retention.rotate(30, function (err) {
    assert.ifError(err);
    fs.appendFileSync(path.join(dir, 'audit.log'), entry('2026-01-06T08:00:00.000Z', 2) + '\n');
    retention.rotate(30, function (err2, r) {
      assert.ifError(err2);
      assert.equal(r.archived, 1);
      assert.equal(r.kept, 0);
      assert.equal(lineCount(path.join(dir, 'audit-archive', '2026-01.jsonl')), 2);
      assert.equal(fs.readFileSync(path.join(dir, 'audit.log'), 'utf8'), '');
      done();
    });
  });
});

test('nothing to do: missing log, nothing old enough, bad days', function (t, done) {
  var dir = seed(t, [entry('2026-06-01T08:00:00.000Z', 1)]);
  retention.rotate(365, function (err, r) {
    assert.ifError(err);
    assert.deepEqual([r.archived, r.kept], [0, 1]);
    assert.equal(fs.existsSync(path.join(dir, 'audit-archive')), false);
    fs.unlinkSync(path.join(dir, 'audit.log'));
    retention.rotate(365, function (err2, r2) {
      assert.ifError(err2);
      assert.equal(r2.archived, 0);
      retention.rotate('abc', function (err3) {
        assert.match(err3.message, /positive number/);
        done();
      });
    });
  });
});

test('query with includeArchive reads archived months that overlap the range', function (t, done) {
  seed(t, [
    entry('2026-01-05T08:00:00.000Z', 1),
    entry('2026-02-10T08:00:00.000Z', 1),
    entry('2026-06-01T08:00:00.000Z', 1),
  ]);
  retention.rotate(60, function (err) {
    assert.ifError(err);
    audit.history('invoices', 1, function (err2, live) {
      assert.ifError(err2);
      assert.equal(live.length, 1);
      audit.query({ entity: 'invoices', id: 1, from: '2026-02-01', includeArchive: true }, function (err3, rows) {
        assert.ifError(err3);
        assert.deepEqual(rows.map(function (e) { return e.ts.slice(0, 7); }), ['2026-02', '2026-06']);
        done();
      });
    });
  });
});
