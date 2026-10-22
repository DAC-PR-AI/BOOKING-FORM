'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createProject, type ProjectState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-dac-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-dac-navy-900 disabled:opacity-60"
    >
      {pending ? 'Adding…' : 'Add project'}
    </button>
  );
}

export function ProjectForm() {
  const [state, formAction] = useActionState<ProjectState, FormData>(createProject, {});

  return (
    <form
      action={formAction}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
            Project name <span className="text-red-600">*</span>
          </label>
          <input
            id="name"
            name="name"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          />
        </div>

        <div>
          <label
            htmlFor="externalCode"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Project code
          </label>
          <input
            id="externalCode"
            name="externalCode"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Used to match this row when the Google Sheet sync arrives.
          </p>
        </div>

        <div>
          <label
            htmlFor="location"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Location
          </label>
          <input
            id="location"
            name="location"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="mt-3 text-sm text-green-700">
          Project added.
        </p>
      ) : null}

      <div className="mt-4">
        <Submit />
      </div>
    </form>
  );
}
