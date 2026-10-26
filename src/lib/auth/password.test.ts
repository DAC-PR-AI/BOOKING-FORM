import { describe, expect, it } from 'vitest';
import { burnPasswordTime, hashPassword, verifyPassword } from './password';

/**
 * These exercise real Argon2id, so they are slower than the rest of the suite.
 * That is the point: the properties being checked are about the cost of the
 * hash, and a mock would assert nothing.
 */

describe('hashing and verifying', () => {
  it('accepts the right password', async () => {
    const stored = await hashPassword('DacDev!2026');
    expect(await verifyPassword(stored, 'DacDev!2026')).toBe(true);
  }, 20_000);

  it('rejects the wrong one', async () => {
    const stored = await hashPassword('DacDev!2026');
    expect(await verifyPassword(stored, 'DacDev!2025')).toBe(false);
  }, 20_000);

  it('produces a different hash each time, so the salt is doing its job', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  }, 20_000);

  it('records the algorithm and cost in the hash', async () => {
    const stored = await hashPassword('x');
    expect(stored).toContain('$argon2id$');
    expect(stored).toContain('m=19456');
    expect(stored).toContain('t=2');
    expect(stored).toContain('p=1');
  }, 20_000);

  it('returns false for a corrupt stored hash rather than throwing', async () => {
    // A corrupt row must not be distinguishable from a wrong password.
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });
});

describe('burnPasswordTime — the login timing oracle', () => {
  it('always reports failure', async () => {
    expect(await burnPasswordTime('anything')).toBe(false);
  }, 20_000);

  it('actually performs a hash verification rather than returning early', async () => {
    // The whole point: a login for an unknown address must cost roughly what a
    // real one costs. Returning immediately would let an attacker enumerate
    // staff email addresses by timing, defeating the single generic error
    // message the login action is careful to use.
    //
    // Asserted as "takes real time" rather than "within N% of a real verify",
    // because a ratio between two Argon2 runs on a shared CI box is flaky and
    // this still fails loudly if the burn is ever removed.
    const started = performance.now();
    await burnPasswordTime('anything');
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThan(10);
  }, 20_000);

  it('costs about what verifying a real account costs', async () => {
    const stored = await hashPassword('DacDev!2026');

    // Warm both paths first; the decoy hash is computed lazily on first use.
    await Promise.all([verifyPassword(stored, 'wrong'), burnPasswordTime('wrong')]);

    const timeOf = async (run: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await run();
      return performance.now() - started;
    };

    const real = await timeOf(() => verifyPassword(stored, 'wrong'));
    const burned = await timeOf(() => burnPasswordTime('wrong'));

    // Deliberately loose. An order of magnitude apart would be an oracle;
    // anything closer is lost in noise on a real network.
    expect(burned).toBeGreaterThan(real / 10);
    expect(burned).toBeLessThan(real * 10);
  }, 30_000);
});
