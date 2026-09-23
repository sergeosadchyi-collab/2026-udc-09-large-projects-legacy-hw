/**
 * Report output: fixed-width text (mail, terminal) and JSON (API, the BI
 * spreadsheet that Olena pulls every Monday).
 */
var TextTable = require('./table').TextTable;
var fmtAmount = require('./table').fmtAmount;
var dates = require('./dates');

function period(report) {
  if (!report.from && !report.to) return 'Період: увесь час';
  return 'Період: ' + (report.from ? dates.monthName(report.from) : '…') + ' — ' + (report.to ? dates.monthName(report.to) : '…');
}

function revenueText(report) {
  var t = new TextTable([
    { key: 'label', title: 'Місяць' },
    { key: 'invoices', title: 'Рахунків', align: 'right' },
    { key: 'net_kopecks', title: 'Без ПДВ', align: 'right', money: true },
    { key: 'vat_kopecks', title: 'ПДВ', align: 'right', money: true },
    { key: 'gross_kopecks', title: 'Разом', align: 'right', money: true },
  ]);
  report.rows.forEach(function (r) {
    t.add(r);
  });
  t.separator().add(Object.assign({ label: 'Усього' }, report.totals));
  return ['Виручка за місяцями (без скасованих і чернеток)', period(report), '', t.toString()].join('\n');
}

function agingText(report) {
  var summary = new TextTable([
    { key: 'label', title: 'Днів' },
    { key: 'invoices', title: 'Рахунків', align: 'right' },
    { key: 'amount_kopecks', title: 'Борг, грн', align: 'right', money: true },
  ]);
  report.buckets.forEach(function (b) {
    summary.add(b);
  });
  summary.separator().add({ label: 'Усього', invoices: report.rows.length, amount_kopecks: report.total_kopecks });

  var out = ['Дебіторська заборгованість станом на ' + report.as_of, '(вік — від дати виставлення рахунку)', '', summary.toString()];
  if (report.rows.length) {
    var detail = new TextTable([
      { key: 'number', title: 'Рахунок' },
      { key: 'customer', title: 'Клієнт', max: 28 },
      { key: 'issued_at', title: 'Виставлено' },
      { key: 'due_at', title: 'Сплатити до' },
      { key: 'age_days', title: 'Вік', align: 'right' },
      { key: 'days_overdue', title: 'Простр.', align: 'right' },
      { key: 'outstanding_kopecks', title: 'Борг, грн', align: 'right', money: true },
    ]);
    report.rows.forEach(function (r) {
      detail.add(r);
    });
    out.push('', detail.toString());
  }
  return out.join('\n');
}

function topCustomersText(report) {
  var t = new TextTable([
    { key: 'rank', title: '#', align: 'right' },
    { key: 'name', title: 'Клієнт', max: 32 },
    { key: 'edrpou', title: 'ЄДРПОУ' },
    { key: 'invoices', title: 'Рахунків', align: 'right' },
    { key: 'net_kopecks', title: 'Без ПДВ', align: 'right', money: true },
    { key: 'share', title: 'Частка', align: 'right' },
  ]);
  report.rows.forEach(function (r) {
    t.add(Object.assign({ share: r.share_pct.toFixed(1).replace('.', ',') + '%' }, r));
  });
  return ['Топ-' + report.limit + ' клієнтів за виручкою (без ПДВ)', period(report), '', t.toString(), '', 'Уся виручка за період: ' + fmtAmount(report.total_net_kopecks) + ' грн'].join('\n');
}

function vatText(report) {
  var t = new TextTable([
    { key: 'label', title: 'Місяць' },
    { key: 'rate', title: 'Ставка', align: 'right' },
    { key: 'invoices', title: 'Рахунків', align: 'right' },
    { key: 'base_kopecks', title: 'База', align: 'right', money: true },
    { key: 'vat_kopecks', title: 'ПДВ', align: 'right', money: true },
    { key: 'diff_kopecks', title: 'Розбіжн.', align: 'right', money: true },
  ]);
  report.rows.forEach(function (r) {
    t.add(Object.assign({ rate: r.vat_rate + '%' }, r));
  });
  t.separator().add(Object.assign({ label: 'Усього' }, report.totals));
  var out = ['Зведення ПДВ за місяцями', period(report), '', t.toString()];
  if (report.totals.diff_kopecks !== 0) out.push('', 'УВАГА: ПДВ у рахунках не збігається з перерахованим від бази.');
  return out.join('\n');
}

var TEXT = {
  revenue: revenueText,
  aging: agingText,
  'top-customers': topCustomersText,
  vat: vatText,
};

// opts is unused since the header/footer moved into bin/monthly-report.js
function renderText(report, opts) {
  var fn = TEXT[report.report];
  if (!fn) throw new Error('unknown report: ' + report.report);
  return fn(report) + '\n';
}

function toJson(report, generatedAt) {
  var payload = Object.assign({ generated_at: generatedAt || new Date().toISOString() }, report);
  return JSON.stringify(payload, null, 2) + '\n';
}

module.exports = { renderText: renderText, toJson: toJson };
