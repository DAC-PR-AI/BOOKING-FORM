/**
 * Storage driver contract.
 *
 * Supporting documents are the only binary data this system holds, and they
 * are regulated personal data (PAN cards, Aadhaar cards, photographs). The
 * residency rule in the brief applies to them exactly as it applies to the
 * database: the bytes must physically sit in India.
 *
 * That rule is about *which driver is configured*, not about the call sites,
 * so the application never talks to a vendor SDK directly — it talks to this
 * interface. Two consequences we actually wanted:
 *
 *   * Development needs no cloud account and no secrets. The `local` driver
 *     writes to a directory outside the repository.
 *   * Swapping provider (or adding a second region) is one file, not a sweep
 *     through every upload and download path.
 *
 * Never add a method that returns a public or unexpiring URL. Access is via
 * short-lived signed URLs only (brief §3).
 */

/** What the browser needs in order to PUT the bytes itself. */
export type SignedUpload = {
  /** Absolute for a cloud driver, app-relative for the local driver. */
  url: string;
  /** Always PUT. Named so the client never has to guess. */
  method: 'PUT';
  /** Headers the browser must send verbatim — content type, and any auth. */
  headers: Record<string, string>;
};

export type StoredObject = {
  body: Buffer;
  contentType: string;
  sizeBytes: number;
};

export interface StorageDriver {
  /** Identifies the driver in logs and on the admin health page. */
  readonly name: 'local' | 'supabase';

  /**
   * Whether the bytes are guaranteed to sit in India. `local` reports true
   * because it is this machine; a cloud driver reports what its region says.
   * The health endpoint surfaces this so a misconfigured deploy is visible.
   */
  readonly residency: { inIndia: boolean; detail: string };

  /**
   * Mints a short-lived URL the browser uploads to directly.
   *
   * Direct upload is deliberate: it keeps multi-megabyte scans out of the
   * serverless function request body, which on Vercel is capped well below
   * our 10 MB picker limit.
   */
  createSignedUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
    /**
     * The application's own upload grant (see `upload-token.ts`).
     *
     * A cloud driver ignores it — its signed URL already authorises the write.
     * The local driver has no such mechanism, so it carries our grant instead
     * of inventing a second signing scheme. Passing it in rather than letting
     * the driver mint one keeps exactly one thing authoritative about what an
     * upload is allowed to be.
     */
    grantToken: string,
  ): Promise<SignedUpload>;

  /** Short-lived read URL. The document route redirects to this. */
  createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;

  /** Server-side read, for PDF composition and for verifying an upload landed. */
  get(key: string): Promise<StoredObject>;

  /** Size and type of a stored object, without transferring the bytes. */
  stat(key: string): Promise<{ sizeBytes: number; contentType: string } | null>;

  /** Used when a document is replaced, so orphans do not accumulate. */
  remove(key: string): Promise<void>;
}
