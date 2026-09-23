var test = require('node:test');
var assert = require('node:assert/strict');
var dates = require('../../lib/reports/dates');
var table = require('../../lib/reports/table');
var render = require('../../lib/reports/render');

test('date helpers: Ukrainian month names, strict ISO, UTC-only arithmetic', function () {
  assert.equal(dates.monthName('2026-03'), 'березень 2026');
  assert.equal(dates.monthName('2025-12-31'), 'грудень 2025');
  assert.equal(dates.isIsoDate('2026-02-30'), false);
  assert.equal(dates.isIsoDate('31.03.2026'), false);
  assert.equal(dates.isMonthKey('2026-13'), false);
  assert.equal(dates.daysBetween('2026-03-28', '2026-03-30'), 2); // DST switch in Kyiv
  assert.equal(dates.addMonths('2026-01', -1), '2025-12');
  assert.equal(dates.addMonths('2025-12', 1), '2026-01');
  assert.equal(dates.lastDayOfMonth('2028-02'), '2028-02-29');
});

test('fmtAmount and TextTable: padding, right alignment, cutting', function () {
  assert.equal(table.fmtAmount(1234567), '12 345,67');
  assert.equal(table.fmtAmount(-5), '-0,05');
  var t = new table.TextTable([
    { key: 'name', title: 'Назва', max: 12 },
    { key: 'sum', title: 'Сума', align: 'right', money: true },
  ]);
  t.add({ name: 'ТОВ «Дуже Довга Назва»', sum: 100 }).add({ name: 'Б', sum: 123456789 });
  var lines = t.toString().split('\n');
  assert.equal(lines[1], '------------  ------------');
  assert.equal(lines[2], 'ТОВ «Дуже Д…          1,00');
  assert.equal(lines[3], 'Б             1 234 567,89');
});

test('revenue as text and any report as JSON', function () {
  var report = {
    report: 'revenue',
    from: '2026-02',
    to: '2026-03',
    rows: [
      { month: '2026-02', label: 'лютий 2026', invoices: 1, net_kopecks: 100000, vat_kopecks: 20000, gross_kopecks: 120000 },
      { month: '2026-03', label: 'березень 2026', invoices: 2, net_kopecks: 50, vat_kopecks: 10, gross_kopecks: 60 },
    ],
    totals: { invoices: 3, net_kopecks: 100050, vat_kopecks: 20010, gross_kopecks: 120060 },
  };
  var text = render.renderText(report);
  assert.match(text, /Період: лютий 2026 — березень 2026/);
  assert.match(text, /\nлютий 2026 +1 +1 000,00 +200,00 +1 200,00\n/);
  assert.match(text, /\nУсього +3 +1 000,50 +200,10 +1 200,60\n/);

  var json = JSON.parse(render.toJson(report, '2026-04-01T07:00:00.000Z'));
  assert.equal(json.generated_at, '2026-04-01T07:00:00.000Z');
  assert.equal(json.rows[1].label, 'березень 2026');
  assert.throws(function () { render.renderText({ report: 'nope' }); }, /unknown report/);
});
