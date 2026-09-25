/**
 * BILL-482 characterization — the shared function itself.
 *
 * lib/format.js formatDate() is the single place the ticket wants to change.
 * Pinned here including the edge cases, so Task C shows exactly which inputs
 * moved and which did not (empty / invalid input behaviour must stay).
 *
 * NB: the JSDoc above formatDate claims "the date in ISO format". It is wrong
 * — the function returns MM/DD/YYYY. Pinned below is what the CODE does.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var execFile = require('child_process').execFile;
var path = require('path');
var format = require('../../lib/format');

test('characterization: formatDate today returns MM/DD/YYYY', function () {
  assert.equal(format.formatDate('2026-03-09'), '03/09/2026');
  assert.equal(format.formatDate('2026-12-31'), '12/31/2026');
  assert.equal(format.formatDate('2026-01-01'), '01/01/2026');
});

test('BILL-482: formatDateUk returns DD.MM.YYYY for customer-facing output', function () {
  assert.equal(format.formatDateUk('2026-03-09'), '09.03.2026');
  assert.equal(format.formatDateUk('2026-12-31'), '31.12.2026');
  assert.equal(format.formatDateUk('2026-01-01'), '01.01.2026');
});

test('BILL-482: formatDateUk keeps the same edge-case behaviour as formatDate', function () {
  ['', null, undefined, 'not a date'].forEach(function (bad) {
    assert.equal(format.formatDateUk(bad), '', 'input: ' + String(bad));
    assert.equal(format.formatDate(bad), '', 'input: ' + String(bad));
  });
  assert.equal(format.formatDateUk(new Date(Date.UTC(2026, 2, 9))), '09.03.2026');
  assert.equal(format.formatDateUk('2026-03-09T22:30:00Z'), '09.03.2026');
});

test('BILL-482: formatDate is still there for the machine consumer', function () {
  // config/export-columns.json maps "type": "Date" onto format['formatDate'];
  // renaming or repurposing it would silently break the Облік-Плюс import
  assert.equal(typeof format.formatDate, 'function');
  assert.equal(format.formatDate('2026-03-09'), '03/09/2026');
  assert.notEqual(format.formatDate('2026-03-09'), format.formatDateUk('2026-03-09'));
});

test('characterization: formatDate edge cases (these must NOT change)', function () {
  assert.equal(format.formatDate(''), '');
  assert.equal(format.formatDate(null), '');
  assert.equal(format.formatDate(undefined), '');
  assert.equal(format.formatDate('not a date'), '');
  // accepts a Date and a full ISO timestamp, reads them as UTC
  assert.equal(format.formatDate(new Date(Date.UTC(2026, 2, 9))), '03/09/2026');
  assert.equal(format.formatDate('2026-03-09T22:30:00Z'), '03/09/2026');
});

test('characterization: the other format helpers are untouched by BILL-482', function () {
  assert.equal(format.formatMoney(123450), '1 234,50 грн');
  assert.equal(format.formatDecimal(123450), '1234.50');
  assert.equal(format.formatText('  а; б\nв '), 'а б в');
  assert.equal(format.formatPercent(20), '20%');
});

test('characterization: bin/render-invoice.js CLI output', function (t, done) {
  var script = path.join(__dirname, '..', '..', 'bin', 'render-invoice.js');
  execFile(process.execPath, [script, 'INV-2026-00007'], function (err, stdout) {
    assert.ifError(err);
    // same document as the HTTP route serves
    var render = require('../../lib/invoices/render');
    var store = require('../../lib/store');
    var invoice = store.loadSync('invoices').filter(function (i) {
      return i.number === 'INV-2026-00007';
    })[0];
    var customer = store.loadSync('customers').filter(function (c) {
      return c.id === invoice.customer_id;
    })[0];
    assert.equal(stdout, render.renderInvoiceHtml(invoice, customer));
    done();
  });
});

