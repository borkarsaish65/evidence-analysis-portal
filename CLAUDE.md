# Evidence Analysis Portal — Phase 1

## What This Application Does

The Evidence Analysis Portal is the web interface for reviewing, submitting, and monitoring AI-powered educational evidence analysis. Users — program managers and analysts at Indian government educational programs — upload CSV evidence files, run Gemini AI analysis, and download scored reports.

**Primary user flows:**
1. **Create & run an analysis** — 3-step wizard: Create metadata → Upload CSVs → Validate & Run
2. **Monitor execution progress** — real-time status polling on ExecutionDetail
3. **Download/view reports** — paginated report data + CSV download + geographic map
4. **Validate criteria ad-hoc** — test evidence URLs against criteria without a full execution

**Institutional aesthetic:** Government-style portal: `slate-800` header, `amber-500` identity stripe, formal typography, Shield icon identity.

---

## Architecture Overview

```
src/
├── App.jsx              ← Router shell + provider composition
├── main.jsx             ← ReactDOM.createRoot only
├── config/env.js        ← Typed env vars — ALL env access goes through here
├── context/
│   └── AuthContext.jsx  ← ONLY global state — user, login, logout, token refresh
├── services/
│   ├── api.js           ← Axios singleton + auth interceptors
│   ├── authStorage.js   ← localStorage / sessionStorage token management
│   └── executionService.js ← ALL API calls (execution, entity, config, report services)
├── lib/
│   ├── utils.js         ← cn() helper — Tailwind class merging
│   └── analysis.js      ← Status helpers + date formatting
├── components/
│   ├── Layout.jsx       ← App shell: fixed header + left sidebar + main
│   ├── PrivateRoute.jsx ← Auth guard with loading state
│   ├── ui/              ← ShadCN-style primitives (Button, Card, Input, Label, Alert)
│   ├── executions/      ← Execution-specific sub-components
│   └── reports/         ← Report visualization components
└── pages/               ← Route-level page components (one file per route)
```

### UI Library Stack

This codebase uses **two** UI systems — keep them isolated:

| System | Purpose | Location |
|--------|---------|---------|
| **ShadCN-style + Tailwind** | All new UI, forms, buttons, cards | `src/components/ui/` |
| **MUI DataGrid** | Complex data tables only | Direct import from `@mui/material` |
| **Lucide React** | All icons | Direct import |

**New components always use ShadCN-style + Tailwind.** Only use MUI for DataGrid tables.

---

## Routing Structure

```
/login                       ← Public (Login.jsx)
/* → PrivateRoute → Layout
  /                          ← Dashboard.jsx
  /executions                ← ExecutionList.jsx
  /executions/create         ← ExecutionCreate.jsx  (Wizard Step 1)
  /executions/create/upload  ← ExecutionUpload.jsx  (Wizard Step 2)
  /executions/create/validate ← ExecutionValidate.jsx (Wizard Step 3)
  /executions/:id            ← ExecutionDetail.jsx
  /reports                   ← ReportsList.jsx
  /reports/:id               ← ReportView.jsx
  /validate-criteria         ← InteractiveTesting.jsx
```

Wizard steps share a URL namespace under `/executions/create/`. Execution ID is passed via `?executionId=<uuid>` query param across wizard steps.

---

## State Management

### Global State: AuthContext only

`AuthContext` owns:
- `user` — UserResponse from `/auth/me`
- `loading` — initial session hydration
- `isAuthenticated` — derived bool
- `login()`, `logout()`

Access via `useAuth()` hook from any component.

### Local State: useState per page

All data (executions, states, districts, filters, pagination) lives in page-level `useState`. There is no shared query cache.

### No React Query / No Zustand

This codebase does NOT use React Query or Zustand. All API calls use manual `useEffect` + `useState` patterns. When adding new data fetching, follow the existing pattern.

---

## API Layer Rules

### All API calls go through `executionService.js`

```js
import { executionService, entityService, configService, reportService } from '../services/executionService';
```

Never call `apiClient` directly from a page/component. Add new API methods to the relevant service object in `executionService.js`.

### Error handling pattern

```js
const [error, setError] = useState('');
try {
  const data = await executionService.getExecution(id);
  // use data
} catch (err) {
  setError(getApiErrorMessage(err, 'Unable to load execution. Please try again.'));
}
```

Use `getApiErrorMessage(err, fallback)` from `executionService.js` for all error messages.

### Cloud upload uses native fetch, not axios

Signed URL PUT uploads use `fetch()` — not `apiClient`. This is intentional because cloud storage CORS headers differ from the API server. The `uploadFileToSignedUrl()` function in `executionService.js` handles this.

---

## Styling Rules

### Tailwind-first, CSS variables for theming

```css
/* index.css defines these — never change them without updating tailwind.config.js */
--primary: 221.2 83.2% 53.3%;     /* blue-600 equivalent */
--secondary: 210 40% 96.1%;
--destructive: 0 84.2% 60.2%;
--muted: 210 40% 96.1%;
```

### `cn()` for conditional classes

```jsx
// ALWAYS use cn() from lib/utils.js for className composition
import { cn } from '../../lib/utils';

<button className={cn(
  'base-classes here',
  isActive && 'active-classes',
  error && 'error-classes'
)} />
```

### No inline `style={}` for layout

Use Tailwind classes. Only use `style={{}}` for values that cannot be expressed in Tailwind (e.g. dynamic widths from data).

### Responsive breakpoints

| Breakpoint | When | Pattern |
|-----------|------|---------|
| (base) | mobile < 640px | Mobile-first default |
| `sm:` | ≥ 640px | Tablet / small desktop |
| `lg:` | ≥ 1024px | Large desktop content |
| `2xl:` | ≥ 1400px | Container max-width cap |

Sidebar: hidden on mobile (overlay on toggle), persistent on `sm:`.

### Status badge pattern (use this everywhere)

```jsx
const { label, badgeClass, dotClass } = getAnalysisStatusMeta(execution.status);

<span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', badgeClass)}>
  <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
  {label}
</span>
```

---

## Environment Variables

All env access goes through `src/config/env.js`. Never call `import.meta.env.X` directly in components.

```js
import { ENV } from '../config/env';
// ENV.API_BASE_URL, ENV.AUTH_TOKEN_STORAGE_KEY, ENV.DEFAULT_CSV_TYPE_ID, etc.
```

Adding a new env var:
1. Add to `.env.example` with `APPLICATION_` prefix
2. Add to `src/config/env.js` `ENV` object with validation
3. Use `ENV.MY_VAR` in code

Vite `envPrefix: ['APPLICATION_', 'API_']` — only these prefixes are exposed to the browser.

---

## Component Design Standards

### Page components (pages/)

- Own all local state for that route
- Call service methods directly in `useEffect`
- Pass data down to sub-components via props
- Handle all loading/error/empty states

### UI components (components/ui/)

- Pure presentational — no API calls, no context access
- Accept className prop and spread via `cn()`
- Use `forwardRef` where DOM access needed
- CVA (`class-variance-authority`) for variants

### Feature components (components/executions/, components/reports/)

- Can use `useAuth()` for user info
- No API calls — receive data via props
- Own only display-level state (open/closed, hover, etc.)

---

## AI Behaviour Rules

When generating or modifying code in this portal:

1. **Follow the existing pattern for data fetching.** New pages use `useState` + `useEffect`. Do not introduce React Query without explicit instruction.

2. **All API methods go in `executionService.js`.** Never import `apiClient` directly in a page or component.

3. **Use `cn()` for all className composition.** Never concatenate class strings manually.

4. **Use only ShadCN-style components for new UI.** Do not add new MUI components — that's only for the DataGrid.

5. **Env vars via `ENV` object only.** Never `import.meta.env.X` in components.

6. **Preserve the government aesthetic.** `slate-800` header with `amber-500` accent stripe. Do not change the brand identity.

7. **Follow the status badge pattern** from `lib/analysis.js` for any new status display.

8. **No TypeScript.** This is a JSX codebase. Do not generate `.tsx` files. Type annotations go in JSDoc comments if needed.

9. **Error messages use `getApiErrorMessage()`.** Never `error.message` directly in a component.

10. **Responsive-first.** Every new UI must work on mobile (base) and desktop (`sm:`, `lg:`). Test sidebar collapse behavior.

---

## Common Mistakes to Avoid

### API
- ❌ `import apiClient from '../services/api'` in a page — use executionService
- ❌ `catch (err) { setError(err.message) }` — use `getApiErrorMessage(err, fallback)`
- ❌ `import.meta.env.VITE_API_URL` — env prefix is `APPLICATION_`, not `VITE_`

### Styling
- ❌ `className={isActive ? 'a b' : 'c d'}` — use `cn('base', isActive && 'a b', !isActive && 'c d')`
- ❌ Adding new MUI components for anything other than DataGrid
- ❌ Hardcoding colors like `text-blue-700` where `text-primary` (CSS var) should be used
- ❌ `standard-report.css` pattern — new styles use Tailwind in JSX

### State
- ❌ Accessing `localStorage` directly in a component — use `authStorage.js` helpers
- ❌ `useContext(AuthContext)` directly — use `useAuth()` hook
- ❌ Sharing state between pages via URL params beyond the wizard pattern (use `?executionId=`)

### Architecture
- ❌ Business logic inside JSX return — extract to component body or helper functions
- ❌ `useEffect` with `async` directly — wrap in `const fetchData = async () => {...}; void fetchData()`
- ❌ Multiple `useEffect` that could be combined — keep one per data dependency

### Accessibility
- ❌ `<div onClick={...}>` for clickable elements — use `<button type="button">`
- ❌ Icons without `aria-label` on standalone icon buttons
- ❌ Form inputs without associated `<Label>` from `components/ui/label.jsx`
