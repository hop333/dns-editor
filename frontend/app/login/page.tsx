"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) router.replace("/");
  }, [router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = new URLSearchParams({ username, password });
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const detail = Array.isArray(errData.detail) ? errData.detail.join(" ") : errData.detail;
        throw new Error(detail || `Ошибка ${res.status}`);
      }
      const data = await res.json();
      if (!data.access_token) throw new Error("Сервер не вернул токен");
      localStorage.setItem("token", data.access_token);
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="relative mx-auto mb-4 h-[68px] w-44 overflow-hidden rounded-xl bg-white shadow-sm">
            <Image
              src="/logo.png"
              alt="DNS Editor"
              fill
              sizes="176px"
              className="object-cover"
              priority
            />
          </div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">
            Вход в DNS Editor
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Введите логин и пароль администратора
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger-text)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm text-[var(--muted)]">
            Логин
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </label>

          <label className="block text-sm text-[var(--muted)]">
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </label>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
