# Vela

A phone-first expense and savings tracker that works in USD and LKR. It is a static Progressive Web App (plain HTML, CSS and JavaScript), hosted on GitHub Pages:

**https://dinsara0611.github.io/vela/**

- Log expenses by category, see the month against your budget.
- Create savings goals and deposit into them.
- Insights: running total, daily average, spending by category.
- Live USD → LKR rate (open.er-api.com), or set your own.
- Works offline and installs to the home screen.
- Optional sign-in and cloud sync with Supabase (see `supabase_setup_guide.md`).

The design system (tokens, components, rules) is documented in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

## Files

| File | Purpose |
|---|---|
| `index.html` | App markup, icon sprite, sheets and onboarding |
| `style.css` | Design tokens and all component styles |
| `app.js` | State, rendering, charts, Supabase sync |
| `sw.js` | Service worker (offline cache) |
| `manifest.json` | PWA manifest |

## Run locally

```bash
python -m http.server 5510
```

Then open http://localhost:5510.

## Deploying updates (GitHub Pages)

GitHub Pages serves the `main` branch from the repository root. Merging changes into `main` publishes them within a minute or two.

When you change `style.css` or `app.js`, bump the `?v=` number in `index.html` and the matching entries plus `VERSION` in `sw.js`, so installed copies pick up the new files.

## Installing on a phone

- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Install app*.

## Publishing to Google Play

1. Open https://www.pwabuilder.com and enter the GitHub Pages URL.
2. Choose **Package for stores → Android** and download the `.aab`.
3. Upload it in the Google Play Console.
