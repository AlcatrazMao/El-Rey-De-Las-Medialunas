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
const R2_BUCKET = "imagenes-cf-r2";
const GUARDIAN_KV_NS = "36c2ec8740c442b88e31ef8f42d728f6";

async function isUploadBlocked(accountId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${GUARDIAN_KV_NS}/values/r2_freno`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return false;
    if (!res.ok) return true; // KV error → fail closed
    return (await res.text()).trim() === "true";
  } catch {
    return true; // network error → fail closed
  }
}

async function uploadToR2(
  accountId: string,
  token: string,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${R2_BUCKET}/objects/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    },
  );
  if (!res.ok) throw new Error(`R2 upload failed (${res.status}): ${await res.text()}`);
}

uploadRoutes.post("/product-image", async (c) => {
  if (await isUploadBlocked(c.env.R2_ACCOUNT_ID, c.env.R2_CF_TOKEN)) {
    return c.json({ success: false, error: "Upload service temporarily unavailable" }, 503);
  }

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

  const contentType = file.type;
  if (!ALLOWED_TYPES.has(contentType)) {
    return c.json({ success: false, error: "Unsupported media type. Allowed: jpeg, png, webp, gif" }, 415);
  }

  if (file.size > MAX_SIZE_BYTES) {
    return c.json({ success: false, error: "File exceeds maximum size of 2MB" }, 413);
  }

  const ext = CONTENT_TYPE_TO_EXT[contentType];
  const key = `products/${crypto.randomUUID()}.${ext}`;

  await uploadToR2(c.env.R2_ACCOUNT_ID, c.env.R2_CF_TOKEN, key, await file.arrayBuffer(), contentType);

  const base = c.env.PRODUCT_IMAGES_URL.replace(/\/$/, "");
  return c.json({ success: true, data: { url: `${base}/${key}` } }, 201);
});
