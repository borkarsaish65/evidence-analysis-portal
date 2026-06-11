import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  Pencil,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { entityService, executionService, getApiErrorMessage, reportService } from '../services/executionService';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { formatDateTime, getAnalysisStatusGroup, getAnalysisStatusMeta } from '../lib/analysis';

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const toSortedUniqueOptions = (values) => {
  const normalizedValues = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  return [...new Set(normalizedValues)].sort((first, second) => first.localeCompare(second));
};

const Dashboard = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [rerunError, setRerunError] = useState('');
  const [rerunSuccess, setRerunSuccess] = useState('');
  const [downloadingExecutionId, setDownloadingExecutionId] = useState('');
  const [rerunningExecutionId, setRerunningExecutionId] = useState('');
  const [analyses, setAnalyses] = useState([]);

  const [states, setStates] = useState([]);
  const [statesLoading, setStatesLoading] = useState(false);
  const [stateError, setStateError] = useState('');

  const [filters, setFilters] = useState({
    status: 'all',
    states: [],
  });

  const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
  const stateDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target)) {
        setStateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const analysisStateOptions = useMemo(() => {
    return toSortedUniqueOptions(analyses.flatMap((analysis) => analysis.states || []));
  }, [analyses]);

  const stateOptions = useMemo(() => {
    const entityStateOptions = toSortedUniqueOptions(states.map((stateItem) => stateItem?.name));
    return entityStateOptions.length > 0 ? entityStateOptions : analysisStateOptions;
  }, [states, analysisStateOptions]);

  const loadAnalyses = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await executionService.getExecutions(1, 250);
      setAnalyses(Array.isArray(response?.items) ? response.items : []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to load analyses right now.'));
      setAnalyses([]);
    } finally {
      setLoading(false);
    }
  };

  const loadStates = async () => {
    setStatesLoading(true);
    setStateError('');

    try {
      const stateItems = await entityService.getStates();
      setStates(stateItems);
    } catch (requestError) {
      setStates([]);
      setStateError(
        `${getApiErrorMessage(requestError, 'Unable to load states right now.')} Showing available analysis states when possible.`
      );
    } finally {
      setStatesLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalyses();
    void loadStates();
  }, []);

  const filteredAnalyses = useMemo(() => {
    return analyses
      .filter((analysis) => {
        const statusMatch =
          filters.status === 'all' || getAnalysisStatusGroup(analysis.status) === filters.status;
        const stateMatch = filters.states.length === 0 || (analysis.states || []).some((s) => filters.states.includes(s));

        return statusMatch && stateMatch;
      })
      .sort((first, second) => new Date(second.created_at) - new Date(first.created_at));
  }, [analyses, filters]);

  const recentAnalyses = useMemo(() => filteredAnalyses.slice(0, 10), [filteredAnalyses]);

  const metrics = useMemo(() => {
    const total = analyses.length;
    const completed = analyses.filter((analysis) => getAnalysisStatusGroup(analysis.status) === 'completed').length;
    const inProgress = analyses.filter((analysis) => getAnalysisStatusGroup(analysis.status) === 'in_progress').length;
    const failed = analyses.filter((analysis) => getAnalysisStatusGroup(analysis.status) === 'failed').length;

    return { total, completed, inProgress, failed };
  }, [analyses]);

  const summaryCards = [
    {
      title: 'Total Analyses',
      value: metrics.total,
      icon: BarChart3,
      accentClass: 'text-blue-600 bg-blue-50 border-blue-100',
      progress: 100,
    },
    {
      title: 'Completed Analyses',
      value: metrics.completed,
      icon: CheckCircle2,
      accentClass: 'text-emerald-600 bg-emerald-50 border-emerald-100',
      progress: metrics.total ? (metrics.completed / metrics.total) * 100 : 0,
    },
    {
      title: 'In Progress',
      value: metrics.inProgress,
      icon: Activity,
      accentClass: 'text-amber-600 bg-amber-50 border-amber-100',
      progress: metrics.total ? (metrics.inProgress / metrics.total) * 100 : 0,
    },
    {
      title: 'Failed',
      value: metrics.failed,
      icon: AlertTriangle,
      accentClass: 'text-rose-600 bg-rose-50 border-rose-100',
      progress: metrics.total ? (metrics.failed / metrics.total) * 100 : 0,
    },
  ];

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value }));
  };

  const handleStateToggle = (stateName) => {
    setFilters((currentFilters) => {
      const next = currentFilters.states.includes(stateName)
        ? currentFilters.states.filter((s) => s !== stateName)
        : [...currentFilters.states, stateName];
      return { ...currentFilters, states: next };
    });
  };

  const clearFilters = () => {
    setFilters({ status: 'all', states: [] });
  };

  const handleDownloadReport = async (executionId) => {
    if (!executionId) {
      return;
    }

    setDownloadError('');
    setDownloadingExecutionId(executionId);

    try {
      await reportService.downloadReport(executionId, 'csv');
    } catch (requestError) {
      setDownloadError(getApiErrorMessage(requestError, 'Failed to download report CSV.'));
    } finally {
      setDownloadingExecutionId('');
    }
  };

  const handleRerunExecution = async (executionId) => {
    if (!executionId) {
      return;
    }

    setRerunError('');
    setRerunSuccess('');
    setRerunningExecutionId(executionId);
    try {
      await executionService.rerunExecution(executionId);
      setRerunSuccess('Rerun queued successfully. Processing has started.');
      await loadAnalyses();
    } catch (requestError) {
      setRerunError(getApiErrorMessage(requestError, 'Failed to rerun analysis.'));
    } finally {
      setRerunningExecutionId('');
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-800">Dashboard</h2>
              <p className="mt-1 text-sm text-slate-600">
                Track your analysis activity, monitor outcomes, and take quick action from one place.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
              <Button
                type="button"
                variant="outline"
                className="border-slate-300 text-slate-700 hover:bg-slate-100 w-full sm:w-auto"
                onClick={() => navigate('/executions')}
              >
                View Analyses
              </Button>
              <Button
                type="button"
                className="bg-blue-600 text-white hover:bg-blue-700 w-full sm:w-auto"
                onClick={() => navigate('/executions/create')}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                <span className="truncate">Start Analysis Run</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;

          return (
            <Card
              key={card.title}
              className="border-slate-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 truncate">{card.title}</p>
                    <p className="mt-2 text-2xl sm:text-3xl font-semibold text-slate-800">{card.value}</p>
                  </div>
                  <div className={`rounded-md border p-2 flex-shrink-0 ${card.accentClass}`}>
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, card.progress))}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
            <Filter className="h-4 w-4 text-blue-600" />
            Filter Analyses
          </CardTitle>
          <CardDescription>Refine dashboard data by status and state.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">Status</span>
              <select
                name="status"
                value={filters.status}
                onChange={handleFilterChange}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1 text-sm text-slate-700" ref={stateDropdownRef}>
              <span className="font-medium block">State</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setStateDropdownOpen((prev) => !prev)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none flex items-center justify-between"
                >
                  <span className="truncate text-left">
                    {statesLoading
                      ? 'Loading states...'
                      : filters.states.length === 0
                        ? 'All States'
                        : `${filters.states.length} state${filters.states.length > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronDown className="h-4 w-4 text-slate-500 shrink-0 ml-2" />
                </button>
                {stateDropdownOpen && stateOptions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                    <div className="max-h-48 overflow-y-auto py-1">
                      {stateOptions.map((stateOption) => (
                        <label
                          key={stateOption}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={filters.states.includes(stateOption)}
                            onChange={() => handleStateToggle(stateOption)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                          <span>{stateOption}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {filters.states.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {filters.states.map((stateName) => (
                    <span
                      key={stateName}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                    >
                      {stateName}
                      <button
                        type="button"
                        aria-label={`Remove ${stateName}`}
                        onClick={() => handleStateToggle(stateName)}
                        className="hover:text-blue-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {stateError && <p className="text-xs text-amber-700">{stateError}</p>}
            </div>



            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full border-slate-300 text-slate-700 hover:bg-slate-100"
                onClick={clearFilters}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg text-slate-800">Recent Analyses</CardTitle>
              <CardDescription>Showing up to 10 latest analysis runs based on active filters.</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-slate-300 text-slate-700 hover:bg-slate-100"
              onClick={() => void loadAnalyses()}
              disabled={loading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          {downloadError && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <span className="font-semibold">Download error: </span>
              {downloadError}
            </div>
          )}
          {rerunError && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <span className="font-semibold">Rerun error: </span>
              {rerunError}
            </div>
          )}
          {rerunSuccess && (
            <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <span className="font-semibold">Success: </span>
              {rerunSuccess}
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
              ))}
            </div>
          ) : recentAnalyses.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-700">No analyses found for selected filters.</p>
              <p className="mt-1 text-xs text-slate-500">Try changing filters or start a new analysis run.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-3 font-semibold">Name</th>
                      <th className="px-2 py-3 font-semibold">State(s)</th>
                      <th className="px-2 py-3 font-semibold">Status</th>
                      <th className="px-2 py-3 font-semibold">Created Date</th>
                      <th className="px-2 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentAnalyses.map((analysis) => {
                      const statusMeta = getAnalysisStatusMeta(analysis.status);
                      const statusGroup = getAnalysisStatusGroup(analysis.status);

                      return (
                        <tr
                          key={analysis.id}
                          className="transition-colors duration-150 hover:bg-slate-50"
                        >
                          <td className="px-2 py-3 text-sm font-medium text-slate-800">{analysis.name}</td>
                          <td className="px-2 py-3 text-sm text-slate-600">
                            {analysis.states?.join(', ') || '-'}
                          </td>
                          <td className="px-2 py-3 text-sm">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${statusMeta.badgeClass}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                              {statusMeta.label}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-sm text-slate-600">{formatDateTime(analysis.created_at)}</td>
                          <td className="px-2 py-3">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-8 border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-100"
                                onClick={() => navigate(`/executions/${analysis.id}`)}
                              >
                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                                View
                              </Button>

                              {statusGroup === 'draft' && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 border-blue-300 px-3 text-xs text-blue-700 hover:bg-blue-50"
                                  onClick={() => navigate(`/executions/create?executionId=${analysis.id}`)}
                                >
                                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                  Edit
                                </Button>
                              )}

                              {statusGroup === 'completed' && (
                                <>
                                  <Button
                                    type="button"
                                    className="h-8 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700"
                                    onClick={() => navigate(`/reports/${analysis.id}`)}
                                  >
                                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                                    View Report
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-8 border-blue-300 px-3 text-xs text-blue-700 hover:bg-blue-50"
                                    onClick={() => void handleDownloadReport(analysis.id)}
                                    disabled={Boolean(downloadingExecutionId)}
                                  >
                                    {downloadingExecutionId === analysis.id ? (
                                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Download className="mr-1.5 h-3.5 w-3.5" />
                                    )}
                                    {downloadingExecutionId === analysis.id ? 'Downloading...' : 'Download'}
                                  </Button>
                                </>
                              )}

                              {statusGroup === 'failed' && (
                                <Button
                                  type="button"
                                  className="h-8 bg-amber-600 px-3 text-xs text-white hover:bg-amber-700"
                                  onClick={() => void handleRerunExecution(analysis.id)}
                                  disabled={Boolean(rerunningExecutionId)}
                                >
                                  {rerunningExecutionId === analysis.id ? (
                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                  )}
                                  {rerunningExecutionId === analysis.id ? 'Rerunning...' : 'Rerun'}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-slate-200">
                {recentAnalyses.map((analysis) => {
                  const statusMeta = getAnalysisStatusMeta(analysis.status);
                  const statusGroup = getAnalysisStatusGroup(analysis.status);

                  return (
                    <div key={analysis.id} className="p-4 space-y-3 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-slate-800 text-sm truncate">{analysis.name}</h3>
                          <div className="mt-1 space-y-0.5">
                            {analysis.states?.length > 0 ? (
                              <p className="text-xs text-slate-600">
                                <span className="font-medium">State:</span> {analysis.states.join(', ')}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-500">-</p>
                            )}
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusMeta.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                          {statusMeta.label}
                        </span>
                      </div>
                      
                      <div className="text-xs text-slate-500">
                        {formatDateTime(analysis.created_at)}
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 min-w-[110px] h-9 border-slate-300 text-xs text-slate-700 hover:bg-slate-100"
                          onClick={() => navigate(`/executions/${analysis.id}`)}
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          View
                        </Button>

                        {statusGroup === 'draft' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1 min-w-[110px] h-9 border-blue-300 text-xs text-blue-700 hover:bg-blue-50"
                            onClick={() => navigate(`/executions/create?executionId=${analysis.id}`)}
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        )}

                        {statusGroup === 'completed' && (
                          <>
                            <Button
                              type="button"
                              className="flex-1 min-w-[110px] h-9 bg-blue-600 text-xs text-white hover:bg-blue-700"
                              onClick={() => navigate(`/reports/${analysis.id}`)}
                            >
                              <FileText className="mr-1.5 h-3.5 w-3.5" />
                              Report
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="flex-1 min-w-[110px] h-9 border-blue-300 text-xs text-blue-700 hover:bg-blue-50"
                              onClick={() => void handleDownloadReport(analysis.id)}
                              disabled={Boolean(downloadingExecutionId)}
                            >
                              {downloadingExecutionId === analysis.id ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              {downloadingExecutionId === analysis.id ? 'Downloading...' : 'Download'}
                            </Button>
                          </>
                        )}

                        {statusGroup === 'failed' && (
                          <Button
                            type="button"
                            className="flex-1 min-w-[110px] h-9 bg-amber-600 text-xs text-white hover:bg-amber-700"
                            onClick={() => void handleRerunExecution(analysis.id)}
                            disabled={Boolean(rerunningExecutionId)}
                          >
                            {rerunningExecutionId === analysis.id ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            {rerunningExecutionId === analysis.id ? 'Rerunning...' : 'Rerun'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
