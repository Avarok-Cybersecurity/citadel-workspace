# Citadel Workspaces brand kit

```
BRAND-GUIDELINES.md   the rules
svg/                  vector masters (text outlined, no font needed)
light/  dark/         PNGs on #FFFFFF / #1C1D28
transparent/          PNGs with alpha
tray/                 system tray: template, white, colour, Windows .ico
tokens/               CSS, SCSS, JSON, Tailwind
favicon.ico           16/32/48
favicon.svg           scalable favicon (light ink)
app.ico               Windows app icon, 16–256
site.webmanifest      PWA manifest
head-snippet.html     <head> tags
```

## Into citadel-workspaces/public/

| Kit | public/ |
| --- | --- |
| favicon.ico, favicon.svg | favicon.ico, favicon.svg |
| svg/mask-icon.svg | mask-icon.svg |
| dark/apple-touch-icon-180.png | icons/apple-touch-icon-180.png |
| dark/icon-192.png, icon-512.png | icons/ |
| dark/icon-maskable-512.png | icons/icon-maskable-512.png |
| dark/og-image-1200x630.png | og-image-1200x630.png |

Reconcile `site.webmanifest` with what vite-plugin-pwa generates rather than shipping both.
