/**
 * Nightly file for the accounting department (Облік-Плюс import).
 * Format notes: docs/integrations/oblik-plus.md
 *
 * Columns are configured in config/export-columns.json so accounting can
 * reorder them without a deploy. Each column has a type; the cell is
 * rendered by the matching helper from lib/format.js.
 */
var format = require('../format');
var columns = require('../../config/export-columns.json');

var SEP = ';';
var EOL = '\r\n';

function flatten(invoice, customer) {
  return {
    number: invoice.number,
    issued_at: invoice.issued_at,
    due_at: invoice.due_at,
    customer_edrpou: customer ? customer.edrpou : '',
    customer_name: customer ? customer.name : '',
    subtotal_kopecks: invoice.subtotal_kopecks,
    vat_kopecks: invoice.vat_kopecks,
    total_kopecks: invoice.total_kopecks,
    status: invoice.status,
  };
}

function cell(col, row) {
  var render = format['format' + col.type];
  if (typeof render !== 'function') {
    throw new Error('export-columns.json: unknown column type "' + col.type + '"');
  }
  return render(row[col.field]);
}

/**
 * @param {object[]} invoices
 * @param {object} customersById  id -> customer
 * @returns {string} file contents, header row first
 */
function buildAccountingFile(invoices, customersById) {
  var out = [
    columns
      .map(function (c) {
        return c.header;
      })
      .join(SEP),
  ];
  invoices
    .filter(function (inv) {
      return inv.status !== 'draft';
    })
    .forEach(function (inv) {
      var row = flatten(inv, customersById[inv.customer_id]);
      out.push(
        columns
          .map(function (c) {
            return cell(c, row);
          })
          .join(SEP),
      );
    });
  return out.join(EOL) + EOL;
}

module.exports = { buildAccountingFile: buildAccountingFile };
