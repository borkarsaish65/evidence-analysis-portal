# Skill: Add New Page

Add a new authenticated route and page component to the Evidence Analysis Portal. Every page in this codebase follows the same structural pattern — do not deviate.

## Step 1: Register Route in App.jsx

Routes live in `src/App.jsx` inside the `<Routes>` tree, under the `PrivateRoute` wrapper:

```jsx
// Inside <Route element={<PrivateRoute />}> → <Route element={<Layout />}>
<Route path="/my-feature" element={<MyFeaturePage />} />

// With URL params:
<Route path="/my-feature/:id" element={<MyFeatureDetail />} />
```

Add the corresponding import at the top:
```jsx
import MyFeaturePage from './pages/MyFeaturePage';
```

Public routes (no auth) go outside `PrivateRoute`, alongside `<Route path="/login">`.

## Step 2: Create the Page Component

Template for `src/pages/MyFeaturePage.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { myService, getApiErrorMessage } from '../services/executionService';
import { cn } from '../lib/utils';

export default function MyFeaturePage() {
  const navigate = useNavigate();

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');
        const result = await myService.getItems();
        setData(result);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Unable to load. Please try again.'));
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, []);

  // Full-page loading (show before any content)
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Page Title</h1>
        <p className="text-sm text-slate-600">Optional subtitle or description</p>
      </div>

      {/* Error banner — shown above content */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Empty state */}
      {data.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No items found.
        </div>
      )}

      {/* Data content */}
      {data.length > 0 && (
        <Card className="border-slate-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-base text-slate-800">Section Title</CardTitle>
          </CardHeader>
          <CardContent>
            {/* render data here */}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
```

## Step 3: Add Service Method to executionService.js

All API methods go in `src/services/executionService.js`. Add to the appropriate service object:

```js
// For execution-domain endpoints:
export const executionService = {
  // ... existing methods ...

  async getMyItems() {
    const response = await apiClient.get('/my-endpoint/');
    return response.data;
  },
};

// For a new domain, add a new exported object:
export const myService = {
  async getItems() {
    const response = await apiClient.get('/my-endpoint/');
    return response.data;  // direct response (execution-style)
  },

  async getItem(id) {
    const response = await apiClient.get(`/my-endpoint/${id}`);
    return response.data;
  },

  async createItem(payload) {
    const response = await apiClient.post('/my-endpoint/', payload);
    return response.data;
  },
};
```

For StandardAPIResponse envelope (entity/config endpoints):
```js
async listItems() {
  const response = await apiClient.get('/my-endpoint/list');
  // response.data = { success: true, data: [...], meta: { count: n } }
  return response.data.data;  // unwrap the envelope
},
```

## Step 4: Add Sidebar Navigation (if user-visible)

In `src/components/Layout.jsx`, add to the nav items array:

```jsx
import { SomeIcon } from 'lucide-react';

// In the navigation items (find the existing array):
{ to: '/my-feature', icon: <SomeIcon className="h-4 w-4" />, label: 'My Feature' }
```

See `context/design-system.md` for the icon map — pick the closest matching icon.

## Handling URL Params

```jsx
import { useParams, useSearchParams } from 'react-router-dom';

// Route: /executions/:id
const { id } = useParams();

// Query params (wizard pattern): /executions/create/upload?executionId=<uuid>
const [searchParams] = useSearchParams();
const executionId = searchParams.get('executionId');
```

## Multiple Data Dependencies

When a page needs multiple independent data sources — fetch them concurrently:

```jsx
useEffect(() => {
  const fetchAll = async () => {
    try {
      setLoading(true);
      const [items, states] = await Promise.all([
        executionService.getExecutions(),
        entityService.getStates(),
      ]);
      setItems(items);
      setStates(states);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load. Please try again.'));
    } finally {
      setLoading(false);
    }
  };
  void fetchAll();
}, []);
```

When the second fetch depends on the first result — use separate useEffects:

```jsx
// Runs once on mount
useEffect(() => {
  const fetchItems = async () => { /* ... */ };
  void fetchItems();
}, []);

// Runs whenever selectedStateId changes
useEffect(() => {
  if (!selectedStateId) return;
  const fetchDistricts = async () => { /* ... */ };
  void fetchDistricts();
}, [selectedStateId]);
```

## Mutation (POST / PATCH / DELETE) Pattern

```jsx
const [submitting, setSubmitting] = useState(false);
const [successMessage, setSuccessMessage] = useState('');

const handleSubmit = async (e) => {
  e.preventDefault();
  try {
    setSubmitting(true);
    setError('');
    const result = await executionService.createExecution({ name, stateId });
    setSuccessMessage('Analysis created successfully.');
    navigate(`/executions/${result.id}`);
  } catch (err) {
    setError(getApiErrorMessage(err, 'Unable to create. Please try again.'));
  } finally {
    setSubmitting(false);
  }
};
```

## Anti-patterns

❌ `import apiClient from '../services/api'` — use service objects
❌ `async` directly in `useEffect(() => async () => {...})` — wrap in inner function
❌ `catch (err) { setError(err.message) }` — use `getApiErrorMessage(err, fallback)`
❌ `import.meta.env.X` — use `ENV` from `src/config/env.js`
❌ `localStorage.getItem('token')` — use `authStorage.js` helpers
❌ Business logic inline in JSX return — extract to component body
❌ Multiple useEffects that share the same dependency — combine into one
❌ `async useEffect(async () => {...})` — not valid; use the inner function pattern
