#!/usr/bin/env node
/**
 * Cron: 09:00 on working days. "Sends" = writes to the outbox dir; the old
 * SMTP relay picks files up from there.
 */
var fs = require('fs');
var path = require('path');
var store = require('../lib/store');
var reminders = require('../lib/notifications/reminders');
var config = require('../config/default.json');

var today = process.argv[2] || new Date().toISOString().slice(0, 10);

store.all('customers', function (err, customers) {
  if (err) throw err;
  store.all('invoices', function (err2, invoices) {
    if (err2) throw err2;
    var byId = {};
    customers.forEach(function (c) { byId[c.id] = c; });
    var mails = reminders.buildReminders(invoices, byId, today);
    var dir = path.join(__dirname, '..', config.mail.outbox);
    fs.mkdirSync(dir, { recursive: true });
    mails.forEach(function (m, i) {
      var name = today + '-' + m.kind + '-' + m.invoice_id + '.txt';
      fs.writeFileSync(path.join(dir, name), 'To: ' + m.to + '\nSubject: ' + m.subject + '\n\n' + m.text + '\n', 'utf8');
    });
    console.log(mails.length + ' reminder(s) queued');
  });
});
