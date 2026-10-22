export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h1>
      {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
    </div>
  );
}

/** Grey section band, matching the ribbons printed on the paper form. */
export function SectionRibbon({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block border border-gray-400 bg-ribbon px-3 py-1 text-xs font-semibold tracking-wide text-ribbon-text uppercase">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}
