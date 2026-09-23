#!/usr/bin/env node
/**
 * node bin/render-invoice.js INV-2026-00007 > invoice.html
 */
var store = require('../lib/store');
var render = require('../lib/invoices/render');

var number = process.argv[2];
if (!number) {
  console.error('usage: render-invoice.js <invoice number>');
  process.exit(2);
}

store.where('invoices', function (i) { return i.number === number; }, function (err, found) {
  if (err) throw err;
  if (!found.length) {
    console.error('no such invoice: ' + number);
    process.exit(1);
  }
  store.find('customers', found[0].customer_id, function (err2, customer) {
    if (err2) throw err2;
    process.stdout.write(render.renderInvoiceHtml(found[0], customer));
  });
});
