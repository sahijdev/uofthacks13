"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = { onFiles?: (file: File) => void };

export default function DropZone({ onFiles }: Props) {
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const image = Array.from(files).find((f) => f.type.startsWith("image/"));
      if (!image) {
        setError("Only image files are accepted.");
        return;
      }
      setError(null);
      onFiles?.(image);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(image);
      });
    },
    [onFiles]
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  return (
    <div
      className={`flex w-full mb-3 flex-col items-center gap-3 rounded-2xl border-4 border-dashed p-6 text-center transition ${
        hover
          ? "border-[#ef4444] bg-[#ffe4e6] shadow-[0_12px_0_#b91c1c]"
          : "border-[#1d4ed8] bg-[#e0f2fe] shadow-[0_12px_0_#0f2f86]"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setHover(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <p className="text-sm font-semibold text-[#0f172a]">Drag & drop an image of your Lego inventory here.</p>
      <p className="text-xs font-medium text-[#0f172a]/70">We&apos;ll scan it to understand what pieces you own.</p>
      {error && <p className="text-xs font-semibold text-[#b91c1c]">{error}</p>}
      {preview && (
        <div className="flex w-full justify-center">
          <img src={preview} alt="Preview" className="h-40 w-auto rounded border-2 border-[#0ea5e9] shadow-[0_8px_0_#0f2f86] object-contain" />
        </div>
      )}
    </div>
  );
}
