import 'server-only';
import { createSign } from 'node:crypto';

/**
 * A very small Google Sheets reader.
 *
 * Deliberately not `googleapis`: that package is tens of megabytes and pulls
 * in the whole Google API surface to make two HTTP calls. What is actually
 * needed is a signed JWT exchanged for an access token, then one `values.get`
 * — about sixty lines, no dependency, and nothing extra in the function bundle
 * on a platform with a size limit.
 *
 * Read-only scope, by design. This app reads the project master list and
 * writes nothing back here; the outbound mirror (brief §8A) is a separate
 * path with its own non-sensitive column list.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export type GoogleConfig = {
  clientEmail: string;
  privateKey: string;
  sheetId: string;
  tab: string;
};

/**
 * Reads the service-account configuration, or null when it is not set up.
 *
 * Null rather than throwing: the project sync is optional until DAC supplies
 * a sheet, and an unconfigured integration should leave the admin screen
 * saying so, not take the page down.
 */
export function googleConfig(): GoogleConfig | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_PROJECTS_SHEET_ID;

  if (!clientEmail || !rawKey || !sheetId) return null;

  return {
    clientEmail,
    // Dotenv keeps `\n` as two characters, so a PEM pasted into .env on one
    // line arrives with literal backslash-n. Both forms have to work.
    privateKey: rawKey.replace(/\\n/g, '\n'),
    sheetId,
    tab: process.env.GOOGLE_PROJECTS_SHEET_TAB || 'Projects',
  };
}

export function googleUsersConfig(): GoogleConfig | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_USERS_SHEET_ID || process.env.GOOGLE_PROJECTS_SHEET_ID;

  if (!clientEmail || !rawKey || !sheetId) return null;

  return {
    clientEmail,
    privateKey: rawKey.replace(/\\n/g, '\n'),
    sheetId,
    tab: process.env.GOOGLE_USERS_SHEET_TAB || 'Users',
  };
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** A service-account assertion, signed RS256 as Google requires. */
function buildAssertion(config: GoogleConfig, now: number): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(config.privateKey).toString('base64url');

  return `${header}.${claims}.${signature}`;
}

/** Cached until shortly before expiry — one token serves many syncs. */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(config: GoogleConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildAssertion(config, now),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google refused the service account (${response.status}). ` +
        'Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY. ' +
        detail.slice(0, 300),
    );
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Google returned no access token.');

  cachedToken = {
    value: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
  };
  return cachedToken.value;
}

/**
 * Every cell of the configured tab, as rows of strings.
 *
 * `UNFORMATTED_VALUE` would hand back numbers and serial dates; the project
 * list is text and the parser trims it, so formatted values are what we want
 * — a code typed as `001` stays `001` rather than becoming `1`.
 */
export async function readProjectRows(config: GoogleConfig): Promise<string[][]> {
  const token = await accessToken(config);
  const range = encodeURIComponent(config.tab);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheetId)}` +
    `/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    // The project list is read on a schedule and cached in Postgres; never
    // serve it from an HTTP cache as well.
    cache: 'no-store',
  });

  if (response.status === 403) {
    throw new Error(
      'Google denied access to the sheet. Share it with the service account ' +
        `(${config.clientEmail}) as a Viewer.`,
    );
  }
  if (response.status === 404) {
    throw new Error(
      `No sheet with that id, or no tab called "${config.tab}". Check ` +
        'GOOGLE_PROJECTS_SHEET_ID and GOOGLE_PROJECTS_SHEET_TAB.',
    );
  }
  if (!response.ok) {
    throw new Error(`Google Sheets returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = (await response.json()) as { values?: string[][] };
  // Sheets omits trailing empty cells, so rows arrive ragged. The parser
  // handles short rows; normalising to strings here keeps it simple.
  return (body.values ?? []).map((row) => row.map((cell) => String(cell ?? '')));
}

export async function readUsersRows(config: GoogleConfig): Promise<string[][]> {
  const token = await accessToken(config);
  const range = encodeURIComponent(config.tab);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheetId)}` +
    `/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (response.status === 403) {
    throw new Error(
      'Google denied access to the sheet. Share it with the service account ' +
        `(${config.clientEmail}) as a Viewer.`,
    );
  }
  if (response.status === 404) {
    throw new Error(
      `No sheet with that id, or no tab called "${config.tab}". Check ` +
        'GOOGLE_USERS_SHEET_ID and GOOGLE_USERS_SHEET_TAB.',
    );
  }
  if (!response.ok) {
    throw new Error(`Google Sheets returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = (await response.json()) as { values?: string[][] };
  return (body.values ?? []).map((row) => row.map((cell) => String(cell ?? '')));
}

/** For the admin screen: a link to the sheet being read. */
export function sheetUrl(config: GoogleConfig): string {
  return `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`;
}
