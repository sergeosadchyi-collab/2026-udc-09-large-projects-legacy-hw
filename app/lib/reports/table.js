'use strict';
/**
 * Fixed-width plain-text tables for reports.
 *
 * Output goes to the monthly mail and gets pasted into Excel by accounting,
 * so: no box-drawing characters, no tabs, columns separated by two spaces.
 * Width is measured in UTF-16 code units — fine for Cyrillic, would break on
 * emoji. Nobody puts emoji into company names. Yet.
 */

var SEP = '  ';

// 1234567 -> "12 345,67". Local on purpose, reports have their own layout.
function fmtAmount(kopecks) {
  var neg = kopecks < 0;
  var abs = Math.abs(Math.round(kopecks));
  var hryvni = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  var kop = String(abs % 100);
  if (kop.length < 2) kop = '0' + kop;
  return (neg ? '-' : '') + hryvni + ',' + kop;
}

function pad(s, w, right) {
  while (s.length < w) s = right ? ' ' + s : s + ' ';
  return s;
}

function cut(s, w) {
  return s.length > w ? s.slice(0, w - 1) + '…' : s;
}

/**
 * columns: [{ key, title, align: 'left'|'right', max, money }]
 * `money: true` runs the value through fmtAmount before measuring.
 */
function TextTable(columns) {
  this.columns = columns;
  this.rows = [];
}

TextTable.prototype.cell = function (col, row) {
  var v = row[col.key];
  if (v === undefined || v === null) return '';
  if (col.money) return fmtAmount(v);
  return String(v);
};

TextTable.prototype.add = function (row) {
  this.rows.push(row);
  return this;
};

TextTable.prototype.separator = function () {
  this.rows.push(null);
  return this;
};

TextTable.prototype.widths = function () {
  var self = this;
  return self.columns.map(function (col) {
    var w = col.title.length;
    self.rows.forEach(function (row) {
      if (!row) return;
      var len = self.cell(col, row).length;
      if (len > w) w = len;
    });
    return col.max && w > col.max ? col.max : w;
  });
};

TextTable.prototype.toString = function () {
  var self = this;
  var widths = self.widths();
  var line = function (values) {
    return values
      .map(function (v, i) {
        var col = self.columns[i];
        v = cut(v, widths[i]);
        return pad(v, widths[i], col.align === 'right');
      })
      .join(SEP)
      .replace(/\s+$/, '');
  };
  var rule = widths
    .map(function (w) {
      return new Array(w + 1).join('-');
    })
    .join(SEP);
  var out = [line(self.columns.map(function (c) { return c.title; })), rule];
  self.rows.forEach(function (row) {
    if (!row) return out.push(rule);
    out.push(line(self.columns.map(function (c) { return self.cell(c, row); })));
  });
  return out.join('\n');
};

module.exports = { TextTable: TextTable, fmtAmount: fmtAmount };
