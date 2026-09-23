'use strict';

/**
 * Order status machine.
 *
 *   new ──> confirmed ──> invoiced ──> shipped ──> closed
 *    │          │
 *    └──────────┴──> cancelled
 *
 * The table below is the source of truth. If you add a status here, also check
 * lib/invoices/routes.js — it only issues for 'confirmed' and flips the order to
 * 'invoiced' itself, without going through this file.
 */
var store = require('../store');

var TRANSITIONS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['invoiced', 'cancelled'],
  invoiced: ['shipped'],
  shipped: ['closed'],
  closed: [],
  cancelled: [],
};

var STATUSES = Object.keys(TRANSITIONS);

// Statuses that only another module may set. 'invoiced' is set by
// POST /api/orders/:id/invoice together with the invoice itself — setting it by
// hand leaves an invoiced order without an invoice (happened twice in 2021).
var SYSTEM_ONLY = {
  invoiced: 'POST /api/orders/:id/invoice',
};

// Since the 2022 audit a confirmed order cannot be cancelled without a reason
// (the warehouse may already have picked it). Orders created before that date
// were cancelled freely and we never backfilled reasons, so they stay exempt.
var CANCEL_REASON_REQUIRED_FROM = '2022-01-01';
var MIN_REASON_LENGTH = 5;

function isStatus(s) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, s);
}

function allowedFrom(status) {
  return isStatus(status) ? TRANSITIONS[status].slice() : [];
}

function canTransition(from, to) {
  if (!isStatus(from) || !isStatus(to)) return false;
  return TRANSITIONS[from].indexOf(to) !== -1;
}

function isTerminal(status) {
  return isStatus(status) && TRANSITIONS[status].length === 0;
}

function needsReason(order, to) {
  if (order.status !== 'confirmed' || to !== 'cancelled') return false;
  // created_at у форматі YYYY-MM-DD, тому порівняння рядків працює
  return (order.created_at || '') >= CANCEL_REASON_REQUIRED_FROM;
}

/**
 * Returns null if the move is allowed, otherwise a human readable reason.
 * Kept separate from applyTransition so the UI could ask "can I?" without
 * writing anything (the UI never did, but the tests use it).
 */
function checkTransition(order, to, reason) {
  if (!isStatus(to)) return 'unknown status: ' + to;
  if (order.status === to) return 'order is already ' + to;
  if (!canTransition(order.status, to)) {
    var next = allowedFrom(order.status);
    return 'cannot move order from ' + order.status + ' to ' + to +
      (next.length ? ' (allowed: ' + next.join(', ') + ')' : ' (final status)');
  }
  if (needsReason(order, to)) {
    var r = typeof reason === 'string' ? reason.trim() : '';
    if (r.length < MIN_REASON_LENGTH) return 'a reason is required to cancel a confirmed order';
  }
  return null;
}

/**
 * Build the patch for store.update. Does not touch `order` — the store hands out
 * the cached row itself, so pushing onto its history would change it even when
 * the update is rejected later.
 */
function buildPatch(order, to, opts) {
  opts = opts || {};
  var at = opts.at || new Date().toISOString();
  var entry = { from: order.status, to: to, at: at, staff_id: opts.staffId || null };
  if (opts.reason) entry.reason = String(opts.reason).trim();

  var patch = {
    status: to,
    status_changed_at: at,
    // seed orders were created before we kept history; they start with none
    status_history: (order.status_history || []).concat([entry]),
  };
  if (to === 'cancelled') patch.cancel_reason = entry.reason || null;
  return patch;
}

/**
 * Move an order to a new status. Does NOT save the collection; the caller
 * decides when (routes save once per request).
 *
 * opts: { reason, staffId, at }
 */
function applyTransition(orderId, to, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  opts = opts || {};
  store.find('orders', orderId, function (err, order) {
    if (err) return cb(err);
    if (!order) return cb(null, null, 'order not found');
    var problem = checkTransition(order, to, opts.reason);
    if (problem) return cb(null, order, problem);
    store.update('orders', order.id, buildPatch(order, to, opts), function (err2, updated) {
      if (err2) return cb(err2);
      cb(null, updated, null);
    });
  });
}

module.exports = {
  TRANSITIONS: TRANSITIONS,
  STATUSES: STATUSES,
  SYSTEM_ONLY: SYSTEM_ONLY,
  CANCEL_REASON_REQUIRED_FROM: CANCEL_REASON_REQUIRED_FROM,
  isStatus: isStatus,
  allowedFrom: allowedFrom,
  canTransition: canTransition,
  isTerminal: isTerminal,
  needsReason: needsReason,
  checkTransition: checkTransition,
  buildPatch: buildPatch,
  applyTransition: applyTransition,
};
