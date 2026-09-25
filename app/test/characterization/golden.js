/**
 * Golden-master helper for the BILL-482 characterization tests.
 *
 * A golden file is the *current* output of a consumer, recorded before the
 * change. The tests compare byte-for-byte, so any drift shows up as a diff of
 * the real artefact instead of a "expected true to be false".
 *
 *   node --test                        # compare against the recorded files
 *   UPDATE_GOLDEN=1 node --test        # re-record (only after a DELIBERATE change)
 *
 * No npm dependencies, CommonJS, like the rest of this codebase.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('node:assert/strict');

var GOLDEN_DIR = path.join(__dirname, 'golden');

function goldenPath(name) {
  return path.join(GOLDEN_DIR, name);
}

/**
 * Compare `actual` with test/characterization/golden/<name>.
 * Records the file instead of comparing when UPDATE_GOLDEN=1.
 *
 * @param {string} name    file name inside golden/
 * @param {string} actual  what the consumer produces right now
 */
function assertGolden(name, actual) {
  var file = goldenPath(name);
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actual, 'utf8');
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(
      'missing golden file ' + path.relative(process.cwd(), file) +
        ' — record it with UPDATE_GOLDEN=1 node --test',
    );
  }
  assert.equal(actual, fs.readFileSync(file, 'utf8'), 'output drifted from golden/' + name);
}

module.exports = { assertGolden: assertGolden, GOLDEN_DIR: GOLDEN_DIR };

/*
 * `node --test` treats every .js under test/ as a test file, this helper
 * included. Guarded by require.main so the check below runs once, when the
 * runner opens this file, and not again in every file that requires it.
 */
if (require.main === module) {
  var test = require('node:test');

  test('golden masters are recorded and non-empty', function () {
    assert.ok(fs.existsSync(GOLDEN_DIR), 'golden/ must be committed together with the tests');
    var files = fs.readdirSync(GOLDEN_DIR).sort();
    assert.deepEqual(files, [
      'aging-2026-03-31.json',
      'invoice-INV-2026-00007.html',
      'invoice-INV-2026-00012-no-customer.html',
      'monthly-report-2026-03.txt',
      'oblik-export.csv',
      'reminders-2026-03-12.txt',
      'reminders-2026-04-01.txt',
    ]);
    files.forEach(function (f) {
      assert.ok(fs.statSync(goldenPath(f)).size > 0, f + ' is empty');
    });
  });
}


