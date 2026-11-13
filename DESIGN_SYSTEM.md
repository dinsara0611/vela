# Vela Design System — v3 "Neon Sail"

Vela is a phone-first money app (USD ⇄ LKR): expenses, income, budgets, bills, savings goals, debts. v3 brings back the original Vela look (deep black, glowing violet and coral, gradient buttons, glass cards) and rebuilds it for phones. All tokens live at the top of `style.css`.

## History

| Version | Look | Why it changed |
|---|---|---|
| v1 | Neon purple/pink glass cards, desktop sidebar | Loved look, but desktop-first: tables on phones, 14px inputs (iOS zoom), glass blur on every card, light mode via CSS nesting that older phones ignored |
| v2 "Sail" | Calm, flat, low-glow | Fixed the phone layout, but lost the brand's character |
| **v3 "Neon Sail"** | v1's neon identity on v2's phone layout | Keeps every v2 fix; glow comes from cheap gradients and shadows, not blur |

## Principles

1. **Phone first.** Designed at 360–430px; the sidebar layout starts at 960px.
2. **Thumb reach.** Five labelled tabs and the + button sit at the bottom. Touch targets ≥ 44px, inputs 50px.
3. **Neon with a budget.** Glow marks what matters: the balance hero, stat tiles, the active tab, primary buttons. Lists and forms stay calm.
4. **No blur on scrolling content.** Blur only on the fixed app bar and tab bar. Cards get their "glass" from a 5% white gradient.
5. **Money reads first.** Amounts use Outfit with tabular numerals. Income is green with "+", spending is pink with "−": colour is never the only signal.
6. **Readable in both themes.** Every text token passes 4.5:1 on its background; gradient starts were darkened so white text on them passes too.

## Colour tokens

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#07070b` | `#f4f5f8` | page |
| `--surface` / `--surface-glass` | `#101018` + 5% white gradient | `#ffffff` | cards |
| `--surface-2` | `#1a1a26` | `#eef0f5` | inputs, tracks |
| `--bg-elevated` | `#111119` | `#ffffff` | sheets, dialogs |
| `--text` / `--text-2` / `--text-3` | `#f3f3f6` / `#a7a7ba` / `#7d7d93` | `#191921` / `#4f4f5e` / `#67677a` | text levels |
| `--primary` | `#b17aff` | `#6200ee` | links, active states, focus |
| `--primary-grad` | `#9446e6 → #7b2cbf` | `#7c2df0 → #5600d6` | primary buttons, selected segments |
| `--accent-grad` | `#9446e6 → #e0174f` | `#6200ee → #d81b60` | + button, brand text, meters |
| `--income` | `#1ee88a` | `#2e7d32` | money in |
| `--expense` | `#ff4d79` | `#d81b60` | money out, over budget |
| `--warning` | `#ffb547` | `#9a5a00` | 80% of a budget, due soon |
| `--danger` | `#ff5c6c` | `#c62828` | delete, wipe |

**Neon palette** (`--pal-*`, used for categories and glow cards): violet, pink, orange, green, cyan, yellow, magenta, indigo, teal, slate. Each has a brighter dark-theme value and a deeper light-theme value that keeps 3:1 for icons on white.

## Type, space, radius, motion

- **Outfit** (display: titles, money) + **Inter** (body). Scale 12 · 13 · 15 · 17 · 20 · 24 · 32 · 40. Inputs are always 16px.
- **Space** 4px grid: `--sp-1` 4 … `--sp-10` 40. Phone gutter 16px, desktop 32px.
- **Radius** `--r-md` 12 (controls 14), `--r-lg` 20 (cards), `--r-xl` 26 (hero, sheets), `--r-full`.
- **Motion** 120 / 220 / 360ms, ease-out `cubic-bezier(.2,.8,.2,1)`, spring for the + button, toasts, switches. Theme changes reveal in a circle from the tap. All motion respects `prefers-reduced-motion`.

## Components

| Component | Class | Notes |
|---|---|---|
| Glow card | `.card.glow` + `--glow` | neon border, corner tint and outer glow in the `--glow` colour |
| Balance hero | `.hero` | the one gradient surface: balance, income/spent flows, budget meter |
| Tile | `.tile` | small stat with a coloured icon chip |
| Due card | `.due-card` | bill due soon, horizontal scroller on Home |
| Transaction row | `.tx` | badge, title, meta, signed amount, original currency |
| Row card | `.row-card` | bills, budgets, goals, debts on the Plan tab |
| Meter | `.meter > .meter-fill` | `data-state="warn|over|done"` |
| Segmented | `.segmented` | selected = primary gradient; `.type-switch` colours expense pink / income green |
| Chip | `.chip` | category filters with a glowing colour dot |
| Switch | `.switch[role=switch]` | settings toggles |
| Pickers | `.cat-picker`, `.swatch-grid`, `.icon-grid` | category, colour, icon |
| Sheet | `.sheet-overlay > .sheet` | bottom sheet on phones, dialog ≥ 640px; swipe down or Back to close |
| Dialog | `.dialog` | confirmations for anything destructive |
| Lock screen | `.lock`, `.keypad`, `.pin-dots` | PIN pad with fingerprint key |
| Toast | `.toast` | top-centre, above everything |

Icons: one inline SVG sprite, 24px grid, 2px stroke, round caps. Category icons are `c-*`, extra choices for custom categories are `x-*`.

## Layers

app bar 40 · + button 45 · tab bar 50 · sheets 100 · dialogs 200 · sign-in 500 · lock screen 800 · toasts 1000
