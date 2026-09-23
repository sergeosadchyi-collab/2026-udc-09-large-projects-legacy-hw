/**
 * Loader/compiler for templates/*.hbs.
 *
 * Real Handlebars pulled half of npm into the pdf-render payload builder, so
 * in 2019 we wrote the subset we actually used:
 *
 *   {{name}} {{customer.name}}   escaped substitution (dotted paths ok)
 *   {{{html}}}                   raw, no escaping
 *   {{money total_kopecks}}      helper call, args are paths or literals
 *   {{#each lines}}..{{/each}}   loop, {{this}} / {{@index}} / {{../x}} inside
 *   {{#if paid}}..{{else}}..{{/if}}, {{! comment }}
 *
 * Compiled templates are cached per process.
 * NB: templates/ was removed together with the PDF service (2020).
 */
'use strict';

var fs = require('fs');
var path = require('path');

var TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.join(__dirname, '..', '..', 'templates');
var EXT = '.hbs';

var cache = {};
var helpers = {};

var TAG = /\{\{\{\s*([\s\S]+?)\s*\}\}\}|\{\{\s*([\s\S]+?)\s*\}\}/g;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tokenize(src) {
  var tokens = [];
  var last = 0;
  var m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(src)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: src.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ kind: 'raw', value: m[1] });
    else tokens.push({ kind: 'tag', value: m[2] });
    last = TAG.lastIndex;
  }
  if (last < src.length) tokens.push({ kind: 'text', value: src.slice(last) });
  return tokens;
}

function parse(tokens, name) {
  var root = [];
  var stack = [{ node: null, list: root }];
  var label = name ? name + ': ' : '';

  function emit(node) {
    stack[stack.length - 1].list.push(node);
  }

  tokens.forEach(function (tok) {
    if (tok.kind === 'text') return emit({ type: 'text', value: tok.value });
    if (tok.kind === 'raw') return emit({ type: 'expr', expr: tok.value, raw: true });

    var v = tok.value;
    var first = v.charAt(0);
    if (first === '!') return;
    if (first === '#') {
      var parts = v.slice(1).trim().split(/\s+/);
      if (parts[0] !== 'each' && parts[0] !== 'if') {
        throw new Error(label + 'unknown block {{#' + parts[0] + '}}');
      }
      var block = { type: parts[0], path: parts[1], body: [], alt: [] };
      emit(block);
      stack.push({ node: block, list: block.body });
      return;
    }
    if (v === 'else') {
      var cur = stack[stack.length - 1];
      if (!cur.node || cur.node.type !== 'if') throw new Error(label + '{{else}} outside of {{#if}}');
      cur.list = cur.node.alt;
      return;
    }
    if (first === '/') {
      var closing = v.slice(1).trim();
      var open = stack.pop();
      if (!open.node || open.node.type !== closing) {
        throw new Error(label + 'unexpected {{/' + closing + '}}');
      }
      return;
    }
    emit({ type: 'expr', expr: v, raw: false });
  });

  if (stack.length > 1) {
    throw new Error(label + 'unclosed {{#' + stack[stack.length - 1].node.type + '}}');
  }
  return root;
}

function resolve(p, scope) {
  if (p === 'this' || p === '.') return scope.data;
  if (p === '@index') return scope.index;
  var s = scope;
  while (p.indexOf('../') === 0 && s.parent) {
    s = s.parent;
    p = p.slice(3);
  }
  if (p.indexOf('this.') === 0) p = p.slice(5);
  var cur = s.data;
  var keys = p.split('.');
  for (var i = 0; i < keys.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[keys[i]];
  }
  return cur;
}

function argValue(arg, scope) {
  if (/^"[^"]*"$|^'[^']*'$/.test(arg)) return arg.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(arg)) return Number(arg);
  return resolve(arg, scope);
}

function evaluate(expr, scope) {
  var args = expr.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  var head = args[0];
  if (Object.prototype.hasOwnProperty.call(helpers, head)) {
    return helpers[head].apply(null, args.slice(1).map(function (a) { return argValue(a, scope); }));
  }
  if (args.length > 1) throw new Error('missing helper: ' + head);
  return resolve(head, scope);
}

function run(nodes, scope) {
  var out = '';
  nodes.forEach(function (n) {
    if (n.type === 'text') {
      out += n.value;
    } else if (n.type === 'expr') {
      var v = evaluate(n.expr, scope);
      if (v === null || v === undefined) return;
      out += n.raw ? String(v) : escapeHtml(v);
    } else if (n.type === 'if') {
      var cond = resolve(n.path, scope);
      out += run((Array.isArray(cond) ? cond.length : cond) ? n.body : n.alt, scope);
    } else if (n.type === 'each') {
      var list = resolve(n.path, scope) || [];
      for (var i = 0; i < list.length; i++) {
        out += run(n.body, { data: list[i], parent: scope, index: i });
      }
    }
  });
  return out;
}

function compile(source, name) {
  var tree = parse(tokenize(String(source)), name);
  return function template(data) {
    return run(tree, { data: data || {}, parent: null, index: 0 });
  };
}

function registerHelper(name, fn) {
  helpers[name] = fn;
}

// --- default helpers (same as the ones we had in the .hbs world) -----------

function fmtAmount(kopecks) {
  var n = Math.round(Number(kopecks) || 0);
  var sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  var whole = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  var frac = String(n % 100);
  return sign + whole + ',' + (frac.length < 2 ? '0' + frac : frac);
}

function dmy(iso) {
  if (!iso) return '';
  var p = String(iso).slice(0, 10).split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

registerHelper('money', fmtAmount);
registerHelper('date', dmy);
registerHelper('upper', function (s) { return s === undefined || s === null ? '' : String(s).toUpperCase(); });

// --- loading ----------------------------------------------------------------

// render('invoice', data, cb) -> templates/invoice.hbs
function render(name, data, cb) {
  if (cache[name]) return done(cache[name]);
  fs.readFile(path.join(TEMPLATES_DIR, name + EXT), 'utf8', function (err, src) {
    if (err) return cb(err);
    try {
      cache[name] = compile(src, name);
    } catch (e) {
      return cb(e);
    }
    done(cache[name]);
  });

  function done(tpl) {
    var html;
    try {
      html = tpl(data);
    } catch (e) {
      return cb(e);
    }
    cb(null, html);
  }
}

module.exports = {
  compile: compile,
  render: render,
  registerHelper: registerHelper,
  escapeHtml: escapeHtml,
};
