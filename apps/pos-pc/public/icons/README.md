# PWA Icons — POS PC

## Required Icons

Place the following PNG files in this directory:

| File | Size | Purpose |
|------|------|---------|
| `icon-192.png` | 192×192 | Standard PWA icon |
| `icon-192-maskable.png` | 192×192 | Maskable icon (safe zone padding) |
| `icon-512.png` | 512×512 | Large PWA icon (splash screen) |
| `icon-512-maskable.png` | 512×512 | Large maskable icon |

## Design Guidelines

- Use the brand's warm bakery colors: primary `#8B4513` (SaddleBrown), background `#FFF8DC` (Cornsilk)
- Include the brand logo or a stylized medialuna (croissant) icon
- Maskable icons need a 40px safe zone margin on all sides
- Export as PNG with transparency support
- Optimize with `pngquant` or `oxipng` for minimal file size

## Quick Generation

Use a tool like `pwa-asset-generator`:

```bash
npx pwa-asset-generator source-logo.svg ./icons \
  --background "#FFF8DC" \
  --padding "10%" \
  --icon-only \
  --favicon \
  --manifest icons/manifest.json
```
