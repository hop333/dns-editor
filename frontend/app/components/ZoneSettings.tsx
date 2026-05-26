import type { Zone } from "./RecordForms";

export default function ZoneSettings({
  zone,
  onChange,
  open,
  onToggle,
}: {
  zone: Zone | undefined;
  onChange: (key: keyof Zone, value: string | number) => void;
  open: boolean;
  onToggle: () => void;
}) {
  if (!zone) return null;

  return (
    <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-4 text-left sm:px-5"
      >
        <span className="font-medium text-[var(--foreground)]">Настройки зоны</span>
        <svg
          className={`h-5 w-5 text-[var(--muted)] transition ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 pb-5 pt-2 sm:px-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="text-[var(--muted)]">TTL по умолчанию (сек)</span>
              <input
                type="number"
                min={60}
                value={zone.ttl}
                onChange={(e) => onChange("ttl", Number(e.target.value) || 60)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--muted)]">Primary NS</span>
              <input
                value={zone.primaryNs}
                onChange={(e) => onChange("primaryNs", e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--muted)]">Email администратора</span>
              <input
                value={zone.adminEmail}
                onChange={(e) => onChange("adminEmail", e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
