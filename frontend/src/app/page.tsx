"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./context/AuthContext";

export default function HomePage() {
  const router = useRouter();
  const { login, register, isAuthenticated, initializing } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [launchWave, setLaunchWave] = useState(0);

  useEffect(() => {
    if (!initializing && isAuthenticated) {
      router.replace("/model");
    }
  }, [initializing, isAuthenticated, router]);

  useEffect(() => {
    const kickOff = setTimeout(() => setLaunchWave((wave) => wave + 1), 200);
    const loop = setInterval(() => setLaunchWave((wave) => wave + 1), 9000);
    return () => {
      clearTimeout(kickOff);
      clearInterval(loop);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      router.replace("/model");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#fff5d6] via-[#ffe9a7] to-[#ffd166] text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(29,78,216,0.18),transparent_28%),radial-gradient(circle_at_85%_10%,rgba(239,68,68,0.2),transparent_30%),radial-gradient(circle_at_70%_75%,rgba(16,185,129,0.18),transparent_32%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-14">
        <div className="grid w-full items-center gap-12 lg:grid-cols-2">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-3 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#1d4ed8] shadow-[0_8px_0_#1d4ed8] ring-2 ring-[#0ea5e9]">
              <div key={`stage-${launchWave}`} className="rocket-stage relative h-14 w-14 overflow-visible">
                <span className="pointer-events-none rocket-flames absolute -bottom-16 left-1/2 h-14 w-14 -translate-x-1/2 translate-y-4 rotate-180 rounded-full bg-[radial-gradient(circle_at_50%_20%,rgba(251,191,36,0.95),rgba(239,68,68,0.9),rgba(249,115,22,0.6),rgba(37,99,235,0))] blur-sm" />
                <img
                  src="/rocket.png"
                  alt="Bricked"
                  className="rocket-flight h-12 w-12 drop-shadow-[0_2px_0_#0f2f86]"
                />
              </div>
              <span>Build with brick energy</span>
            </div>
            <h1 className="text-5xl font-black leading-tight text-[#111827] drop-shadow-[0_12px_0_rgba(29,78,216,0.18)]">
              Bricked
            </h1>
            <p className="text-lg text-slate-700">
              Sign in to snap your collection, spot every piece, and turn ideas into playful build plans.
            </p>
            <div className="flex flex-wrap gap-3 text-sm text-slate-800">
              <span className="rounded-xl bg-[#ef4444] px-3 py-1 font-semibold text-white shadow-[0_6px_0_#b91c1c]">JWT secured</span>
              <span className="rounded-xl bg-[#1d4ed8] px-3 py-1 font-semibold text-white shadow-[0_6px_0_#0f2f86]">Fast uploads</span>
              <span className="rounded-xl bg-[#fbbf24] px-3 py-1 font-semibold text-[#92400e] shadow-[0_6px_0_#d97706]">AI-assisted plans</span>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="relative overflow-hidden rounded-3xl border-4 border-[#0ea5e9] bg-white p-8 shadow-[0_18px_0_#0f2f86]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(251,191,36,0.25),transparent_35%),radial-gradient(circle_at_80%_85%,rgba(239,68,68,0.18),transparent_38%)]" />
            <div className="relative space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-black uppercase tracking-[0.08em] text-[#0f172a]" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-2xl border-2 border-[#1d4ed8] bg-[#e0e7ff] px-4 py-3 text-slate-900 outline-none shadow-[0_8px_0_#0f2f86] transition focus:-translate-y-0.5 focus:border-[#ef4444] focus:shadow-[0_10px_0_#b91c1c]"
                  placeholder="you@lego.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-black uppercase tracking-[0.08em] text-[#0f172a]" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-2xl border-2 border-[#1d4ed8] bg-[#e0e7ff] px-4 py-3 text-slate-900 outline-none shadow-[0_8px_0_#0f2f86] transition focus:-translate-y-0.5 focus:border-[#ef4444] focus:shadow-[0_10px_0_#b91c1c]"
                  placeholder="••••••••"
                />
              </div>
              {error && <p className="text-sm font-semibold text-[#b91c1c]">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#fbbf24] px-4 py-3 text-center text-lg font-black uppercase tracking-wide text-[#92400e] shadow-[0_12px_0_#d97706] transition hover:-translate-y-0.5 hover:shadow-[0_16px_0_#b45309] disabled:translate-y-0 disabled:shadow-[0_12px_0_#d97706] disabled:opacity-70"
              >
                {loading ? "Snapping in..." : mode === "login" ? "Enter the build room" : "Create my account"}
              </button>
              <p className="text-xs font-medium text-slate-700">
                {mode === "login"
                  ? "Need an account? Switch to sign up below."
                  : "Already built something? Switch to sign in."}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#0f172a]">
                  {mode === "login" ? "New to Bricked?" : "Already have an account?"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setMode(mode === "login" ? "signup" : "login");
                  }}
                  className="rounded-xl border-2 border-[#1d4ed8] bg-[#e0e7ff] px-3 py-1 text-xs font-black uppercase tracking-wide text-[#0f172a] shadow-[0_6px_0_#0f2f86] transition hover:-translate-y-0.5 hover:border-[#ef4444] hover:shadow-[0_8px_0_#b91c1c]"
                >
                  {mode === "login" ? "Sign up" : "Sign in"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
      <style jsx>{`
        .rocket-stage {
          animation: rocketStage 3s ease-in-out forwards;
        }

        .rocket-flight {
          position: relative;
          z-index: 3;
          animation: rocketFlight 3s ease-in-out forwards;
        }

        .rocket-flames {
          z-index: 2;
          animation: rocketFlames 3s ease-in-out;
          opacity: 0;
        }

        @keyframes rocketStage {
          0% {
            opacity: 0;
            transform: translate(60vw, 70vh) scale(3.4) rotate(35deg);
          }
          18% {
            opacity: 1;
            transform: translate(30vw, 38vh) scale(2.4) rotate(12deg);
          }
          42% {
            transform: translate(-12vw, -32vh) scale(1.8) rotate(-8deg);
          }
          65% {
            transform: translate(-8vw, -8vh) scale(1.35) rotate(18deg);
          }
          82% {
            transform: translate(4vw, 16vh) scale(1.15) rotate(-10deg);
          }
          100% {
            opacity: 1;
            transform: translate(0, 0) scale(1) rotate(0deg);
          }
        }

        @keyframes rocketFlight {
          0% {
            transform: rotate(-30deg) scale(1.2);
          }
          25% {
            transform: rotate(-12deg) scale(1.15);
          }
          50% {
            transform: rotate(24deg) scale(1.1);
          }
          75% {
            transform: rotate(-18deg) scale(1.05);
          }
          100% {
            transform: rotate(0deg) scale(1);
          }
        }

        @keyframes rocketFlames {
          0% {
            opacity: 0;
            transform: translate(-4px, 40px) scale(1);
            filter: blur(8px);
          }
          20% {
            opacity: 1;
            transform: translate(0, 54px) scale(1.25);
            filter: blur(4px);
          }
          50% {
            opacity: 0.95;
            transform: translate(0, 64px) scale(1.35);
            filter: blur(2px);
          }
          100% {
            opacity: 0;
            transform: translate(0, 140px) scale(1.8);
            filter: blur(12px);
          }
        }
      `}</style>
    </main>
  );
}
