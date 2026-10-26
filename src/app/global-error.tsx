'use client';

/**
 * The last resort: an error in the root layout itself.
 *
 * This replaces the entire document, so it has to render its own `<html>` and
 * `<body>` and cannot rely on the app's stylesheet having loaded — which is
 * why the styling here is inline rather than Tailwind classes. A boundary that
 * depends on the thing that just broke is not a boundary.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif',
          background: '#ffffff',
          color: '#111827',
        }}
      >
        <div style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            The portal could not start
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#4b5563', marginTop: '0.5rem' }}>
            Something failed before the page could load. Nothing you had saved is lost.
            If this keeps happening, tell an administrator and quote the reference below.
          </p>

          <div
            style={{
              marginTop: '1.5rem',
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                background: '#1b2a6b',
                color: '#ffffff',
                border: 0,
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/login"
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#374151',
                textDecoration: 'none',
              }}
            >
              Sign in again
            </a>
          </div>

          {error.digest ? (
            <p
              style={{
                marginTop: '1.5rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.75rem',
                color: '#9ca3af',
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
