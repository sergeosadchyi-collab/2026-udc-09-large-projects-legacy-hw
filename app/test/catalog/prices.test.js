var test = require('node:test');
var assert = require('node:assert/strict');
var catalog = require('../../lib/catalog');
var priceImport = require('../../lib/catalog/price-import');

test('parseHrn accepts both decimal marks, spaces and "грн", rejects junk', function () {
  assert.equal(priceImport.parseHrn('12,50'), 1250);
  assert.equal(priceImport.parseHrn('12.50'), 1250);
  assert.equal(priceImport.parseHrn('12,5'), 1250);
  assert.equal(priceImport.parseHrn('12'), 1200);
  assert.equal(priceImport.parseHrn('19.99'), 1999);
  assert.equal(priceImport.parseHrn('1\u00a0250,00'), 125000);
  assert.equal(priceImport.parseHrn(' 95,50 грн'), 9550);
  // ambiguous marks, three decimals, negatives and junk are not prices
  ['1.250,00', '12,505', '-5', 'abc', '', '12,50,1', null, undefined].forEach(function (v) {
    assert.equal(priceImport.parseHrn(v), null, 'expected null for ' + JSON.stringify(v));
  });
});

test('parsePriceFile skips header, comments, BOM and blank lines, reports bad rows', function () {
  var text = '\uFEFFsku;price\r\n# from purchasing\r\nSKU-1000;95,50\r\n\r\nsku-1001;101.00;новий постачальник\r\nSKU-1002\r\nSKU-1003;0\r\nSKU-1004;дорого\r\n';
  var parsed = priceImport.parsePriceFile(text);
  assert.deepEqual(parsed.rows, [
    { line: 3, sku: 'SKU-1000', price_kopecks: 9550, note: '' },
    { line: 5, sku: 'SKU-1001', price_kopecks: 10100, note: 'новий постачальник' },
  ]);
  assert.deepEqual(
    parsed.errors.map(function (e) { return [e.line, e.reason]; }),
    [[6, 'expected "sku;price"'], [7, 'zero price'], [8, 'bad price "дорого"']],
  );
});

test('price lists: wholesale is 7% off, dealer 12% off rounded down to 10 kopecks', function () {
  var p = { price_kopecks: 13750 };
  assert.equal(catalog.priceFor(p, 'base'), 13750);
  assert.equal(catalog.priceFor(p), 13750);
  assert.equal(catalog.priceFor(p, 'wholesale'), 12788); // 12787.5 rounds up
  assert.equal(catalog.priceFor(p, 'dealer'), 12100);
  assert.equal(catalog.priceFor({ price_kopecks: 2750 }, 'dealer'), 2420);
  assert.throws(function () {
    catalog.priceFor(p, 'vip');
  }, /unknown price list/);
});
