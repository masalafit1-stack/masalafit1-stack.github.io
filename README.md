# MasalaFit static site

This is the GitHub Pages source for `masalafit.fit`. It is intentionally plain static HTML.

## Dish pages

Dish pages are generated from the adjacent private app repository. The generator reads the app JSON at build time and writes rendered HTML only, so raw dish data is never committed here.

```bash
node scripts/generate-dishes.js
```

When the app checkout is elsewhere, point the generator at it explicitly:

```bash
MASALAFIT_APP_DIR=/absolute/path/to/DesICal node scripts/generate-dishes.js
```

Preview the output locally:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080/dishes/` and spot-check several dish pages. GitHub Pages publishes pushes to `main` automatically, so review generated changes before pushing.

The `/masalafit-privacy/` path is served by the separate `masalafit-privacy` GitHub Pages project and is not generated or changed here.
