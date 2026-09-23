/**
 * Bank statement parser: "KB-2" fixed-width export from the client-bank of
 * АТ «Банк Вигаданий». It is the only format they still give business
 * accounts; the CSV export was "temporarily disabled" in 2019.
 *
 * One record per line. The first character is the record type. Positions
 * below are 1-based, inclusive and count CHARACTERS, not bytes: the bank
 * writes cp1251, where that's the same thing, and the SFTP bridge hands us
 * UTF-8 since 2023.
 *
 *   H  header, exactly one, first line
 *      1       'H'
 *      2-30    account (IBAN), left aligned
 *      31-38   period from, DDMMYYYY
 *      39-46   period to, DDMMYYYY
 *      47-49   currency, always 'UAH' for us
 *
 *   D  one transaction
 *      1       'D'
 *      2-9     value date, DDMMYYYY
 *      10-11   'CR' money in, 'DR' money out
 *      12-26   amount in kopecks, right aligned (zero OR space padded)
 *      27-34   counterparty ЄДРПОУ, blank for private persons
 *      35-74   counterparty name
 *      75-90   bank document reference, unique per bank
 *      91-250  purpose of payment, free text, may be shorter or absent
 *
 *   T  trailer, exactly one, last line
 *      1       'T'
 *      2-7     number of D records
 *      8-22    sum of CR amounts, kopecks
 *      23-37   sum of DR amounts, kopecks
 *
 * Blank lines are ignored. Trailing spaces are often stripped on the way
 * (editors, git), so short lines are padded back before cutting.
 */

var LAYOUT = {
  H: { min: 49, fields: [['account', 2, 29], ['from', 31, 8], ['to', 39, 8], ['currency', 47, 3]] },
  D: {
    min: 90,
    fields: [['date', 2, 8], ['direction', 10, 2], ['amount', 12, 15], ['edrpou', 27, 8],
      ['name', 35, 40], ['ref', 75, 16], ['purpose', 91, 160]],
  },
  T: { min: 37, fields: [['count', 2, 6], ['credit', 8, 15], ['debit', 23, 15]] },
};

function cut(line, layout) {
  var padded = line;
  while (padded.length < layout.min) padded += ' ';
  var out = {};
  layout.fields.forEach(function (f) {
    out[f[0]] = padded.substr(f[1] - 1, f[2]).trim();
  });
  return out;
}

// DDMMYYYY -> YYYY-MM-DD, or null if it is not a real date
function toIsoDate(ddmmyyyy) {
  if (!/^\d{8}$/.test(ddmmyyyy)) return null;
  var iso = ddmmyyyy.slice(4, 8) + '-' + ddmmyyyy.slice(2, 4) + '-' + ddmmyyyy.slice(0, 2);
  var d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function toKopecks(s) {
  // банк у 2020 перейшов з нулів на пробіли, у 2021 повернув нулі; trim() покриває обидва варіанти
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

function parseHeader(f, errors, no) {
  var from = toIsoDate(f.from);
  var to = toIsoDate(f.to);
  if (!from || !to) errors.push({ line: no, message: 'bad statement period' });
  if (f.currency !== 'UAH') errors.push({ line: no, message: 'unsupported currency "' + f.currency + '"' });
  return { account: f.account, from: from, to: to, currency: f.currency };
}

function parseDetail(f, errors, no) {
  var date = toIsoDate(f.date);
  var amount = toKopecks(f.amount);
  if (!date) errors.push({ line: no, message: 'bad value date "' + f.date + '"' });
  if (amount === null) errors.push({ line: no, message: 'bad amount "' + f.amount + '"' });
  if (f.direction !== 'CR' && f.direction !== 'DR') {
    errors.push({ line: no, message: 'bad direction "' + f.direction + '"' });
  }
  if (f.edrpou && !/^\d{8}$/.test(f.edrpou)) errors.push({ line: no, message: 'bad ЄДРПОУ "' + f.edrpou + '"' });
  return { line: no, date: date, direction: f.direction, amount_kopecks: amount,
    payer_edrpou: f.edrpou || null, payer_name: f.name, bank_ref: f.ref, purpose: f.purpose };
}

/**
 * @param {string} text  whole statement file
 * @returns {{header, entries, trailer, errors}} errors: [{line, message}]
 *   A statement with any errors must not be imported at all: the bank
 *   either sends the whole file or a broken one, never "mostly fine".
 */
function parseStatement(text) {
  var result = { header: null, entries: [], trailer: null, errors: [] };
  var errors = result.errors;
  var lines = String(text || '').replace(/^\uFEFF/, '').split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\r$/, '');
    var no = i + 1;
    if (!line.trim()) continue;
    var kind = line.charAt(0);
    if (!LAYOUT[kind]) {
      errors.push({ line: no, message: 'unknown record type "' + kind + '"' });
      continue;
    }
    if (result.trailer) {
      errors.push({ line: no, message: 'record after trailer' });
      continue;
    }
    var f = cut(line, LAYOUT[kind]);
    if (kind === 'H') {
      if (result.header || result.entries.length) errors.push({ line: no, message: 'header must be the first record' });
      else result.header = parseHeader(f, errors, no);
    } else if (kind === 'D') {
      if (!result.header) errors.push({ line: no, message: 'transaction before header' });
      result.entries.push(parseDetail(f, errors, no));
    } else {
      result.trailer = { count: toKopecks(f.count), credit_kopecks: toKopecks(f.credit), debit_kopecks: toKopecks(f.debit) };
    }
  }

  if (!result.header) errors.push({ line: 0, message: 'missing header record' });
  if (!result.trailer) {
    errors.push({ line: 0, message: 'missing trailer record (truncated file?)' });
    return result;
  }
  checkTrailer(result);
  return result;
}

function checkTrailer(result) {
  var cr = 0;
  var dr = 0;
  result.entries.forEach(function (e) {
    if (e.direction === 'CR') cr += e.amount_kopecks || 0;
    if (e.direction === 'DR') dr += e.amount_kopecks || 0;
  });
  var t = result.trailer;
  if (t.count !== result.entries.length) {
    result.errors.push({ line: 0, message: 'trailer says ' + t.count + ' records, found ' + result.entries.length });
  }
  if (t.credit_kopecks !== cr) result.errors.push({ line: 0, message: 'trailer credit total mismatch' });
  if (t.debit_kopecks !== dr) result.errors.push({ line: 0, message: 'trailer debit total mismatch' });
}

module.exports = {
  LAYOUT: LAYOUT,
  parseStatement: parseStatement,
  toIsoDate: toIsoDate,
};
