# Design System Reference

Full CSS variable values, component internals, icon catalog, and implementation details. For usage patterns and enforcement rules, see `agents/ui-engineer.md` and `CLAUDE.md`. This file contains the exact values you need when building or auditing components.

## CSS Custom Properties (src/index.css)

Light mode only — no dark mode in this application.

```css
--background:             0 0% 100%           /* white */
--foreground:             222.2 84% 4.9%      /* near-black */
--card:                   0 0% 100%           /* white */
--card-foreground:        222.2 84% 4.9%
--popover:                0 0% 100%
--popover-foreground:     222.2 84% 4.9%
--primary:                221.2 83.2% 53.3%  /* blue-600 */
--primary-foreground:     210 40% 98%         /* near-white */
--secondary:              210 40% 96.1%       /* slate-100 */
--secondary-foreground:   222.2 47.4% 11.2%
--muted:                  210 40% 96.1%       /* slate-100 */
--muted-foreground:       215.4 16.3% 46.9%  /* slate-500 */
--accent:                 210 40% 96.1%
--accent-foreground:      222.2 47.4% 11.2%
--destructive:            0 84.2% 60.2%       /* rose-600 */
--destructive-foreground: 210 40% 98%
--border:                 214.3 31.8% 91.4%  /* slate-200 */
--input:                  214.3 31.8% 91.4%
--ring:                   221.2 83.2% 53.3%  /* blue-600 */
--radius:                 0.5rem
```

## Button Component Internals (src/components/ui/button.jsx)

Built with CVA (`class-variance-authority`). The base class applied to all buttons:

```
inline-flex items-center justify-center rounded-md text-sm font-medium
ring-offset-background transition-colors
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
disabled:pointer-events-none disabled:opacity-50
```

Variant → size matrix:

```js
variants: {
  variant: {
    default:     'bg-primary text-primary-foreground hover:bg-primary/90',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    outline:     'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
    secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost:       'hover:bg-accent hover:text-accent-foreground',
    link:        'text-primary underline-offset-4 hover:underline',
  },
  size: {
    default: 'h-10 px-4 py-2',
    sm:      'h-9 rounded-md px-3',
    lg:      'h-11 rounded-md px-8',
    icon:    'h-10 w-10',
  },
},
defaultVariants: { variant: 'default', size: 'default' }
```

## Layout Measurements

```
Header:
  height:       h-16 (64px)
  position:     fixed, z-40
  background:   bg-slate-800
  brand stripe: border-b-4 border-amber-500
  contains:     hamburger (mobile), Shield logo + title, user menu

Sidebar:
  width:        w-72 (288px)
  sm+:          sticky, always visible (hidden sm:block)
  mobile:       fixed left-0 top-16 z-40 with backdrop overlay
  content:      nav items with active state

Main Content:
  top offset:   pt-16 (accounts for fixed header)
  left offset:  sm:pl-72 (sidebar width)
  padding:      px-4 py-6 sm:px-6 lg:px-8
  max-width:    max-w-7xl mx-auto (1280px)
```

## Icon System (lucide-react)

All icons from `lucide-react`. Never import from other icon libraries.

### Icon Size Guide

| Class | Size | Usage |
|-------|------|-------|
| `h-3 w-3` | 12px | Tiny inline (rare) |
| `h-3.5 w-3.5` | 14px | Small table row actions |
| `h-4 w-4` | 16px | Default — most icons |
| `h-5 w-5` | 20px | Prominent standalone icons |
| `h-6 w-6` | 24px | Large nav, hero |

### Application Icon Map

| Icon | Used For |
|------|---------|
| `Shield` | Brand / auth identity (login header, brand mark) |
| `LayoutDashboard` | Dashboard nav item |
| `ListChecks` | Analyses (executions) nav item |
| `FileText` | Reports nav item |
| `ClipboardCheck` | Validate Criteria nav item |
| `Loader2` | Loading spinner — ALWAYS with `animate-spin` |
| `AlertCircle` | Error alert icon |
| `CheckCircle2` | Success alert icon |
| `RefreshCw` | Refresh action button |
| `Download` | Download file action |
| `Eye` | View/preview action |
| `Pencil` | Edit action |
| `RotateCcw` | Rerun execution action |
| `Menu` / `X` | Mobile nav open / close toggle |
| `ChevronDown` | Dropdown / select indicator |
| `Upload` | File upload zone icon |
| `FileUp` | File upload action |
| `XCircle` | Error / clear action |
| `Lock` | Locked/inactive wizard step |
| `CheckCircle` | Completed wizard step |

## Animation Config (tailwind.config.js)

```js
keyframes: {
  'accordion-down': {
    from: { height: 0 },
    to: { height: 'var(--radix-accordion-content-height)' }
  },
  'accordion-up': {
    from: { height: 'var(--radix-accordion-content-height)' },
    to: { height: 0 }
  },
},
animation: {
  'accordion-down': 'accordion-down 0.2s ease-out',
  'accordion-up': 'accordion-up 0.2s ease-out',
},
```

Built-in animations used: `animate-spin` (Loader2), `animate-pulse` (skeletons).

Keep animations subtle — this is a data-heavy government portal, not a consumer app.

## Status System Internals (src/lib/analysis.js)

### getAnalysisStatusMeta(status) return values

| status | label | badgeClass | dotClass |
|--------|-------|------------|----------|
| `completed` | Completed | `border-emerald-200 bg-emerald-50 text-emerald-700` | `bg-emerald-500` |
| `failed` | Failed | `border-rose-200 bg-rose-50 text-rose-700` | `bg-rose-500` |
| `in_progress` | In Progress | `border-amber-200 bg-amber-50 text-amber-700` | `bg-amber-500` |
| `running` | In Progress | (same as in_progress) | |
| `queued` | Queued | `border-blue-200 bg-blue-50 text-blue-700` | `bg-blue-500` |
| `draft` | Draft | `border-slate-200 bg-slate-50 text-slate-700` | `bg-slate-400` |
| `validated` | Ready | `border-slate-200 bg-slate-50 text-slate-700` | `bg-slate-400` |
| `notstarted` | Not Started | `border-slate-200 bg-slate-50 text-slate-700` | `bg-slate-400` |

### getAnalysisStatusGroup(status) groups

```
'completed'   → status === 'completed'
'failed'      → status === 'failed'
'draft'       → status in ['draft', 'validated', 'notstarted']
'in_progress' → all others (queued, in_progress, running) — the default
```

Use `getAnalysisStatusGroup()` for branching logic (e.g., show/hide re-run button).
Use `getAnalysisStatusMeta()` for all visual display.

## Date Formatting (src/lib/analysis.js)

```js
formatDateTime(isoString) → "15 May 2026, 02:30 pm"
```

- Locale: `en-IN`
- Format options: `{ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }`
- `null` input → `"-"`
- Invalid string → `"-"` (silently)

Always use this function. Never use `new Date(str).toLocaleDateString()` inline in components.

## Card Component Sub-parts (src/components/ui/card.jsx)

```jsx
Card             // outer container: rounded-lg border bg-card text-card-foreground shadow-sm
CardHeader       // padding: flex flex-col space-y-1.5 p-6
CardTitle        // text-2xl font-semibold leading-none tracking-tight
CardDescription  // text-sm text-muted-foreground
CardContent      // padding: p-6 pt-0
CardFooter       // flex items-center p-6 pt-0
```

Common overrides:
```jsx
<Card className="border-slate-200">                    // standard page card
<CardHeader className="pb-4">                          // tighter header
<CardTitle className="text-base text-slate-800">       // smaller card title
<CardContent className="p-4">                          // tighter info/stat card
```

## Responsive Breakpoints

| Token | Width | Layout change |
|-------|-------|---------------|
| (base) | 0px | Mobile: no sidebar, stacked layout |
| `sm:` | 640px | Sidebar appears, tablet layout |
| `lg:` | 1024px | Full desktop content columns |
| `2xl:` | 1400px | Container hits max-width cap |

Container: `max-w-7xl` = 1280px. Content stops growing at 2xl.
