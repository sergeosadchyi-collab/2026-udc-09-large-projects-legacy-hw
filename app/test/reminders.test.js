var test = require('node:test');
var assert = require('node:assert/strict');
var reminders = require('../lib/notifications/reminders');

var inv = { id: 5, number: 'INV-2026-00005', status: 'issued', due_at: '2026-03-12', total_kopecks: 99900, customer_id: 1 };
var customers = { 1: { id: 1, email: 'client1@example.invalid', contact_name: 'Ірина' } };

test('upcoming reminder exactly 3 days before due', function () {
  assert.equal(reminders.reminderKind(inv, '2026-03-09'), 'upcoming');
  assert.equal(reminders.reminderKind(inv, '2026-03-10'), null);
});

test('overdue reminder once', function () {
  assert.equal(reminders.reminderKind(inv, '2026-03-13'), 'overdue');
  assert.equal(reminders.reminderKind(Object.assign({}, inv, { overdue_reminded: true }), '2026-03-13'), null);
});

test('no reminders for paid, cancelled or draft invoices', function () {
  ['paid', 'cancelled', 'draft'].forEach(function (s) {
    assert.equal(reminders.reminderKind(Object.assign({}, inv, { status: s }), '2026-03-13'), null);
  });
});

test('reminder mail addresses the contact and names the amount', function () {
  var mails = reminders.buildReminders([inv], customers, '2026-03-09');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'client1@example.invalid');
  assert.match(mails[0].text, /^Ірина,/);
  assert.match(mails[0].text, /999,00 грн/);
});
