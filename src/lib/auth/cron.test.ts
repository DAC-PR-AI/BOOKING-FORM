import { describe, expect, it } from 'vitest';
import { verifyCronAuth } from './cron';

describe('verifyCronAuth', () => {
  it('accepts a matching Bearer token in constant time', () => {
    expect(
      verifyCronAuth('Bearer super-secret-cron-token', {
        cronSecret: 'super-secret-cron-token',
        nodeEnv: 'production',
      }),
    ).toBe(true);
  });

  it('rejects a wrong or missing Bearer token when CRON_SECRET is set', () => {
    expect(
      verifyCronAuth('Bearer wrong-token', {
        cronSecret: 'super-secret-cron-token',
        nodeEnv: 'production',
      }),
    ).toBe(false);

    expect(
      verifyCronAuth(null, {
        cronSecret: 'super-secret-cron-token',
        nodeEnv: 'development',
      }),
    ).toBe(false);
  });

  it('fails closed in production when CRON_SECRET is unset and failClosedInProd is true', () => {
    expect(
      verifyCronAuth(null, {
        cronSecret: undefined,
        nodeEnv: 'production',
        failClosedInProd: true,
      }),
    ).toBe(false);
  });

  it('allows local development calls when CRON_SECRET is unset', () => {
    expect(
      verifyCronAuth(null, {
        cronSecret: undefined,
        nodeEnv: 'development',
        failClosedInProd: true,
      }),
    ).toBe(true);
  });
});

