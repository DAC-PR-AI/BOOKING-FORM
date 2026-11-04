import 'server-only';
import { z } from 'zod';

/**
 * Environment validation. Fails fast at boot rather than at the first request,
 * so a missing key never reaches a user as a 500 halfway through a booking.
 */

const base64Key32 = z
  .string()
  .min(1, 'required')
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'must be 32 bytes, base64-encoded (node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))")');

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  FIELD_ENCRYPTION_KEY: base64Key32,
  SESSION_SECRET: base64Key32,
  APP_URL: z.string().min(1).default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CRON_SECRET: z.string().optional(),

  // --- Google Workspace OAuth (@dacdevelopers.com) -------------------------
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ALLOWED_AUTH_DOMAIN: z.string().min(1).default('dacdevelopers.com'),

  // --- Document storage (Phase 3) ------------------------------------------
  // Left optional on purpose: with nothing set the app uses the local
  // filesystem driver, so development needs no cloud credential. The presence
  // of SUPABASE_SERVICE_ROLE_KEY is what switches it to Supabase — see
  // src/lib/storage/index.ts.
  STORAGE_DRIVER: z.enum(['local', 'supabase']).optional(),
  LOCAL_STORAGE_DIR: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().optional(),
  /// Must be ap-south-1. Inferred from the DATABASE_URL host when absent.
  SUPABASE_REGION: z.string().optional(),
  /// Escape hatch for self-hosting on a real disk; never set this on Vercel.
  ALLOW_LOCAL_STORAGE: z.enum(['yes']).optional(),

  // --- Email digest (Phase 7) ----------------------------------------------
  // Optional. Without RESEND_API_KEY the digest reports itself as not
  // configured and the in-app queue carries on unaffected.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  /// Resend's free tier allows 100 a day; lower it to be careful.
  RESEND_DAILY_CAP: z.string().optional(),

  // --- Google Sheets project sync (Phase 7) --------------------------------
  // Optional: with these unset the project list is maintained by hand in the
  // admin screen and the sync simply reports itself as not configured. The
  // booking form never reads Google directly either way (PLAN.md §2A).
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_PROJECTS_SHEET_ID: z.string().optional(),
  GOOGLE_PROJECTS_SHEET_TAB: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`,
    );
  }

  return parsed.data;
}

export const env: Env = load();

export const isProduction = env.NODE_ENV === 'production';
