'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
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
 * Business Rule:
 *   - Photo, PAN card, and Aadhaar card are mandatory when creating/submitting
 *     the form. Once submitted, existing mandatory KYC documents are locked
 *     unless the form is returned for changes.
 *   - All other supporting documents (1st payment screenshot, Simple cost sheet,
 *     Mail, Discount cost sheet) can be uploaded or updated at ANY time.
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

function isMandatoryType(requirement: {
  isMandatory: boolean;
  requiredIfSecondApplicant: boolean;
} | null): boolean {
  if (!requirement) return false;
  return requirement.isMandatory || requirement.requiredIfSecondApplicant;
}

const requestUploadSchema = z.object({
  bookingFormId: z.string().uuid('Form not found.'),
  documentTypeId: z.string().uuid('Unknown document type.'),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive('That file is empty.').max(50 * 1024 * 1024),
});

const confirmUploadSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  originalName: z.string().trim().max(255),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

const documentIdSchema = z.string().uuid();

export async function requestDocumentUpload(rawInput: {
  bookingFormId: string;
  documentTypeId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<RequestUploadResult> {
  const user = await requireUser();

  const parsedInput = requestUploadSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: parsedInput.error.issues[0]?.message ?? 'Invalid upload request.',
    };
  }
  const input = parsedInput.data;

  const access = await authoriseFormAccess(user, input.bookingFormId);
  if (!access) return { ok: false, error: 'Form not found.' };
  if (!access.canUploadAnytime) {
    return {
      ok: false,
      error: 'This booking has been cancelled, so documents can no longer be changed.',
    };
  }

  const documentType = await prisma.documentType.findFirst({
    where: {
      id: input.documentTypeId,
      organizationId: user.organizationId,
      isActive: true,
    },
    include: { requirement: true },
  });
  if (!documentType) return { ok: false, error: 'Unknown document type.' };

  // Mandatory KYC documents (Photo, PAN, Aadhaar) that are already attached
  // cannot be replaced after submission unless the form is in DRAFT or RETURNED.
  // Non-mandatory documents can be uploaded or updated at any time.
  if (isMandatoryType(documentType.requirement) && !access.editable) {
    const existingCount = await prisma.formDocument.count({
      where: {
        bookingFormId: access.bookingFormId,
        documentTypeId: documentType.id,
      },
    });
    if (existingCount > 0) {
      return {
        ok: false,
        error:
          'Mandatory identity documents (Photo, PAN, Aadhaar) are locked once submitted unless the form is returned for changes. Other supporting documents can still be uploaded anytime.',
      };
    }
  }

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

export async function confirmDocumentUpload(rawInput: {
  token: string;
  originalName: string;
  /** Hex SHA-256 computed in the browser, for integrity. Optional. */
  sha256?: string;
}): Promise<ConfirmUploadResult> {
  const user = await requireUser();

  const parsedInput = confirmUploadSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return { ok: false, error: 'That upload could not be verified. Please try again.' };
  }
  const input = parsedInput.data;

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

  const access = await authoriseFormAccess(user, grant.bookingFormId);
  if (!access) return { ok: false, error: 'Form not found.' };
  if (!access.canUploadAnytime) {
    return {
      ok: false,
      error: 'This booking has been cancelled, so the file was not attached.',
    };
  }

  const documentType = await prisma.documentType.findUnique({
    where: { id: grant.documentTypeId },
    include: { requirement: true },
  });

  const previous = await prisma.formDocument.findMany({
    where: { bookingFormId: grant.bookingFormId, documentTypeId: grant.documentTypeId },
    select: { id: true, storageKey: true },
  });

  if (
    documentType &&
    isMandatoryType(documentType.requirement) &&
    !access.editable &&
    previous.length > 0
  ) {
    return {
      ok: false,
      error:
        'Mandatory identity documents (Photo, PAN, Aadhaar) are locked once submitted unless the form is returned for changes.',
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
  revalidatePath(`/forms/${grant.bookingFormId}`);
  revalidatePath('/forms');

  return { ok: true, documentId: created.id };
}

export async function removeDocument(documentId: string): Promise<RemoveResult> {
  const user = await requireUser();

  const parsedId = documentIdSchema.safeParse(documentId);
  if (!parsedId.success) return { ok: false, error: 'Document not found.' };

  const document = await prisma.formDocument.findFirst({
    where: { id: documentId },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      bookingFormId: true,
      documentType: { select: { label: true, requirement: true } },
    },
  });
  if (!document) return { ok: false, error: 'Document not found.' };

  const access = await authoriseFormAccess(user, document.bookingFormId);
  if (!access) return { ok: false, error: 'Document not found.' };
  if (!access.canUploadAnytime) {
    return { ok: false, error: 'This booking has been cancelled, so its documents are locked.' };
  }

  if (isMandatoryType(document.documentType.requirement) && !access.editable) {
    return {
      ok: false,
      error:
        'Mandatory identity documents (Photo, PAN, Aadhaar) cannot be removed once the booking is submitted.',
    };
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
  revalidatePath(`/forms/${document.bookingFormId}`);
  revalidatePath('/forms');

  return { ok: true };
}
