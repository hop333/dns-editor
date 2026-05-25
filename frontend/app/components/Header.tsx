import Image from "next/image";

export type BindStatus = {
  bind_running: boolean;
  version?: string;
  uptime?: string;
  zones_count?: number;
  error?: string;
};

export default function Header({
  selectedZoneName,
  zoneList,
  loadingZone,
  reloading,
  savingZone,
  theme,
  bindStatus,
  onZoneChange,
  onReloadClick,
  onSaveClick,
  onToggleTheme,
  onCreateZone,
  onDeleteZone,
  onLogout,
}: {
  selectedZoneName: string;
  zoneList: string[];
  loadingZone: boolean;
  reloading: boolean;
  savingZone: boolean;
  theme: "light" | "dark";
  bindStatus: BindStatus | null;
  onZoneChange: (name: string) => void;
  onReloadClick: () => void;
  onSaveClick: () => void;
  onToggleTheme: () => void;
  onCreateZone: () => void;
  onDeleteZone: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_92%,transparent)]/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="DNS Editor"
            width={40}
            height={40}
            className="h-10 w-10 rounded-xl bg-white object-cover shadow-sm"
          />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--foreground)]">DNS&#x2011;редактор</h1>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span>Управление DNS&#x2011;записями</span>
              {bindStatus && (
                <span className="inline-flex items-center gap-1" title={bindStatus.bind_running ? (bindStatus.version || "BIND работает") : (bindStatus.error || "BIND недоступен")}>
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      bindStatus.bind_running ? "bg-[var(--status-ok)]" : "bg-[var(--status-bad)]"
                    }`}
                  />
                  <span className={bindStatus.bind_running ? "text-[var(--status-ok)]" : "text-[var(--status-bad)]"}>
                    {bindStatus.bind_running ? "BIND" : "BIND offline"}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex items-center gap-1 sm:w-auto">
            <span className="text-sm text-[var(--muted)]">Зона:</span>
            <select
              value={selectedZoneName}
              onChange={(e) => onZoneChange(e.target.value)}
              disabled={loadingZone}
              className="w-full min-w-[0] rounded-lg border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] sm:w-auto sm:min-w-[190px]"
            >
              {zoneList.map((f) => {
                const name = f.startsWith("db.") ? f.slice(3) : f;
                return (
                  <option key={f} value={name}>
                    {name}
                  </option>
                );
              })}
              {zoneList.length === 0 && <option value={selectedZoneName}>{selectedZoneName}</option>}
            </select>
            <button
              type="button"
              onClick={onCreateZone}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--card)] text-[var(--muted)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--muted-soft)]"
              title="Создать зону"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDeleteZone}
              disabled={zoneList.length === 0}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--card)] text-[var(--muted)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--danger-bg)] hover:text-[var(--danger-text)] disabled:opacity-40"
              title="Удалить зону"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={onToggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--card)] text-[var(--muted)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--muted-soft)]"
              title={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"}
            >
              {theme === "light" ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M8.05 17.95l-1.414 1.414m0-12.728L8.05 8.05m9.9 9.9-1.414-1.414M12 8a4 4 0 100 8 4 4 0 000-8z"
                  />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
                  />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--card)] text-[var(--muted)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--muted-soft)]"
              title="Выйти"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={onReloadClick}
              disabled={reloading || loadingZone}
              className="hidden rounded-lg border border-[var(--border-strong)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--muted-soft)] disabled:opacity-60 min-[420px]:inline-flex"
            >
              {reloading ? "Перезагрузка…" : "Перезагрузить BIND"}
            </button>
            <button
              type="button"
              onClick={onSaveClick}
              disabled={savingZone || loadingZone}
              className="flex-1 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            >
              {savingZone ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
