"use client";

import { useMemo, useRef, useState } from "react";
import { DnsRecord, RECORD_TYPES, RecordEditForm, RecordTypeBadge, Zone } from "./RecordForms";

type RecordTypeFilter = "ALL" | DnsRecord["type"];

export default function RecordTable({
  zone,
  domainName,
  records,
  showAddForm,
  onToggleAddForm,
  newRecord,
  onAddRecord,
  editingRecordId,
  onStartEdit,
  onCancelEdit,
  onUpdateRecord,
  recordToDelete,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  zone: Zone | undefined;
  domainName: string;
  records: DnsRecord[];
  showAddForm: boolean;
  onToggleAddForm: () => void;
  newRecord: DnsRecord;
  onAddRecord: (record: DnsRecord) => void;
  editingRecordId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onUpdateRecord: (id: string, record: DnsRecord) => void;
  recordToDelete: DnsRecord | null;
  onAskDelete: (record: DnsRecord) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecordTypeFilter>("ALL");
  const addOverlayPointerDown = useRef(false);
  const deleteOverlayPointerDown = useRef(false);

  const filtered = useMemo(() => {
    let result = records;
    if (typeFilter !== "ALL") {
      result = result.filter((r) => r.type === typeFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((r) => {
        const fullName = r.name === "@" ? (zone?.name ?? "") : `${r.name}.${zone?.name ?? ""}`;
        return (
          fullName.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.value.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [records, typeFilter, search, zone?.name]);

  const typeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of records) {
      map[r.type] = (map[r.type] || 0) + 1;
    }
    return map;
  }, [records]);

  const hasFilters = search.trim() !== "" || typeFilter !== "ALL";

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">DNS&#x2011;записи</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {hasFilters ? `${filtered.length} из ${records.length}` : records.length} записей
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleAddForm}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--primary-hover)] sm:w-auto sm:justify-start"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Добавить запись
        </button>
      </div>

            {records.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени или значению…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-9 pr-8 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter("ALL")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                typeFilter === "ALL"
                  ? "bg-[var(--primary)] text-white shadow-sm"
                  : "bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Все
            </button>
            {RECORD_TYPES.map((t) => {
              const count = typeCounts[t] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(typeFilter === t ? "ALL" : t)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    typeFilter === t
                      ? "bg-[var(--primary)] text-white shadow-sm"
                      : "bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t}
                  <span className="ml-1 opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

            {showAddForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onPointerDown={(e) => {
            addOverlayPointerDown.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (addOverlayPointerDown.current && e.target === e.currentTarget) {
              onToggleAddForm();
            }
            addOverlayPointerDown.current = false;
          }}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <p className="text-base font-semibold text-[var(--foreground)]">Новая DNS&#x2011;запись</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{domainName}</p>
              </div>
              <button
                type="button"
                onClick={onToggleAddForm}
                className="rounded p-2 text-[var(--muted)] hover:bg-[var(--muted-soft)]"
                title="Закрыть"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <RecordEditForm
                record={newRecord}
                domainName={domainName}
                isNew
                onSave={(r) => {
                  onAddRecord(r);
                  onToggleAddForm();
                }}
                onCancel={onToggleAddForm}
              />
            </div>
          </div>
        </div>
      )}

            <div className="overflow-x-auto">
        {records.length === 0 && !showAddForm ? (
          <div className="px-5 py-12 text-center text-[var(--muted)]">
            <p className="mb-2">Записей пока нет</p>
            <button
              type="button"
              onClick={onToggleAddForm}
              className="text-sm font-medium text-[var(--primary)] hover:underline"
            >
              Добавить первую запись
            </button>
          </div>
        ) : filtered.length === 0 && hasFilters ? (
          <div className="px-5 py-10 text-center text-[var(--muted)]">
            <p className="mb-1">Ничего не найдено</p>
            <button
              type="button"
              onClick={() => { setSearch(""); setTypeFilter("ALL"); }}
              className="text-sm font-medium text-[var(--primary)] hover:underline"
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((record) => (
              <div key={record.id}>
                <div className="flex flex-wrap items-center gap-4 px-5 py-3 transition hover:bg-[var(--muted-soft)]/60 sm:flex-nowrap">
                  <div className="w-16 shrink-0">
                    <RecordTypeBadge type={record.type} />
                  </div>
                  <div className="min-w-0 flex-1 font-mono text-sm text-[var(--foreground)]">
                    {record.name === "@" ? zone?.name : `${record.name}.${zone?.name}`}
                  </div>
                  <div className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--muted)]">
                    {record.type === "MX" && record.priority != null && `${record.priority} `}
                    {record.value}
                  </div>
                  <div className="w-14 shrink-0 text-right text-sm text-[var(--muted)]">{record.ttl}</div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => onStartEdit(record.id)}
                      className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--muted-soft)] hover:text-[var(--primary)]"
                      title="Редактировать"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAskDelete(record)}
                      className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger-text)]"
                      title="Удалить"
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
                </div>
                {editingRecordId === record.id && (
                  <RecordEditForm
                    record={record}
                    domainName={domainName}
                    onSave={(updated) => onUpdateRecord(record.id, updated)}
                    onCancel={onCancelEdit}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

            {recordToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onPointerDown={(e) => {
            deleteOverlayPointerDown.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (deleteOverlayPointerDown.current && e.target === e.currentTarget) {
              onCancelDelete();
            }
            deleteOverlayPointerDown.current = false;
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl"
          >
            <p className="font-medium text-[var(--foreground)]">Удалить запись?</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {recordToDelete.type}{" "}
              {recordToDelete.name === "@" ? zone?.name : `${recordToDelete.name}.${zone?.name}`} →{" "}
              {recordToDelete.value}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancelDelete}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--muted-soft)]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => onConfirmDelete(recordToDelete.id)}
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
