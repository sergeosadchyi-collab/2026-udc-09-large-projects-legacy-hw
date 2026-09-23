#!/usr/bin/env node
/**
 * Cron: 02:30 every night (see ops/crontab on the old box).
 * Writes out/export/oblik-YYYY-MM-DD.csv which accounting picks up at 06:00.
 */
var fs = require('fs');
var path = require('path');
var store = require('../lib/store');
var accounting = require('../lib/export/accounting');
var config = require('../config/default.json');

var today = process.argv[2] || new Date().toISOString().slice(0, 10);

store.all('customers', function (err, customers) {
  if (err) throw err;
  store.all('invoices', function (err2, invoices) {
    if (err2) throw err2;
    var byId = {};
    customers.forEach(function (c) {
      byId[c.id] = c;
    });
    var dir = path.join(__dirname, '..', config.export.dir);
    fs.mkdirSync(dir, { recursive: true });
    var file = path.join(dir, config.export.filePrefix + today + '.csv');
    fs.writeFileSync(file, accounting.buildAccountingFile(invoices, byId), 'utf8');
    console.log('export written: ' + path.relative(process.cwd(), file));
  });
});
