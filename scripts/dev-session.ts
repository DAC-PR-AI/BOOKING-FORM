import 'dotenv/config';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Mints a session cookie for a seeded demo account, for testing routes with
 * curl without driving a browser.
 *
 * It reproduces `createSession()` exactly — same token shape, same SHA-256 in
 * the database, same HMAC — but writes the value to stdout instead of to a
 * `Set-Cookie` header, because `cookies()` only exists inside a request.
 *
 * Run:  npx tsx scripts/dev-session.ts exec@dac.test
 *
 * Refuses to run in production: it hands out a working session for any
 * account, which is a development convenience and nothing else.
 */

const TTL_MS = 12 * 60 * 60 * 1000;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to mint a session in production.');
  }

  const email = process.argv[2] ?? 'exec@dac.test';
  if (!email.endsWith('.test')) {
    throw new Error('Only .test demo accounts, so this cannot be aimed at a real user.');
  }

  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.SESSION_SECRET;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  if (!secret) throw new Error('SESSION_SECRET is not set.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No such user: ${email}. Run \`npm run db:seed\`.`);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const hmac = createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(token)
      .digest('base64url');

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + TTL_MS),
        userAgent: 'scripts/dev-session.ts',
      },
    });

    // Only the cookie value, so it can be captured straight into a variable.
    console.log(`${token}.${hmac}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
