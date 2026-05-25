import { useCallback, useEffect, useState } from "react";

export type DnssecStatus = {
  enabled: boolean;
  ds_records: string[];
  dnskey_present?: boolean;
  message?: string | null;
};

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("copy command failed");
  } finally {
    document.body.removeChild(textarea);
  }
}

type Props = {
  zoneName: string;
  apiUrl: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  open: boolean;
  onToggle: () => void;
    refreshKey?: number;
};

function parseApiError(obj: Record<string, unknown>, fallback: string): string {
  const d = obj?.detail;
  if (Array.isArray(d)) return d.join(" ");
  if (typeof d === "string") return d;
  return fallback;
}

export default function DnssecPanel({
  zoneName,
  apiUrl,
  authFetch,
  open,
  onToggle,
  refreshKey = 0,
}: Props) {
  const [status, setStatus] = useState<DnssecStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!zoneName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${apiUrl}/zones/${encodeURIComponent(zoneName)}/dnssec`);
      const data = (await res.json()) as DnssecStatus;
      setStatus(data);
    } catch (e) {
      if (e instanceof Error && e.message === "Unauthorized") return;
      setError("Не удалось загрузить статус DNSSEC");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, authFetch, zoneName]);

  useEffect(() => {
    if (open && zoneName) loadStatus();
  }, [open, zoneName, loadStatus, refreshKey]);

  const handleEnable = async () => {
    setActing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await authFetch(
        `${apiUrl}/zones/${encodeURIComponent(zoneName)}/dnssec/enable`,
        { method: "POST" },
      );
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(parseApiError(data, "Не удалось включить DNSSEC"));
      setStatus({
        enabled: true,
        ds_records: (data.ds_records as string[]) ?? [],
        dnskey_present: ((data.ds_records as string[]) ?? []).length > 0,
        message: (data.message as string) ?? null,
      });
      setInfo((data.message as string) || "DNSSEC включён");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка включения DNSSEC");
    } finally {
      setActing(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm(`Отключить DNSSEC для зоны ${zoneName}?`)) return;
    setActing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await authFetch(
        `${apiUrl}/zones/${encodeURIComponent(zoneName)}/dnssec/disable`,
        { method: "POST" },
      );
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(parseApiError(data, "Не удалось отключить DNSSEC"));
      setStatus({ enabled: false, ds_records: [], message: (data.message as string) ?? null });
      setInfo((data.message as string) || "DNSSEC отключён");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отключения DNSSEC");
    } finally {
      setActing(false);
    }
  };

  const copyDs = async () => {
    const text = status?.ds_records?.join("\n") ?? "";
    if (!text) return;
    try {
      await copyTextToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать в буфер обмена");
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">
          DNSSEC
          {status?.enabled && (
            <span className="rounded-full bg-[var(--success-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--success-text)]">
              вкл
            </span>
          )}
        </span>
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
        <div className="border-t border-[var(--border)] px-5 pb-5 pt-2 text-sm">
          {loading && <p className="text-[var(--muted)]">Загрузка…</p>}
          {error && (
            <p className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-[var(--danger-text)]">
              {error}
            </p>
          )}
          {info && (
            <p className="mb-3 rounded-lg border border-[var(--success)] bg-[var(--success-bg)] px-3 py-2 text-[var(--success-text)]">
              {info}
            </p>
          )}
          {!loading && status && (
            <>
              <p className="mb-3 text-[var(--muted)]">
                {status.enabled
                  ? "Зона подписывается BIND (inline-signing). Редактор по-прежнему меняет неподписанный файл зоны."
                  : "Подпись DNSSEC отключена. Включите для защиты от подмены ответов DNS."}
              </p>
              {status.message && (
                <p className="mb-3 rounded-lg bg-[var(--muted-soft)] px-3 py-2 text-[var(--foreground)]">
                  {status.message}
                </p>
              )}
              {status.enabled && status.ds_records.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1 font-medium text-[var(--foreground)]">
                    DS-записи (добавьте у регистратора домена):
                  </p>
                  <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--muted-soft)] p-3 text-xs">
                    {status.ds_records.join("\n")}
                  </pre>
                  <button
                    type="button"
                    onClick={copyDs}
                    className="mt-2 rounded-lg border border-[var(--border-strong)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--muted-soft)]"
                  >
                    {copied ? "Скопировано" : "Копировать DS"}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!status.enabled ? (
                  <button
                    type="button"
                    onClick={handleEnable}
                    disabled={acting}
                    className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--primary-hover)] disabled:opacity-50"
                  >
                    {acting ? "Включение…" : "Включить DNSSEC"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleDisable}
                    disabled={acting}
                    className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-2 text-sm font-medium text-[var(--danger-text)] transition hover:opacity-90 disabled:opacity-50"
                  >
                    {acting ? "Отключение…" : "Отключить DNSSEC"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={loadStatus}
                  disabled={loading || acting}
                  className="rounded-lg border border-[var(--border-strong)] bg-[var(--card)] px-4 py-2 text-sm font-medium transition hover:bg-[var(--muted-soft)] disabled:opacity-50"
                >
                  Обновить
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
