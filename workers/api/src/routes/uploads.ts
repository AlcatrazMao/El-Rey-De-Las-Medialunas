import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const uploadRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

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

  const contentType = file.type;

  if (!ALLOWED_TYPES.has(contentType)) {
    return c.json(
      {
        success: false,
        error: "Unsupported media type. Allowed: jpeg, png, webp, gif",
      },
      415,
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return c.json(
      { success: false, error: "File exceeds maximum size of 2MB" },
      413,
    );
  }

  const ext = CONTENT_TYPE_TO_EXT[contentType];
  const key = `products/${crypto.randomUUID()}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();

  await c.env.BUCKET_R2.put(key, arrayBuffer, {
    httpMetadata: { contentType },
  });

  const base = c.env.PRODUCT_IMAGES_URL.replace(/\/$/, "");
  const url = `${base}/${key}`;

  return c.json({ success: true, data: { url } }, 201);
});
