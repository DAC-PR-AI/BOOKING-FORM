'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-gradient-to-r from-dac-navy-800 to-dac-navy-700 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-dac-navy-900/15 transition hover:from-dac-navy-900 hover:to-dac-navy-800 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-dac-orange-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Signing in…' : 'Sign in to Portal'}
    </button>
  );
}

export function LoginForm({
  next,
  domain = 'dacdevelopers.com',
}: {
  next?: string | undefined;
  domain?: string;
}) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-700 uppercase">
          Work Email (@{domain})
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder={`name@${domain}`}
          autoComplete="username"
          required
          className="w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs transition placeholder:text-slate-400 focus:border-dac-navy-600 focus:bg-white focus:outline-none focus:ring-3 focus:ring-dac-navy-500/15"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-700 uppercase">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••••••"
          autoComplete="current-password"
          required
          className="w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs transition placeholder:text-slate-400 focus:border-dac-navy-600 focus:bg-white focus:outline-none focus:ring-3 focus:ring-dac-navy-500/15"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
