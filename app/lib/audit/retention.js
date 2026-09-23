/**
 * Audit log retention: moves entries older than N days out of out/audit.log
 * into out/audit-archive/YYYY-MM.jsonl (month of the entry, UTC).
 *
 * cron on the old box:  10 3 * * *  node lib/audit/retention.js 365
 *
 * NB: the write queue in index.js only protects this process. The cron runs as
 * a separate process while the server is up, so an append landing between our
 * read and the rename is lost. The window is milliseconds at 03:10 — accepted
 * in 2022, see #billing.
 */
var fs = require('fs');
var path = require('path');
var audit = require('./index');

// бухгалтерія хоче рік "онлайн", решта — в архіві
var DEFAULT_DAYS = 365;
var DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(date, days) {
  return new Date(date.getTime() - days * DAY_MS);
}

function appendMonths(dir, months, byMonth, cb) {
  (function next(i) {
    if (i >= months.length) return cb(null);
    var file = path.join(dir, months[i] + '.jsonl');
    fs.appendFile(file, byMonth[months[i]].join('\n') + '\n', 'utf8', function (err) {
      if (err) return cb(err);
      next(i + 1);
    });
  })(0);
}

/**
 * Split raw log text into lines to keep and lines to archive (by month).
 * Lines we cannot parse stay in the log so somebody can look at them.
 */
function partition(text, cutoffMs) {
  var keep = [];
  var byMonth = {};
  var archived = 0;
  text.split('\n').forEach(function (line) {
    line = line.replace(/\r$/, '');
    if (!line.trim()) return;
    var e = null;
    try { e = JSON.parse(line); } catch (x) { /* stays in the log */ }
    var t = e && typeof e.ts === 'string' ? Date.parse(e.ts) : NaN;
    if (isNaN(t) || t >= cutoffMs) {
      keep.push(line);
      return;
    }
    var month = new Date(t).toISOString().slice(0, 7);
    (byMonth[month] = byMonth[month] || []).push(line);
    archived++;
  });
  return { keep: keep, byMonth: byMonth, archived: archived };
}

/**
 * Rotate old entries into the archive.
 * cb(err, { archived, kept, months, cutoff })
 *
 * Order matters: archive first, then rewrite the log. If we die in between,
 * the next run archives the same lines again — duplicates, not loss.
 */
function rotate(days, cb) {
  days = Number(days);
  if (!(days > 0)) return process.nextTick(cb, new Error('retention: days must be a positive number'));
  var p = audit.paths();
  var cutoff = daysAgo(audit.now(), days);

  audit._exclusive(function (release) {
    function finish(err, result) {
      release();
      if (err) return cb(err);
      result.cutoff = cutoff.toISOString();
      cb(null, result);
    }

    fs.readFile(p.log, 'utf8', function (err, text) {
      if (err && err.code === 'ENOENT') return finish(null, { archived: 0, kept: 0, months: [] });
      if (err) return finish(err);

      var parts = partition(text, cutoff.getTime());
      var months = Object.keys(parts.byMonth).sort();
      if (!months.length) return finish(null, { archived: 0, kept: parts.keep.length, months: [] });

      fs.mkdir(p.archiveDir, { recursive: true }, function (err2) {
        if (err2) return finish(err2);
        appendMonths(p.archiveDir, months, parts.byMonth, function (err3) {
          if (err3) return finish(err3);
          var tmp = p.log + '.tmp';
          var body = parts.keep.length ? parts.keep.join('\n') + '\n' : '';
          fs.writeFile(tmp, body, 'utf8', function (err4) {
            if (err4) return finish(err4);
            fs.rename(tmp, p.log, function (err5) {
              if (err5) return finish(err5);
              finish(null, { archived: parts.archived, kept: parts.keep.length, months: months });
            });
          });
        });
      });
    });
  });
}

module.exports = { rotate: rotate, partition: partition, DEFAULT_DAYS: DEFAULT_DAYS };

if (require.main === module) {
  var days = Number(process.argv[2] || process.env.AUDIT_RETENTION_DAYS || DEFAULT_DAYS);
  rotate(days, function (err, r) {
    if (err) {
      console.error('audit retention failed: ' + err.message);
      process.exit(1);
    }
    console.log(
      'audit retention: archived ' + r.archived + ', kept ' + r.kept +
        (r.months.length ? ' -> ' + r.months.join(', ') : '') + ' (cutoff ' + r.cutoff + ')',
    );
  });
}
