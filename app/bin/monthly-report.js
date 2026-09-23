#!/usr/bin/env node
/**
 * Monthly management report.
 *
 *   node bin/monthly-report.js            # previous calendar month, text
 *   node bin/monthly-report.js 2026-03    # a given month
 *   node bin/monthly-report.js 2026-03 --json
 *
 * Cron: 07:00 on the 1st (ops/crontab on the old box pipes stdout into mail
 * for the director and accounting). Prints to stdout, writes nothing.
 */
var reports = require('../lib/reports');
var render = require('../lib/reports/render');
var dates = require('../lib/reports/dates');
var config = require('../config/default.json');

var args = process.argv.slice(2);
var asJson = args.indexOf('--json') !== -1;
var month = args.filter(function (a) { return a.indexOf('--') !== 0; })[0];

if (!month) month = dates.addMonths(dates.monthKey(dates.todayIso()), -1);
if (!dates.isMonthKey(month)) {
  console.error('usage: monthly-report.js [YYYY-MM] [--json]');
  process.exit(2);
}

var monthEnd = dates.lastDayOfMonth(month);
var range = { from: month, to: month };

reports.loadAll(['invoices', 'payments', 'customers'], function (err, invoices, payments, customers) {
  if (err) {
    console.error('monthly-report: ' + err.message);
    process.exit(1);
  }
  var parts = {
    revenue: reports.revenueByMonth(invoices, range),
    vat: reports.vatSummary(invoices, range),
    top_customers: reports.topCustomers(invoices, customers, { from: month, to: month, limit: 5 }),
    aging: reports.aging(invoices, payments, customers, monthEnd),
  };

  if (asJson) {
    process.stdout.write(render.toJson(Object.assign({ report: 'monthly', month: month, label: dates.monthName(month) }, parts)));
    return;
  }

  var title = config.company.name + ' — звіт за ' + dates.monthName(month);
  var out = [title, new Array(title.length + 1).join('='), ''];
  out.push(render.renderText(parts.revenue));
  out.push(render.renderText(parts.vat));
  out.push(render.renderText(parts.top_customers));
  out.push(render.renderText(parts.aging));
  out.push('Згенеровано ' + dates.todayIso() + ', bin/monthly-report.js');
  process.stdout.write(out.join('\n') + '\n');
});
