# Vela Design System — v2 "Sail"

Vela is a phone-first expense and savings tracker (USD ⇄ LKR). This document
covers two things:

1. **What the v1 codebase actually used** (extracted from `style.css`, `index.html`, `app.js` before the redesign).
2. **The new v2 system** that replaces it. All tokens live at the top of `style.css`.

---

## 1. Extracted v1 system (audit)

| Area | v1 value | Problem found |
|---|---|---|
| Background | `#07070b` dark, `#f4f5f8` light | fine |
| Surfaces | `rgba(18,18,26,.55)` + `backdrop-filter: blur(16px)` on every card | glass blur on every card is slow on phones and drops frames when scrolling |
| Accents | purple `#9b51e0`, pink `#ff2a5f`, orange `#ff7300`, green `#00e676`, plus untokenised blue `#6366f1`, cyan `#00b8d4`, yellow `#ffd600`, magenta `#e91e63` | four accent colours competing; pink meant both "brand" and "over budget" |
| Category colours | hard-coded twice (CSS `.tag-*` and JS `colorsMap`) | could drift apart; not theme-aware |
| Type | Outfit (headings) + Inter (body), sizes ad-hoc: `.75 .78 .8 .82 .85 .88 .9 .92 .95 1 1.15 1.25 1.35 1.8 2 2.2 2.8rem` | 17 different sizes, no scale |
| Inputs | `font-size: .9rem` (14.4px) | iOS Safari zooms the page on every input focus |
| Radius | `4 5 6 9 10 12 16 17 20 23 24px` | 11 radii |
| Spacing | rem values chosen per component | no scale |
| Layout | desktop sidebar first; mobile = sidebar hidden at 768px | tables with 6 columns on a 375px screen; header with 5 controls overflowed; bottom nav had no labels and the Settings icon was an empty circle |
| Modals | centred box, no max-height | tall forms cut off behind the phone keyboard |
| Light theme | implemented via CSS nesting inside `[data-theme="light"] { … }` | ignored by older mobile browsers, so light mode broke there |
| Safe areas | none | content under the iPhone home indicator / notch |
| z-index | toasts `9999` < auth overlay `999999` | sign-in toasts were invisible |

## 2. v2 principles

1. **Phone first.** Designed at 360–430px; desktop is the enhancement (sidebar from 960px).
2. **Thumb reach.** Primary navigation and the add button live at the bottom. Every tap target is ≥ 44px.
3. **One bold surface.** Only the monthly "hero" card carries the sail gradient. Everything else is a flat, quiet surface.
4. **Money reads first.** Amounts use the display face with tabular numerals so digits line up.
5. **Colour has a job.** Violet = interactive, coral = money out, mint = money saved, amber = warning, red = destructive.
6. **No blur on scrolling content.** Blur is only used on the fixed app bar and tab bar.

## 3. Tokens

### Colour — semantic (dark is the default theme)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0b0c14` | `#f4f5fa` | page |
| `--bg-elevated` | `#12141f` | `#ffffff` | sheets, dialogs |
| `--surface` | `#151826` | `#ffffff` | cards |
| `--surface-2` | `#1d2132` | `#eef0f6` | inputs, segmented track |
| `--surface-pressed` | `#252a3f` | `#e4e7f0` | pressed rows |
| `--border` | `rgba(255,255,255,.07)` | `rgba(20,22,40,.08)` | hairlines |
| `--border-strong` | `rgba(255,255,255,.14)` | `rgba(20,22,40,.16)` | input outlines |
| `--text` | `#f2f3f8` | `#151726` | primary text |
| `--text-2` | `#a6aac0` | `#4f5470` | secondary |
| `--text-3` | `#7a7f99` | `#666b84` | meta, captions |
| `--primary` | `#a07bff` | `#6a3de0` | buttons, active nav, focus |
| `--on-primary` | `#14092e` | `#ffffff` | text and icons on `--primary` (dark ink in dark theme keeps 4.5:1) |
| `--expense` | `#ff6688` | `#d42a5b` | outflow, over-budget |
| `--saving` | `#3fdc9a` | `#08805a` | savings, under budget |
| `--warning` | `#ffc04d` | `#9a5f00` | near budget |
| `--danger` | `#ff5f5f` | `#d32f2f` | delete, wipe |

Each accent has a `*-soft` companion (≈14% alpha) for tinted backgrounds.

### Colour — categories (single source; JS reads them from CSS)

| Category | Token | Dark | Light |
|---|---|---|---|
| Food | `--cat-food` | `#ff7a95` | `#d6335f` |
| Utilities | `--cat-utilities` | `#a07bff` | `#6a3de0` |
| Rent | `--cat-rent` | `#ffa94d` | `#c76a00` |
| Entertainment | `--cat-entertainment` | `#3fdc9a` | `#08805a` |
| Travel | `--cat-travel` | `#4cc3ff` | `#0b7fc0` |
| Health | `--cat-health` | `#ffd84d` | `#a88100` |
| Shopping | `--cat-shopping` | `#f47ac8` | `#c0368f` |
| Other | `--cat-other` | `#98a0b8` | `#6b7189` |

### Type

| Token | Value |
|---|---|
| `--font-display` | Outfit, system-ui fallback — titles and every money amount |
| `--font-body` | Inter, system-ui fallback — everything else |

Scale (px): **12 · 13 · 15 · 17 · 20 · 24 · 32 · 40** → `--fs-xs … --fs-4xl`. Inputs are always 16px.

### Space, radius, motion

| Group | Tokens |
|---|---|
| Space (4px grid) | `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32 · `--sp-10` 40 |
| Radius | `--r-sm` 8 · `--r-md` 12 · `--r-lg` 18 · `--r-xl` 26 · `--r-full` 999 |
| Duration | `--dur-fast` 120ms · `--dur` 220ms · `--dur-slow` 360ms |
| Easing | `--ease-out` `cubic-bezier(.2,.8,.2,1)` · `--ease-spring` `cubic-bezier(.34,1.3,.64,1)` |
| Layout | `--appbar-h` 60px · `--tabbar-h` 64px · `--sidebar-w` 248px |

Safe areas are exposed as `--safe-top/right/bottom/left` (from `env(safe-area-inset-*)`).

## 4. Components

| Component | Class | Notes |
|---|---|---|
| App bar | `.appbar` | sticky, blurred, holds title, live-rate chip, currency switch, theme switch |
| Tab bar | `.tabbar` / `.tab` | 5 labelled tabs, fixed bottom, safe-area padded; hidden ≥ 960px |
| Floating add | `.fab` | opens the quick-add sheet; hidden on Settings and on desktop |
| Sidebar | `.sidebar` | desktop only |
| Hero card | `.hero` | the only gradient surface; month spend + budget meter |
| Card | `.card`, `.card-head`, `.card-title` | flat surface |
| Tile | `.tile` | small stat, tappable |
| Transaction row | `.tx` in `.tx-list` | category icon, title, meta, amount; tap to edit |
| Chip | `.chip` | filters; `aria-pressed="true"` = selected |
| Segmented control | `.segmented` | 2–3 options; `aria-pressed` |
| Button | `.btn` + `.btn-primary / -secondary / -ghost / -danger` + `.btn-sm / .btn-block` | 48px tall (36px for `-sm`) |
| Icon button | `.icon-btn` | 40px |
| Field | `.field`, `.field-label`, `.input`, `.input-group`, `.addon` | 48px tall, 16px text |
| Category picker | `.cat-picker` / `.cat-option` | radio grid, 4 columns |
| Meter | `.meter` / `.meter-fill` | `data-state="ok|warn|over"` |
| Sheet | `.sheet-overlay` / `.sheet` | bottom sheet on phones, centred dialog ≥ 640px, swipe down or Back to close |
| Dialog | `.dialog-overlay` / `.dialog` | confirmations |
| Toast | `.toast` | top-centre, above every layer |
| Empty state | `.empty` | icon, title, one line, action |

Icons are a single inline SVG sprite in `index.html` (`<use href="#i-…">`), 24px grid, 2px stroke, round caps.

## 5. Layering

| Layer | z-index |
|---|---|
| app bar | 40 |
| FAB | 45 |
| tab bar | 50 |
| sheets | 100 |
| dialogs | 200 |
| auth / onboarding | 500 |
| toasts | 1000 |
