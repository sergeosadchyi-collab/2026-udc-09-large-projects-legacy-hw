/**
 * BILL-482 characterization — consumer #2: payment reminder mails.
 *
 * Read by: a HUMAN (the customer). The ticket names these explicitly
 * ("там теж сплатити до 03/12/2026"), so they are EXPECTED to change.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var store = require('../../lib/store');
var reminders = require('../../lib/notifications/reminders');
var assertGolden = require('./golden').assertGolden;

function customersById() {
  var by = {};
  store.loadSync('customers').forEach(function (c) {
    by[c.id] = c;
  });
  return by;
}

/** Same shape bin/send-reminders.js writes into out/mail/<date>-<kind>-<id>.txt */
function mailbox(todayIso) {
  var mails = reminders.buildReminders(store.loadSync('invoices'), customersById(), todayIso);
  return mails
    .map(function (m) {
      return [
        '--- ' + todayIso + '-' + m.kind + '-' + m.invoice_id + '.txt',
        'To: ' + m.to,
        'Subject: ' + m.subject,
        '',
        m.text,
        '',
      ].join('\n');
    })
    .join('\n');
}

// 2026-03-12 produces "upcoming" mails (3 days before due, config.reminders.daysBeforeDue)
test('characterization: reminder outbox for 2026-03-12 (upcoming)', function () {
  var out = mailbox('2026-03-12');
  assert.ok(out.length > 0, 'fixture date must produce at least one mail');
  assertGolden('reminders-2026-03-12.txt', out);
});

// a later date so overdue mails are in the golden master too
test('characterization: reminder outbox for 2026-04-01 (overdue)', function () {
  var out = mailbox('2026-04-01');
  assert.ok(out.indexOf('Прострочено:') !== -1, 'fixture date must produce overdue mails');
  assertGolden('reminders-2026-04-01.txt', out);
});

test('characterization: reminder text prints the due date as DD.MM.YYYY (BILL-482)', function () {
  var inv = {
    id: 5,
    number: 'INV-2026-00005',
    status: 'issued',
    due_at: '2026-03-12',
    total_kopecks: 99900,
    customer_id: 1,
  };
  var mails = reminders.buildReminders([inv], { 1: { id: 1, email: 'c@example.invalid', contact_name: 'Ірина' } }, '2026-03-09');
  // the exact line the ticket quotes: was "слід сплатити до 03/12/2026."
  assert.match(mails[0].text, /слід сплатити до 12\.03\.2026\./);
});

