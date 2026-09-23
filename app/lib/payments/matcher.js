/**
 * Matching incoming bank transfers to invoices.
 *
 * Rules, in this order (agreed with accounting in 2019, ticket BILL-212):
 *   1. invoice number(s) found in the purpose of payment;
 *   2. exact amount against the remaining balance of an open invoice —
 *      only the payer's own invoices if we know the payer by ЄДРПОУ;
 *   3. everything else goes to the unmatched queue for a human.
 *
 * A transfer bigger than what is due becomes customer credit. A smaller one
 * is a partial payment: the invoice stays open with a lower balance.
 *
 * Pure: takes rows, returns a plan. Never touches the store and never
 * mutates the rows it was given (store rows are the cached objects!).
 */
'use strict';

var CLOSED = { paid: true, cancelled: true, draft: true };

// INV-2026-00042, but also "INV 2026 00042", "inv-2026-42", "INV/2026/00042", "inv2026-42"
// TODO(2021-06): people type a Cyrillic «І» in "INV" — those end up in the unmatched queue
var REF_SOURCE = '\\bINV[\\s\\-_.\\/№#:]*(20\\d{2})[\\s\\-_.\\/]*(\\d{1,5})(?!\\d)';

function pad5(n) {
  var s = String(n);
  while (s.length < 5) s = '0' + s;
  return s;
}

/**
 * All invoice numbers mentioned in a purpose text, canonical form, no repeats,
 * in the order they appear.
 */
function extractInvoiceRefs(purpose) {
  var re = new RegExp(REF_SOURCE, 'gi');
  var out = [];
  var m;
  while ((m = re.exec(purpose || '')) !== null) {
    var num = 'INV-' + m[1] + '-' + pad5(Number(m[2]));
    if (out.indexOf(num) === -1) out.push(num);
  }
  return out;
}

function Planner(data, opts) {
  var self = this;
  this.today = opts.today || new Date().toISOString().slice(0, 10);
  this.invoices = data.invoices || [];
  this.byNumber = {};
  this.outstanding = {}; // invoice id -> kopecks still due, updated as we go
  this.closedNow = {}; // invoice id -> true once this plan pays it off
  this.customerByEdrpou = {};
  this.knownRefs = {};
  this.plan = { decisions: [], payments: [], invoiceUpdates: [], credits: [], unmatched: [] };

  this.invoices.forEach(function (inv) {
    self.byNumber[inv.number] = inv;
    self.outstanding[inv.id] = inv.total_kopecks;
  });
  (data.payments || []).forEach(function (p) {
    if (self.outstanding[p.invoice_id] !== undefined) self.outstanding[p.invoice_id] -= p.amount_kopecks;
    if (p.bank_ref) self.knownRefs[p.bank_ref] = true;
  });
  (data.unmatched || []).forEach(function (u) {
    if (u.bank_ref) self.knownRefs[u.bank_ref] = true;
  });
  (data.customers || []).forEach(function (c) {
    if (c.edrpou) self.customerByEdrpou[c.edrpou] = c;
  });
}

Planner.prototype.statusOf = function (inv) {
  return this.closedNow[inv.id] ? 'paid' : inv.status;
};

Planner.prototype.isOpen = function (inv) {
  return !CLOSED[this.statusOf(inv)] && this.outstanding[inv.id] > 0;
};

Planner.prototype.decide = function (entry, outcome, numbers, detail) {
  this.plan.decisions.push({ line: entry.line, date: entry.date, bank_ref: entry.bank_ref, amount_kopecks: entry.amount_kopecks,
    outcome: outcome, invoices: numbers || [], detail: detail || '' });
};

Planner.prototype.byAmount = function (entry, payer) {
  var self = this;
  return this.invoices.filter(function (inv) {
    if (!self.isOpen(inv) || self.outstanding[inv.id] !== entry.amount_kopecks) return false;
    // payer known: never book onto somebody else's invoice by amount alone (BILL-340)
    return payer ? inv.customer_id === payer.id : true;
  });
};

Planner.prototype.add = function (entry) {
  var self = this;
  if (entry.direction !== 'CR') return this.decide(entry, 'skipped', [], 'outgoing payment');
  if (entry.bank_ref && this.knownRefs[entry.bank_ref]) return this.decide(entry, 'skipped', [], 'already imported');
  if (entry.bank_ref) this.knownRefs[entry.bank_ref] = true;

  var payer = entry.payer_edrpou ? this.customerByEdrpou[entry.payer_edrpou] : null;
  var refs = extractInvoiceRefs(entry.purpose);
  var targets = [];
  var closed = [];
  refs.forEach(function (num) {
    var inv = self.byNumber[num];
    if (!inv) return;
    if (self.isOpen(inv)) targets.push(inv);
    else closed.push(num + ' is ' + self.statusOf(inv));
  });
  if (targets.length) return this.allocate(entry, targets, payer, 'number');

  // рахунок уже оплачений або скасований — найімовірніше, подвійна оплата; хай дивиться людина
  if (closed.length) return this.queue(entry, 'invoice_not_open', refs, closed.join('; '));

  var candidates = this.byAmount(entry, payer);
  if (candidates.length === 1) return this.allocate(entry, candidates, payer, 'amount');
  if (candidates.length > 1) {
    return this.queue(entry, 'ambiguous_amount', candidates.map(function (i) { return i.number; }), candidates.length + ' open invoices with this amount');
  }
  this.queue(entry, refs.length ? 'unknown_invoice' : 'no_match', refs, '');
};

Planner.prototype.allocate = function (entry, targets, payer, via) {
  var self = this;
  var left = entry.amount_kopecks;
  var partial = false;
  var numbers = [];
  targets.forEach(function (inv) {
    if (left <= 0) return;
    var take = Math.min(left, self.outstanding[inv.id]);
    left -= take;
    self.outstanding[inv.id] -= take;
    numbers.push(inv.number);
    self.plan.payments.push({
      invoice_id: inv.id,
      amount_kopecks: take,
      paid_at: entry.date,
      method: 'bank',
      bank_ref: entry.bank_ref,
      payer_edrpou: entry.payer_edrpou,
      matched_by: via,
    });
    if (self.outstanding[inv.id] === 0) {
      self.closedNow[inv.id] = true;
      self.plan.invoiceUpdates.push({ id: inv.id, number: inv.number, patch: { status: 'paid', paid_at: entry.date } });
    } else {
      partial = true;
    }
  });

  if (left > 0) {
    var last = targets[targets.length - 1];
    this.plan.credits.push({
      customer_id: payer ? payer.id : last.customer_id,
      amount_kopecks: left,
      reason: 'overpayment',
      invoice_id: last.id,
      bank_ref: entry.bank_ref,
      created_at: entry.date,
    });
    return this.decide(entry, 'overpaid', numbers, 'credit ' + left + ' kop.');
  }
  this.decide(entry, partial ? 'partial' : 'matched', numbers, 'by ' + via);
};

Planner.prototype.queue = function (entry, reason, numbers, detail) {
  this.plan.unmatched.push({
    bank_ref: entry.bank_ref,
    received_at: entry.date,
    amount_kopecks: entry.amount_kopecks,
    payer_edrpou: entry.payer_edrpou,
    payer_name: entry.payer_name,
    purpose: entry.purpose,
    reason: reason,
    status: 'open',
    queued_at: this.today,
  });
  this.decide(entry, 'unmatched', numbers, reason + (detail ? ': ' + detail : ''));
};

/**
 * @param {object} parsed  result of statement.parseStatement (must have no errors)
 * @param {object} data    { invoices, payments, customers, unmatched } — rows as stored
 * @param {object} [opts]  { today: 'YYYY-MM-DD' }
 * @returns {object} plan: decisions (one per D line), payments, invoiceUpdates,
 *   credits, unmatched, statement, totals
 */
function planPayments(parsed, data, opts) {
  var p = new Planner(data || {}, opts || {});
  parsed.entries.forEach(function (e) {
    p.add(e);
  });
  var plan = p.plan;
  plan.statement = Object.assign({}, parsed.header, { records: parsed.entries.length });
  plan.totals = {
    received_kopecks: sum(parsed.entries.filter(function (e) { return e.direction === 'CR'; })),
    booked_kopecks: sum(plan.payments),
    credit_kopecks: sum(plan.credits),
    unmatched_kopecks: sum(plan.unmatched),
  };
  return plan;
}

function sum(rows) {
  return rows.reduce(function (s, r) { return s + r.amount_kopecks; }, 0);
}

module.exports = {
  extractInvoiceRefs: extractInvoiceRefs,
  planPayments: planPayments,
  Planner: Planner,
};
