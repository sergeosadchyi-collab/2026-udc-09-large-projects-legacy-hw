/**
 * Invoice -> HTML.
 *
 * We used to render through templates/, which was dropped in 2020 when the
 * PDF service went away; the string building below is what actually runs now.
 */
var format = require('../format');

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lineRow(line) {
  return (
    '<tr>' +
    '<td>' + esc(line.title) + '</td>' +
    '<td class="num">' + esc(line.qty) + '</td>' +
    '<td class="num">' + esc(format.formatMoney(line.unit_price_kopecks)) + '</td>' +
    '<td class="num">' + esc(format.formatMoney(line.qty * line.unit_price_kopecks)) + '</td>' +
    '</tr>'
  );
}

/**
 * @param {object} invoice   row from invoices.json
 * @param {object} customer  row from customers.json
 */
function renderInvoiceHtml(invoice, customer) {
  var lines = invoice.lines || [];
  var html = '';
  html += '<!doctype html><html lang="uk"><head><meta charset="utf-8">';
  html += '<title>Рахунок ' + esc(invoice.number) + '</title></head><body>';
  html += '<h1>Рахунок-фактура № ' + esc(invoice.number) + '</h1>';
  html += '<p class="dates">Дата: <b>' + esc(format.formatDateUk(invoice.issued_at)) + '</b>';
  html += '  Сплатити до: <b>' + esc(format.formatDateUk(invoice.due_at)) + '</b></p>';
  html += '<p class="customer">Платник: ' + esc(customer ? customer.name : '—');
  if (customer && customer.edrpou) html += ' (ЄДРПОУ ' + esc(customer.edrpou) + ')';
  html += '</p>';
  html += '<table><thead><tr><th>Позиція</th><th>К-сть</th><th>Ціна</th><th>Сума</th></tr></thead><tbody>';
  lines.forEach(function (l) {
    html += lineRow(l);
  });
  html += '</tbody></table>';
  html += '<p class="total">Разом без ПДВ: ' + esc(format.formatMoney(invoice.subtotal_kopecks)) + '</p>';
  html += '<p class="total">ПДВ ' + esc(format.formatPercent(invoice.vat_rate)) + ': ' + esc(format.formatMoney(invoice.vat_kopecks)) + '</p>';
  html += '<p class="total grand">До сплати: ' + esc(format.formatMoney(invoice.total_kopecks)) + '</p>';
  html += '</body></html>';
  return html;
}

module.exports = { renderInvoiceHtml: renderInvoiceHtml };
