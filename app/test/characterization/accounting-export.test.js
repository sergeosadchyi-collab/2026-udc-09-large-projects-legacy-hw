/**
 * BILL-482 characterization — consumer #3: the nightly file for Облік-Плюс.
 *
 * Read by: ANOTHER SYSTEM (the accounting server picks the file up at 06:00).
 * This output MUST NOT change. The ticket is about what customers see; the
 * accounting import expects MM/DD/YYYY because their server runs a US locale
 * (app/docs/integrations/oblik-plus.md).
 *
 * Why grep for "formatDate" does not find this consumer:
 * lib/export/accounting.js resolves the helper DYNAMICALLY —
 *   var render = format['format' + col.type];
 * with col.type coming from config/export-columns.json ("type": "Date").
 *
 * Why a silent break is the real danger: Облік-Плюс does not fail on a row
 * with an unexpected date format, it SKIPS the row and writes a warning into
 * a log nobody reads. In February 2021 40 invoices were lost that way and the
 * tests were green. Hence this golden master.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var store = require('../../lib/store');
var accounting = require('../../lib/export/accounting');
var columns = require('../../config/export-columns.json');
var assertGolden = require('./golden').assertGolden;

function nightlyFile() {
  var by = {};
  store.loadSync('customers').forEach(function (c) {
    by[c.id] = c;
  });
  return accounting.buildAccountingFile(store.loadSync('invoices'), by);
}

test('characterization: the whole nightly export file (golden master)', function () {
  assertGolden('oblik-export.csv', nightlyFile());
});

// The golden master above would also catch this, but these spell out WHICH
// part of the file is a contract with Облік-Плюс, so a future reader knows
// what may never be "fixed".
test('contract: Облік-Плюс date columns are MM/DD/YYYY', function () {
  var rows = nightlyFile().split('\r\n').filter(Boolean);
  var header = rows.shift().split(';');
  var docDate = header.indexOf('DocDate');
  var payUntil = header.indexOf('PayUntil');
  assert.ok(docDate !== -1 && payUntil !== -1);

  assert.ok(rows.length > 0);
  rows.forEach(function (line) {
    var cells = line.split(';');
    assert.match(cells[docDate], /^\d{2}\/\d{2}\/\d{4}$/, 'DocDate in: ' + line);
    assert.match(cells[payUntil], /^\d{2}\/\d{2}\/\d{4}$/, 'PayUntil in: ' + line);
  });

  // invoice 1: issued_at 2026-03-01, due_at 2026-03-15 -> month first
  assert.match(nightlyFile(), /\r\nINV-2026-00001;03\/01\/2026;03\/15\/2026;/);
});

test('contract: separator ";", CRLF line endings, header first, drafts excluded', function () {
  var text = nightlyFile();
  assert.equal(text.indexOf('DocNo;DocDate;PayUntil;'), 0);
  assert.ok(text.indexOf('\r\n') !== -1);
  assert.equal(text.replace(/\r\n/g, ''), text.replace(/\r\n/g, '').replace(/\n/g, ''), 'no bare LF');
  assert.ok(/\r\n$/.test(text), 'file ends with CRLF');

  var dataRows = text.split('\r\n').filter(Boolean).slice(1);
  assert.equal(dataRows.length, store.loadSync('invoices').filter(function (i) {
    return i.status !== 'draft';
  }).length);
});

test('contract: amounts are dot-decimal without spaces and without "грн"', function () {
  var rows = nightlyFile().split('\r\n').filter(Boolean);
  var header = rows.shift().split(';');
  ['NetAmount', 'Vat', 'Amount'].forEach(function (name) {
    var idx = header.indexOf(name);
    assert.ok(idx !== -1, name + ' column');
    rows.forEach(function (line) {
      assert.match(line.split(';')[idx], /^-?\d+\.\d{2}$/, name + ' in: ' + line);
    });
  });
});

test('contract: column types in export-columns.json still map onto lib/format helpers', function () {
  // this mapping is the reason grep does not find the consumer — pin it
  assert.deepEqual(
    columns.map(function (c) {
      return c.field + ':' + c.type;
    }),
    [
      'number:Text',
      'issued_at:Date',
      'due_at:Date',
      'customer_edrpou:Text',
      'customer_name:Text',
      'subtotal_kopecks:Decimal',
      'vat_kopecks:Decimal',
      'total_kopecks:Decimal',
    ],
  );
});

