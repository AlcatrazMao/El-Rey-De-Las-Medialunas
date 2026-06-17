import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const uploadRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const IMAGES_WORKER_URL = "https://imagenes-cf-r2.isosistemas2.workers.dev";

uploadRoutes.post("/product-image", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ success: false, error: "Invalid form data" }, 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: "No file provided" }, 400);
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return c.json({ success: false, error: "Unsupported media type. Allowed: jpeg, png, webp, gif" }, 415);
  }

  if (file.size > MAX_SIZE_BYTES) {
    return c.json({ success: false, error: "File exceeds maximum size of 2MB" }, 413);
  }

  const key = `el-rey/products/${crypto.randomUUID()}.${CONTENT_TYPE_TO_EXT[file.type]}`;

  const form = new FormData();
  form.append("file", file);
  form.append("key", key);

  const upstream = await fetch(`${IMAGES_WORKER_URL}/upload`, {
    method: "POST",
    headers: { "X-Internal-Token": c.env.IMAGES_INTERNAL_TOKEN },
    body: form,
  });

  if (upstream.status === 503) {
    return c.json({ success: false, error: "Upload service temporarily unavailable" }, 503);
  }

  if (!upstream.ok) {
    return c.json({ success: false, error: "Upload failed" }, 502);
  }

  const data = (await upstream.json()) as { url: string; key: string };
  return c.json({ success: true, data: { url: data.url } }, 201);
});
