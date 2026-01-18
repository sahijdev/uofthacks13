"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import DropZone from "../DropZone";
import { useAuth } from "../context/AuthContext";
import { Bouncy } from "ldrs/react";
import 'ldrs/react/Bouncy.css'

type InventoryItem = { name: string; count?: number; rawCount: string };
type Build = { id: number; title: string; prompt: string; created_at: string };

function parseInventory(raw: string): InventoryItem[] {
  if (!raw) return [];
  return raw
    .split("*")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((segment) => {
      const [namePart, countPart = ""] = segment.split(":");
      const name = namePart?.trim() || "Unknown piece";
      const count = countPart.match(/\d+/)?.[0];
      return { name, count: count ? Number(count) : undefined, rawCount: countPart.trim() || "?" };
    });
}

const LOADING_PHRASES = [
  "Building bricks…",
  "Snapping studs…",
  "Sorting colors…",
  "Counting plates…",
  "Stacking beams…",
];

type AgentStep =
  | "idle"
  | "architect"
  | "evaluator"
  | "builder"
  | "finalizing";

const AGENT_STEPS: Record<AgentStep, { label: string; color: string }> = {
  idle: { label: "", color: "" },
  architect: { label: "Architect Agent — planning structure", color: "#ef4444" },
  evaluator: { label: "Evaluator Agent — checking stability", color: "#3b82f6" },
  builder: { label: "Builder Agent — snapping bricks", color: "#22c55e" },
  finalizing: { label: "Finalizing OpenSCAD output", color: "#f59e0b" },
};

function LegoLoadingPopup({ step, message }: { step: AgentStep; message?: string }) {
  if (step === "idle") return null;

  const meta = AGENT_STEPS[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="relative w-[320px] rounded-2xl border-4 bg-white p-5 shadow-[0_14px_0_rgba(0,0,0,0.25)]"
        style={{ borderColor: meta.color }}
      >
        <div className="absolute -top-3 left-4 flex gap-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-4 w-6 rounded-full shadow-inner"
              style={{ backgroundColor: meta.color }}
            />
          ))}
        </div>

        <div className="flex flex-col items-center gap-3">
          <Bouncy size={36} />
          <p
            className="text-center text-sm font-black uppercase tracking-wide"
            style={{ color: meta.color }}
          >
            {meta.label}
          </p>
          {message && <p className="text-xs text-slate-600">{message}</p>}
          <p className="text-xs font-semibold text-slate-600">
            Please don’t shake the table 🧱
          </p>
        </div>
      </div>
    </div>
  );
}

function buildIdentity(builds: Build[]): string | null {
  if (!builds.length) return null;
  const text = builds.map((b) => `${b.title} ${b.prompt}`.toLowerCase()).join(" ");
  const tokens = text.match(/[a-z]{3,}/g) || [];
  const freq: Record<string, number> = {};
  tokens.forEach((t) => {
    freq[t] = (freq[t] || 0) + 1;
  });
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
  if (!top.length) return null;
  return `You lean toward ${top.join(", ")} builds`;
}

function buildFallbackRecommendations(inventory: InventoryItem[], builds: Build[]) {
  const persona = buildIdentity(builds);
  const topPieces = [...inventory]
    .map((i) => ({ ...i, score: Number.isFinite(i.count) ? i.count! : 1 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((i) => i.name);

  return [
    topPieces.length
      ? `Mini build using your abundant ${topPieces.join(", ")} pieces — think a micro vehicle or bot.`
      : "Quick micro build using your common plates and bricks.",
    persona
      ? `${persona} vibe: try a variant inspired by your past prompts, but smaller so it fits current pieces.`
      : "Try a fresh themed build (spaceship, cottage, or mech) sized for your current stash.",
    "Remix an older prompt with fewer studs: shrink dimensions and focus on a standout detail.",
  ];
}

function useAgentStream(
  onStep: (step: AgentStep, message: string) => void,
  onFinalScript?: (script: string) => void,
  onStreamingComplete?: (script: string) => void
) {
  const esRef = useRef<EventSource | null>(null);

  const startStream = (prompt: string) => {
    if (!prompt) return;
    if (esRef.current) esRef.current.close();

    const url = `http://localhost:8000/stream_build?prompt=${encodeURIComponent(prompt)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const { step, message, final_script } = data;

      onStep(step, message);

      if (final_script) {
        onFinalScript?.(final_script);       // safe call using optional chaining
        onStreamingComplete?.(final_script); // safe call
      }
    };

    es.onerror = () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  };

  const stopStream = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  };

  return { startStream, stopStream };
}



export default function ModelPage() {
  const { isAuthenticated, initializing, user, logout, token } = useAuth();
  const router = useRouter();
  const url = "http://0.0.0.0:8000/detect";
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "done">("idle");
  const [message, setMessage] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const loadingInterval = useRef<NodeJS.Timeout | null>(null);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const confettiRef = useRef<HTMLDivElement | null>(null);
  const [agentStep, setAgentStep] = useState<AgentStep>("idle");
  const [agentMessage, setAgentMessage] = useState<string>("");
  const [finalScript, setFinalScript] = useState<string | null>(null);


  const handleStep = useCallback((step: AgentStep, message: string) => {
    setAgentStep(step);
    setAgentMessage(message);
  }, []);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch("/api/builds", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        setBuilds(data.builds || []);
      } catch (err) {
        console.error("load builds failed", err);
      }
    })();
  }, [token]);

  // Only refresh suggestions after inventory updates (even if builds change).
  useEffect(() => {
    if (inventory.length === 0) {
      setRecommendations([]);
      return;
    }
    const controller = new AbortController();
    const payload = {
      prompts: builds.map((b) => b.prompt).slice(0, 20),
      inventory: inventory.map((i) => `${i.name}: ${i.count ?? i.rawCount}`).slice(0, 20),
    };

    setLoadingRecs(true);
    fetch("http://localhost:8000/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`suggestions ${res.status}`);
        const data = await res.json();
        const ideas = Array.isArray(data?.recommendations) ? data.recommendations : [];
        setRecommendations(ideas.length ? ideas : buildFallbackRecommendations(inventory, builds));
      })
      .catch((err) => {
        console.error("suggestions failed", err);
        setRecommendations(buildFallbackRecommendations(inventory, builds));
      })
      .finally(() => setLoadingRecs(false));

    return () => controller.abort();
  }, [inventory]);

  useEffect(() => {
    if (!initializing && !isAuthenticated) {
      router.replace("/");
    }
  }, [initializing, isAuthenticated, router]);

  async function sendFileToServer(file: File) {
    try {
      setStatus("uploading");
      setMessage(LOADING_PHRASES[0]);
      if (loadingInterval.current) clearInterval(loadingInterval.current);
      let i = 0;
      loadingInterval.current = setInterval(() => {
        i = (i + 1) % LOADING_PHRASES.length;
        setMessage(LOADING_PHRASES[i]);
      }, 1100);

      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(url, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const data = await response.json();
      setInventory(parseInventory(data?.bricks ?? ""));
      setStatus("done");
      setMessage("Upload complete. Parsed your inventory below.");
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage("Upload failed. Check backend and CORS.");
    } finally {
      if (loadingInterval.current) {
        clearInterval(loadingInterval.current);
        loadingInterval.current = null;
      }
    }
  }

  const onStreamingComplete = useCallback((script: string) => {
    setFinalScript(script);
    const encoded = encodeURIComponent(script);
    router.push(`/instructions?dsl=${encoded}`);
  }, [router]);

  const { startStream } = useAgentStream(handleStep, onStreamingComplete);

async function saveBuild() {
  setSaving(true);
  setAgentStep("architect");
  setAgentMessage("Starting build workflow...");

  // Start the SSE only when submitting
  startStream(prompt);

   try {
    // Save build via API
    await fetch("/api/builds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: prompt.slice(0, 50), prompt }),
    });

    setSaveMessage("Build started! Please wait patiently...");
    triggerFallingBricks();
  } catch (err) {
    console.error(err);
    setSaveMessage("Build failed.");
    setAgentStep("idle");
  } finally {
    setSaving(false);
  }
}

  function triggerFallingBricks() {
    const host = confettiRef.current;
    if (!host) return;
    host.innerHTML = "";
    const colors = ["#ef4444", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#facc15"];
    Array.from({ length: 12 }).forEach((_, idx) => {
      const div = document.createElement("div");
      const size = 10 + Math.random() * 8;
      div.className = "lego-confetti";
      div.style.setProperty("--x", `${5 + Math.random() * 90}%`);
      div.style.setProperty("--delay", `${Math.random() * 0.25}s`);
      div.style.setProperty("--duration", `${1.1 + Math.random() * 0.7}s`);
      div.style.setProperty("--w", `${size}px`);
      div.style.setProperty("--h", `${size * 0.6}px`);
      div.style.backgroundColor = colors[idx % colors.length];
      host.appendChild(div);
      div.addEventListener("animationend", () => div.remove());
    });
  }

  if (!isAuthenticated && !initializing) return null;

  return (
    <>
      <LegoLoadingPopup step={agentStep} message={agentMessage} />

      <main className="min-h-screen bg-gradient-to-b from-[#fff5d6] via-[#ffe9a7] to-[#ffd166] text-slate-900">
        <div className="border-b-2 border-[#0ea5e9] bg-[#fef08a] shadow-[0_6px_0_#f59e0b]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3 md:px-8">
            <div className="flex items-center gap-2 text-lg font-black text-[#111827]">
              <img src="/rocket.png" alt="Bricked" className="h-8 w-8 drop-shadow-[0_2px_0_#0f2f86]" />
              Bricked
            </div>
            <div className="flex items-center gap-4 text-sm text-[#0f172a]">
              <button
                onClick={() => router.push("/models")}
                className="rounded-full border-2 border-[#ef4444] bg-white px-3 py-1 font-semibold text-[#b91c1c] shadow-[0_6px_0_#b91c1c33] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#b91c1c55]"
              >
                My builds
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

        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 md:px-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(29,78,216,0.18),transparent_26%),radial-gradient(circle_at_85%_15%,rgba(239,68,68,0.2),transparent_30%),radial-gradient(circle_at_70%_75%,rgba(16,185,129,0.18),transparent_32%)]" />

          <section className="relative overflow-hidden rounded-2xl border-2 border-[#ef4444] bg-white p-6 shadow-[0_10px_0_#b91c1c]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(251,191,36,0.22),transparent_40%)]" />
            <div className="relative space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[#b91c1c]">Inventory</p>
              <h1 className="text-2xl font-black text-[#0f172a]">Upload your Lego collection</h1>
              <p className="text-sm text-slate-700">
                Drag in a quick snapshot of your pieces to detect parts and keep your build plan aligned with what you own.
              </p>
              <DropZone onFiles={(file) => sendFileToServer(file)} />
              {status !== "idle" && (
                <p
                  className={
                    status === "error"
                      ? "mt-4 text-sm font-semibold text-[#b91c1c]"
                      : status === "uploading"
                        ? "mt-4 text-sm font-semibold text-[#1d4ed8]"
                        : "mt-4 text-sm font-semibold text-[#15803d]"
                  }
                >
                  {message}
                </p>
              )}
              {inventory.length > 0 && (
                <div className="mt-4 rounded-2xl border-2 border-[#16a34a] bg-[#ecfdf3] p-3 shadow-[0_8px_0_#15803d]">
                  <p className="text-xs font-black uppercase tracking-[0.1em] text-[#15803d]">Detected pieces</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {inventory.map((item, idx) => (
                      <div
                        key={`${item.name}-${idx}`}
                        className="rounded-lg border border-[#16a34a] bg-white px-2.5 py-2 text-xs font-semibold text-[#166534] shadow-[0_4px_0_#15803d]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#14532d] line-clamp-2">{item.name}</span>
                          <span className="rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-black uppercase text-[#166534] shadow-[0_3px_0_#15803d]">
                            {item.count ?? item.rawCount}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="relative overflow-hidden rounded-2xl border-2 border-[#0ea5e9] bg-white p-6 shadow-[0_10px_0_#0f2f86]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.16),transparent_40%)]" />
            <div className="relative space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0ea5e9]">Suggestions</p>
              <h2 className="text-xl font-black text-[#0f172a]">Recommended builds for you</h2>
              <p className="text-sm text-[#0f172a]">
                Personalized from your saved prompts and current pieces. Left-click a card to drop it into your prompt box.
              </p>
              {loadingRecs && (
                <p className="text-xs font-semibold text-[#1d4ed8]">Asking Gemini for ideas…</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {recommendations.map((rec, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPrompt(rec)}
                    className="cursor-pointer rounded-xl border-2 border-[#0ea5e9] bg-[#e0f2fe] p-3 text-left text-sm font-semibold text-[#0f172a] shadow-[0_8px_0_#0f2f86] transition hover:-translate-y-0.5 hover:shadow-[0_10px_0_#0f2f86] focus:outline-none focus:ring-2 focus:ring-[#0ea5e9]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#ef4444] shadow-[0_0_0_3px_#0f2f86]" />
                      <span className="text-[#0f172a]">{rec}</span>
                    </div>
                  </button>
                ))}
                {recommendations.length === 0 && (
                  <div className="rounded-xl border-2 border-dashed border-[#0ea5e9] bg-[#f8fafc] p-3 text-sm font-semibold text-[#0f172a] shadow-[0_8px_0_#0f2f86]">
                    Save a prompt and upload inventory to see personalized ideas.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-2xl border-2 border-[#1d4ed8] bg-white p-6 shadow-[0_10px_0_#0f2f86]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(251,191,36,0.18),transparent_45%)]" />
            <div className="relative space-y-3">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[#1d4ed8]">Blueprint</p>
              <label className="text-xl font-black text-[#0f172a]">
                What do you want to build?
                <textarea
                  className="mt-1 w-full rounded-2xl border-2 border-[#ef4444] bg-[#fff7ed] p-2.5 text-sm text-[#0f172a] outline-none shadow-[0_6px_0_#b91c1c] transition focus:-translate-y-0.5 focus:border-[#1d4ed8] focus:shadow-[0_8px_0_#0f2f86]"
                  rows={3}
                  placeholder="Small spaceship, bridge, house..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2 md:mt-4">
                <button
                  onClick={saveBuild}
                  disabled={saving}
                  className="relative rounded-xl bg-[#fbbf24] px-4 py-2 text-xs font-black uppercase tracking-wide text-[#92400e] shadow-[0_8px_0_#d97706] transition hover:-translate-y-0.5 hover:shadow-[0_10px_0_#b45309] disabled:opacity-60"
                >
                  <span className="pointer-events-none absolute -top-1 left-1.5 flex gap-1">
                    <span className="h-2 w-3 rounded-full bg-[#ffe08a] shadow-[0_2px_0_#d97706]" />
                    <span className="h-2 w-3 rounded-full bg-[#ffe08a] shadow-[0_2px_0_#d97706]" />
                  </span>
                  {saving ? "Generating" : "Submit prompt"} {saving && <Bouncy size={12}/>}
                </button>
                <button
                  onClick={() => setPrompt("")}
                  className="rounded-xl border-2 border-[#1d4ed8] bg-[#e0e7ff] px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-[0_6px_0_#0f2f86] transition hover:-translate-y-0.5 hover:border-[#ef4444] hover:shadow-[0_8px_0_#b91c1c]"
                >
                  Clear
                </button>
              </div>
              {saveMessage && <p className="text-sm font-semibold text-[#0f172a]">{saveMessage}</p>}
              <div ref={confettiRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
