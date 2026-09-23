var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var statement = require('../../lib/payments/statement');

var SAMPLE = path.join(__dirname, '..', '..', 'data', 'statements', '2026-03-sample.txt');

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}
function zeros(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}
function header() {
  return 'H' + pad('UA000000000000000000000000000', 29) + '01032026' + '31032026' + 'UAH';
}
function detail(date, dir, kop, edrpou, name, ref, purpose) {
  return 'D' + date + dir + zeros(kop, 15) + pad(edrpou, 8) + pad(name, 40) + pad(ref, 16) + (purpose || '');
}
function trailer(count, cr, dr) {
  return 'T' + zeros(count, 6) + zeros(cr, 15) + zeros(dr, 15);
}

test('sample statement parses cleanly and matches its trailer', function () {
  var parsed = statement.parseStatement(fs.readFileSync(SAMPLE, 'utf8'));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries.length, 14);
  assert.equal(parsed.header.from, '2026-03-01');
  assert.equal(parsed.header.to, '2026-03-31');
  assert.deepEqual(parsed.entries[0], {
    line: 2,
    date: '2026-03-04',
    direction: 'CR',
    amount_kopecks: 154200,
    payer_edrpou: '10000002',
    payer_name: 'ТОВ «Липовий Цвіт»',
    bank_ref: 'PP26030400117',
    purpose: 'Оплата згідно рах. INV-2026-00002 від 02.03.2026, у т.ч. ПДВ 257.00 грн',
  });
  var bank = parsed.entries.filter(function (e) { return e.direction === 'DR'; });
  assert.equal(bank.length, 1);
  assert.equal(bank[0].payer_edrpou, null);
});

test('tolerates BOM, CRLF and stripped trailing spaces', function () {
  var line = detail('02032026', 'CR', 5000, '', 'Вигаданенко В.В.', 'PP1', '').replace(/\s+$/, '');
  var text = '\uFEFF' + [header(), line, trailer(1, 5000, 0)].join('\r\n') + '\r\n';
  var parsed = statement.parseStatement(text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries[0].bank_ref, 'PP1');
  assert.equal(parsed.entries[0].purpose, '');
});

test('space-padded amounts are accepted', function () {
  var line = detail('02032026', 'CR', 0, '10000001', 'X', 'PP2', 'a').replace('000000000000000', '           4200');
  var parsed = statement.parseStatement([header(), line, trailer(1, 4200, 0)].join('\n'));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries[0].amount_kopecks, 4200);
});

test('bad dates, amounts and directions are reported with line numbers', function () {
  var lines = [
    header(),
    detail('31022026', 'CR', 100, '', 'X', 'R1', 'a'),
    detail('01032026', 'XX', 100, '', 'X', 'R2', 'b'),
    detail('01032026', 'CR', 100, '', 'X', 'R3', 'c').replace('000000000000100', '00000000000010A'),
    trailer(3, 200, 0),
  ];
  var parsed = statement.parseStatement(lines.join('\n'));
  var byLine = parsed.errors.map(function (e) { return e.line; });
  assert.ok(byLine.indexOf(2) !== -1, 'Feb 31 is not a date');
  assert.ok(byLine.indexOf(3) !== -1, 'direction');
  assert.ok(byLine.indexOf(4) !== -1, 'amount');
});

test('truncated file or wrong trailer rejects the statement', function () {
  var d = detail('02032026', 'CR', 5000, '', 'X', 'R1', 'a');
  var noTrailer = statement.parseStatement([header(), d].join('\n'));
  assert.match(noTrailer.errors[0].message, /missing trailer/);

  var wrong = statement.parseStatement([header(), d, trailer(2, 5001, 0)].join('\n'));
  var msgs = wrong.errors.map(function (e) { return e.message; }).join(' | ');
  assert.match(msgs, /trailer says 2 records, found 1/);
  assert.match(msgs, /credit total mismatch/);
});
