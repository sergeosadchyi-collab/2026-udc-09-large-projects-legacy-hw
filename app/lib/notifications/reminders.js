/**
 * Payment reminders: N days before the due date, and once when overdue.
 */
var format = require('../format');
var invoices = require('../invoices');
var config = require('../../config/default.json');

function daysBetween(fromIso, toIso) {
  var a = Date.parse(fromIso + 'T00:00:00Z');
  var b = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/**
 * Decide which reminder (if any) an invoice needs today.
 * @returns {null|'upcoming'|'overdue'}
 */
function reminderKind(invoice, todayIso) {
  if (invoice.status === 'paid' || invoice.status === 'cancelled' || invoice.status === 'draft') return null;
  if (invoices.isOverdue(invoice, todayIso)) return invoice.overdue_reminded ? null : 'overdue';
  var left = daysBetween(todayIso, invoice.due_at);
  if (left === config.reminders.daysBeforeDue && !invoice.upcoming_reminded) return 'upcoming';
  return null;
}

function subject(kind, invoice) {
  return kind === 'overdue'
    ? 'Прострочено: рахунок ' + invoice.number
    : 'Нагадування: рахунок ' + invoice.number;
}

function body(kind, invoice, customer) {
  var who = customer && customer.contact_name ? customer.contact_name : 'Шановний клієнте';
  var lines = [];
  lines.push(who + ',');
  lines.push('');
  if (kind === 'overdue') {
    lines.push(
      'рахунок ' + invoice.number + ' на суму ' + format.formatMoney(invoice.total_kopecks) +
        ' мав бути сплачений до ' + format.formatDateUk(invoice.due_at) + '.',
    );
    lines.push('Якщо ви вже сплатили — просто проігноруйте цей лист.');
  } else {
    lines.push(
      'нагадуємо, що рахунок ' + invoice.number + ' на суму ' + format.formatMoney(invoice.total_kopecks) +
        ' слід сплатити до ' + format.formatDateUk(invoice.due_at) + '.',
    );
  }
  lines.push('');
  lines.push('З повагою,');
  lines.push(config.company.name);
  return lines.join('\n');
}

/**
 * Build the mails due today. Pure: does not send, does not mark anything.
 */
function buildReminders(allInvoices, customersById, todayIso) {
  var out = [];
  allInvoices.forEach(function (inv) {
    var kind = reminderKind(inv, todayIso);
    if (!kind) return;
    var c = customersById[inv.customer_id];
    if (!c || !c.email) return;
    out.push({ to: c.email, subject: subject(kind, inv), text: body(kind, inv, c), invoice_id: inv.id, kind: kind });
  });
  return out;
}

module.exports = { reminderKind: reminderKind, buildReminders: buildReminders };
