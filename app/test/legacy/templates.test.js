var test = require('node:test');
var assert = require('node:assert/strict');
var templates = require('../../lib/legacy/templates');

test('substitutes {{var}} and tolerates spaces inside the braces', function () {
  var tpl = templates.compile('Шановний {{ contact }}, рахунок {{number}}.');
  assert.equal(tpl({ contact: 'Ірина', number: 'INV-2026-00007' }), 'Шановний Ірина, рахунок INV-2026-00007.');
});

test('dotted paths reach into nested objects', function () {
  var tpl = templates.compile('{{customer.name}} ({{customer.address.city}})');
  var out = tpl({ customer: { name: 'ТОВ «Зелений Кут»', address: { city: 'Київ' } } });
  assert.equal(out, 'ТОВ «Зелений Кут» (Київ)');
});

test('escapes HTML by default, {{{triple}}} is inserted raw', function () {
  var tpl = templates.compile('<p>{{name}}</p>{{{footer}}}');
  var out = tpl({ name: '<b>"A & B"</b>', footer: '<hr>' });
  assert.equal(out, '<p>&lt;b&gt;&quot;A &amp; B&quot;&lt;/b&gt;</p><hr>');
});

test('missing and null values become empty strings, but 0 is kept', function () {
  var tpl = templates.compile('[{{a}}][{{b}}][{{c.d.e}}][{{zero}}]');
  assert.equal(tpl({ b: null, zero: 0 }), '[][][][0]');
});

test('the same compiled template can be reused with different data', function () {
  var tpl = templates.compile('{{n}}:{{title}}');
  assert.equal(tpl({ n: 1, title: 'Степлер' }), '1:Степлер');
  assert.equal(tpl({ n: 2, title: 'Скріпки' }), '2:Скріпки');
});
