import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, FileSearch, FileText, Loader2, Pencil, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { executionService, getApiErrorMessage, reportService } from '../services/executionService';
import { formatDateTime, getAnalysisStatusGroup, getAnalysisStatusMeta } from '../lib/analysis';

const PREVIEW_LIMIT = 10;

const formatPercent = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
};

const formatFileSize = (bytes) => {
  if (typeof bytes !== 'number' || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatValue = (value) => {
  if (value === null || value === undefined) {
    return '-';
  }

  if (typeof value === 'string') {
    return value.trim() || '-';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString('en-IN') : '-';
  }

  return String(value);
};

const ExecutionDetail = () => {
  const { id: executionId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [rerunError, setRerunError] = useState('');
  const [rerunSuccess, setRerunSuccess] = useState('');

  const [execution, setExecution] = useState(null);
  const [statusInfo, setStatusInfo] = useState(null);
  const [previews, setPreviews] = useState({
    input: null,
    questions: null,
  });
  const [previewErrors, setPreviewErrors] = useState({
    input: '',
    questions: '',
  });

  const loadExecutionView = useCallback(
    async ({ showFullLoader = false } = {}) => {
      if (!executionId) {
        setError('Missing execution id in route.');
        setLoading(false);
        return;
      }

      if (showFullLoader) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError('');

      const fetchPreview = async (fileType) => {
        try {
          const data = await executionService.getExecutionFilePreview(executionId, fileType, PREVIEW_LIMIT);
          return { data, error: '' };
        } catch (requestError) {
          return {
            data: null,
            error: getApiErrorMessage(requestError, `Unable to load ${fileType} preview.`),
          };
        }
      };

      try {
        const [executionDetail, executionStatus, inputPreview, questionsPreview] = await Promise.all([
          executionService.getExecution(executionId),
          executionService.getExecutionStatus(executionId),
          fetchPreview('input'),
          fetchPreview('questions'),
        ]);

        setExecution(executionDetail);
        setStatusInfo(executionStatus);
        setPreviews({
          input: inputPreview.data,
          questions: questionsPreview.data,
        });
        setPreviewErrors({
          input: inputPreview.error,
          questions: questionsPreview.error,
        });
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, 'Unable to load analysis details right now.'));
        setExecution(null);
        setStatusInfo(null);
        setPreviews({ input: null, questions: null });
        setPreviewErrors({ input: '', questions: '' });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [executionId]
  );

  useEffect(() => {
    void loadExecutionView({ showFullLoader: true });
  }, [loadExecutionView]);

  useEffect(() => {
    if (!executionId || loading) {
      return undefined;
    }

    const statusGroup = getAnalysisStatusGroup(statusInfo?.status || execution?.status);
    if (statusGroup === 'completed' || statusGroup === 'failed') {
      return undefined;
    }

    const pollTimer = setInterval(() => {
      void (async () => {
        try {
          const latestStatus = await executionService.getExecutionStatus(executionId);
          setStatusInfo(latestStatus);

          if (getAnalysisStatusGroup(latestStatus?.status) === 'completed') {
            const latestExecution = await executionService.getExecution(executionId);
            setExecution(latestExecution);
          }
        } catch (requestError) {
          // Silent poll failure; explicit refresh button remains available.
        }
      })();
    }, 10000);

    return () => clearInterval(pollTimer);
  }, [execution?.status, executionId, loading, statusInfo?.status]);

  const statusMeta = useMemo(() => getAnalysisStatusMeta(statusInfo?.status || execution?.status), [execution?.status, statusInfo?.status]);

  const progressPercent = useMemo(() => {
    if (typeof statusInfo?.progress_percentage === 'number') {
      return statusInfo.progress_percentage;
    }

    const processedRows = statusInfo?.processed_rows ?? execution?.processed_rows;
    const totalRows = statusInfo?.total_rows ?? execution?.total_rows;

    if (typeof processedRows === 'number' && typeof totalRows === 'number' && totalRows > 0) {
      return (processedRows / totalRows) * 100;
    }

    return null;
  }, [execution?.processed_rows, execution?.total_rows, statusInfo]);

  const canEdit = useMemo(() => {
    const normalizedStatus = `${statusInfo?.status || execution?.status || ''}`.toLowerCase();
    return normalizedStatus === 'draft' || normalizedStatus === 'validated';
  }, [execution?.status, statusInfo?.status]);
  const canViewReport = useMemo(() => {
    return getAnalysisStatusGroup(statusInfo?.status || execution?.status) === 'completed';
  }, [execution?.status, statusInfo?.status]);
  const canRerun = useMemo(() => {
    return getAnalysisStatusGroup(statusInfo?.status || execution?.status) === 'failed';
  }, [execution?.status, statusInfo?.status]);

  const quickDetails = useMemo(
    () => [
      { label: 'State', value: execution?.states?.join(', ') || null },
      { label: 'Program', value: execution?.program_name },
      { label: 'Created On', value: formatDateTime(execution?.created_at) },
      { label: 'Last Updated', value: formatDateTime(execution?.updated_at) },
      ...(execution?.threshold_config?.enable_relevant_cap === true &&
        Number.isFinite(execution.threshold_config.max_relevant_per_user_task)
        ? [{ label: 'Evidence Cap', value: `${execution.threshold_config.max_relevant_per_user_task} per user per task` }]
        : []),
    ],
    [execution]
  );

  const handleDownloadReport = useCallback(async () => {
    if (!execution?.id) {
      return;
    }

    setDownloadError('');
    setDownloadingReport(true);

    try {
      await reportService.downloadReport(execution.id, 'csv');
    } catch (requestError) {
      setDownloadError(getApiErrorMessage(requestError, 'Failed to download report CSV.'));
    } finally {
      setDownloadingReport(false);
    }
  }, [execution?.id]);

  const handleRerunExecution = useCallback(async () => {
    if (!execution?.id) {
      return;
    }

    setRerunError('');
    setRerunSuccess('');
    setRerunning(true);
    try {
      await executionService.rerunExecution(execution.id);
      setRerunSuccess('Rerun queued successfully. Processing has started.');
      await loadExecutionView({ showFullLoader: false });
    } catch (requestError) {
      setRerunError(getApiErrorMessage(requestError, 'Failed to rerun analysis.'));
    } finally {
      setRerunning(false);
    }
  }, [execution?.id, loadExecutionView]);

  const renderPreviewSection = (title, fileType) => {
    const previewData = previews[fileType];
    const previewError = previewErrors[fileType];
    const columns = Array.isArray(previewData?.columns_detected) ? previewData.columns_detected : [];
    const previewRows = Array.isArray(previewData?.preview_rows) ? previewData.preview_rows : [];

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-500">Rows:</span>
              <span className="font-semibold text-blue-600">{formatValue(previewData?.rows_detected)}</span>
            </div>
            <span className="text-slate-300">•</span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-500">Columns:</span>
              <span className="font-semibold text-blue-600">{columns.length}</span>
            </div>
          </div>
        </div>

        {previewError ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {previewError}
          </div>
        ) : null}

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto rounded-md border border-slate-200 bg-white">
          {columns.length > 0 ? (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 font-semibold">
                    #
                  </th>
                  {columns.map((column) => (
                    <th
                      key={`${fileType}-col-${column}`}
                      className="whitespace-nowrap bg-slate-50 px-3 py-2.5 font-semibold"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {previewRows.length > 0 ? (
                  previewRows.map((row, rowIndex) => (
                    <tr key={`${fileType}-row-${rowIndex}`} className="transition-colors duration-150 hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white whitespace-nowrap px-3 py-2.5 text-slate-500 font-medium hover:bg-slate-50 transition-colors">
                        {rowIndex + 1}
                      </td>
                      {columns.map((column) => (
                        <td
                          key={`${fileType}-cell-${rowIndex}-${column}`}
                          className="min-w-[140px] max-w-xs break-words px-3 py-2.5 text-slate-700"
                        >
                          {row?.[column] || '-'}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-sm text-slate-500">
                      No sample rows available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <div className="px-3 py-8 text-center text-sm text-slate-500">
              Preview unavailable
            </div>
          )}
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden space-y-3">
          {columns.length > 0 && previewRows.length > 0 ? (
            previewRows.map((row, rowIndex) => (
              <div
                key={`${fileType}-mobile-row-${rowIndex}`}
                className="rounded-md border border-slate-200 bg-white p-3 space-y-2 hover:bg-slate-50 transition-colors duration-150"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-semibold text-slate-800">Row {rowIndex + 1}</span>
                </div>
                {columns.map((column) => (
                  <div key={`${fileType}-mobile-cell-${rowIndex}-${column}`} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-500">{column}</span>
                    <span className="text-sm text-slate-700 break-words">{row?.[column] || '-'}</span>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-500">
                {columns.length === 0 ? 'Preview unavailable' : 'No sample rows available'}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!executionId) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="font-semibold">Missing execution id in URL.</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4 sm:space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-md border border-slate-200 bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <Card className="border-rose-200 bg-rose-50 shadow-sm">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="rounded-md border border-rose-200 bg-white px-3 py-2.5 text-sm text-rose-700">
              <span className="font-semibold">Error: </span>
              {error || 'Analysis details not available.'}
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => navigate('/executions')}>
                Back to Analyses
              </Button>
              <Button
                type="button"
                className="bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => void loadExecutionView({ showFullLoader: true })}
              >
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Card */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-800">{execution.name || 'Analysis Details'}</h2>
              <p className="mt-1 text-sm text-slate-600">Track status and review uploaded data</p>
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto lg:justify-end">
              {canViewReport ? (
                <>
                  <Button
                    type="button"
                    className="bg-blue-600 text-white hover:bg-blue-700 w-full sm:w-auto"
                    onClick={() => navigate(`/reports/${execution.id}`)}
                  >
                    <FileText className="mr-1.5 h-4 w-4" />
                    View Report
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-blue-300 text-blue-700 hover:bg-blue-50 w-full sm:w-auto"
                    onClick={() => void handleDownloadReport()}
                    disabled={downloadingReport}
                  >
                    {downloadingReport ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-1.5 h-4 w-4" />
                    )}
                    {downloadingReport ? 'Downloading...' : 'Download'}
                  </Button>
                </>
              ) : null}

              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-blue-300 text-blue-700 hover:bg-blue-50 w-full sm:w-auto"
                  onClick={() => navigate(`/executions/create?executionId=${execution.id}`)}
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
              ) : null}

              {canRerun ? (
                <Button
                  type="button"
                  className="bg-amber-600 text-white hover:bg-amber-700 w-full sm:w-auto"
                  onClick={() => void handleRerunExecution()}
                  disabled={rerunning}
                >
                  {rerunning ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                  )}
                  {rerunning ? 'Rerunning...' : 'Rerun'}
                </Button>
              ) : null}

              <Button
                type="button"
                variant="outline"
                className="border-slate-300 text-slate-700 hover:bg-slate-100 w-full sm:w-auto"
                onClick={() => void loadExecutionView({ showFullLoader: false })}
                disabled={refreshing}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {downloadError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="font-semibold">Download error: </span>
          {downloadError}
        </div>
      ) : null}
      {rerunError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="font-semibold">Rerun error: </span>
          {rerunError}
        </div>
      ) : null}
      {rerunSuccess ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <span className="font-semibold">Success: </span>
          {rerunSuccess}
        </div>
      ) : null}

      {/* Analysis Overview Card */}
      <Card className="border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg text-slate-800">Analysis Overview</CardTitle>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium self-start sm:self-auto ${statusMeta.badgeClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
              {statusMeta.label}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress Section */}
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Processing Progress</span>
              <span className="font-semibold text-slate-800">{formatPercent(progressPercent)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, progressPercent || 0))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium">
                <span className="text-blue-600 font-semibold">{formatValue(statusInfo?.processed_rows ?? execution.processed_rows)}</span> processed
              </span>
              <span className="font-medium">
                <span className="text-blue-600 font-semibold">{formatValue(statusInfo?.total_rows ?? execution.total_rows)}</span> total
              </span>
            </div>
          </div>

          {/* Error Message if any */}
          {(statusInfo?.failure_reason || execution.failure_reason) && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <span className="font-semibold">Error: </span>
              {statusInfo?.failure_reason || execution.failure_reason}
            </div>
          )}

          {/* Details Grid */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Analysis Details</h4>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {quickDetails.map((field) => (
                <div key={field.label} className="space-y-1.5">
                  <p className="text-xs font-medium text-slate-500">{field.label}</p>
                  <p className="break-words text-sm font-medium text-slate-800">{formatValue(field.value)}</p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File Preview Card */}
      <Card className="border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
            <FileSearch className="h-5 w-5 text-blue-600" />
            Uploaded Files Preview
          </CardTitle>
          <CardDescription>First {PREVIEW_LIMIT} rows from your uploaded data files</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {renderPreviewSection('Input Data CSV', 'input')}
          {renderPreviewSection('Criteria / Questions CSV', 'questions')}
          {execution.school_filter_file_url ? (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-800">School Filter CSV</h4>
              <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                <FileText className="h-4 w-4 flex-shrink-0 text-slate-500" />
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {execution.school_filter_file_url.split('/').pop() || execution.school_filter_file_url}
                  </p>
                  {typeof execution.school_filter_file_size === 'number' && (
                    <p className="text-xs text-slate-500">{formatFileSize(execution.school_filter_file_size)}</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExecutionDetail;
