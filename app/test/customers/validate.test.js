var test = require('node:test');
var assert = require('node:assert/strict');
var validate = require('../../lib/customers/validate');

function fields(errors) {
  return errors.map(function (e) { return e.field; });
}

test('ЄДРПОУ check digit: first pass, second pass (+2 weights) and the 10 -> 0 case', function () {
  assert.equal(validate.edrpouCheckDigit('10000001'), 1);
  assert.equal(validate.edrpouCheckDigit('10000107'), 7);
  // first-pass remainder is 10, weights +2 give 2
  assert.equal(validate.edrpouCheckDigit('10000062'), 2);
  // remainder is 10 on both passes -> 0
  assert.equal(validate.edrpouCheckDigit('10000640'), 0);
  assert.equal(validate.edrpouChecksumOk('10000062'), true);
  assert.equal(validate.edrpouChecksumOk('10000063'), false);
  assert.equal(validate.edrpouChecksumOk('1000006'), false);
  assert.equal(validate.edrpouChecksumOk(null), false);
});

test('validateNew: name required, email shape, ЄДРПОУ 8 digits + check digit', function () {
  assert.deepEqual(validate.validateNew({ name: 'ТОВ «Тест»', edrpou: '10000107', email: 'a@example.invalid' }), []);
  assert.deepEqual(fields(validate.validateNew({ name: '  ', edrpou: '10000107' })), ['name']);
  assert.deepEqual(fields(validate.validateNew({ name: 'X', edrpou: '10000107', email: 'nope@' })), ['email']);
  assert.deepEqual(fields(validate.validateNew({ name: 'X', edrpou: '1000010' })), ['edrpou']);
  assert.deepEqual(fields(validate.validateNew({ name: 'X', edrpou: '10000108' })), ['edrpou']);
  assert.deepEqual(fields(validate.validateNew({})), ['name', 'edrpou']);
});

test('validateNew: a failing check digit can be forced with edrpou_unchecked, a bad shape cannot', function () {
  assert.deepEqual(validate.validateNew({ name: 'X', edrpou: '10000108', edrpou_unchecked: true }), []);
  assert.deepEqual(fields(validate.validateNew({ name: 'X', edrpou: '1000010', edrpou_unchecked: true })), ['edrpou']);
  // only a real boolean counts, not "true" from a form
  assert.deepEqual(fields(validate.validateNew({ name: 'X', edrpou: '10000108', edrpou_unchecked: 'true' })), ['edrpou']);
});

test('validatePatch: a stored code that fails the checksum is grandfathered', function () {
  var old = { id: 2, name: 'ТОВ «Липовий Цвіт»', edrpou: '10000002' };
  assert.equal(validate.edrpouChecksumOk(old.edrpou), false);
  assert.deepEqual(validate.validatePatch(old, { name: 'Нова назва' }), []);
  // the UI echoes the whole form back, including the old code
  assert.deepEqual(validate.validatePatch(old, { name: 'Нова назва', edrpou: '1000 0002' }), []);
  // but changing it to another failing code is not OK
  assert.deepEqual(fields(validate.validatePatch(old, { edrpou: '10000003' })), ['edrpou']);
  assert.deepEqual(validate.validatePatch(old, { edrpou: '10000107' }), []);
  assert.deepEqual(fields(validate.validatePatch(old, { active: 'no' })), ['active']);
});
