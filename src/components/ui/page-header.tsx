export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <div className="mb-1.5 flex items-center gap-1.5" aria-hidden="true">
        <span className="h-1 w-6 rounded-full bg-dac-navy-700" />
        <span className="h-1 w-2.5 rounded-full bg-dac-orange-500" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      {description ? (
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
      ) : null}
    </div>
  );
}

/** Grey section band, matching the ribbons printed on the paper form. */
export function SectionRibbon({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block rounded-r-md border border-slate-300 border-l-4 border-l-dac-navy-700 bg-ribbon px-3.5 py-1 text-xs font-bold tracking-wider text-ribbon-text uppercase shadow-2xs">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/90 px-6 py-12 text-center text-sm text-slate-500 shadow-2xs">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-dac-navy-50 text-dac-navy-700">
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
        </svg>
      </div>
      <div className="mx-auto max-w-md leading-relaxed">{children}</div>
    </div>
  );
}
