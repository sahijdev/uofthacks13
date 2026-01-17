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
      className={`flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed p-6 text-center transition ${
        hover ? "border-blue-500 bg-blue-50/60" : "border-zinc-300 bg-white"
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
      <p className="text-sm text-zinc-600">Drag & drop an image of your Lego inventory here!</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {preview && (
        <div className="flex w-full justify-center">
          <img src={preview} alt="Preview" className="h-40 w-auto rounded object-contain" />
        </div>
      )}
    </div>
  );
}
