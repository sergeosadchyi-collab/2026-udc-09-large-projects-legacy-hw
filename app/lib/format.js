/**
 * Formatting helpers.
 *
 * Shared by the invoice renderer, the reminder mails and the exports, so keep
 * the signatures stable.
 *
 * (c) 2017 billing team
 */
'use strict';

var CURRENCY = 'грн';

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function toDate(value) {
  if (value instanceof Date) return value;
  // dates are stored as YYYY-MM-DD strings, see lib/store.js
  return new Date(String(value).slice(0, 10) + 'T00:00:00Z');
}

/**
 * Format a date for the Облік-Плюс export: MM/DD/YYYY.
 *
 * Do NOT change this and do NOT rename it: config/export-columns.json maps
 * column "type": "Date" onto format['format' + type], and their import server
 * runs a US locale. A row with another date format is silently SKIPPED on
 * their side — see docs/integrations/oblik-plus.md.
 *
 * For dates a customer reads use formatDateUk() (BILL-482).
 *
 * @param {string|Date} value  YYYY-MM-DD string or a Date
 * @returns {string} the date as MM/DD/YYYY
 */
function formatDate(value) {
  if (!value) return '';
  var d = toDate(value);
  if (isNaN(d.getTime())) return '';
  return pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + d.getUTCFullYear();
}

/**
 * Format a date the way customers read it: DD.MM.YYYY (BILL-482).
 *
 * For documents and mails a person reads — the invoice and the payment
 * reminders. Machine-readable output keeps formatDate().
 *
 * @param {string|Date} value  YYYY-MM-DD string or a Date
 * @returns {string} the date as DD.MM.YYYY
 */
function formatDateUk(value) {
  if (!value) return '';
  var d = toDate(value);
  if (isNaN(d.getTime())) return '';
  return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
}

/**
 * Money for people: 123450 -> "1 234,50 грн".
 * Amounts are integer kopecks everywhere (never floats!).
 */
function formatMoney(kopecks) {
  if (kopecks === null || kopecks === undefined || kopecks === '') return '';
  var n = Number(kopecks);
  var neg = n < 0;
  n = Math.abs(Math.round(n));
  var hrn = Math.floor(n / 100);
  var kop = n % 100;
  var s = String(hrn).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + s + ',' + pad(kop) + ' ' + CURRENCY;
}

/**
 * Money for machines: 123450 -> "1234.50".
 */
function formatDecimal(kopecks) {
  if (kopecks === null || kopecks === undefined || kopecks === '') return '';
  var n = Math.round(Number(kopecks));
  var neg = n < 0;
  n = Math.abs(n);
  return (neg ? '-' : '') + Math.floor(n / 100) + '.' + pad(n % 100);
}

/**
 * Text for a cell or a line: trims, collapses whitespace, drops ';' which the
 * old CSV consumers choke on.
 */
function formatText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[;\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value) + '%';
}

module.exports = {
  formatDate: formatDate,
  formatDateUk: formatDateUk,
  formatMoney: formatMoney,
  formatDecimal: formatDecimal,
  formatText: formatText,
  formatPercent: formatPercent,
};
