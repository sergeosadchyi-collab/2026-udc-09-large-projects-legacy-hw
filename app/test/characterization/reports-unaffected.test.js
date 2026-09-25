/**
 * BILL-482 characterization — the NON-consumers.
 *
 * These outputs also contain dates, which makes them look like consumers, but
 * lib/reports has its own date helpers (lib/reports/dates.js) and its own
 * money formatter (lib/reports/table.js) and never requires lib/format.js.
 *
 * Recorded so that "collateral damage" is impossible to miss: if changing
 * formatDate moves any of these, the change reached further than the ticket.
 *
 * Read by: the monthly text report — HUMANS (director, accounting);
 *          the JSON — ANOTHER SYSTEM (the BI spreadsheet, lib/reports/render.js).
 * Expected after the ticket: NOTHING changes here.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var store = require('../../lib/store');
var reports = require('../../lib/reports');
var render = require('../../lib/reports/render');
var assertGolden = require('./golden').assertGolden;

var MONTH = '2026-03';
var AS_OF = '2026-03-31';
var RANGE = { from: MONTH, to: MONTH };

function parts() {
  var invoices = store.loadSync('invoices');
  var payments = store.loadSync('payments');
  var customers = store.loadSync('customers');
  return {
    revenue: reports.revenueByMonth(invoices, RANGE),
    vat: reports.vatSummary(invoices, RANGE),
    top_customers: reports.topCustomers(invoices, customers, { from: MONTH, to: MONTH, limit: 5 }),
    aging: reports.aging(invoices, payments, customers, AS_OF),
  };
}

test('characterization: monthly report text (the cron mail for the director)', function () {
  var p = parts();
  var out = [
    render.renderText(p.revenue),
    render.renderText(p.vat),
    render.renderText(p.top_customers),
    render.renderText(p.aging),
  ].join('');
  assertGolden('monthly-report-2026-03.txt', out);
});

test('characterization: aging report JSON (the BI spreadsheet)', function () {
  // generated_at is passed explicitly so the golden master stays deterministic
  assertGolden('aging-2026-03-31.json', render.toJson(parts().aging, '2026-03-31T00:00:00.000Z'));
});

test('reports print raw ISO dates and must NOT be touched by BILL-482', function () {
  var p = parts();
  var text = render.renderText(p.aging);
  assert.match(text, /станом на 2026-03-31/);
  // the detail table prints issued_at / due_at straight from the store
  assert.match(text, /2026-03-\d{2}/);
  assert.ok(text.indexOf('03/31/2026') === -1, 'reports never used the MM/DD/YYYY formatter');

  var json = JSON.parse(render.toJson(p.aging, 'x'));
  assert.equal(json.as_of, '2026-03-31');
  json.rows.forEach(function (r) {
    assert.match(r.issued_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.due_at, /^\d{4}-\d{2}-\d{2}$/);
  });
});

test('lib/reports does not depend on lib/format', function () {
  var fs = require('fs');
  var path = require('path');
  var dir = path.join(__dirname, '..', '..', 'lib', 'reports');
  fs.readdirSync(dir).forEach(function (f) {
    var src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(src.indexOf("require('../format')") === -1, f + ' must not require lib/format');
  });
});

test('the store keeps dates in ISO — BILL-482 changes display only', function () {
  store.loadSync('invoices').forEach(function (i) {
    assert.match(i.issued_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(i.due_at, /^\d{4}-\d{2}-\d{2}$/);
  });
});

