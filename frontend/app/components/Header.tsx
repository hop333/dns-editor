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
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_94%,transparent)]/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/logo.png"
            alt="DNS Editor"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-xl bg-white object-cover shadow-sm"
          />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-[var(--foreground)] sm:text-lg">
              DNS&#x2011;редактор
            </h1>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
              <span className="truncate">Управление DNS&#x2011;записями</span>
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
        <div className="grid gap-2 lg:flex lg:items-center lg:gap-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1">
            <span className="text-sm text-[var(--muted)]">Зона</span>
            <select
              value={selectedZoneName}
              onChange={(e) => onZoneChange(e.target.value)}
              disabled={loadingZone}
              className="min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] lg:min-w-[190px]"
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
          <div className="grid grid-cols-[auto_auto_1fr_1fr] items-center gap-2 min-[520px]:grid-cols-[auto_auto_auto_1fr] sm:flex sm:w-full sm:justify-end lg:w-auto">
            <button
              type="button"
              onClick={onToggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--card)] text-[var(--muted)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--muted-soft)]"
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
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--card)] text-[var(--muted)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--muted-soft)]"
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
              className="inline-flex min-w-0 justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--muted-soft)] disabled:opacity-60 sm:px-4"
            >
              <span className="truncate">{reloading ? "Перезагрузка…" : "Reload BIND"}</span>
            </button>
            <button
              type="button"
              onClick={onSaveClick}
              disabled={savingZone || loadingZone}
              className="min-w-0 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
            >
              <span className="truncate">{savingZone ? "Сохранение…" : "Сохранить"}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
