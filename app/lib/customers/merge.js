/**
 * Duplicate customers and merging them.
 *
 * planMerge() is PURE: it looks at the collections you give it and returns the
 * list of changes that a merge would make. It does not write anything. The
 * plan is shown to a human first (accounting insists); each change is a plain
 * store.update(collection, id, patch), done by hand for now.
 * TODO(2021): bin/merge-customers.js that applies a reviewed plan.
 */
function byId(rows, id) {
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

/**
 * Plan moving everything from customer `sourceId` onto `targetId`.
 *
 * @param {number} sourceId  the duplicate that goes away
 * @param {number} targetId  the customer that stays
 * @param {object} data      { customers: [], orders: [], invoices: [] }
 * @returns {object} { source_id, target_id, errors, warnings, changes, counts }
 *   changes: [{ collection, id, patch }] — in the order they should be applied
 */
function planMerge(sourceId, targetId, data) {
  var plan = {
    source_id: sourceId,
    target_id: targetId,
    errors: [],
    warnings: [],
    changes: [],
    counts: { orders: 0, invoices: 0 },
  };
  if (sourceId === targetId) {
    plan.errors.push('cannot merge a customer into itself');
    return plan;
  }
  var source = byId(data.customers, sourceId);
  var target = byId(data.customers, targetId);
  if (!source) plan.errors.push('source customer ' + sourceId + ' not found');
  if (!target) plan.errors.push('target customer ' + targetId + ' not found');
  if (plan.errors.length) return plan;

  if (source.merged_into) plan.errors.push('source was already merged into ' + source.merged_into);
  if (target.merged_into) plan.errors.push('target was itself merged into ' + target.merged_into + ', merge into that one');
  if (target.active === false) plan.errors.push('target customer is inactive — activate it first');
  if (plan.errors.length) return plan;

  if (source.edrpou && target.edrpou && source.edrpou !== target.edrpou) {
    plan.warnings.push('ЄДРПОУ differ: ' + source.edrpou + ' vs ' + target.edrpou + ' — are these really the same company?');
  }

  (data.orders || []).forEach(function (o) {
    if (o.customer_id !== sourceId) return;
    plan.changes.push({ collection: 'orders', id: o.id, patch: { customer_id: targetId } });
    plan.counts.orders++;
  });

  var open = 0;
  (data.invoices || []).forEach(function (inv) {
    if (inv.customer_id !== sourceId) return;
    plan.changes.push({ collection: 'invoices', id: inv.id, patch: { customer_id: targetId } });
    plan.counts.invoices++;
    if (inv.status === 'issued') open++;
  });
  if (open) {
    plan.warnings.push(open + ' open invoice(s) move to the target; already printed copies still show the old name');
  }
  // payments reference invoice_id, not the customer, so they follow their invoices

  plan.changes.push({
    collection: 'customers',
    id: sourceId,
    patch: { active: false, merged_into: targetId },
  });
  return plan;
}

module.exports = { planMerge: planMerge };
