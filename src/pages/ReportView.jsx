import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import StandardReportRenderer from '../components/reports/StandardReportRenderer';
import { getApiErrorMessage, reportService, executionService } from '../services/executionService';

const ReportView = () => {
  const { id: executionId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [reportApiData, setReportApiData] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [executionName, setExecutionName] = useState('');
  const [activeFilters, setActiveFilters] = useState({});

  const loadReportData = useCallback(async (filters = {}) => {
    if (!executionId) {
      setError('Missing execution id in URL.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [executionDetails, pageData] = await Promise.all([
        executionService.getExecution(executionId),
        reportService.getReportDataPage(executionId, {
          page: 1,
          pageSize: 1000,
          ...filters,
        }),
      ]);

      setExecutionName(executionDetails?.name || 'Unnamed Execution');
      setReportApiData(pageData);
    } catch (requestError) {
      setReportApiData(null);
      setExecutionName('');
      setError(getApiErrorMessage(requestError, 'Unable to load report data.'));
    } finally {
      setLoading(false);
    }
  }, [executionId]);

  useEffect(() => {
    void loadReportData(activeFilters);
  }, [executionId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = useCallback((filters) => {
    setActiveFilters(filters);
    void loadReportData(filters);
  }, [loadReportData]);

  if (loading && !reportApiData) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50 shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/reports')}>
              Back to Reports
            </Button>
            <Button
              type="button"
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <StandardReportRenderer
      reportApiData={reportApiData}
      onFilterChange={handleFilterChange}
      sourceLabel={`Analysis Report - ${executionName}`}
    />
  );
};

export default ReportView;
