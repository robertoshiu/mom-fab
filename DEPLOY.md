# DEPLOY

MOM FAB is a pure static SPA (no bundler, no build step). It is served by
publishing the repository root as-is — `index.html` plus native ES modules,
CSS tokens/themes, self-hosted fonts, and a vendor D3 fallback.

## Deploy

Hosting: **GitHub Pages**, served from the `main` branch root (`/`). Because
there is no build step, deployment is pure file publish — every push to `main`
re-deploys.

### One-time setup

```bash
# 1. Create the public repo and push the current tree (user account default).
gh repo create mom-fab --public --source . --push \
  --description "FAB MOM — deterministic semiconductor MOM demo"

# 2. Enable GitHub Pages from main / root.
gh api repos/{owner}/mom-fab/pages -X POST \
  -f 'source[branch]=main' -f 'source[path]=/'

# 3. (optional) Poll until the first build is built.
gh api repos/{owner}/mom-fab/pages/builds/latest --jq .status
```

### Push-to-deploy

```bash
git push origin main          # any push to main triggers a Pages rebuild
gh api repos/{owner}/mom-fab/pages/builds/latest --jq '.status,.updated_at'
```

### Pages URL pattern

```
https://{owner}.github.io/mom-fab/
```

For this repo: <https://robertoshiu.github.io/mom-fab/>

## esm.sh + vendor fallback

D3 v7 loads as native ESM from `esm.sh` via the import map (`"d3"` →
`./engine/d3-loader.js`). GitHub Pages serves correct MIME types for `.js`
(unlike Windows `python -m http.server`, which serves `.js` as
`text/plain` and blocks module loading — that local quirk does **not** apply
on Pages). `esm.sh` sends `Access-Control-Allow-Origin: *`, so the Pages
origin loads it without CORS issues.

If `esm.sh` is unreachable (offline, CDN outage, or a restrictive CSP), the
loader (`engine/d3-loader.js`) falls back to the self-hosted UMD bundle at
`vendor/d3.v7.min.js`. Fonts are also self-hosted under `vendor/fonts/` — no
CDN font dependency. The app renders fully offline once the page itself is
cached.

## Local verification (unchanged)

Pages does not replace the local dev path. Use the MIME-correct dev server:

```bash
node tools/serve.mjs 8000   # http://localhost:8000/
```

(Plain `python3 -m http.server 8000` works on Linux/macOS but mis-types `.js`
on Windows — prefer `tools/serve.mjs`.)

## Before wide sharing

- **Brand-token swap**: the product name is the placeholder `--brand-name:
  'FAB MOM'` (`styles/tokens.css`) and the geometric mark
  `assets/brand-mark.svg`. Swap both once the brand is finalized — no other
  file hardcodes the name.
- **De-identification**: public files must not name any specific vendor
  product. Keep `index.html`, `DEPLOY.md`, and the i18n dictionaries clear of
  third-party MOM product names before publishing.
