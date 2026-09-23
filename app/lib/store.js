/**
 * Tiny JSON "database".
 *
 * Every collection is a file in data/ (customers.json, invoices.json, ...).
 * Loaded lazily, cached in memory, written back on save(). Callback style
 * because this predates async/await in our codebase — please keep it that way
 * until the big rewrite.
 *
 * Dates are stored as YYYY-MM-DD strings. Money is integer kopecks.
 */
var fs = require('fs');
var path = require('path');

var DEFAULT_DIR = path.join(__dirname, '..', 'data');

var dataDir = DEFAULT_DIR;
var cache = {};

function open(dir) {
  dataDir = dir || DEFAULT_DIR;
  cache = {};
}

function file(name) {
  return path.join(dataDir, name + '.json');
}

function load(name, cb) {
  if (cache[name]) return process.nextTick(function () { cb(null, cache[name]); });
  fs.readFile(file(name), 'utf8', function (err, text) {
    if (err) {
      if (err.code === 'ENOENT') {
        cache[name] = [];
        return cb(null, cache[name]);
      }
      return cb(err);
    }
    try {
      cache[name] = JSON.parse(text);
    } catch (e) {
      return cb(new Error('corrupt collection ' + name + ': ' + e.message));
    }
    cb(null, cache[name]);
  });
}

function loadSync(name) {
  if (cache[name]) return cache[name];
  try {
    cache[name] = JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') cache[name] = [];
    else throw e;
  }
  return cache[name];
}

function all(name, cb) {
  load(name, function (err, rows) {
    if (err) return cb(err);
    cb(null, rows.slice());
  });
}

function find(name, id, cb) {
  load(name, function (err, rows) {
    if (err) return cb(err);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return cb(null, rows[i]);
    }
    cb(null, null);
  });
}

function where(name, pred, cb) {
  load(name, function (err, rows) {
    if (err) return cb(err);
    cb(null, rows.filter(pred));
  });
}

function nextId(rows) {
  var max = 0;
  rows.forEach(function (r) {
    if (r.id > max) max = r.id;
  });
  return max + 1;
}

function insert(name, row, cb) {
  load(name, function (err, rows) {
    if (err) return cb(err);
    var copy = Object.assign({}, row);
    if (!copy.id) copy.id = nextId(rows);
    rows.push(copy);
    cb(null, copy);
  });
}

function update(name, id, patch, cb) {
  load(name, function (err, rows) {
    if (err) return cb(err);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        rows[i] = Object.assign({}, rows[i], patch);
        return cb(null, rows[i]);
      }
    }
    cb(null, null);
  });
}

function save(name, cb) {
  var rows = cache[name];
  if (!rows) return process.nextTick(cb);
  fs.writeFile(file(name), JSON.stringify(rows, null, 2) + '\n', 'utf8', cb);
}

module.exports = {
  open: open,
  all: all,
  find: find,
  where: where,
  insert: insert,
  update: update,
  save: save,
  loadSync: loadSync,
};
