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
  FIELD_ENCRYPTION_KEY: base64Key32,
  SESSION_SECRET: base64Key32,
  APP_URL: z.string().min(1).default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CRON_SECRET: z.string().optional(),
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
