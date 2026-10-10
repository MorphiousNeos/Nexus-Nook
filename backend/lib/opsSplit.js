// =============================================================================
// SHARED OPS PAYOUT SPLITTING
// =============================================================================
// One crew, one ledger, one answer about who is owed what.
//
// This lives in its own module, free of Express and the database, for two
// reasons: the server cannot be imported without a live Postgres and Redis, so
// anything defined inside it is untestable; and the split is the one piece of
// arithmetic in this product that players will check by hand against their own
// aUEC. It needs to be verifiable on its own terms.
//
// The rules:
//
//   * aUEC is an integer currency. No payout is ever a fraction.
//   * The payouts always sum to exactly the net. Rounding may not create or
//     destroy a single aUEC, because the crew will add the numbers up.
//   * A negative net (expenses beat income) splits the loss the same way a
//     profit splits. Pretending a loss is a zero payout would be a lie about
//     who is out of pocket.
//   * A crew with no shares between them gets nothing, and we say how much went
//     unallocated rather than quietly dividing by zero.

/** Parse a value that may arrive from `pg` as a string (BIGINT, NUMERIC). */
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Ledger total in whole aUEC. Income is positive, expenses negative. */
function netOf(entries) {
  if (!Array.isArray(entries)) return 0;
  let net = 0;
  for (const entry of entries) {
    net += Math.trunc(toFiniteNumber(entry?.amount));
  }
  return net;
}

/**
 * Split `net` across `crew` by share weight.
 *
 * Shares are stored as NUMERIC(4,1) — always a multiple of 0.5 — so weights are
 * doubled into integers and the whole calculation stays in integer arithmetic.
 * Each member first takes the whole part of their exact share (truncated toward
 * zero), which leaves a few aUEC undistributed; those go one at a time to the
 * members with the largest remainders. That is the largest-remainder method,
 * and it is what makes the total come out exact.
 *
 * Ties go to the lower user id, so the same ledger always produces the same
 * answer — two crew members comparing phones must not see different numbers.
 *
 * @param {Array<{user_id?: any, userId?: any, name?: string, shares?: any}>} crew
 * @param {Array<{amount?: any}>} entries
 * @returns {{net: number, totalShares: number, unallocated: number,
 *            payouts: Array<{userId: string, name: string, shares: number, payout: number}>}}
 */
function computeOpsPayouts(crew, entries) {
  const net = netOf(entries);
  const members = (Array.isArray(crew) ? crew : []).map((member) => {
    const shares = Math.max(0, toFiniteNumber(member?.shares));
    return {
      userId: String(member?.user_id ?? member?.userId ?? ''),
      name: typeof member?.name === 'string' ? member.name : '',
      shares,
      // Doubled so halves become integers; rounded because a NUMERIC round-trip
      // can land a hair off a clean 0.5.
      weight: Math.round(shares * 2),
    };
  });

  const totalWeight = members.reduce((sum, m) => sum + m.weight, 0);
  const totalShares = totalWeight / 2;

  // Nobody holds a share: there is no defensible way to divide this, so we
  // divide none of it and report the whole net as unallocated.
  if (totalWeight === 0) {
    return {
      net,
      totalShares: 0,
      unallocated: net,
      payouts: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        shares: m.shares,
        payout: 0,
      })),
    };
  }

  // `net * weight` stays far inside the safe integer range for any plausible
  // haul (weights cap at 199, so a net would have to exceed ~45 trillion aUEC).
  // If it somehow does not, fall back to float division: approximate beats
  // silently wrong.
  const exact = members.map((m) => {
    const numerator = net * m.weight;
    if (!Number.isSafeInteger(numerator)) {
      return { base: Math.trunc((net / totalWeight) * m.weight), remainder: 0 };
    }
    const base = Math.trunc(numerator / totalWeight);
    return { base, remainder: numerator - base * totalWeight };
  });

  const distributed = exact.reduce((sum, e) => sum + e.base, 0);
  let leftover = net - distributed;

  // `leftover` carries the sign of the net and is smaller than the crew size,
  // so one aUEC each to the largest remainders settles it. Sorting by |remainder|
  // handles a loss as naturally as a profit.
  const step = leftover >= 0 ? 1 : -1;
  const order = members
    .map((m, i) => ({ i, remainder: Math.abs(exact[i].remainder), userId: m.userId }))
    .sort(
      (a, b) =>
        b.remainder - a.remainder ||
        (Number(a.userId) || 0) - (Number(b.userId) || 0) ||
        a.i - b.i,
    );

  const bonus = new Array(members.length).fill(0);
  for (let k = 0; leftover !== 0 && k < order.length; k += 1) {
    bonus[order[k].i] = step;
    leftover -= step;
  }

  return {
    net,
    totalShares,
    unallocated: 0,
    payouts: members.map((m, i) => ({
      userId: m.userId,
      name: m.name,
      shares: m.shares,
      payout: exact[i].base + bonus[i],
    })),
  };
}

module.exports = { computeOpsPayouts, netOf };
