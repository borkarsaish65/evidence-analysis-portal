import { useCallback, useState } from 'react';
import Papa from 'papaparse';
import { AlertCircle, FileUp } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import StandardReportRenderer from '../components/reports/StandardReportRenderer';

const REQUIRED_COLUMNS = [
  'UUID',
  'Declared State',
  'District',
  'Block',
  'School Name',
  'Tasks',
  'Project ID',
  'Project start date of the user',
  'Project completion date of the user',
  'Relevance Tag',
];

const ReportsList = () => {
  const [selectedFileName, setSelectedFileName] = useState('');
  const [parsedRows, setParsedRows] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [parseStatus, setParseStatus] = useState('');

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    setError('');
    setParsedRows(null);

    if (!file) {
      setSelectedFileName('');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setSelectedFileName(file.name);
      setError('Please upload a valid .csv file.');
      return;
    }

    setSelectedFileName(file.name);
    setLoading(true);
    setParseStatus('Reading file…');

    let csvText;
    try {
      csvText = await file.text();
    } catch {
      setError('Unable to read the selected file.');
      setLoading(false);
      return;
    }

    if (!csvText.trim()) {
      setError('Uploaded CSV is empty.');
      setLoading(false);
      return;
    }

    // Yield one frame so React can paint the "Reading file…" state before
    // the synchronous Papa.parse call occupies the main thread.
    setParseStatus('Parsing CSV…');
    await new Promise((resolve) => setTimeout(resolve, 30));

    let results;
    try {
      results = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      });
    } catch (parseError) {
      setError(parseError?.message || 'CSV parse failed.');
      setLoading(false);
      return;
    }

    if (results.errors?.length) {
      const firstFatal = results.errors.find((e) => e.type !== 'FieldMismatch');
      if (firstFatal) {
        setError(firstFatal.message || 'Invalid CSV format.');
        setLoading(false);
        return;
      }
    }

    // Normalize header names (trim + strip BOM on first column)
    const rawFields = results.meta?.fields || [];
    const headers = rawFields.map((field, i) => {
      const cleaned = String(field || '').trim();
      return i === 0 ? cleaned.replace(/^\uFEFF/, '') : cleaned;
    });

    const missingColumns = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
    if (missingColumns.length) {
      setError(`Missing required CSV columns: ${missingColumns.join(', ')}`);
      setLoading(false);
      return;
    }

    const rows = (results.data || []).filter((row) =>
      Object.values(row).some((v) => String(v || '').trim() !== '')
    );

    if (!rows.length) {
      setError('CSV contains no data rows.');
      setLoading(false);
      return;
    }

    // Re-key rows using the normalized headers so downstream code gets clean keys
    const normalizedRows = rows.map((row) => {
      const out = {};
      headers.forEach((header, i) => {
        out[header] = String(row[rawFields[i]] ?? '').trim();
      });
      return out;
    });

    setParsedRows(normalizedRows);
    setLoading(false);
    setParseStatus('');
  }, []);

  const handleReset = useCallback(() => {
    setSelectedFileName('');
    setParsedRows(null);
    setError('');
    setParseStatus('');
  }, []);

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-800">External CSV Report Viewer</CardTitle>
          <CardDescription>
            Upload any valid output CSV to render the standardized report format. This page is external CSV-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/70 p-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-4 py-6 text-center">
              <FileUp className="h-6 w-6 text-blue-600" />
              <span className="text-sm font-medium text-slate-800">Choose Output CSV File</span>
              <span className="text-xs text-slate-500">{selectedFileName || 'No file selected'}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void handleFileChange(e)}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleReset}>
              Reset
            </Button>
          </div>

          {loading && parseStatus && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {parseStatus}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {parsedRows && !loading ? (
        <StandardReportRenderer
          parsedRows={parsedRows}
          sourceLabel={`External CSV: ${selectedFileName}`}
        />
      ) : null}
    </div>
  );
};

export default ReportsList;
