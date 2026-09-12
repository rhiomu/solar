---
name: Helios Industrial Solar OS
colors:
  surface: '#0f131d'
  surface-dim: '#0f131d'
  surface-bright: '#353944'
  surface-container-lowest: '#0a0e18'
  surface-container-low: '#171b26'
  surface-container: '#1c1f2a'
  surface-container-high: '#262a35'
  surface-container-highest: '#313540'
  on-surface: '#dfe2f1'
  on-surface-variant: '#bcc9cd'
  inverse-surface: '#dfe2f1'
  inverse-on-surface: '#2c303b'
  outline: '#869397'
  outline-variant: '#3d494c'
  surface-tint: '#4cd7f6'
  primary: '#4cd7f6'
  on-primary: '#003640'
  primary-container: '#06b6d4'
  on-primary-container: '#00424f'
  inverse-primary: '#00687a'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#e79400'
  on-tertiary-container: '#563400'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#acedff'
  primary-fixed-dim: '#4cd7f6'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#004e5c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0f131d'
  on-background: '#dfe2f1'
  surface-variant: '#313540'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: 0em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  title-lg:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0.01em
  title-md:
    fontFamily: Space Grotesk
    fontSize: 15px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
  label-telemetry:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.03em
  label-md:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.06em
  label-sm:
    fontFamily: Space Grotesk
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-sm: 0.5rem
  gutter-lg: 1.5rem
  margin: 1.5rem
  margin-sm: 0.75rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system establishes a high-density, mission-critical command aesthetic for utility-scale solar telemetry, fleet monitoring, and automated field intervention. Built to operate in control rooms and field tablets under 24/7 watch, the visual direction synthesizes tactical sci-fi precision with industrial SCADA utility. 

The aesthetic fuses **Tactical Dark Glassmorphism** with **Technical Precision Brutalism**:
- **Environment:** Deep obsidian-navy substrates eliminate glare and optical fatigue in dim monitoring hubs.
- **Data Luminescence:** Functional neon indicators pop sharply against dark planes, treating light purely as informational state (nominal generation, critical soiling, thermal throttling).
- **Personality:** Authoritative, razor-sharp, systematic, and instantaneous. The operator must perceive zero latency and zero decorative noise.

## Colors

The color palette is engineered strictly around visual telemetry tiers, status signals, and operational thresholds:

- **Substrates & Containers:**
  - Base Obsidian Canvas: `#0b0f19` (lowest layer, screen backing)
  - Card & Panel Glass: `#111827` (elevated telemetry containers, semi-translucent)
  - Sub-surface & Inset: `#1e293b` (control wells, switch channels, active row states)
  - Grid & Structural Hairlines: `#1f293d` (ultra-crisp structural boundaries)

- **Telemetry & Functional Accents:**
  - **Telemetry Primary (Electric Cyan):** `#06b6d4` — Real-time megawatt output, active irradiance sweeps, GIS radar vectoring, and active interactive controls.
  - **Vector Blue:** `#3b82f6` — Inverter grid sync status, network telemetry, auxiliary diagnostic streams.
  - **Operational Nominal (Emerald Green):** `#10b981` — Clean panels, optimal generation efficiency, automated wash cycle completed, nominal string voltage.
  - **Cautionary Soiling (Amber / Golden):** `#f59e0b` — Moderate particulate buildup, irradiance attenuation warning, scheduled queue alert.
  - **Critical Urgent Action (Crimson):** `#ef4444` — Heavy soiling curtailment, ground fault, junction box thermal runaway, emergency wash deployment required.

Text colors adhere to strict luminance contrast against obsidian surfaces:
- Primary Display Data: `#f8fafc` (high-readability numeric telemetry)
- Secondary Metadata: `#94a3b8` (units, micro-labels, timestamps)
- Disabled/Muted Structural Guides: `#475569`

## Typography

Typography prioritizes instantaneous telemetry ingestion. `Space Grotesk` drives all display values, metrics, SCADA tags, and high-impact headers to provide a futuristic yet rigorously technical character. Tabular figures (`tnum`) must be enforced globally on `Space Grotesk` metrics to prevent visual jitter during live millisecond data streaming.

`Inter` governs all narrative data, diagnostic logs, alert descriptions, and complex parametric inputs, ensuring peak legibility at micro scales down to 10px. Uppercase styling with wide tracking (`0.06em` to `0.08em`) is reserved exclusively for system labels, operational status chips, and sensor coordinates.

## Layout & Spacing

The layout model is built on an uninterrupted, 12-column high-density fluid grid that dynamically maximizes screen real estate across widescreen control room monitors (1440px to 4K multi-head setups) and rugged field tablets.

- **Desktop & Command Consoles (1200px+):** Fixed full-height layout with a 12-column operational grid. Left-docked telemetry tree, center GIS radar/string array canvas, and right-docked alert/diagnostic sidebar. Columns use `1rem` gutters to pack dense data streams with minimal wasted distance.
- **Field Tablets (768px - 1199px):** 6-column adaptive layout. The center GIS map collapses to top-half priority, while telemetry gauges flow below in two-column split cards.
- **Mobile Handhelds (<768px):** Single-column stacked stream. Critical system statuses stay anchored in a sticky persistent top telemetry bar.

Margins and interior paddings favor tight, compact arrangements (`space-sm` to `space-md`) to ensure critical metrics remain "above the fold" without requiring physical scrolling during urgent events.

## Elevation & Depth

Visual hierarchy does not rely on traditional drop shadows; ambient blur is instead harnessed as a functional glowing beacon against the dark background.

- **Surface Layering:**
  - Base Floor: Flat `#0b0f19` canvas.
  - Telemetry Cards & Docks: Backdrop-filtered translucent glass with `background: rgba(17, 24, 39, 0.75)`, layered with a `backdrop-filter: blur(12px)`.
  - Floating Tooltips & Context Hubs: `rgba(30, 41, 59, 0.95)` with `backdrop-filter: blur(16px)`.

- **Border Architecture:**
  - Every card, pane, and separator relies on a razor-thin 1px border colored `#1f293d`. Hover and focus states escalate the border to the semantic state color (`#06b6d4`, `#10b981`, etc.) at 50% opacity.

- **Telemetry Luminescence:**
  - State indicators, toggle pips, and alarm cards emit subtle neon radiance to draw instant peripheral vision:
    - Nominal/Clean glow: `0 0 12px rgba(16, 185, 129, 0.35)`
    - Caution/Warning glow: `0 0 14px rgba(245, 158, 11, 0.40)`
    - Urgent Alarm glow: `0 0 20px rgba(239, 68, 68, 0.50)`
    - Telemetry/Radar active glow: `0 0 14px rgba(6, 182, 212, 0.40)`

## Shapes

The design system employs a disciplined, angular geometry (`roundedness: 1`). Radii are strictly constrained to 4px (`0.25rem`) for cards, data cells, badges, and controls, preserving an industrial hardware-instrument aesthetic rather than a consumer web app feel.

- **Panels, Gauges, & Modals:** 4px corners with 1px inset borders.
- **Status Indicator Badges & Pips:** Squircle tags (4px radius) or pure circles (100% border-radius) for live blinking radar/sensor dots.
- **Buttons & Input Fields:** 4px radius, maintaining consistent structural alignment with grid lines.

## Components

### Buttons & Telemetry Triggers
- **Primary Telemetry Action:** Bordered in `#06b6d4`, filled with `rgba(6, 182, 212, 0.15)`, text in `#06b6d4` (`Space Grotesk`, medium tracking). On hover, fill expands to `rgba(6, 182, 212, 0.28)` with a 10px cyan ambient bloom.
- **Emergency / Intervention Action (Wash Deployment / E-Stop):** Filled with `rgba(239, 68, 68, 0.20)`, border `#ef4444`, text `#f8fafc`. Emits continuous low-frequency crimson pulse during active critical states.
- **Ghost Utility Action:** Transparent backing, 1px `#1f293d` outline, text `#94a3b8`. Hover transitions text to `#f8fafc` and border to `#475569`.

### Chips & Glowing Status Indicators
- Status chips are uppercase micro-labels (`label-sm`) with a 1px border matching the status color and an integrated 6px circular LED pip.
- **Clean / Nominal:** Green border (`#10b981`), background `rgba(16, 185, 129, 0.10)`, static solid green LED.
- **Warning / Moderate Soiling:** Amber border (`#f59e0b`), background `rgba(245, 158, 11, 0.12)`, LED with slow breath animation (2s cycle).
- **Critical / Urgent Wash:** Crimson border (`#ef4444`), background `rgba(239, 68, 68, 0.18)`, LED with rapid strobe animation (0.75s cycle).

### Cards & Telemetry Containers
- Fabricated with dark glassmorphism: `background: rgba(17, 24, 39, 0.75)`, `border: 1px solid #1f293d`, `backdrop-filter: blur(12px)`.
- Features an optional micro-header rail displaying a technical section tag (e.g., `INVERTER_ARRAY_04 // SECTOR_B`) rendered in `label-sm` text color `#475569`.

### Input Fields & Parameter Controls
- Background `#0b0f19` inset with `border: 1px solid #1f293d`. 
- Active typing state introduces an intense electric cyan highlight: border changes to `#06b6d4`, accompanied by an inner glow `0 0 6px rgba(6, 182, 212, 0.25)`.
- Numerical fields automatically render in `Space Grotesk` monospace tabular figures.

### Checkboxes, Toggles, & Radio Swatches
- Checkboxes: 16x16px square, 2px radius, `#1e293b` background, `#1f293d` border. Checked state fills with `#06b6d4` with a black checkmark.
- Radio Swatches: Dual concentric rings; active state activates an inner glowing cyan dot.

### Specialized Solar SCADA Modules
- **String Soiling Heatmap Cell:** Micro tabular grid cells showing panel string degradation. Colored by dynamic gradient interpolation from emerald (`0% attenuation`), amber (`15-30% loss`), to crimson (`>30% critical wash needed`).
- **GIS Radar Array Map:** Dark vectorized map overlay (`#0b0f19`) featuring faint 64px cyan coordinate grid crosshairs, highlighting individual tracker row vectors with neon directional arrows.