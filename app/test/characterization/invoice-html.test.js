/**
 * BILL-482 characterization — consumer #1: the HTML invoice.
 *
 * Read by: a HUMAN (the customer). This output is what the ticket is about,
 * so it is EXPECTED to change in Task C.
 *
 * Recorded before the change so the diff of the change is visible.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var store = require('../../lib/store');
var render = require('../../lib/invoices/render');
var assertGolden = require('./golden').assertGolden;

function fixture(number) {
  var invoice = store.loadSync('invoices').filter(function (i) {
    return i.number === number;
  })[0];
  assert.ok(invoice, 'fixture invoice ' + number + ' must exist in data/invoices.json');
  var customer = store.loadSync('customers').filter(function (c) {
    return c.id === invoice.customer_id;
  })[0];
  return { invoice: invoice, customer: customer };
}

test('characterization: invoice HTML (the whole document) — the invoice the customer sees', function () {
  var f = fixture('INV-2026-00007');
  assertGolden('invoice-INV-2026-00007.html', render.renderInvoiceHtml(f.invoice, f.customer));
});

test('characterization: invoice HTML prints dates as DD.MM.YYYY (BILL-482)', function () {
  var f = fixture('INV-2026-00007');
  var html = render.renderInvoiceHtml(f.invoice, f.customer);
  // data: issued_at 2026-03-07, due_at 2026-03-21 — was 03/07/2026 before BILL-482
  assert.match(html, /Дата: <b>07\.03\.2026<\/b>/);
  assert.match(html, /Сплатити до: <b>21\.03\.2026<\/b>/);
  assert.ok(html.indexOf('03/07/2026') === -1, 'no MM/DD/YYYY left in the customer-facing invoice');
});

test('characterization: invoice HTML for an invoice with no customer row', function () {
  var invoice = store.loadSync('invoices').filter(function (i) {
    return i.number === 'INV-2026-00012';
  })[0];
  assertGolden('invoice-INV-2026-00012-no-customer.html', render.renderInvoiceHtml(invoice, null));
});

