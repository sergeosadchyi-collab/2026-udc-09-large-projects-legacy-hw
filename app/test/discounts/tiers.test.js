var test = require('node:test');
var assert = require('node:assert/strict');
var tiers = require('../../lib/discounts/tiers');

test('standard tiers: boundaries are inclusive', function () {
  assert.equal(tiers.tierFor(0).percent, 0);
  assert.equal(tiers.tierFor(499999).percent, 0);
  assert.equal(tiers.tierFor(500000).percent, 2);
  assert.equal(tiers.tierFor(999999).percent, 2);
  assert.equal(tiers.tierFor(1000000).percent, 3);
  assert.equal(tiers.tierFor(2500000).code, 'gold');
  assert.equal(tiers.tierFor(99999999).percent, 5);
  // tierFor relies on both tables being sorted and starting at 0
  [tiers.STANDARD, tiers.LEGACY].forEach(function (table) {
    assert.equal(table[0].from, 0);
    for (var i = 1; i < table.length; i++) assert.ok(table[i].from > table[i - 1].from);
  });
});

test('legacy tiers: nobody gets less than 3%', function () {
  assert.equal(tiers.tierFor(0, tiers.LEGACY).percent, 3);
  assert.equal(tiers.tierFor(999999, tiers.LEGACY).percent, 3);
  assert.equal(tiers.tierFor(1000000, tiers.LEGACY).percent, 5);
  assert.equal(tiers.tierFor(3000000, tiers.LEGACY).code, 'legacy-vip');
});

test('toNextTier: distance to the next tier, null at the top', function () {
  assert.deepEqual(tiers.toNextTier(916250), { code: 'silver', percent: 3, missing_kopecks: 83750 });
  assert.deepEqual(tiers.toNextTier(0, tiers.LEGACY), { code: 'legacy-plus', percent: 5, missing_kopecks: 1000000 });
  assert.equal(tiers.toNextTier(2500000), null);
});
