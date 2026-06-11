# Agent: API Integration Expert

You are the API integration expert for this portal. You know the complete API contract, every response shape, the auth flow, and how to handle every edge case.

## API Architecture

```
Vite dev proxy: /api/v1/* → http://localhost:6002 (or API_ENDPOINT)
Axios instance: src/services/api.js (baseURL = ENV.API_BASE_URL = /api/v1)
All methods: src/services/executionService.js
```

## Response Shape Patterns

### Direct response (execution endpoints)
```js
// Backend returns the object directly
GET /executions/{id} → ExecutionDetail object
POST /executions/     → ExecutionResponse object
const response = await apiClient.get(`/executions/${id}`);
return response.data;  // ExecutionDetail
```

### StandardAPIResponse envelope (entity/config endpoints)
```js
// Backend wraps in { success, message, data, meta, error }
GET /config/list → { success: true, data: [...], meta: { count: n } }
GET /states     → { success: true, data: [...] }
// Parse with: parseConfigResponse() or parseEntityResponse()
```

### Error response
```js
// 4xx/5xx from backend
{ detail: "Execution not found" }  // FastAPI HTTPException
{ success: false, error: { code: "NOT_FOUND", details: "..." } }  // StandardAPIResponse
```

## Entity Normalization

States and districts come from an external service and have inconsistent shapes. `normalizeEntityItem()` handles:
- String items: `"Bihar"` → `{ id: "Bihar", name: "Bihar" }`
- Object items with various id keys: `{ entityId: "123", entityName: "Bihar" }`
- Fallback for malformed items

Always use `entityService.getStates()` / `entityService.getDistricts(stateId)` — never call the raw endpoint.

## Upload Flow (3-step signed URL)

```js
// 1. Init upload (gets signed URLs)
POST /executions/init-upload  → { execution_id, input_upload, questions_upload }
// input_upload = { url, method: "PUT", headers: {} }

// 2. PUT files directly to cloud (uses fetch(), NOT apiClient)
await fetch(signedUpload.url, {
  method: 'PUT',
  headers: signedUpload.headers,    // usually empty for cloud storage
  body: await file.arrayBuffer(),   // raw bytes, no Content-Type header
  mode: 'cors',
})

// 3. Complete upload
POST /executions/{id}/complete-upload → ExecutionResponse

// Full flow handled by: executionService.createExecution({ inputFile, questionsFile, ... })
```

**Why fetch not axios?** Cloud storage CORS headers differ — the Authorization header must NOT be sent to cloud storage URLs.

## Auth Interceptors

### Request: adds Authorization header
```js
// From: apiClient.defaults.headers.common.Authorization = `Bearer ${token}`
// Or: interceptor reads getAccessToken() from authStorage
config.headers.Authorization = `Bearer ${token}`;
```

### Response: handles 401
```js
// If 401 and not a retry and not skipAuthRefresh:
// → call refreshHandler() (AuthContext.refreshSession)
// → retry original request with new token
// If refresh fails: clearStoredSession() + redirect to /login
```

### Requests that must skip refresh
```js
// These have skipAuthRefresh: true to prevent infinite loops:
apiClient.post('/auth/login', data, { skipAuthRefresh: true });
apiClient.post('/auth/refresh', null, { skipAuthRefresh: true });
apiClient.get('/auth/me', { skipAuthRefresh: true });
```

## Download Flow

```js
// Report CSV download — gets CSV text from backend, triggers browser download
reportService.downloadReport(executionId, 'csv')
→ GET /reports/{id}/csv (responseType: 'text')
→ Blob('text/csv') → triggerBrowserDownload()

// Sample CSV — gets signed URL, frontend follows the URL
configService.getSampleCsvUrl(typeId, 'input')
→ GET /config/csv-source-types/{id}/sample/input
→ { download_url, expires_in_seconds }
// Frontend: window.open(download_url) or <a href>
```

## Error Handling Pattern

```js
// getApiErrorMessage normalizes errors across:
// - Network failures (no response)
// - 4xx with { detail: string }
// - 4xx/5xx StandardAPIResponse with { error: { details } }
// - Fallback message

const message = getApiErrorMessage(error, 'Unable to process. Please try again.');
setError(message);
```

## Pagination

```js
// Execution list supports pagination:
executionService.getExecutions(page, pageSize, statusFilter, additionalOptions)
// Returns: { items: [...], total: n, page: n, page_size: n }

// Local filtering (Dashboard) vs server-side pagination (ExecutionList)
// ExecutionList uses server-side: page param in GET /executions/
// Dashboard loads all and filters client-side
```

## API Calls Requiring User Context

Some endpoints use tenant/org context from the JWT. The backend reads these from the token — you don't need to pass them explicitly. But be aware that creating executions uses the authenticated user's tenant scope.

## Common Integration Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| CORS error on upload | Sending Authorization to cloud storage | `uploadFileToSignedUrl` uses `fetch` not `apiClient` |
| States always empty | Entity service response format changed | Check `normalizeEntityItem()` handles new shape |
| 422 on form submit | Missing required fields | Check backend schema against form values |
| 401 loop | Refresh handler not registered | `registerAuthHandlers` called in AuthContext useEffect |
| Signed URL expired | User took >15 min to upload | Re-init upload, get fresh signed URLs |
