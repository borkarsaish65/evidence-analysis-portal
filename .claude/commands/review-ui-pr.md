# Command: Review UI / Frontend PR

**Usage:** `/review-ui-pr` — reviews the current diff for frontend engineering compliance.

Perform a structured PR review of any frontend changes to the Evidence Analysis Portal. Check every dimension below. A failing check in "Must Fix" blocks merge.

## Review Dimensions

### 1. API Layer Compliance

- [ ] No `import apiClient from '../services/api'` in pages or components
- [ ] All API calls go through service objects exported from `executionService.js`
- [ ] Error handling uses `getApiErrorMessage(err, fallback)` — not `err.message` or bare `String(err)`
- [ ] New API methods added to the correct service object in `executionService.js`, not inline
- [ ] Signed URL file uploads use `fetch()` not `apiClient` (cloud CORS — critical)

### 2. State and Data Fetching

- [ ] Data fetching uses `useState + useEffect` — not React Query, SWR, Zustand, or other libraries
- [ ] `async` wrapped in inner function: `const fetchData = async () => {...}; void fetchData()`
- [ ] No `localStorage` / `sessionStorage` direct access — use `authStorage.js` helpers
- [ ] `useAuth()` hook used — not `useContext(AuthContext)` directly
- [ ] No new `<Context.Provider>` added without architectural discussion

### 3. Environment Variables

- [ ] `ENV.X` from `src/config/env.js` — not raw `import.meta.env.X` anywhere
- [ ] New env vars added to both `.env.example` AND `src/config/env.js` with validation

### 4. Styling

- [ ] `cn()` from `lib/utils.js` used for all conditional className — no string concatenation
- [ ] Semantic color tokens used (`text-muted-foreground`, `bg-destructive`) not raw palette where appropriate
- [ ] Brand identity preserved: `bg-slate-800` header, `border-amber-500` brand stripe — never changed
- [ ] No `style={{}}` for layout (only acceptable for values impossible to express in Tailwind)
- [ ] No new CSS files added — styles belong in JSX via Tailwind classes

### 5. Component Library

- [ ] New UI uses ShadCN-style components from `src/components/ui/`
- [ ] No new MUI components outside DataGrid context — check all `@mui/material` imports
- [ ] All icons from `lucide-react` — no other icon libraries added
- [ ] No new UI library dependencies added to `package.json`

### 6. Status Display

- [ ] Execution status badges use `getAnalysisStatusMeta()` from `lib/analysis.js`
- [ ] No hardcoded status colors (`text-green-600`, `bg-red-100`, etc.) for execution state
- [ ] Status branching logic uses `getAnalysisStatusGroup()` — not raw string comparisons
- [ ] `formatDateTime()` from `lib/analysis.js` used for all datetime display

### 7. Accessibility

- [ ] Form inputs have `<Label htmlFor="field-id">` with matching `id` attribute on `<Input>`
- [ ] Icon-only buttons have descriptive `aria-label` attribute
- [ ] Clickable elements use `<button type="button">` or `<Button>` — not `<div onClick>`
- [ ] Empty states rendered (not conditionally hidden) — content must exist in DOM
- [ ] `disabled` attribute set on buttons during async operations (`disabled={loading}`)

### 8. Language — JSX Only

- [ ] No `.tsx` files created
- [ ] No TypeScript syntax (`interface`, `type Foo =`, `: string`, `as Type`)
- [ ] JSDoc used if type documentation is needed: `/** @param {string} id */`

### 9. Responsive

- [ ] New UI is functional at mobile base (375px) — no overflow, no broken layout
- [ ] Responsive prefixes (`sm:`, `lg:`) used appropriately for layout changes
- [ ] No hardcoded pixel widths that break at narrow viewports

### 10. Architecture (escalate if yes)

- [ ] Does this add React Query, SWR, Zustand, or any state library? → **Escalate**
- [ ] Does this add TypeScript to any file? → **Escalate**
- [ ] Does this modify `AuthContext.jsx` or the token refresh logic? → **Escalate**
- [ ] Does this add a new `Context.Provider` beyond AuthContext? → **Escalate**

## Review Output Format

```
## PR Review: <title or brief diff description>

### ✅ Passes
- API layer: service objects used, getApiErrorMessage applied
- State: useState+useEffect, no library imports
- Styling: cn() used, semantic tokens, no raw palette violations

### ⚠️ Concerns (non-blocking — should fix before next PR)
- pages/MyPage.jsx:58 — consider combining two useEffects that share the same dependency

### ❌ Must Fix (blocks merge)
- pages/MyPage.jsx:12 — imports apiClient directly; must use service object
- components/StatusCell.jsx:34 — hardcodes bg-green-100 for status; use getAnalysisStatusMeta()
- MyForm.jsx:22 — Input id="name" has no associated <Label htmlFor="name">

### Architectural Flags
(none) or: Adding X requires discussion with frontend-architect before merge

### Summary
<2-3 sentences: overall code quality, pattern compliance, readiness to merge>
```
