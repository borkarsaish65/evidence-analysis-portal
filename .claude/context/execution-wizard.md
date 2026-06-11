# Execution Creation Wizard Context

## Overview

Creating an execution is a 3-step wizard. Each step is a separate route with its own page component. Execution ID is passed via `?executionId=` query param.

## Step Flow

```
Step 1: /executions/create               ExecutionCreate.jsx
  → Form: name, state, district, program
  → Creates execution via API on submit
  → On success: navigate('/executions/create/upload?executionId=<uuid>')

Step 2: /executions/create/upload        ExecutionUpload.jsx
  → File drop zones: input CSV + criteria CSV
  → Gets signed upload URLs from backend
  → Uploads directly to cloud storage via fetch()
  → Marks upload complete via API
  → On success: navigate('/executions/create/validate?executionId=<uuid>')

Step 3: /executions/create/validate      ExecutionValidate.jsx
  → Validates CSV structure against source type config
  → Shows validation results
  → User clicks "Start Analysis"
  → On success: navigate(`/executions/${id}`) (execution detail page)
```

## State Between Steps

There is NO shared state between wizard steps — state lives entirely in URL query params:
- `?executionId=<uuid>` — the execution ID created in Step 1

Each step page:
1. Reads `executionId` from `useSearchParams()`
2. Fetches execution data if needed to pre-fill (edit mode)
3. Saves its step's result to the backend

## Step 1 (ExecutionCreate) Details

**Edit mode:** If `?executionId=` param is present on mount, the page loads the existing execution and pre-fills the form (edit mode).

**API calls:**
- Load states: `entityService.getStates()`
- Load districts: `entityService.getDistricts(stateId)` (triggered by state selection)
- Load CSV source types: `configService.listProjectCsvSourceTypes()`
- Create execution: `executionService.createExecution({...})` — this is the full 3-step upload internally
- Update execution: `executionService.updateExecution(id, patch)` (edit mode)

**Form fields:**
- `name` — required text
- `stateId` / `stateName` — from entity service
- `districtId` / `districtName` — from entity service, dependent on state
- `csv_type_id` — from configService (defaults to `ENV.DEFAULT_CSV_TYPE_ID = 'project_report'`)

## Step 2 (ExecutionUpload) Details

**Two-file upload with signed URLs:**
```
1. executionService.getFileUploadUrl(executionId, fileType)
   → POST /executions/{id}/files/{type}/upload-url
   → Returns { upload_url, method, headers }

2. fetch(upload_url, { method: 'PUT', body: fileArrayBuffer })
   → Direct PUT to cloud storage (not through API proxy)

3. executionService.completeFileUpload(executionId, fileType, { file_name, file_size })
   → POST /executions/{id}/files/{type}/complete
```

File types: `"input"` (evidence CSV) and `"questions"` (criteria CSV)

**Sample CSV download:** Users can download sample files to understand the format. Uses `configService.getSampleCsvUrl(typeId, fileType)`.

**Validation before upload:**
- File must be `.csv` extension
- Max size: `ENV.MAX_FILE_SIZE_MB` (from env, typically 100MB)
- Content type: `text/csv`, `application/csv`, `text/plain` acceptable

## Step 3 (ExecutionValidate) Details

**API calls:**
- Validate: `executionService.validateExecutionFiles(executionId)` → validation results
- Start: `executionService.startExecution(executionId)` → status = "in_progress"
- Alternative direct flow: `executionService.createExecution({...})` handles steps 2+3 together

**Validation response:**
```js
{
  is_valid: boolean,
  input_validation: { is_valid, missing_columns, row_count },
  questions_validation: { is_valid, missing_columns, row_count },
  cross_validation: { is_valid, task_mismatch_count }
}
```

## Stepper Component

`ExecutionWizardStepper` in `src/components/executions/ExecutionWizardStepper.jsx`:

```jsx
<ExecutionWizardStepper activeStep={2} />  // 1, 2, or 3
```

Shows: Create → Upload → Validate & Run
- Active step: filled blue
- Completed steps: outlined blue
- Future steps: locked icon

## Navigation Rules

- Forward navigation only via explicit API success
- Back navigation: browser back button or explicit "Edit" links
- Direct URL access: each step can recover if executionId is in URL
- After completing Step 3: redirect to `/executions/${id}` detail page
