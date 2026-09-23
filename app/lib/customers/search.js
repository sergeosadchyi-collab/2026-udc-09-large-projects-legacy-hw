/**
 * Customer search by name fragment.
 *
 * Case-insensitive, and forgiving about the apostrophe and the quotes: the
 * same company is typed as «Кам'яний Міст», "Кам’яний міст" or Камʼяний Міст
 * depending on who typed it and from which keyboard layout.
 */

// ' (ASCII), ’ (U+2019, Word autocorrect), ʼ (U+02BC, the "correct" one), `
var APOSTROPHES = /['’ʼ‘`]/g;
var QUOTES = /[«»"“”„]/g;

function normalizeName(s) {
  return String(s || '')
    .toLocaleLowerCase('uk-UA')
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object[]} customers
 * @param {string} fragment
 * @param {object} [opts] { includeInactive: bool, limit: number }
 * @returns {object[]} matches, the ones where the name starts with the fragment first
 */
function searchByName(customers, fragment, opts) {
  opts = opts || {};
  var needle = normalizeName(fragment);
  if (!needle) return [];
  var hits = [];
  customers.forEach(function (c) {
    if (!opts.includeInactive && c.active === false) return;
    var hay = normalizeName(c.name);
    var pos = hay.indexOf(needle);
    if (pos === -1) {
      // not in the company name — try the contact person, that is how people
      // remember ФОПs. Ranked after every name hit. (asked by sales, 2021)
      if (normalizeName(c.contact_name).indexOf(needle) === -1) return;
      pos = 1000;
    }
    hits.push({ c: c, pos: pos, hay: hay });
  });
  hits.sort(function (a, b) {
    if (a.pos !== b.pos) return a.pos - b.pos;
    return a.hay < b.hay ? -1 : a.hay > b.hay ? 1 : 0;
  });
  var out = hits.map(function (h) { return h.c; });
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

module.exports = { normalizeName: normalizeName, searchByName: searchByName };
