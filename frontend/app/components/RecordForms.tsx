import { useMemo, useState } from "react";

type ZoneType = "master" | "slave";
type RecordType = "A" | "AAAA" | "CNAME" | "MX" | "NS" | "TXT" | "SRV";

export type DnsRecord = {
  id: string;
  name: string;
  type: RecordType;
  value: string;
  ttl: number;
  priority?: number;
};

export type Zone = {
  id: string;
  name: string;
  type: ZoneType;
  ttl: number;
  adminEmail: string;
  primaryNs: string;
  records: DnsRecord[];
};

export type BackendZoneRecord = Omit<DnsRecord, "id">;

export type BackendZoneData = {
  name: string;
  type: ZoneType;
  ttl: number;
  adminEmail: string;
  primaryNs: string;
  records: BackendZoneRecord[];
};

export const RECORD_TYPES: RecordType[] = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SRV"];

export function RecordTypeBadge({ type }: { type: RecordType }) {
  const c = `badge-${type.toLowerCase()} inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold`;
  return <span className={c}>{type}</span>;
}

function parseSrvValue(value: string): { weight: number; port: number; target: string } {
  const parts = value.trim().split(/\s+/);
  if (parts.length >= 3) {
    return {
      weight: parseInt(parts[0], 10) || 0,
      port: parseInt(parts[1], 10) || 0,
      target: parts.slice(2).join(" "),
    };
  }
  return { weight: 0, port: 0, target: value };
}

export function RecordEditForm({
  record,
  onSave,
  onCancel,
  isNew = false,
}: {
  record: DnsRecord;
  domainName: string;
  onSave: (r: DnsRecord) => void;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const [form, setForm] = useState<DnsRecord>({ ...record });
  const srvParts = useMemo(() => parseSrvValue(form.value), [form.value]);
  const [srvWeight, setSrvWeight] = useState(srvParts.weight);
  const [srvPort, setSrvPort] = useState(srvParts.port);
  const [srvTarget, setSrvTarget] = useState(srvParts.target);

  const handleSave = () => {
    if (form.type === "SRV") {
      onSave({ ...form, value: `${srvWeight} ${srvPort} ${srvTarget}`, priority: form.priority ?? 10 });
    } else {
      onSave(form);
    }
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:ring-2 focus:ring-[var(--primary)]";
  const labelClass = "block text-sm text-[var(--muted)]";

  return (
    <div className="border-t border-[var(--border)] bg-[var(--card)] px-4 py-4 sm:px-5">
      <p className="mb-3 text-sm font-semibold text-[var(--foreground)]">
        {isNew ? "Новая запись" : "Редактирование записи"} · <RecordTypeBadge type={form.type} />
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>
          Имя (хост)
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="@ или www"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Тип записи
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as RecordType }))}
            className={inputClass}
          >
            {RECORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          TTL (сек)
          <input
            type="number"
            min={60}
            value={form.ttl}
            onChange={(e) => setForm((f) => ({ ...f, ttl: Number(e.target.value) || 60 }))}
            className={inputClass}
          />
        </label>

        {(form.type === "A" || form.type === "AAAA") && (
          <label className={`${labelClass} sm:col-span-2`}>
            {form.type === "A" ? "IPv4-адрес" : "IPv6-адрес"}
            <input
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder={form.type === "A" ? "192.168.1.1" : "2001:db8::1"}
              className={inputClass}
            />
          </label>
        )}

        {(form.type === "CNAME" || form.type === "NS") && (
          <label className={`${labelClass} sm:col-span-2`}>
            {form.type === "CNAME" ? "Целевой хост" : "Сервер имён"}
            <input
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder={form.type === "CNAME" ? "host.example.com" : "ns1.example.com"}
              className={inputClass}
            />
          </label>
        )}

        {form.type === "MX" && (
          <>
            <label className={labelClass}>
              Приоритет
              <input
                type="number"
                min={0}
                value={form.priority ?? 10}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))}
                className={inputClass}
              />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Сервер почты
              <input
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="mail.example.com"
                className={inputClass}
              />
            </label>
          </>
        )}

        {form.type === "TXT" && (
          <label className={`${labelClass} sm:col-span-2`}>
            Текст
            <input
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder='Текст или "в кавычках"'
              className={inputClass}
            />
          </label>
        )}

        {form.type === "SRV" && (
          <>
            <label className={labelClass}>
              Приоритет
              <input
                type="number"
                min={0}
                value={form.priority ?? 10}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Вес
              <input
                type="number"
                min={0}
                value={srvWeight}
                onChange={(e) => setSrvWeight(Number(e.target.value) || 0)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Порт
              <input
                type="number"
                min={0}
                value={srvPort}
                onChange={(e) => setSrvPort(Number(e.target.value) || 0)}
                className={inputClass}
              />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Целевой хост
              <input
                value={srvTarget}
                onChange={(e) => setSrvTarget(e.target.value)}
                placeholder="host.example.com"
                className={inputClass}
              />
            </label>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleSave}
          disabled={(form.type !== "SRV" && !form.value.trim()) || (form.type === "SRV" && !srvTarget.trim())}
          className="w-full rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-50 sm:w-auto"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--muted-soft)] sm:w-auto"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
