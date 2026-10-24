import 'server-only';
import type { StorageDriver } from './types';
import { localDriver, assertUsable as assertLocalUsable } from './local';
import { supabaseConfig, supabaseDriver, assertUsable as assertSupabaseUsable } from './supabase';

/**
 * Picks the storage driver.
 *
 * Selection is by configuration, not by environment name, so there is exactly
 * one rule to reason about: **if a Supabase service-role key is present, the
 * documents go to Supabase; otherwise they go to disk.** Nothing needs to be
 * edited when the credential arrives — dropping it into `.env` is the switch.
 *
 * `STORAGE_DRIVER` overrides this, for the case where you have the credential
 * but deliberately want local files (debugging a PDF, working offline).
 *
 * Each driver vets itself on first use: local refuses production, Supabase
 * refuses a region outside India.
 */

export type DriverName = 'local' | 'supabase';

function chooseName(): DriverName {
  const forced = process.env.STORAGE_DRIVER?.toLowerCase();
  if (forced === 'local' || forced === 'supabase') return forced;
  if (forced) {
    throw new Error(`STORAGE_DRIVER must be "local" or "supabase", got "${forced}".`);
  }
  return supabaseConfig() ? 'supabase' : 'local';
}

let resolved: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (resolved) return resolved;

  if (chooseName() === 'supabase') {
    assertSupabaseUsable();
    resolved = supabaseDriver;
  } else {
    assertLocalUsable();
    resolved = localDriver;
  }

  return resolved;
}

/** For the health endpoint and the admin screen — never for a decision. */
export function storageStatus(): {
  driver: DriverName;
  residency: StorageDriver['residency'];
} {
  const driver = storage();
  return { driver: driver.name, residency: driver.residency };
}

export type { StorageDriver, SignedUpload, StoredObject } from './types';
