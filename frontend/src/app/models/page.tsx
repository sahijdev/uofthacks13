"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";

type Build = { id: number; title: string; prompt: string; created_at: string };

export default function ModelsHistoryPage() {
  const { isAuthenticated, initializing, token, user, logout } = useAuth();
  const router = useRouter();
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!initializing && !isAuthenticated) router.replace("/");
  }, [initializing, isAuthenticated, router]);

  useEffect(() => {
    if (!token) return;
    async function loadBuilds() {
      setError("");
      setLoading(true);
      try {
        const res = await fetch("/api/builds", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.message || "Unable to load builds.");
        }
        const data = await res.json();
        setBuilds(data.builds || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load builds.");
      } finally {
        setLoading(false);
      }
    }
    loadBuilds();
  }, [token]);

  async function deleteBuild(id: number) {
    if (!token) return;
    setDeletingId(id);
    setError("");
    try {
      const res = await fetch(`/api/builds?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || "Unable to delete build.");
      }
      setBuilds((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete build.");
    } finally {
      setDeletingId(null);
    }
  }

  if (!isAuthenticated && !initializing) return null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#fff5d6] via-[#ffe9a7] to-[#ffd166] text-slate-900">
      <div className="border-b-4 border-[#0ea5e9] bg-[#fef08a] shadow-[0_10px_0_#f59e0b]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3 text-lg font-black text-[#111827]">
            <img src="/rocket.png" alt="Bricked" className="h-8 w-8 drop-shadow-[0_2px_0_#0f2f86]" />
            <span>Bricked</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-[#0f172a]">
            <button
              onClick={() => router.push("/model")}
              className="rounded-full border-2 border-[#ef4444] bg-white px-3 py-1 font-semibold text-[#b91c1c] shadow-[0_6px_0_#b91c1c33] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#b91c1c55]"
            >
              Back to builder
            </button>
            {user?.email && (
              <span className="rounded-full bg-white px-3 py-1 font-semibold text-[#1d4ed8] shadow-[0_6px_0_#0f2f86]">
                {user.email}
              </span>
            )}
            <button
              onClick={() => {
                logout();
                router.replace("/");
              }}
              className="rounded-full border-2 border-[#1d4ed8] bg-[#e0e7ff] px-3 py-1 font-semibold text-[#0f172a] shadow-[0_6px_0_#0f2f86] transition hover:-translate-y-0.5 hover:border-[#ef4444] hover:shadow-[0_8px_0_#b91c1c]"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(29,78,216,0.18),transparent_26%),radial-gradient(circle_at_85%_15%,rgba(239,68,68,0.2),transparent_30%),radial-gradient(circle_at_70%_75%,rgba(16,185,129,0.18),transparent_32%)]" />

        <section className="relative overflow-hidden rounded-3xl border-4 border-[#1d4ed8] bg-white p-8 shadow-[0_16px_0_#0f2f86]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(251,191,36,0.22),transparent_42%)]" />
          <div className="relative space-y-4">
            <p className="text-sm font-black uppercase tracking-[0.15em] text-[#1d4ed8]">Your builds</p>
            <h1 className="text-3xl font-black text-[#0f172a]">Saved models and prompts</h1>
            {loading && <p className="text-sm font-semibold text-[#0f172a]">Loading builds...</p>}
            {error && <p className="text-sm font-semibold text-[#b91c1c]">{error}</p>}
            {!loading && !error && builds.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-[#ef4444] bg-[#fff7ed] p-6 text-sm font-semibold text-[#b45309] shadow-[0_10px_0_#d97706]">
                No builds yet. Save a prompt from the builder to see it here.
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {builds.map((build) => (
                <div
                  key={build.id}
                  className="rounded-2xl border-2 border-[#0ea5e9] bg-[#e0f2fe] p-4 shadow-[0_10px_0_#0f2f86]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-black text-[#0f172a]">{build.title || "Untitled build"}</h2>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#0f172a] shadow-[0_6px_0_#0f2f86]">
                        {new Date(build.created_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => deleteBuild(build.id)}
                        disabled={deletingId === build.id}
                        className="rounded-xl border-2 border-[#ef4444] bg-[#fee2e2] px-3 py-1 text-xs font-black uppercase text-[#991b1b] shadow-[0_6px_0_#b91c1c66] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#b91c1c99] disabled:opacity-60"
                      >
                        {deletingId === build.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-[#0f172a]">{build.prompt || "No prompt saved."}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
