var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../lib/store');

function tmpStore(collections) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-store-'));
  Object.keys(collections).forEach(function (name) {
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(collections[name]));
  });
  store.open(dir);
  return dir;
}

test('find / where / insert on a JSON collection', function (t, done) {
  tmpStore({ customers: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
  store.find('customers', 2, function (err, c) {
    assert.ifError(err);
    assert.equal(c.name, 'B');
    store.insert('customers', { name: 'C' }, function (err2, row) {
      assert.ifError(err2);
      assert.equal(row.id, 3);
      store.where('customers', function (x) { return x.id > 1; }, function (err3, rows) {
        assert.ifError(err3);
        assert.equal(rows.length, 2);
        store.open();
        done();
      });
    });
  });
});

test('missing collection reads as empty', function (t, done) {
  tmpStore({});
  store.all('nothing', function (err, rows) {
    assert.ifError(err);
    assert.deepEqual(rows, []);
    store.open();
    done();
  });
});
