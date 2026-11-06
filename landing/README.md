# Cubbit landing page

Static English landing page for **Cubbit**, an independent Windows desktop pet. No build step, no dependencies, no JavaScript, no external fonts or CDNs. Open `index.html` directly to preview it.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Hero, four feature blocks, "It works solo too", pricing, three FAQs, footer |
| `privacy.html` | Standalone English privacy policy (nine sections, including GDPR rights) |
| `style.css` | All styles: dark cute theme, CSS-drawn cube logo and hero art, responsive layout |
| `README.md` | This file |

## Preview

Double-click `index.html`, or drag it into a browser. Everything works from `file://`.

Optional local server:

```bash
cd landing
python -m http.server 8000
# open http://localhost:8000
```

There is nothing to install and nothing to compile.

## Deploy

### Option A — any static host

Upload the contents of this folder (keep the file names) to any static host: Netlify, Cloudflare Pages, GitHub Pages, S3 + CloudFront, Vercel, or a plain web server.

- Entry point: `index.html` (already the default on every host above).
- `privacy.html` is a real file, so no rewrite rules are needed.
- Enable HTTPS; the download and purchase placeholders should point at HTTPS URLs.
- Cache `style.css` with a normal static-asset policy (for example 7 days); it has no build hash, so use a short cache or add a query string when you change it.

### Option B — your own nginx directory

Copy the three site files to the server (`README.md` is documentation only, not needed on the server):

```bash
sudo mkdir -p /var/www/cubbit
sudo cp index.html privacy.html style.css /var/www/cubbit/
```

Minimal server block (`/etc/nginx/sites-available/cubbit`):

```nginx
server {
    listen 80;
    server_name cubbit.app www.cubbit.app;

    root /var/www/cubbit;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.(css|js)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

Then:

```bash
sudo ln -s /etc/nginx/sites-available/cubbit /etc/nginx/sites-enabled/cubbit
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d cubbit.app -d www.cubbit.app   # HTTPS
```

No SPA fallback is required: every page is a real HTML file.

## Placeholders to replace

There are **4 placeholder values in 20 places**: 8 URLs and 12 email-address instances. All of them live in `index.html` and `privacy.html`.

| # | Placeholder | Occurrences | Where | Replace with |
| --- | --- | --- | --- | --- |
| 1 | Domain `https://cubbit.app` | 8 URLs (download 3, buy 1, terms 2, canonical 2) | `index.html`, `privacy.html` | Your production domain. Replaces the base of every URL below at once. |
| 2 | Download URL `https://cubbit.app/download/Cubbit-Setup.exe` | 3 | Header nav, hero button, Free plan button in `index.html` | Real Windows installer URL (direct `.exe` or a download page). |
| 3 | Purchase URL `https://cubbit.app/buy` | 1 | Couple Pack button in `index.html` | Real checkout / payment link. |
| 4 | Email `support@cubbit.app` | 12 (`href` + visible text) | Footer Contact links, privacy policy contact and deletion sections | Real support mailbox. |

Rows 2 and 3 are part of the 8 URLs counted in row 1: changing the domain updates their host, and you still need to set the real installer and checkout paths.

Notes:

- The footer **Terms** link points to `https://cubbit.app/terms`. A Terms page is not included in this folder: publish one at that URL, or change the link.
- The footer **Privacy** link points to the included `privacy.html`, so it works as-is.
- Quick find-and-replace (Linux/macOS, from this folder):

  ```bash
  sed -i 's#https://cubbit.app#https://yourdomain.com#g' index.html privacy.html
  sed -i 's#support@cubbit.app#hello@yourdomain.com#g' index.html privacy.html
  ```

  After changing the domain, still replace the installer path and the checkout path with the real ones (rows 2 and 3).

## Before you publish

These are policy values, not URL placeholders — confirm them against what the app actually does:

- Retention periods in `privacy.html`: 30 days for pairing records and messages, 12 months for support emails, 30 days for deletion requests.
- The "Last updated" date in `privacy.html`.
- Legal entity: the policy currently says "Cubbit, an independent studio." Add a registered name and address if your jurisdiction requires one.
- If you add analytics, cookies, embedded video or external fonts to this site, update section 3 of `privacy.html` — it currently states that the site is static, with no cookies, analytics or third-party scripts.
- Keep the product facts in sync if the app changes: 42 expressions, 7 gestures, 60-second voice messages, Windows 10/11 only, six languages, 30-day free start with no account or card, free base app, Couple Pack $19.99 (launch $14.99), skins $2.99–$4.99, no subscription.

## Design and implementation notes

- Palette: background `#0c0e14`, accent `#ff7a3d`; all colors are CSS custom properties at the top of `style.css`.
- System font stack only (`system-ui`, Segoe UI, Roboto, Helvetica Neue, Arial). No Google Fonts, no CDN, no tracking — nothing is requested from a third party.
- The logo is a CSS-drawn orange rounded square with two eyes; the hero scene is two CSS cubes joined by a floating heart. There are no image assets.
- Responsive: a two-column hero on desktop, single column below 960px; pricing stacks below 880px; compact header and full-width hero buttons on phones.
- No JavaScript. The FAQ uses native `<details>`/`<summary>`, and the mobile layout is pure CSS.
- Accessibility: skip link, visible focus states, `prefers-reduced-motion` support, semantic landmarks, alt-free decorative art marked `aria-hidden`.

## Editing

- Marketing copy: `index.html`.
- Policy text: `privacy.html`.
- Colors, spacing, cube art: `style.css`.
- The line **"Cubbit is made by a tiny independent studio."** appears in the footer of both pages; keep it if you fork the page.
