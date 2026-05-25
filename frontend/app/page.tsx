"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "./components/Header";
import type { BindStatus } from "./components/Header";
import ZoneSettings from "./components/ZoneSettings";
import DnssecPanel from "./components/DnssecPanel";
import RecordTable from "./components/RecordTable";
import CreateZoneModal from "./components/CreateZoneModal";
import type { BackendZoneData, BackendZoneRecord, DnsRecord, Zone } from "./components/RecordForms";

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2);

function parseApiDetail(obj: Record<string, unknown>): string[] {
  const d = obj?.detail;
  if (Array.isArray(d)) return d.map((x) => String(x));
  if (typeof d === "string") return [d];
  return [];
}

function parseApiError(obj: Record<string, unknown>, fallback: string): string {
  const parts = parseApiDetail(obj);
  return parts.length > 0 ? parts.join(" ") : fallback;
}

function isEditableZoneFile(fileName: string): boolean {
  return (
    fileName.startsWith("db.") &&
    !fileName.endsWith(".bak") &&
    !fileName.endsWith(".jnl") &&
    !fileName.endsWith(".jbk") &&
    !fileName.endsWith(".signed") &&
    !fileName.endsWith(".signed.jnl") &&
    !fileName.endsWith(".signed.jbk")
  );
}

function zoneFileToName(fileName: string): string {
  return fileName.startsWith("db.") ? fileName.slice(3) : fileName;
}

const defaultRecord: DnsRecord = {
  id: "",
  name: "@",
  type: "A",
  value: "",
  ttl: 3600,
  priority: 10,
};

const initialZones: Zone[] = [
  {
    id: "initial-zone-mydomain-ru",
    name: "mydomain.ru",
    type: "master",
    ttl: 3600,
    adminEmail: "admin@mydomain.ru",
    primaryNs: "ns1.mydomain.ru",
    records: [],
  },
];

function isValidIPv4(addr: string): boolean {
  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function validateZoneData(zone: Zone): string[] {
  const errors: string[] = [];
  if (zone.ttl < 60) errors.push("TTL должен быть не меньше 60.");
  const nsCount = zone.records.filter((r) => r.type === "NS").length;
  if (nsCount < 1) errors.push("Нужна минимум одна NS-запись.");
  const byOwner = new Map<string, typeof zone.records>();
  for (const r of zone.records) {
    const key = (r.name || "").trim() || "@";
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(r);
  }
  for (const [owner, recs] of byOwner) {
    const cnames = recs.filter((r) => r.type === "CNAME");
    if (cnames.length > 1) errors.push(`Имя «${owner}»: только одна CNAME на это имя.`);
    if (cnames.length > 0 && recs.some((r) => r.type !== "CNAME")) {
      errors.push(`Имя «${owner}»: CNAME нельзя сочетать с другими записями на том же имени.`);
    }
  }
  for (const r of zone.records) {
    if (!r.name.trim()) errors.push(`Запись без имени (тип ${r.type}).`);
    if (r.ttl < 60) errors.push(`TTL записи ${r.name || r.type} должен быть не меньше 60.`);
    if (r.type === "A" && r.value.trim() && !isValidIPv4(r.value.trim())) {
      errors.push(`Некорректный IPv4 в записи ${r.name}: ${r.value}`);
    }
    if (r.type === "AAAA" && r.value.trim()) {
      try {
        const groups = r.value.trim().split(":");
        if (groups.length < 3 || groups.length > 8) throw 0;
      } catch {
        errors.push(`Некорректный IPv6 в записи ${r.name}: ${r.value}`);
      }
    }
    if (r.type !== "SRV" && !r.value.trim()) {
      errors.push(`Пустое значение у записи ${r.name} (тип ${r.type}).`);
    }
  }
  return errors;
}

export default function Home() {
  const router = useRouter();

  // --- Данные зоны в UI (обычно в состоянии ровно одна выбранная зона в zones[]) ---
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [selectedZoneId, setSelectedZoneId] = useState<string>(initialZones[0]?.id);
  const [newRecord, setNewRecord] = useState<DnsRecord>({ ...defaultRecord, id: "draft-record" });
  const [showAddForm, setShowAddForm] = useState(false);
  const [showZoneSettings, setShowZoneSettings] = useState(false);
  const [showDnssec, setShowDnssec] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [loadingZone, setLoadingZone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingZone, setSavingZone] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Базовый URL FastAPI; в Docker build на localhost:8000 — браузер на хосте обращается туда же.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const [zoneList, setZoneList] = useState<string[]>([]);
  const [selectedZoneName, setSelectedZoneName] = useState<string>("mydomain.ru");
  const [recordToDelete, setRecordToDelete] = useState<DnsRecord | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloadSuccess, setReloadSuccess] = useState(false);
  const [dnssecRefreshKey, setDnssecRefreshKey] = useState(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [bindStatus, setBindStatus] = useState<BindStatus | null>(null);
  const [showCreateZone, setShowCreateZone] = useState(false);
  const [zoneToDelete, setZoneToDelete] = useState<string | null>(null);
  const deleteZoneOverlayPointerDown = useRef(false);

  // ---- Auth helpers ----

  const getToken = useCallback(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("token");
  }, []);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [getToken]);

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem("token");
    router.replace("/login");
  }, [router]);

  const authFetch = useCallback(
    async (url: string, opts: RequestInit = {}): Promise<Response> => {
      const headers = { ...authHeaders(), ...(opts.headers as Record<string, string> ?? {}) };
      const res = await fetch(url, { ...opts, headers });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error("Unauthorized");
      }
      return res;
    },
    [authHeaders, handleUnauthorized],
  );

  // ---- Auth check on mount ----

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
    }
  }, [getToken, router]);

  // ---- Theme ----

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("theme") as "light" | "dark" | null;
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved ?? (prefersDark ? "dark" : "light");
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  // ---- BIND status polling ----

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await authFetch(`${apiUrl}/status`);
        if (!cancelled) setBindStatus(await res.json());
      } catch {
        if (!cancelled) setBindStatus({ bind_running: false, error: "Нет связи с API" });
      }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [apiUrl, authFetch, getToken]);

  // ---- Zone list ----

  const fetchZoneList = useCallback(async () => {
    try {
      const res = await authFetch(`${apiUrl}/zones`);
      if (!res.ok) return;
      const data = (await res.json()) as { zones: string[] };
      const files = (data.zones ?? []).filter(isEditableZoneFile);
      setZoneList(files);
      return files;
    } catch {
      return undefined;
    }
  }, [apiUrl, authFetch]);

  useEffect(() => {
    if (!getToken()) return;
    fetchZoneList().then((files) => {
      if (files && files.length > 0) {
        const names = files.map(zoneFileToName);
        setSelectedZoneName(names[0]);
      }
    });
  }, [fetchZoneList, getToken]);

  // ---- Load zone records ----

  const loadZoneFromBackend = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      if (!selectedZoneName || !getToken()) return false;
      setLoadingZone(true);
      setLoadError(null);
      try {
        const res = await authFetch(`${apiUrl}/zones/${selectedZoneName}/records`, { signal });
        const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(parseApiError(raw, `Не удалось загрузить зону ${selectedZoneName}`));
        }
        const data = raw as BackendZoneData;
        if (signal?.aborted) return false;
        const backendRecords = Array.isArray(data.records) ? data.records : [];
        const zone: Zone = {
          id: createId(),
          name: data.name || selectedZoneName,
          type: data.type || "master",
          ttl: data.ttl || 3600,
          adminEmail: data.adminEmail || `admin@${selectedZoneName}`,
          primaryNs: data.primaryNs || `ns1.${selectedZoneName}`,
          records: backendRecords.map((r) => ({ ...r, id: createId() })),
        };
        setZones([zone]);
        setSelectedZoneId(zone.id);
        setEditingRecordId(null);
        setShowAddForm(false);
        setRecordToDelete(null);
        return true;
      } catch (e) {
        if (signal?.aborted) return false;
        if ((e as Error).message === "Unauthorized") return false;
        setLoadError((e as Error).message || "Не удалось загрузить зону");
        return false;
      } finally {
        if (!signal?.aborted) setLoadingZone(false);
      }
    },
    [selectedZoneName, apiUrl, authFetch, getToken],
  );

  useEffect(() => {
    if (!selectedZoneName || !getToken()) return;
    const controller = new AbortController();
    loadZoneFromBackend(controller.signal);
    return () => controller.abort();
  }, [selectedZoneName, loadZoneFromBackend, getToken]);

  // ---- Save zone ----

  const saveZoneToBackend = async () => {
    if (!selectedZone || !selectedZoneName) return;
    const errors = validateZoneData(selectedZone);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setSaveError("Исправьте ошибки перед сохранением.");
      return;
    }
    setSavingZone(true);
    setSaveError(null);
    setSaveSuccess(null);
    const payload: BackendZoneData = {
      name: selectedZoneName,
      type: selectedZone.type,
      ttl: selectedZone.ttl,
      adminEmail: selectedZone.adminEmail,
      primaryNs: selectedZone.primaryNs,
      records: selectedZone.records.map<BackendZoneRecord>((record) => ({
        name: record.name,
        type: record.type,
        value: record.value,
        ttl: record.ttl,
        priority: record.priority,
      })),
    };
    try {
      const res = await authFetch(`${apiUrl}/zones/${selectedZoneName}/records`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const details = parseApiDetail(err);
        if (details.length > 0) setValidationErrors(details);
        await loadZoneFromBackend();
        throw new Error(parseApiError(err, `Ошибка ${res.status}`));
      }
      setSaveSuccess("Изменения сохранены");
      setValidationErrors([]);
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (e) {
      if ((e as Error).message === "Unauthorized") return;
      setSaveError(
        `${(e as Error).message || "Не удалось сохранить"}. Данные зоны восстановлены с сервера.`,
      );
    } finally {
      setSavingZone(false);
    }
  };

  // ---- Reload BIND ----

  const reloadBind = async () => {
    if (!selectedZoneName) return;
    setReloading(true);
    setReloadError(null);
    setReloadSuccess(false);
    try {
      const res = await authFetch(`${apiUrl}/zones/${selectedZoneName}/reload`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(parseApiError(err, `Ошибка ${res.status}`));
      }
      setReloadSuccess(true);
      setDnssecRefreshKey((k) => k + 1);
      setTimeout(() => setReloadSuccess(false), 3000);
    } catch (e) {
      if ((e as Error).message === "Unauthorized") return;
      setReloadError((e as Error).message);
    } finally {
      setReloading(false);
    }
  };

  // ---- Create zone ----

  const handleCreateZone = async (zoneName: string) => {
    setShowCreateZone(false);
    const payload: BackendZoneData = {
      name: zoneName,
      type: "master",
      ttl: 3600,
      adminEmail: `admin@${zoneName}`,
      primaryNs: `ns1.${zoneName}`,
      records: [
        { name: "@", type: "NS", value: `ns1.${zoneName}`, ttl: 3600 },
        // Glue A для NS в этой же зоне — иначе BIND 9 отклоняет зону (named-checkzone)
        { name: "ns1", type: "A", value: "192.0.2.1", ttl: 3600 },
        { name: "@", type: "A", value: "127.0.0.1", ttl: 3600 },
      ],
    };
    try {
      const res = await authFetch(`${apiUrl}/zones/${zoneName}/records`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(parseApiError(err, `Ошибка ${res.status}`));
      }
      const files = await fetchZoneList();
      if (files) {
        const names = files.map(zoneFileToName);
        if (names.includes(zoneName)) setSelectedZoneName(zoneName);
      }
    } catch (e) {
      if ((e as Error).message === "Unauthorized") return;
      setSaveError(`Не удалось создать зону: ${(e as Error).message}`);
    }
  };

  // ---- Delete zone ----

  const handleDeleteZone = async () => {
    if (!zoneToDelete) return;
    try {
      const res = await authFetch(`${apiUrl}/zones/${zoneToDelete}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(parseApiError(err, `Ошибка ${res.status}`));
      }
      setZoneToDelete(null);
      const files = await fetchZoneList();
      if (files && files.length > 0) {
        const names = files.map(zoneFileToName);
        setSelectedZoneName(names[0]);
      } else {
        setZoneList([]);
        setSelectedZoneName("");
        setZones([{ ...initialZones[0], id: createId(), records: [] }]);
      }
    } catch (e) {
      if ((e as Error).message === "Unauthorized") return;
      setSaveError(`Не удалось удалить зону: ${(e as Error).message}`);
      setZoneToDelete(null);
    }
  };

  // ---- Производное состояние: текущая зона для форм ----

  const selectedZone = useMemo(
    () => zones.find((z) => z.id === selectedZoneId) ?? zones[0],
    [zones, selectedZoneId],
  );

  const updateZoneField = (key: keyof Zone, value: string | number) => {
    if (!selectedZone) return;
    setZones((prev) => prev.map((z) => (z.id === selectedZone.id ? { ...z, [key]: value } : z)));
  };

  const updateRecord = (recordId: string, updated: DnsRecord) => {
    if (!selectedZone) return;
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== selectedZone.id) return z;
        return { ...z, records: z.records.map((r) => (r.id === recordId ? { ...updated, id: recordId } : r)) };
      }),
    );
    setEditingRecordId(null);
  };

  const addRecord = (record: DnsRecord) => {
    if (!selectedZone || (!record.value.trim() && record.type !== "SRV")) return;
    if (record.type === "SRV" && !record.value.trim()) return;
    setZones((prev) =>
      prev.map((z) =>
        z.id === selectedZone.id ? { ...z, records: [...z.records, { ...record, id: createId() }] } : z,
      ),
    );
    setNewRecord({ ...defaultRecord, id: createId() });
    setShowAddForm(false);
  };

  const deleteRecord = (recordId: string) => {
    if (!selectedZone) return;
    setZones((prev) =>
      prev.map((z) =>
        z.id === selectedZone.id ? { ...z, records: z.records.filter((r) => r.id !== recordId) } : z,
      ),
    );
    setEditingRecordId(null);
    setRecordToDelete(null);
  };

  // ---- Render ----

  if (!getToken()) return null;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Header
        selectedZoneName={selectedZoneName}
        zoneList={zoneList}
        loadingZone={loadingZone}
        reloading={reloading}
        savingZone={savingZone}
        theme={theme}
        bindStatus={bindStatus}
        onZoneChange={(name) => {
          setSelectedZoneName(name);
          setLoadError(null);
          setValidationErrors([]);
        }}
        onReloadClick={reloadBind}
        onSaveClick={saveZoneToBackend}
        onToggleTheme={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
        onCreateZone={() => setShowCreateZone(true)}
        onDeleteZone={() => setZoneToDelete(selectedZoneName)}
        onLogout={handleUnauthorized}
      />

      <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
        {loadingZone && (
          <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted)] shadow-sm">
            Загрузка записей…
          </div>
        )}
        {loadError && (
          <div className="mb-4 rounded-xl border border-[var(--warning-text)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning-text)] shadow-sm">
            {loadError}. Редактируйте и сохраните — файл зоны обновится.
          </div>
        )}
        {saveSuccess && (
          <div className="mb-4 rounded-xl border border-[var(--success)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success-text)] shadow-sm">
            {saveSuccess}
          </div>
        )}
        {saveError && (
          <div className="mb-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger-text)] shadow-sm">
            {saveError}
          </div>
        )}
        {validationErrors.length > 0 && (
          <div className="mb-4 rounded-xl border border-[var(--warning-text)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning-text)] shadow-sm">
            <p className="font-semibold">Ошибки валидации:</p>
            <ul className="mt-1 list-inside list-disc">
              {validationErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        {reloadSuccess && (
          <div className="mb-4 rounded-xl border border-[var(--success)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success-text)] shadow-sm">
            BIND перезагружен
          </div>
        )}
        {reloadError && (
          <div className="mb-4 rounded-xl border border-[var(--warning-text)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning-text)] shadow-sm">
            {reloadError}
          </div>
        )}

        <ZoneSettings
          zone={selectedZone}
          open={showZoneSettings}
          onToggle={() => setShowZoneSettings(!showZoneSettings)}
          onChange={updateZoneField}
        />

        <DnssecPanel
          zoneName={selectedZoneName}
          apiUrl={apiUrl}
          authFetch={authFetch}
          open={showDnssec}
          onToggle={() => setShowDnssec(!showDnssec)}
          refreshKey={dnssecRefreshKey}
        />

        <RecordTable
          zone={selectedZone}
          domainName={selectedZoneName}
          records={selectedZone?.records ?? []}
          showAddForm={showAddForm}
          onToggleAddForm={() => {
            setShowAddForm(!showAddForm);
            setEditingRecordId(null);
          }}
          newRecord={newRecord}
          onAddRecord={addRecord}
          editingRecordId={editingRecordId}
          onStartEdit={(id) => {
            setEditingRecordId(id);
            setShowAddForm(false);
          }}
          onCancelEdit={() => setEditingRecordId(null)}
          onUpdateRecord={updateRecord}
          recordToDelete={recordToDelete}
          onAskDelete={(record) => setRecordToDelete(record)}
          onCancelDelete={() => setRecordToDelete(null)}
          onConfirmDelete={deleteRecord}
        />

        <p className="mt-5 text-center text-xs text-[var(--muted)]">
          Изменения применяются после нажатия «Сохранить». После сохранения нажмите «Перезагрузить BIND», если rndc настроен.
        </p>
      </main>

            {showCreateZone && (
        <CreateZoneModal onClose={() => setShowCreateZone(false)} onCreate={handleCreateZone} />
      )}

            {zoneToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onPointerDown={(e) => {
            deleteZoneOverlayPointerDown.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (deleteZoneOverlayPointerDown.current && e.target === e.currentTarget) {
              setZoneToDelete(null);
            }
            deleteZoneOverlayPointerDown.current = false;
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <p className="font-medium text-[var(--foreground)]">Удалить зону?</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Зона <strong>{zoneToDelete}</strong> и файл <code>db.{zoneToDelete}</code> будут удалены.
              Бэкап сохранится в <code>.bak</code>.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setZoneToDelete(null)}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--muted-soft)]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteZone}
                className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
