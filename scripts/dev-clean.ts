import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { storage } from '../src/lib/storage';

/**
 * Clears bookings and their files out of the development database.
 *
 * Running the end-to-end suite creates a booking per spec, and `dev-fixture`
 * creates one each time it is called; after a few sessions the queues are full
 * of RAVI KUMARs and it stops being possible to see what you are looking at.
 * The verification scripts tidy up after themselves, but Playwright
 * deliberately does not — a failed run's data is what you need to inspect.
 *
 * Run:  npm run dev:clean            # fixtures and test bookings only
 *       npm run dev:clean -- --all   # every booking
 *
 * Deletes the stored objects first, because a booking row is what tells us
 * which objects belong to it. Refuses to run in production.
 */

const FIXTURE_MARKERS = ['VERIFY-', 'HTTP-TEST', 'Created by scripts/dev-fixture.ts', 'Autosave test'];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to delete bookings in production.');
  }

  const all = process.argv.includes('--all');

  const forms = await prisma.bookingForm.findMany({
    where: all
      ? {}
      : {
          OR: [
            ...FIXTURE_MARKERS.map((marker) => ({
              remarks: { startsWith: marker },
            })),
            // Drafts the e2e specs create and abandon have no remarks at all.
            { remarks: null, status: 'DRAFT' as const },
          ],
        },
    select: { id: true, bookingId: true },
  });

  if (forms.length === 0) {
    console.log('Nothing to clean.');
    await prisma.$disconnect();
    return;
  }

  const ids = forms.map((f) => f.id);
  const driver = storage();

  const [documents, signatures, pdfs] = await Promise.all([
    prisma.formDocument.findMany({
      where: { bookingFormId: { in: ids } },
      select: { storageKey: true },
    }),
    prisma.signatureAsset.findMany({
      where: { stepRecord: { flowInstance: { bookingFormId: { in: ids } } } },
      select: { id: true, storageKey: true },
    }),
    prisma.generatedPdf.findMany({
      where: { bookingFormId: { in: ids } },
      select: { storageKey: true },
    }),
  ]);

  let removed = 0;
  for (const key of [
    ...documents.map((d) => d.storageKey),
    ...signatures.map((s) => s.storageKey),
    ...pdfs.map((p) => p.storageKey),
  ]) {
    await driver.remove(key).catch(() => undefined);
    removed += 1;
  }

  // Notifications point at a form by URL, not by foreign key, so they do not
  // cascade and have to be matched by link.
  for (const id of ids) {
    await prisma.notification.deleteMany({ where: { link: { contains: id } } });
  }

  await prisma.bookingForm.deleteMany({ where: { id: { in: ids } } });

  // Signature assets are the PARENT of their step record, so deleting the
  // booking cascades the records away and leaves these orphaned.
  await prisma.signatureAsset.deleteMany({
    where: { id: { in: signatures.map((s) => s.id) } },
  });

  const orphans = await prisma.signatureAsset.count({ where: { stepRecord: null } });
  if (orphans > 0) {
    await prisma.signatureAsset.deleteMany({ where: { stepRecord: null } });
    console.log(`  cleared ${orphans} orphaned signature row(s) from earlier runs`);
  }

  console.log(
    `Deleted ${forms.length} booking${forms.length === 1 ? '' : 's'} and ${removed} stored object${removed === 1 ? '' : 's'}.`,
  );

  const remaining = await prisma.bookingForm.count();
  console.log(`${remaining} booking${remaining === 1 ? '' : 's'} left.`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
