/**
 * Audit endpoints. Read-only: entries are written by the modules themselves
 * through audit.record().
 *
 *   GET /api/audit?entity=invoices&id=12
 *   GET /api/audit?entity=customers&from=2026-01-01&to=2026-03-31&archive=1
 */
var audit = require('./index');
var httpError = require('../http/router').httpError;

// the admin page renders all of it in one table, so keep it sane
var MAX_ROWS = 500;

function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function list(req, res, ctx, done) {
  var q = ctx.query || {};
  // no "dump everything" on purpose — the log is big and has customer data in it
  if (!q.entity) return done(httpError(400, 'entity is required'));
  if (!/^[a-z_]+$/.test(q.entity)) return done(httpError(400, 'bad entity'));
  if (q.from && !isDay(q.from)) return done(httpError(400, 'from must be YYYY-MM-DD'));
  if (q.to && !isDay(q.to)) return done(httpError(400, 'to must be YYYY-MM-DD'));
  if (q.from && q.to && q.from > q.to) return done(httpError(400, 'from is after to'));

  var filter = {
    entity: q.entity,
    id: q.id,
    from: q.from,
    to: q.to,
    includeArchive: q.archive === '1' || q.archive === 'true',
  };
  audit.query(filter, function (err, rows) {
    if (err) return done(err);
    rows.reverse(); // newest first
    done(null, 200, rows.slice(0, MAX_ROWS));
  });
}

module.exports = [{ method: 'GET', path: '/api/audit', handler: list }];
