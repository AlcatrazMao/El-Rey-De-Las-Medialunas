import { useState, useRef } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { Upload, Smile, X } from "lucide-react";

const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ||
  "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

interface ImagePickerProps {
  value: string;
  onChange: (val: string) => void;
}

export function ImagePicker({ value, onChange }: ImagePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emoji" | "image">("emoji");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isUrl = value.startsWith("http");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("Solo se permiten imágenes (JPG, PNG, WebP, GIF).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("El archivo no puede superar 2 MB.");
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const token = localStorage.getItem("firebase_token") || "";
      const res = await fetch(`${API_URL}/api/v1/upload/product-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = (await res.json()) as { success: boolean; data?: { url: string }; error?: string };
      if (!json.success || !json.data?.url) {
        setUploadError(json.error ?? "Error al subir la imagen.");
        return;
      }
      onChange(json.data.url);
      setOpen(false);
    } catch {
      setUploadError("Sin conexión. Probá más tarde.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 hover:border-amber-400 transition-colors"
      >
        {isUrl ? (
          <img src={value} alt="" className="h-6 w-6 rounded object-cover" />
        ) : (
          <span className="text-xl leading-none">{value}</span>
        )}
        <span className="text-gray-400 dark:text-zinc-500 font-medium">
          {isUrl ? "Imagen subida" : value}
        </span>
        <Smile className="h-3.5 w-3.5 text-gray-400 ml-auto" />
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute z-50 mt-1 left-0 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl shadow-2xl overflow-hidden w-[352px]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-100 dark:border-zinc-800">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setTab("emoji")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                  tab === "emoji"
                    ? "bg-amber-500 text-white"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800"
                }`}
              >
                <Smile className="h-3.5 w-3.5 inline mr-1" />
                Emoji
              </button>
              <button
                type="button"
                onClick={() => setTab("image")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                  tab === "image"
                    ? "bg-amber-500 text-white"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800"
                }`}
              >
                <Upload className="h-3.5 w-3.5 inline mr-1" />
                Imagen
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Emoji tab */}
          {tab === "emoji" && (
            <Picker
              data={data}
              locale="es"
              theme="auto"
              onEmojiSelect={(emoji: { native: string }) => {
                onChange(emoji.native);
                setOpen(false);
              }}
              previewPosition="none"
              skinTonePosition="none"
            />
          )}

          {/* Image upload tab */}
          {tab === "image" && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Subí una imagen del producto (JPG, PNG, WebP · máx. 2 MB).
              </p>

              {/* Preview */}
              {isUrl && (
                <div className="flex justify-center py-2">
                  <img
                    src={value}
                    alt="Preview"
                    className="h-20 w-20 rounded-xl object-cover border border-gray-200 dark:border-zinc-700"
                  />
                </div>
              )}

              <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-xl p-4 cursor-pointer hover:border-amber-400 transition-colors">
                <Upload className="h-5 w-5 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-zinc-400">
                  {uploading ? "Subiendo…" : "Hacé clic para elegir archivo"}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>

              {uploadError && (
                <p className="text-xs text-red-500 font-medium">{uploadError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
