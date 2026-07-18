# CurbAgora Design System — "Urban Sunset Marketplace"

## Brand intent

CurbAgora should feel trustworthy, local, energetic, urban, and warm — a
street market at sunset, not a corporate SaaS dashboard or a food-delivery
clone. Density over emptiness, tactile controls, restrained decoration.

## Palette

Brand anchors (never invent new hues; derive shades from these):

| Name          | Hex       | Meaning                    |
| ------------- | --------- | -------------------------- |
| Sunset orange | `#F67E04` | Action & live energy       |
| Deep teal     | `#31737A` | Brand surface & selection  |
| Warm sand     | `#E3D1BA` | Page background            |
| Mist sage     | `#A2B9A7` | Supporting panels & hovers |
| Walnut brown  | `#785F54` | Secondary text & borders   |

## Semantic color roles (defined once in `src/app/globals.css`)

All component styling uses Tailwind semantic classes backed by CSS
variables. Light and dark values both exist (dark mode follows
`prefers-color-scheme`). **Never hardcode hex values in components** — the
single exception is the Google Maps canvas (`nearby-map.tsx`), which
cannot read CSS variables and mirrors the brand constants with a comment.

- `background` / `foreground` — sand page, warm ink text.
- `card` — warm near-white surfaces: cards AND form fields (fields sit on
  sand, so they need the lighter surface to read as inputs).
- `primary` (+`-foreground`) — sunset orange fills. **Text on orange is
  dark ink, never white.** Reserved for primary actions and key moments.
- `secondary` (+`-foreground`) — deep teal. Nav/footer bars, secondary
  buttons, and every _selected_ state (pills, tabs, chips, selected cards
  and map-marker strokes). Near-white text on teal.
- `accent` (+`-foreground`) — light sage. Hover fills for outline/ghost
  controls, informational chips, quiet supporting panels.
- `muted` / `muted-foreground` — light-sand panels; walnut secondary text
  (pre-darkened for WCAG AA on sand).
- `border` / `input` — sand-walnut hairlines.
- `ring` — orange focus rings (with `ring-offset-2`).
- `brand` (+`-foreground`) — teal _as text/icon color_, pre-darkened
  (light) / pre-lightened (dark) so small text stays AA. Avatars, brand
  icons, links.
- `live` — the live/open state. Burnt orange in light mode (AA as small
  text), bright orange in dark. Badges: `bg-live/15 text-live`; callouts:
  `border-live/30 bg-live/10`.
- `success` — deep sage green for success alerts and verified states.
  Success ≠ live: live is orange energy, success is calm green.
- `destructive` — warm red, errors only.

## Typography

Geist (sans) / Geist Mono. Hierarchy:

- Page title: `text-2xl font-semibold tracking-tight` (marketing hero may
  go larger).
- Card/section title: `text-lg font-semibold`.
- Body: `text-sm`; metadata: `text-xs text-muted-foreground`.

## Shape, depth, spacing

- Radius: `rounded-md` controls · `rounded-lg` inner panels · `rounded-xl`
  cards · `rounded-full` pills/badges. Nothing else.
- Shadows: `shadow-sm` on cards only; buttons stay flat.
- Borders: 1px `border-border`. Headers/footers are solid teal — no
  translucency, no backdrop blur, no glassmorphism.
- Keep layouts dense and mobile-first; don't add empty landing-page air.

## Component rules

- **Buttons**: default = orange/ink; secondary = teal/near-white; outline =
  `border-input bg-card` + sage hover; ghost = sage hover. All have
  `hover:` and `active:` states plus the orange focus ring.
- **Selected vs. action**: selection is TEAL (solid `bg-secondary`), action
  is ORANGE. Never use orange tints for selected pills/tabs.
- **Live indicators**: always the `live` token, never `success` green.
- **Nav**: `bg-secondary text-secondary-foreground`; links
  `text-secondary-foreground/80 hover:text-primary`.
- **Map**: center marker = teal dot w/ sand stroke; vendor markers =
  orange circles w/ ink stroke; selected marker = larger + teal stroke.
- **QR backing** in MFA enrollment stays `bg-white` on purpose (scanner
  contrast).

## Accessibility rules

- WCAG AA minimum everywhere. The pre-darkened `live`/`brand`/
  `muted-foreground` tokens exist precisely so small text passes on sand;
  don't substitute the raw brand hexes for text.
- No white normal-sized text on `#F67E04`.
- Keyboard focus must stay visible: `focus-visible:ring-2 ring-ring
ring-offset-2` on all interactive elements.
- Icons that carry no information are `aria-hidden`.

## Common mistakes to avoid

- Hardcoding hexes or Tailwind palette colors (`bg-green-500`) in
  components — use tokens.
- Using orange for selected states (selection is teal).
- Using green for live states (live is orange; green is success).
- White text on orange.
- Reintroducing translucent/blurred headers.
- Adding gradients, glassmorphism, neon, decorative animation, or
  oversized rounded cards.
- Forgetting the dark palette: both modes are first-class
  (`prefers-color-scheme`), so check every change in both.
