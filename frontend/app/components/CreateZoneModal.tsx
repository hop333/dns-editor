"use client";

import { FormEvent, useRef, useState } from "react";

export default function CreateZoneModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (zoneName: string) => void;
}) {
  const [name, setName] = useState("");
  const overlayPointerDown = useRef(false);
  const domainRe = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  const valid = domainRe.test(name.trim());

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onCreate(name.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        overlayPointerDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (overlayPointerDown.current && e.target === e.currentTarget) {
          onClose();
        }
        overlayPointerDown.current = false;
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Новая зона</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-[var(--muted)] hover:bg-[var(--muted-soft)]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm text-[var(--muted)]">
            Доменное имя
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="example.com"
              autoFocus
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </label>

          {name.trim() && !valid && (
            <p className="text-xs text-[var(--danger-text)]">Введите корректное доменное имя, например example.com</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--muted)]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!valid}
              className="rounded bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
