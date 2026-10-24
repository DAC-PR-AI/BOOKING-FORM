import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SignedUpload, StorageDriver, StoredObject } from './types';
import { isSafeKey } from './keys';

/**
 * Supabase Storage driver — production.
 *
 * The bucket must be PRIVATE. Every read goes through a signed URL minted
 * here after the application has authorised it; there is no code path that
 * produces a public object URL (brief §3).
 *
 * This module uses the SERVICE ROLE key, which bypasses row-level security.
 * That is correct for this architecture and is why it must never be imported
 * from a client component — authorisation is done by our own session and RBAC
 * layer before any call reaches this file, and the browser never speaks to
 * Supabase. `server-only` makes a mistaken import a build error rather than a
 * credential leak.
 */

const REQUIRED_REGION = 'ap-south-1';

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function supabaseConfig():
  | { url: string; serviceRoleKey: string; bucket: string }
  | null {
  const url = readEnv('SUPABASE_URL') ?? readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  const bucket = readEnv('SUPABASE_STORAGE_BUCKET') ?? 'booking-documents';

  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey, bucket };
}

/**
 * Works out whether the project really is in Mumbai.
 *
 * Storage lives in the project's region, and the region is fixed at creation,
 * so there is nothing to check at runtime per request — but there IS something
 * to check at boot, because the single most likely way to break the residency
 * requirement is to point this at a project created in the default region
 * without noticing. `SUPABASE_REGION` is the explicit answer; the pooler host
 * in DATABASE_URL is the fallback, since it names the region directly.
 */
export function detectRegion(): { region: string | null; source: string } {
  const declared = readEnv('SUPABASE_REGION');
  if (declared) return { region: declared.toLowerCase(), source: 'SUPABASE_REGION' };

  const databaseUrl = readEnv('DATABASE_URL');
  if (databaseUrl) {
    const match = /(?:aws|gcp)-\d+-([a-z]{2}-[a-z]+-\d)\./.exec(databaseUrl);
    if (match?.[1]) return { region: match[1], source: 'DATABASE_URL host' };
  }

  return { region: null, source: 'undetermined' };
}

let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cached) return cached;

  const config = supabaseConfig();
  if (!config) {
    throw new Error(
      'Supabase storage is not configured. Set SUPABASE_SERVICE_ROLE_KEY and ' +
        'NEXT_PUBLIC_SUPABASE_URL, or leave them unset to use the local driver.',
    );
  }

  cached = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

function bucket() {
  const config = supabaseConfig();
  if (!config) throw new Error('Supabase storage is not configured.');
  return client().storage.from(config.bucket);
}

function assertKey(key: string): void {
  if (!isSafeKey(key)) throw new Error('Unsafe storage key.');
}

const region = detectRegion();

export const supabaseDriver: StorageDriver = {
  name: 'supabase',

  residency: {
    inIndia: region.region === REQUIRED_REGION,
    detail:
      region.region === null
        ? 'Supabase project region could not be determined. Set SUPABASE_REGION=ap-south-1.'
        : `Supabase project region ${region.region} (from ${region.source}).`,
  },

  async createSignedUpload(key, contentType, _expiresInSeconds, _grantToken): Promise<SignedUpload> {
    assertKey(key);

    // Supabase's signed upload URL carries its own token in the query string
    // and has a fixed two-hour validity, so our shorter grant TTL is the
    // binding one — the server still refuses to record a document after it.
    const { data, error } = await bucket().createSignedUploadUrl(key);
    if (error || !data) {
      throw new Error(`Could not create an upload URL: ${error?.message ?? 'unknown error'}`);
    }

    return {
      url: data.signedUrl,
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-upsert': 'false' },
    };
  },

  async createSignedDownloadUrl(key, expiresInSeconds): Promise<string> {
    assertKey(key);
    const { data, error } = await bucket().createSignedUrl(key, expiresInSeconds);
    if (error || !data) {
      throw new Error(`Could not create a download URL: ${error?.message ?? 'unknown error'}`);
    }
    return data.signedUrl;
  },

  async get(key): Promise<StoredObject> {
    assertKey(key);
    const { data, error } = await bucket().download(key);
    if (error || !data) {
      throw new Error(`Could not read ${key}: ${error?.message ?? 'not found'}`);
    }
    const body = Buffer.from(await data.arrayBuffer());
    return {
      body,
      contentType: data.type || 'application/octet-stream',
      sizeBytes: body.byteLength,
    };
  },

  async stat(key) {
    assertKey(key);

    const lastSlash = key.lastIndexOf('/');
    const prefix = lastSlash === -1 ? '' : key.slice(0, lastSlash);
    const name = key.slice(lastSlash + 1);

    const { data, error } = await bucket().list(prefix, { search: name, limit: 100 });
    if (error || !data) return null;

    const match = data.find((entry) => entry.name === name);
    if (!match) return null;

    const metadata = match.metadata as { size?: number; mimetype?: string } | null;
    return {
      sizeBytes: metadata?.size ?? 0,
      contentType: metadata?.mimetype ?? 'application/octet-stream',
    };
  },

  async remove(key): Promise<void> {
    assertKey(key);
    const { error } = await bucket().remove([key]);
    if (error) throw new Error(`Could not delete ${key}: ${error.message}`);
  },
};

/**
 * Called by the driver factory. Refuses to serve regulated documents out of a
 * region that breaks the residency requirement — in production this is a hard
 * stop, because the alternative is personal data silently sitting abroad.
 */
export function assertUsable(): void {
  if (region.region === REQUIRED_REGION) return;

  const message =
    `Supabase storage region is ${region.region ?? 'unknown'} (from ${region.source}), ` +
    `but all personal data must reside in India (${REQUIRED_REGION}). A project's region ` +
    'cannot be changed after creation — create a Mumbai project, or set SUPABASE_REGION ' +
    'if detection is simply failing.';

  if (process.env.NODE_ENV === 'production') throw new Error(message);
  console.warn(`[storage] ${message}`);
}
