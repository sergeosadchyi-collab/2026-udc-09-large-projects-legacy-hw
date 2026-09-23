/**
 * Loyalty discount tiers.
 *
 * Thresholds are 12-month revenue in kopecks. A customer gets the percent of
 * the highest tier whose `from` they reached. Tables must be sorted by `from`.
 *
 * TODO(2021-04): move both tables to config/ once accounting signs off the
 * new thresholds. — S.
 */

// Current programme (revised 2020). Revenue is counted WITHOUT VAT.
var STANDARD = [
  { code: 'none', from: 0, percent: 0 },
  { code: 'bronze', from: 500000, percent: 2 }, // 5 000 грн
  { code: 'silver', from: 1000000, percent: 3 }, // 10 000 грн
  { code: 'gold', from: 2500000, percent: 5 }, // 25 000 грн
];

// Old programme, 2017-2018. Revenue is counted WITH VAT, as v1 invoicing did.
// Кожен клієнт старої програми мав гарантовані 3%, тому нижнього рівня 0% немає.
var LEGACY = [
  { code: 'legacy-base', from: 0, percent: 3 },
  { code: 'legacy-plus', from: 1000000, percent: 5 }, // 10 000 грн з ПДВ
  { code: 'legacy-vip', from: 3000000, percent: 7 }, // 30 000 грн з ПДВ
];

function tierFor(revenueKopecks, table) {
  table = table || STANDARD;
  var hit = table[0];
  for (var i = 0; i < table.length; i++) {
    if (revenueKopecks >= table[i].from) hit = table[i];
  }
  return hit;
}

// how much more a customer has to buy to reach the next tier; null at the top
function toNextTier(revenueKopecks, table) {
  table = table || STANDARD;
  for (var i = 0; i < table.length; i++) {
    if (table[i].from > revenueKopecks) {
      return { code: table[i].code, percent: table[i].percent, missing_kopecks: table[i].from - revenueKopecks };
    }
  }
  return null;
}

module.exports = {
  STANDARD: STANDARD,
  LEGACY: LEGACY,
  tierFor: tierFor,
  toNextTier: toNextTier,
};
