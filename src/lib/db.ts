import 'server-only';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env, isProduction } from './env';

/**
 * Prisma 7 connects through a driver adapter rather than a datasource URL in
 * the schema. See prisma.config.ts for the migrate-time configuration.
 *
 * This module must only ever be imported from server code running in `bom1`
 * (Mumbai). It must never be reached from middleware — see PLAN.md §3:
 * Vercel deploys Routing Middleware to ALL regions regardless of the `regions`
 * setting, so a DB read there would execute outside India.
 */

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
});

function createClient(): PrismaClient {
  return new PrismaClient({
    adapter,
    log: isProduction ? ['error'] : ['error', 'warn'],
  });
}

// Reuse the client across hot reloads in development.
const globalForPrisma = globalThis as unknown as {
  __dacPrisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.__dacPrisma ?? createClient();

if (!isProduction) {
  globalForPrisma.__dacPrisma = prisma;
}
