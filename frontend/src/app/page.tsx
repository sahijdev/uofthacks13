"use client";
import { useState } from "react";
import DropZone from "./DropZone";

export default function ModelPage() {
  //const url = "https://api.brickognize.com/predict/";
  const url = "http://0.0.0.0:8000/detect";
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "done">("idle");
  const [message, setMessage] = useState<string>("");

  async function sendFileToServer(file: File) {
    try {
      setStatus("uploading");
      setMessage("Uploading...");
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
      console.log("Server response:", data);
      setStatus("done");
      setMessage(`Detected ${data.count ?? 0} bricks`);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage("Upload failed. Check backend and CORS.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 p-10 text-white">
      <h1 className="text-3xl font-semibold mb-6 text-center">Upload your Lego Inventory</h1>
      <div className="flex flex-col items-center gap-4">
        <DropZone onFiles={(file) => sendFileToServer(file)}/>
        {status !== "idle" && (
          <p
            className={
              status === "error"
                ? "text-sm text-red-400"
                : status === "uploading"
                  ? "text-sm text-blue-300"
                  : "text-sm text-green-400"
            }
          >
            {message}
          </p>
        )}
        <label className="w-full max-w-xl text-sm text-zinc-300">
          What do you want to build?
          <textarea
            className="mt-2 w-full rounded-xl border border-zinc-600 bg-zinc-800 p-3 text-white outline-none transition focus:border-blue-400 focus:ring focus:ring-blue-500/30"
            rows={3}
            placeholder="Describe the model you want (e.g., small spaceship, bridge, house)..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <button className="bg-green-500 p-3 rounded-md w-50 text-wh">Submit</button>
        </div>
    </main>
  );
}
