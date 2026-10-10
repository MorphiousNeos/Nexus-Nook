// Tests for the shared-ops payout split.
//
// These are the first tests in the repository. They cover one function, chosen
// because it is the arithmetic players will check by hand: if a crew of three
// splits a haul and the numbers do not add up to what they sold it for, they
// stop trusting the app. Every case below is a shape a real op can take.
//
// Run with `npm test` in backend/.

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeOpsPayouts, netOf } = require('../lib/opsSplit');

/** Crew member shorthand. */
const member = (id, shares, name = `player${id}`) => ({ user_id: id, name, shares });
/** Ledger entry shorthand. */
const entry = (amount) => ({ amount });

/** The invariant that matters most: no aUEC is created or destroyed. */
function assertConserved(result) {
  const paid = result.payouts.reduce((sum, p) => sum + p.payout, 0);
  assert.equal(
    paid + result.unallocated,
    result.net,
    `payouts (${paid}) + unallocated (${result.unallocated}) must equal net (${result.net})`,
  );
  for (const p of result.payouts) {
    assert.ok(Number.isInteger(p.payout), `payout ${p.payout} must be a whole aUEC`);
  }
}

test('splits an even haul equally', () => {
  const result = computeOpsPayouts(
    [member(1, 1), member(2, 1), member(3, 1)],
    [entry(300000)],
  );
  assert.equal(result.net, 300000);
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [100000, 100000, 100000],
  );
  assertConserved(result);
});

test('honours weighted shares', () => {
  // 1 + 1.5 + 1 = 3.5 shares over 350,000 aUEC = 100,000 per share.
  const result = computeOpsPayouts(
    [member(1, 1), member(2, 1.5), member(3, 1)],
    [entry(350000)],
  );
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [100000, 150000, 100000],
  );
  assert.equal(result.totalShares, 3.5);
  assertConserved(result);
});

test('loses no aUEC when the split does not come out even', () => {
  // The case from the plan: 1,000,003 three ways. Someone must get the extra.
  const result = computeOpsPayouts(
    [member(1, 1), member(2, 1), member(3, 1)],
    [entry(1000003)],
  );
  assert.equal(result.net, 1000003);
  assertConserved(result);
  const payouts = result.payouts.map((p) => p.payout).sort((a, b) => a - b);
  assert.deepEqual(payouts, [333334, 333334, 333335]);
});

test('is deterministic across repeated calls', () => {
  // Two crew members comparing phones must see identical numbers, so the
  // remainder may never land on an arbitrary member.
  const crew = [member(7, 1), member(3, 1), member(11, 1)];
  const ledger = [entry(1000001)];
  const first = computeOpsPayouts(crew, ledger);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(computeOpsPayouts(crew, ledger).payouts, first.payouts);
  }
});

test('splits a loss as readily as a profit', () => {
  // Expenses beat income: everyone is genuinely out of pocket.
  const result = computeOpsPayouts(
    [member(1, 1), member(2, 1)],
    [entry(50000), entry(-130000)],
  );
  assert.equal(result.net, -80000);
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [-40000, -40000],
  );
  assertConserved(result);
});

test('conserves aUEC on an uneven loss', () => {
  const result = computeOpsPayouts(
    [member(1, 1), member(2, 1), member(3, 1)],
    [entry(-1000001)],
  );
  assert.equal(result.net, -1000001);
  assertConserved(result);
  const payouts = result.payouts.map((p) => p.payout).sort((a, b) => a - b);
  assert.deepEqual(payouts, [-333334, -333334, -333333]);
});

test('mixes income and expenses into one net', () => {
  const result = computeOpsPayouts(
    [member(1, 1), member(2, 1)],
    [entry(500000), entry(-40000), entry(120000), entry(-80000)],
  );
  assert.equal(result.net, 500000);
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [250000, 250000],
  );
  assertConserved(result);
});

test('pays nothing, and says so, when nobody holds a share', () => {
  const result = computeOpsPayouts([member(1, 0), member(2, 0)], [entry(90000)]);
  assert.equal(result.net, 90000);
  assert.equal(result.totalShares, 0);
  assert.equal(result.unallocated, 90000);
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [0, 0],
  );
  assertConserved(result);
});

test('ignores a member set to zero shares without dropping them', () => {
  // Sitting a run out means no cut — but the member stays visible to the crew.
  const result = computeOpsPayouts(
    [member(1, 1), member(2, 0), member(3, 1)],
    [entry(200000)],
  );
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [100000, 0, 100000],
  );
  assert.equal(result.payouts.length, 3);
  assertConserved(result);
});

test('treats a negative share weight as zero', () => {
  const result = computeOpsPayouts([member(1, -5), member(2, 1)], [entry(60000)]);
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [0, 60000],
  );
  assertConserved(result);
});

test('pays a single crew member the whole net', () => {
  const result = computeOpsPayouts([member(1, 2.5)], [entry(777777)]);
  assert.deepEqual(result.payouts[0].payout, 777777);
  assertConserved(result);
});

test('handles an empty crew and an empty ledger', () => {
  const noCrew = computeOpsPayouts([], [entry(1000)]);
  assert.equal(noCrew.unallocated, 1000);
  assert.deepEqual(noCrew.payouts, []);

  const noLedger = computeOpsPayouts([member(1, 1), member(2, 1)], []);
  assert.equal(noLedger.net, 0);
  assert.deepEqual(
    noLedger.payouts.map((p) => p.payout),
    [0, 0],
  );
  assertConserved(noLedger);
});

test('parses the strings pg returns for BIGINT and NUMERIC', () => {
  // `pg` hands back BIGINT amounts and NUMERIC shares as strings. Treating
  // those as numbers without parsing would concatenate instead of adding.
  const result = computeOpsPayouts(
    [
      { user_id: 1, name: 'a', shares: '1.0' },
      { user_id: 2, name: 'b', shares: '1.0' },
    ],
    [{ amount: '420000' }, { amount: '-20000' }],
  );
  assert.equal(result.net, 400000);
  assert.deepEqual(
    result.payouts.map((p) => p.payout),
    [200000, 200000],
  );
  assertConserved(result);
});

test('accepts camelCase crew rows as well as snake_case', () => {
  const result = computeOpsPayouts(
    [{ userId: 1, name: 'a', shares: 1 }, { userId: 2, name: 'b', shares: 1 }],
    [entry(100)],
  );
  assert.deepEqual(
    result.payouts.map((p) => p.userId),
    ['1', '2'],
  );
  assertConserved(result);
});

test('ignores fractional aUEC in the ledger', () => {
  // Amounts are truncated on write; a stray float must not leak a fraction
  // into someone's payout.
  const result = computeOpsPayouts([member(1, 1)], [entry(100.9), entry(0.4)]);
  assert.equal(result.net, 100);
  assert.equal(result.payouts[0].payout, 100);
});

test('netOf tolerates junk', () => {
  assert.equal(netOf(null), 0);
  assert.equal(netOf([{ amount: 'nonsense' }, { amount: 500 }]), 500);
  assert.equal(netOf([{}, { amount: null }]), 0);
});

test('conserves aUEC across many random crews and ledgers', () => {
  // The invariant should not depend on the shapes we happened to think of.
  let seed = 20261010;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let run = 0; run < 500; run += 1) {
    const crew = Array.from({ length: 1 + rand(6) }, (_, i) =>
      member(i + 1, rand(8) / 2),
    );
    const entries = Array.from({ length: 1 + rand(5) }, () =>
      entry(rand(2000000) - 1000000),
    );
    assertConserved(computeOpsPayouts(crew, entries));
  }
});
