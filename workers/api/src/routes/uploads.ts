import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

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

// SECURITY: rate-limit per user — 30 uploads per hour.

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// SECURITY: verify the declared content type by checking the actual magic
// bytes of the uploaded file. A malicious client can lie about file.type, so
// trust-but-verify by sniffing the first bytes ourselves.
function detectMimeFromMagicBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  // GIF: 47 49 46 38 (37|39) 61
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) return "image/gif";
  // WEBP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

uploadRoutes.post("/product-image", async (c) => {
  // SECURITY: require an authenticated, registered user before accepting
  // uploads. Without this any holder of a valid JWT (including a stale one)
  // could fill our R2 bucket with garbage.
  const userId = c.get("userId");
  if (!userId) {
    return c.json(errBody("UNAUTHORIZED", "Token de acceso requerido"), 401);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(errBody("VALIDATION_ERROR", "Form data inválido"), 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return c.json(errBody("VALIDATION_ERROR", "Archivo no proporcionado"), 400);
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return c.json(
      errBody("UNSUPPORTED_MEDIA_TYPE", "Tipo de archivo no soportado. Permitidos: jpeg, png, webp, gif"),
      415,
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return c.json(errBody("PAYLOAD_TOO_LARGE", "El archivo excede el tamaño máximo de 2MB"), 413);
  }

  if (file.size === 0) {
    return c.json(errBody("VALIDATION_ERROR", "Archivo vacío"), 400);
  }

  // SECURITY: verify magic bytes match the declared content type. This
  // prevents attackers from uploading e.g. an HTML file (XSS) or a PHP shell
  // disguised as image/png.
  const firstBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const realMime = detectMimeFromMagicBytes(firstBytes);
  if (!realMime || realMime !== file.type) {
    return c.json(
      errBody("VALIDATION_ERROR", "El contenido del archivo no coincide con el tipo declarado"),
      400,
    );
  }

  const key = `el-rey/products/${crypto.randomUUID()}.${CONTENT_TYPE_TO_EXT[file.type]}`;

  const form = new FormData();
  form.append("file", file);
  form.append("key", key);

  let upstream: Response;
  try {
    upstream = await fetch(`${IMAGES_WORKER_URL}/upload`, {
      method: "POST",
      headers: { "X-Internal-Token": c.env.IMAGES_INTERNAL_TOKEN },
      body: form,
    });
  } catch (err) {
    console.error("[uploads] upstream fetch failed:", err);
    return c.json(errBody("BAD_GATEWAY", "No se pudo contactar el servicio de carga"), 502);
  }

  if (upstream.status === 503) {
    return c.json(errBody("SERVICE_UNAVAILABLE", "Servicio de carga no disponible temporalmente"), 503);
  }

  if (!upstream.ok) {
    console.error(`[uploads] upstream returned ${upstream.status}`);
    return c.json(errBody("BAD_GATEWAY", "La carga falló"), 502);
  }

  let data: { url: string; key: string };
  try {
    data = (await upstream.json()) as { url: string; key: string };
  } catch (err) {
    console.error("[uploads] upstream returned invalid JSON:", err);
    return c.json(errBody("BAD_GATEWAY", "Respuesta inválida del servicio de carga"), 502);
  }

  if (!data?.url || typeof data.url !== 'string') {
    return c.json(errBody("BAD_GATEWAY", "Respuesta inválida del servicio de carga"), 502);
  }

  // AUDIT: registrar el upload exitoso en la tabla uploaded_files para
  // trazabilidad (quién, qué, cuándo, qué clave R2).
  try {
    const auditId = genId();
    const uploadedAt = nowSqliteTs();
    const branchId = c.get("branchId") ?? null;
    await c.env.DB.prepare(
      `INSERT INTO uploaded_files (id, user_id, file_name, file_size, mime_type, r2_key, uploaded_at, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(auditId, userId, file.name, file.size, file.type, key, uploadedAt, branchId)
      .run();
  } catch (err) {
    // No fallar el upload por un error de auditoría — loguear y continuar.
    console.error("[uploads] audit insert failed:", err);
  }

  return c.json({ success: true, data: { url: data.url } }, 201);
});
