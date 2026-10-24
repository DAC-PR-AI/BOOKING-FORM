'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit/log';
import { storage } from '@/lib/storage';
import { buildDocumentKey } from '@/lib/storage/keys';
import {
  createUploadToken,
  verifyUploadToken,
  UPLOAD_GRANT_TTL_SECONDS,
} from '@/lib/storage/upload-token';
import { authoriseFormAccess } from '@/lib/documents/access';

/**
 * Uploading a supporting document, in two steps.
 *
 *   1. `requestDocumentUpload` — the server decides whether this user may
 *      attach this type of file to this booking, how big it may be and where
 *      it will live, then hands back a signed grant and a URL.
 *   2. The browser PUTs the bytes to that URL.
 *   3. `confirmDocumentUpload` — the server checks the object really landed,
 *      at a plausible size, and records the row.
 *
 * The row is created in step 3, not step 1, so a failed or abandoned upload
 * leaves no document that appears attached but cannot be opened. The reverse
 * order would be worse than useless: a checklist that claims a PAN card is on
 * file when it is not.
 *
 * Nothing here trusts the browser about the key, the content type or the size
 * ceiling — all three are inside the signed grant.
 */

export type UploadTicket = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  /** Returned to the client and handed straight back on confirm. */
  token: string;
};

export type RequestUploadResult =
  | { ok: true; ticket: UploadTicket }
  | { ok: false; error: string };

export type ConfirmUploadResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string };

export type RemoveResult = { ok: true } | { ok: false; error: string };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is not set.');
  return value;
}

export async function requestDocumentUpload(input: {
  bookingFormId: string;
  documentTypeId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<RequestUploadResult> {
  const user = await requireUser();

  const access = await authoriseFormAccess(user, input.bookingFormId);
  if (!access) return { ok: false, error: 'Form not found.' };
  if (!access.editable) {
    return {
      ok: false,
      error: 'This form has been submitted, so its documents can no longer be changed.',
    };
  }

  const documentType = await prisma.documentType.findFirst({
    where: {
      id: input.documentTypeId,
      organizationId: user.organizationId,
      isActive: true,
    },
  });
  if (!documentType) return { ok: false, error: 'Unknown document type.' };

  const contentType = input.contentType.toLowerCase();
  if (!documentType.acceptedMimeTypes.includes(contentType)) {
    return {
      ok: false,
      error: `${documentType.label} does not accept ${contentType || 'that file type'}.`,
    };
  }

  if (input.sizeBytes <= 0) return { ok: false, error: 'That file is empty.' };
  if (input.sizeBytes > documentType.maxBytes) {
    const mb = Math.floor(documentType.maxBytes / (1024 * 1024));
    return { ok: false, error: `That file is larger than the ${mb} MB limit.` };
  }

  // APPLICANT-scoped documents belong to a specific applicant row, so the
  // PDF and the audit trail can say whose card it is.
  let applicantId: string | null = null;
  if (documentType.scope === 'APPLICANT') {
    if (!documentType.appliesTo) {
      return { ok: false, error: 'This document type is misconfigured.' };
    }
    const applicant = await prisma.applicant.findUnique({
      where: {
        bookingFormId_applicantType: {
          bookingFormId: access.bookingFormId,
          applicantType: documentType.appliesTo,
        },
      },
      select: { id: true },
    });
    if (!applicant) {
      return {
        ok: false,
        error:
          documentType.appliesTo === 'SECONDARY'
            ? 'Add the second applicant on the form before uploading their documents.'
            : 'The applicant could not be found on this form.',
      };
    }
    applicantId = applicant.id;
  }

  const storageKey = buildDocumentKey({
    bookingFormId: access.bookingFormId,
    documentTypeKey: documentType.key,
    mimeType: contentType,
    unique: randomUUID(),
  });

  const token = createUploadToken(
    {
      userId: user.id,
      bookingFormId: access.bookingFormId,
      documentTypeId: documentType.id,
      applicantId,
      storageKey,
      contentType,
      maxBytes: documentType.maxBytes,
      expiresAt: Math.floor(Date.now() / 1000) + UPLOAD_GRANT_TTL_SECONDS,
    },
    secret(),
  );

  const signed = await storage().createSignedUpload(
    storageKey,
    contentType,
    UPLOAD_GRANT_TTL_SECONDS,
    token,
  );

  return {
    ok: true,
    ticket: { url: signed.url, method: signed.method, headers: signed.headers, token },
  };
}

export async function confirmDocumentUpload(input: {
  token: string;
  originalName: string;
  /** Hex SHA-256 computed in the browser, for integrity. Optional. */
  sha256?: string;
}): Promise<ConfirmUploadResult> {
  const user = await requireUser();

  const verified = verifyUploadToken(input.token, secret());
  if (!verified.ok) {
    return {
      ok: false,
      error:
        verified.reason === 'expired'
          ? 'That upload took too long. Please pick the file again.'
          : 'That upload could not be verified. Please try again.',
    };
  }
  const grant = verified.grant;

  if (grant.userId !== user.id) {
    return { ok: false, error: 'That upload could not be verified. Please try again.' };
  }

  // Re-check access: the form may have been submitted while the file uploaded.
  const access = await authoriseFormAccess(user, grant.bookingFormId);
  if (!access) return { ok: false, error: 'Form not found.' };
  if (!access.editable) {
    return {
      ok: false,
      error: 'This form was submitted while the file was uploading, so it was not attached.',
    };
  }

  const driver = storage();

  // Proof the bytes actually arrived. Without this the row would be a promise
  // rather than a fact, and the first person to find out would be whoever
  // opens the PDF.
  const stored = await driver.stat(grant.storageKey);
  if (!stored) {
    return { ok: false, error: 'The upload did not complete. Please try again.' };
  }
  if (stored.sizeBytes <= 0 || stored.sizeBytes > grant.maxBytes) {
    await driver.remove(grant.storageKey).catch(() => undefined);
    return { ok: false, error: 'The uploaded file was not the expected size.' };
  }

  // Replacing a document: supersede the previous row, then delete its object.
  const previous = await prisma.formDocument.findMany({
    where: { bookingFormId: grant.bookingFormId, documentTypeId: grant.documentTypeId },
    select: { id: true, storageKey: true },
  });

  const name = input.originalName.trim().slice(0, 255) || 'document';

  const created = await prisma.$transaction(async (tx) => {
    if (previous.length > 0) {
      await tx.formDocument.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });
    }

    return tx.formDocument.create({
      data: {
        bookingFormId: grant.bookingFormId,
        documentTypeId: grant.documentTypeId,
        applicantId: grant.applicantId,
        storageKey: grant.storageKey,
        originalName: name,
        mimeType: grant.contentType,
        sizeBytes: stored.sizeBytes,
        sha256: input.sha256 && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null,
        uploadedById: user.id,
      },
      select: { id: true },
    });
  });

  // Only once the row is safely committed. An orphaned object is recoverable;
  // a row pointing at bytes we just deleted is not.
  for (const old of previous) {
    await driver.remove(old.storageKey).catch((error: unknown) => {
      console.error('[documents] could not delete a superseded object', {
        storageKey: old.storageKey,
        error,
      });
    });
  }

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    bookingFormId: grant.bookingFormId,
    action: 'UPLOAD',
    detail:
      previous.length > 0
        ? `Replaced a supporting document (${name}, ${stored.sizeBytes} bytes).`
        : `Uploaded a supporting document (${name}, ${stored.sizeBytes} bytes).`,
  });

  revalidatePath(`/forms/${grant.bookingFormId}/documents`);
  revalidatePath('/forms');

  return { ok: true, documentId: created.id };
}

export async function removeDocument(documentId: string): Promise<RemoveResult> {
  const user = await requireUser();

  const document = await prisma.formDocument.findFirst({
    where: { id: documentId },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      bookingFormId: true,
      documentType: { select: { label: true } },
    },
  });
  if (!document) return { ok: false, error: 'Document not found.' };

  const access = await authoriseFormAccess(user, document.bookingFormId);
  if (!access) return { ok: false, error: 'Document not found.' };
  if (!access.editable) {
    return { ok: false, error: 'This form has been submitted, so its documents are locked.' };
  }

  await prisma.formDocument.delete({ where: { id: document.id } });

  await storage()
    .remove(document.storageKey)
    .catch((error: unknown) => {
      console.error('[documents] could not delete a removed object', {
        storageKey: document.storageKey,
        error,
      });
    });

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    bookingFormId: document.bookingFormId,
    action: 'EDIT',
    detail: `Removed supporting document "${document.documentType.label}" (${document.originalName}).`,
  });

  revalidatePath(`/forms/${document.bookingFormId}/documents`);
  revalidatePath('/forms');

  return { ok: true };
}
