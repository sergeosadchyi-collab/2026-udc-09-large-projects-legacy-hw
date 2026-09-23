'use strict';
/**
 * Audit trail: who changed what, and when.
 *
 * Append-only JSON lines in out/audit.log, one entry per change:
 *   {"ts":"2026-03-02T09:14:07.120Z","staff_id":7,"action":"update","entity":"invoices",
 *    "entity_id":12,"changes":{"status":{"from":"issued","to":"paid"}}}
 *
 * Nothing edits an entry in place; retention.js moves old ones to
 * out/audit-archive/YYYY-MM.jsonl. staff_id 0 = system (cron scripts).
 */
var fs = require('fs');
var path = require('path');

var DEFAULT_DIR = process.env.AUDIT_DIR || path.join(__dirname, '..', '..', 'out');

// Change on every save and only make noise in the diff.
var IGNORED_FIELDS = ['updated_at', 'updated_by'];
// Never written to the log in clear text (security review, 2021).
var MASKED_FIELDS = ['iban', 'password', 'token', 'api_key'];

var outDir = DEFAULT_DIR;
var dirReady = false;
var systemClock = function () { return new Date(); };
var clock = systemClock;

/** Point the log at another directory (tests use a temp dir). */
function open(dir) {
  outDir = dir || DEFAULT_DIR;
  dirReady = false;
}

/** For tests only. */
function setClock(fn) {
  clock = fn || systemClock;
}

function now() {
  return clock();
}

function paths() {
  return { dir: outDir, log: path.join(outDir, 'audit.log'), archiveDir: path.join(outDir, 'audit-archive') };
}

// same as in invoices/index.js, but that one works on strings
function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function toDay(v) {
  if (!v) return null;
  return v instanceof Date ? toIsoDate(v) : String(v).slice(0, 10);
}

/*
 * Writes to audit.log go through this queue one at a time, so lines never
 * interleave and retention.js can rewrite the file without eating an append.
 * Only covers this process — see the note at the top of retention.js.
 */
var queue = [];
var busy = false;

function exclusive(task) {
  queue.push(task);
  if (!busy) drain();
}

function drain() {
  var task = queue.shift();
  busy = !!task;
  if (task) task(drain);
}

function ensureDir(cb) {
  if (dirReady) return cb(null);
  fs.mkdir(outDir, { recursive: true }, function (err) {
    if (!err) dirReady = true;
    cb(err || null);
  });
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  // shallow diff: nested objects / arrays (invoice lines) are compared as a whole
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Shallow diff of two rows. Either side may be null (create / delete).
 * @returns {object} field -> { from, to }; {} when nothing changed
 */
function diff(before, after) {
  var a = before || {};
  var b = after || {};
  var changes = {};
  Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
    if (changes[k] || IGNORED_FIELDS.indexOf(k) !== -1) return;
    var from = a[k] === undefined ? null : a[k];
    var to = b[k] === undefined ? null : b[k];
    if (sameValue(from, to)) return;
    var secret = MASKED_FIELDS.indexOf(k) !== -1;
    changes[k] = { from: secret && from !== null ? '***' : from, to: secret && to !== null ? '***' : to };
  });
  return changes;
}

/**
 * Append one entry. `before` / `after` are whole rows.
 * cb(err, entry) is optional — most handlers don't wait for it. entry is null
 * when an update changed nothing (no-op saves were ~40% of the file in 2021).
 */
function record(staffId, action, entity, id, before, after, cb) {
  cb = cb || function (err) { if (err) console.error('audit: ' + err.message); };
  if (!action || !entity) return process.nextTick(cb, new Error('audit: action and entity are required'));
  var changes = diff(before, after);
  if (action === 'update' && !Object.keys(changes).length) return process.nextTick(cb, null, null);

  var entry = {
    ts: clock().toISOString(),
    staff_id: staffId === undefined ? null : staffId,
    action: action,
    entity: entity,
    entity_id: id === undefined ? null : id,
    changes: changes,
  };
  exclusive(function (release) {
    ensureDir(function (err) {
      if (err) {
        release();
        return cb(err);
      }
      fs.appendFile(paths().log, JSON.stringify(entry) + '\n', 'utf8', function (err2) {
        release();
        cb(err2 || null, err2 ? null : entry);
      });
    });
  });
}

/**
 * Split a JSONL file into entries. Broken lines (the 2022 disk-full night)
 * are returned separately instead of failing the whole read.
 */
function parseLog(text, fileName) {
  var out = { entries: [], bad: [] };
  text.split('\n').forEach(function (line) {
    line = line.replace(/\r$/, '');
    if (!line.trim()) return;
    try {
      out.entries.push(JSON.parse(line));
    } catch (e) {
      out.bad.push(line);
    }
  });
  return out;
}

function readFileEntries(file, cb) {
  fs.readFile(file, 'utf8', function (err, text) {
    if (err) return err.code === 'ENOENT' ? cb(null, []) : cb(err);
    cb(null, parseLog(text, file).entries);
  });
}

/** Months that have an archive file, sorted: ['2025-01', '2025-02', ...] */
function listArchiveMonths(cb) {
  fs.readdir(paths().archiveDir, function (err, names) {
    if (err) return err.code === 'ENOENT' ? cb(null, []) : cb(err);
    var months = names.filter(function (n) { return /^\d{4}-\d{2}\.jsonl$/.test(n); });
    cb(null, months.map(function (n) { return n.slice(0, 7); }).sort());
  });
}

function matches(e, f) {
  if (f.entity && e.entity !== f.entity) return false;
  // ids come from the query string as strings; the rows have numbers
  if (f.id !== null && String(e.entity_id) !== f.id) return false;
  var day = typeof e.ts === 'string' ? e.ts.slice(0, 10) : '';
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  return true;
}

/**
 * Find entries, oldest first.
 * filter: { entity, id, from, to, includeArchive }
 *   from / to — YYYY-MM-DD (or Date), inclusive, compared on the UTC date of ts.
 *   includeArchive — also read the archive files for the months in range.
 * TODO(2021): stream instead of readFile once the log gets big. It hasn't yet.
 */
function query(filter, cb) {
  if (typeof filter === 'function') {
    cb = filter;
    filter = {};
  }
  filter = filter || {};
  var hasId = filter.id !== undefined && filter.id !== null && filter.id !== '';
  var f = { entity: filter.entity || null, id: hasId ? String(filter.id) : null, from: toDay(filter.from), to: toDay(filter.to) };

  function collect(files, out) {
    if (!files.length) return cb(null, out);
    readFileEntries(files[0], function (err, entries) {
      if (err) return cb(err);
      collect(files.slice(1), out.concat(entries.filter(function (e) { return matches(e, f); })));
    });
  }

  if (!filter.includeArchive) return collect([paths().log], []);
  listArchiveMonths(function (err, months) {
    if (err) return cb(err);
    var files = months
      .filter(function (m) { return (!f.from || m >= f.from.slice(0, 7)) && (!f.to || m <= f.to.slice(0, 7)); })
      .map(function (m) { return path.join(paths().archiveDir, m + '.jsonl'); });
    collect(files.concat(paths().log), []);
  });
}

function history(entity, id, cb) {
  query({ entity: entity, id: id }, cb);
}

function between(from, to, cb) {
  query({ from: from, to: to }, cb);
}

module.exports = {
  open: open,
  setClock: setClock,
  now: now,
  paths: paths,
  diff: diff,
  record: record,
  query: query,
  history: history,
  between: between,
  parseLog: parseLog,
  listArchiveMonths: listArchiveMonths,
  _exclusive: exclusive,
};
