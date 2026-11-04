'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createUserAndMapRole, type UserActionState } from './actions';

type RoleOption = {
  id: string;
  name: string;
  label: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-dac-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-dac-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Mapping user…' : 'Add & Map to Role'}
    </button>
  );
}

export function UserRoleForm({
  roles,
  domain,
}: {
  roles: RoleOption[];
  domain: string;
}) {
  const [state, formAction] = useActionState<UserActionState, FormData>(
    createUserAndMapRole,
    {},
  );

  return (
    <form
      action={formAction}
      className="mb-8 rounded-lg border border-gray-200 bg-white p-5 shadow-xs"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Map Staff Member to Role Master
          </h2>
          <p className="text-xs text-gray-600">
            Multiple people can be mapped to the same role (e.g. multiple Sales Executives, AGMs, or Directors). Only{' '}
            <code className="font-mono font-semibold text-gray-800">@{domain}</code> emails are accepted.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Full Name *
          </label>
          <input
            name="name"
            type="text"
            required
            placeholder="e.g. Ragil Immanuvel"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Google Workspace Email *
          </label>
          <input
            name="email"
            type="email"
            required
            placeholder={`name@${domain}`}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Role (Role Master) *
          </label>
          <select
            name="roleId"
            required
            defaultValue={roles.find((r) => r.name === 'SALES_EXECUTIVE')?.id ?? roles[0]?.id}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.name})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Phone (optional)
          </label>
          <input
            name="phone"
            type="tel"
            placeholder="9876543210"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Fallback Password (optional)
          </label>
          <input
            name="password"
            type="password"
            placeholder="Optional (uses Google OAuth)"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-dac-navy-500 focus:outline-none focus:ring-1 focus:ring-dac-navy-500"
          />
        </div>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      {state.ok && state.message ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700"
        >
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

