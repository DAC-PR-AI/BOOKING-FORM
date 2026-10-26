/**
 * A no-op stand-in for the `server-only` package, used by the scripts.
 *
 * `server-only` is a guard, not behaviour: its real package exports a module
 * that throws unless Node resolves under the `react-server` condition, which
 * is how a mistaken import into a client bundle becomes a build error.
 *
 * The verification scripts are plain Node, and they cannot use that condition,
 * because `@react-pdf/renderer` needs the ordinary React build — under
 * `react-server` it resolves to the RSC build and dies inside the renderer
 * with an unhelpful `Cannot read properties of undefined`. So the scripts map
 * `server-only` here instead, via `scripts/tsconfig.json`.
 *
 * This only ever applies to `scripts/`. The application's own tsconfig is
 * untouched, so the guard still does its job everywhere it matters.
 */
export {};
