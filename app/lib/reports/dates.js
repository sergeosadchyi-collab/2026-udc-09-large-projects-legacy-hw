/**
 * Date helpers for reports.
 *
 * Yes, there are other date helpers in this repo. These ones only know about
 * ISO strings (YYYY-MM-DD) and month keys (YYYY-MM), which is all reports need,
 * and they never go through local time — the server box runs in Europe/Kyiv
 * and we got bitten by DST in March 2021 (the "missing 31st" bug).
 */

// називний відмінок, з малої літери — як у бухгалтерії: "березень 2026"
var MONTHS_UK = [
  'січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
  'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень',
];

var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var MONTH_RE = /^(\d{4})-(\d{2})$/;
var DAY_MS = 86400000;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function toIsoDate(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function todayIso() {
  return toIsoDate(new Date());
}

/** Strict: 2026-02-30 is rejected, not rolled over into March. */
function isIsoDate(s) {
  var m = ISO_RE.exec(s || '');
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function isMonthKey(s) {
  var m = MONTH_RE.exec(s || '');
  return !!m && +m[2] >= 1 && +m[2] <= 12;
}

function monthKey(iso) {
  return String(iso).slice(0, 7);
}

// "2026-03" -> "березень 2026"
function monthName(key) {
  var m = MONTH_RE.exec(monthKey(key));
  if (!m) return String(key);
  return MONTHS_UK[+m[2] - 1] + ' ' + m[1];
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / DAY_MS);
}

function lastDayOfMonth(key) {
  var y = +key.slice(0, 4);
  var m = +key.slice(5, 7);
  return toIsoDate(new Date(Date.UTC(y, m, 0)));
}

// addMonths('2026-01', -1) -> '2025-12'
function addMonths(key, n) {
  return toIsoDate(new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1 + n, 1))).slice(0, 7);
}

module.exports = {
  MONTHS_UK: MONTHS_UK,
  toIsoDate: toIsoDate,
  todayIso: todayIso,
  isIsoDate: isIsoDate,
  isMonthKey: isMonthKey,
  monthKey: monthKey,
  monthName: monthName,
  daysBetween: daysBetween,
  lastDayOfMonth: lastDayOfMonth,
  addMonths: addMonths,
};
