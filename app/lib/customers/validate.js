/**
 * Customer field validation.
 *
 * Returns a list of { field, message } — empty list means OK. The admin UI
 * shows the messages as-is, so they are in Ukrainian.
 */
'use strict';

var EDRPOU_RE = /^\d{8}$/;
// Deliberately loose. We tried a "proper" RFC regex in 2019 and it rejected
// half of the addresses accounting had on file.
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ЄДРПОУ check digit (the official algorithm for legal entities).
 *
 * Weights 1..7 for the first seven digits; for codes between 30000000 and
 * 60000000 the weights are 7,1,2,3,4,5,6 instead. Sum mod 11. If the remainder
 * is 10, redo it with every weight +2; if that is 10 again the digit is 0.
 *
 * NOTE: this is a legacy validator — it was bolted on long after the customer
 * table existed. Plenty of old records fail it (the 2019 spreadsheet import
 * had made-up codes for ФОПs, and nobody checked hand-typed ones). Those rows
 * are grandfathered: we never re-validate a stored code, only a new or changed
 * one, and staff can force a failing code in with edrpou_unchecked: true,
 * which is then kept on the row so it is obvious later. Do not "clean up" the
 * data by running this over customers.json.
 *
 * @param {string} code 8 digits, already checked with EDRPOU_RE
 * @returns {number} expected last digit
 */
function edrpouCheckDigit(code) {
  var digits = code.split('').map(Number);
  var n = Number(code);
  var weights = n < 30000000 || n > 60000000 ? [1, 2, 3, 4, 5, 6, 7] : [7, 1, 2, 3, 4, 5, 6];
  var sum = 0;
  var i;
  for (i = 0; i < 7; i++) sum += digits[i] * weights[i];
  var rest = sum % 11;
  if (rest > 9) {
    sum = 0;
    for (i = 0; i < 7; i++) sum += digits[i] * (weights[i] + 2);
    rest = sum % 11;
    if (rest > 9) rest = 0;
  }
  return rest;
}

function edrpouChecksumOk(code) {
  if (!EDRPOU_RE.test(String(code || ''))) return false;
  return edrpouCheckDigit(code) === Number(code.charAt(7));
}

// "1000 0107" / " 10000107 " -> "10000107". People paste from PDFs.
function cleanEdrpou(value) {
  if (value === undefined || value === null) return value;
  return String(value).replace(/\s+/g, '');
}

function checkEdrpou(code, unchecked, errors) {
  if (!EDRPOU_RE.test(code || '')) {
    errors.push({ field: 'edrpou', message: 'ЄДРПОУ має складатися з 8 цифр' });
    return;
  }
  if (!edrpouChecksumOk(code) && unchecked !== true) {
    errors.push({ field: 'edrpou', message: 'ЄДРПОУ не проходить перевірку контрольної цифри' });
  }
}

function checkName(name, errors) {
  if (typeof name !== 'string' || !name.trim()) {
    errors.push({ field: 'name', message: "Назва обов'язкова" });
  }
}

function checkEmail(email, errors) {
  // email is optional for walk-in ФОПs, but if it's there it must look like one
  if (email === undefined || email === null || email === '') return;
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    errors.push({ field: 'email', message: 'Некоректний email' });
  }
}

/**
 * Validate a brand-new customer.
 */
function validateNew(fields) {
  var errors = [];
  fields = fields || {};
  checkName(fields.name, errors);
  checkEmail(fields.email, errors);
  checkEdrpou(cleanEdrpou(fields.edrpou), fields.edrpou_unchecked, errors);
  return errors;
}

/**
 * Validate a PATCH against the stored row. Only fields present in the patch are
 * looked at, and the ЄДРПОУ check digit only when the code actually changes —
 * the UI sends the whole form back, including the old (possibly failing) code.
 */
function validatePatch(existing, patch) {
  var errors = [];
  if ('name' in patch) checkName(patch.name, errors);
  if ('email' in patch) checkEmail(patch.email, errors);
  if ('edrpou' in patch) {
    var code = cleanEdrpou(patch.edrpou);
    if (code !== existing.edrpou) checkEdrpou(code, patch.edrpou_unchecked, errors);
  }
  if ('active' in patch && typeof patch.active !== 'boolean') {
    errors.push({ field: 'active', message: 'active має бути true або false' });
  }
  return errors;
}

module.exports = {
  EDRPOU_RE: EDRPOU_RE,
  EMAIL_RE: EMAIL_RE,
  edrpouCheckDigit: edrpouCheckDigit,
  edrpouChecksumOk: edrpouChecksumOk,
  cleanEdrpou: cleanEdrpou,
  validateNew: validateNew,
  validatePatch: validatePatch,
};
