import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Download, FileText, Filter, RefreshCw, UploadCloud, XCircle } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { executionService, configService, getApiErrorMessage } from '../services/executionService';
import { ENV } from '../config/env';
import ExecutionWizardStepper from '../components/executions/ExecutionWizardStepper';

const initialFileState = {
  file: null,
  uploading: false,
  uploaded: false,
  rowsDetected: null,
  columnsDetected: [],
  message: '',
  error: '',
  existingFileName: '',
  existingUploaded: false,
  existingValidated: false,
};

const formatFileSize = (bytes) => {
  if (typeof bytes !== 'number' || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const extractDisplayFileName = (filePath, fileType) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return '';
  }

  const rawName = filePath.split('/').pop() || '';
  const decodedName = decodeURIComponent(rawName);
  const prefix = `${fileType}_`;
  return decodedName.startsWith(prefix) ? decodedName.slice(prefix.length) : decodedName;
};

const ExecutionUpload = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const executionId = (searchParams.get('executionId') || '').trim();

  const [globalError, setGlobalError] = useState('');
  const [globalSuccess, setGlobalSuccess] = useState('');
  const [loadingExecution, setLoadingExecution] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState('');
  const [csvTypeId, setCsvTypeId] = useState(null);
  const [downloadingSample, setDownloadingSample] = useState({ input: false, criteria: false });
  const [inputFileState, setInputFileState] = useState(initialFileState);
  const [questionsFileState, setQuestionsFileState] = useState(initialFileState);
  const [schoolFilterState, setSchoolFilterState] = useState({
    file: null,
    uploading: false,
    rowsDetected: null,
    error: '',
    existingFileName: '',
    existingFileSize: null,
    existingUploaded: false,
  });

  const hasAnyFileSelected = Boolean(inputFileState.file) || Boolean(questionsFileState.file) || Boolean(schoolFilterState.file);
  const hasInputAvailable = Boolean(inputFileState.file) || inputFileState.existingUploaded;
  const hasQuestionsAvailable = Boolean(questionsFileState.file) || questionsFileState.existingUploaded;
  const hasExistingFiles = inputFileState.existingUploaded && questionsFileState.existingUploaded;
  const isUploadingAny = inputFileState.uploading || questionsFileState.uploading || submitting || schoolFilterState.uploading;
  const isEditableExecution = useMemo(() => {
    const normalizedStatus = `${executionStatus || ''}`.toLowerCase();
    if (!normalizedStatus) {
      return true;
    }
    return normalizedStatus === 'draft' || normalizedStatus === 'validated' || normalizedStatus === 'queued';
  }, [executionStatus]);

  const actionLabel = useMemo(() => {
    if (submitting) {
      return hasAnyFileSelected ? 'Uploading & Validating...' : 'Validating...';
    }
    if (hasAnyFileSelected) {
      return 'Upload & Validate';
    }
    if (hasExistingFiles) {
      return 'Continue with Existing Files';
    }
    return 'Upload & Validate';
  }, [hasAnyFileSelected, hasExistingFiles, submitting]);

  const createStepPath = executionId ? `/executions/create?executionId=${executionId}` : '/executions/create';

  const hydrateExistingFiles = (execution) => {
    const inputStatus = execution?.input_file_status || {};
    const questionsStatus = execution?.questions_file_status || {};

    setInputFileState((current) => ({
      ...current,
      existingFileName: extractDisplayFileName(execution?.input_file_url, 'input'),
      existingUploaded: Boolean(execution?.input_file_url) || Boolean(inputStatus.uploaded),
      existingValidated: Boolean(inputStatus.validated),
      rowsDetected: typeof inputStatus.rows_detected === 'number' ? inputStatus.rows_detected : null,
      columnsDetected: Array.isArray(inputStatus.columns_detected) ? inputStatus.columns_detected : [],
      message: typeof inputStatus.message === 'string' ? inputStatus.message : '',
      error: '',
    }));

    setQuestionsFileState((current) => ({
      ...current,
      existingFileName: extractDisplayFileName(execution?.criterias_file_url || execution?.questions_file_url, 'questions'),
      existingUploaded: Boolean(execution?.criterias_file_url || execution?.questions_file_url) || Boolean(questionsStatus.uploaded),
      existingValidated: Boolean(questionsStatus.validated),
      rowsDetected: typeof questionsStatus.rows_detected === 'number' ? questionsStatus.rows_detected : null,
      columnsDetected: Array.isArray(questionsStatus.columns_detected) ? questionsStatus.columns_detected : [],
      message: typeof questionsStatus.message === 'string' ? questionsStatus.message : '',
      error: '',
    }));

    setSchoolFilterState((current) => ({
      ...current,
      existingFileName: execution?.school_filter_file_url ? (execution.school_filter_file_url.split('/').pop() || '') : '',
      existingFileSize: typeof execution?.school_filter_file_size === 'number' ? execution.school_filter_file_size : null,
      existingUploaded: Boolean(execution?.school_filter_file_url),
      error: '',
    }));
  };

  useEffect(() => {
    if (!executionId) {
      return;
    }

    const loadExecution = async () => {
      setLoadingExecution(true);
      setGlobalError('');
      try {
        const execution = await executionService.getExecution(executionId);
        const normalizedStatus = `${execution?.status || ''}`.toLowerCase();
        setExecutionStatus(normalizedStatus);
        setCsvTypeId(execution?.csv_type_id || null);
        hydrateExistingFiles(execution);

        if (!['draft', 'validated', 'queued'].includes(normalizedStatus)) {
          setGlobalError('Only draft, validated, or queued executions can be updated.');
        }
      } catch (error) {
        const message = error?.response?.data?.detail || error?.message || 'Failed to load execution details.';
        setGlobalError(typeof message === 'string' ? message : 'Failed to load execution details.');
      } finally {
        setLoadingExecution(false);
      }
    };

    void loadExecution();
  }, [executionId]);

  const handleFileSelection = (fileType, event) => {
    const selectedFile = event.target.files?.[0] || null;
    const setState = fileType === 'input' ? setInputFileState : setQuestionsFileState;
    setState((current) => ({
      ...current,
      file: selectedFile,
      uploaded: false,
      rowsDetected: null,
      columnsDetected: [],
      error: '',
      message: selectedFile
        ? `${current.existingUploaded ? 'Replacement selected' : 'Selected'}: ${selectedFile.name}`
        : '',
    }));
    setGlobalError('');
    setGlobalSuccess('');
  };

  const handleSchoolFilterFileSelect = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setSchoolFilterState((current) => ({ ...current, file: selectedFile, error: '' }));
  };

  const handleSchoolFilterUpload = async () => {
    if (!schoolFilterState.file || !executionId) return;
    setSchoolFilterState((current) => ({ ...current, uploading: true, error: '' }));
    try {
      const result = await executionService.uploadSchoolFilterFile(executionId, schoolFilterState.file);
      setSchoolFilterState((current) => ({
        ...current,
        file: null,
        uploading: false,
        rowsDetected: result?.rows_detected ?? null,
        existingFileName: current.file?.name || current.existingFileName,
        existingFileSize: typeof current.file?.size === 'number' ? current.file.size : current.existingFileSize,
        existingUploaded: true,
        error: '',
      }));
    } catch (err) {
      setSchoolFilterState((current) => ({
        ...current,
        uploading: false,
        error: getApiErrorMessage(err, 'Failed to upload school filter file.'),
      }));
    }
  };

  const handleDownloadSample = async (fileType) => {
    setDownloadingSample((prev) => ({ ...prev, [fileType]: true }));
    setGlobalError('');

    try {
      // Use csvTypeId from execution or fall back to default
      const typeId = csvTypeId || ENV.DEFAULT_CSV_TYPE_ID;
      
      // If typeId is still a string (like 'project_report'), we need the numeric ID
      // For now, we'll use 1 as the default ID for project_report type
      const numericTypeId = typeof typeId === 'number' ? typeId : 1;
      
      const response = await configService.getSampleCsvUrl(numericTypeId, fileType);
      
      if (response?.download_url) {
        // Open the signed URL in a new tab to trigger download
        window.open(response.download_url, '_blank');
      } else {
        throw new Error('Download URL not available');
      }
    } catch (error) {
      const message = getApiErrorMessage(error, `Failed to download sample ${fileType} CSV.`);
      setGlobalError(message);
    } finally {
      setDownloadingSample((prev) => ({ ...prev, [fileType]: false }));
    }
  };

  const uploadSelectedFiles = async () => {
    const selectedInputFile = inputFileState.file;
    const selectedQuestionsFile = questionsFileState.file;

    if (selectedInputFile) {
      setInputFileState((current) => ({ ...current, uploading: true, error: '' }));
    }
    if (selectedQuestionsFile) {
      setQuestionsFileState((current) => ({ ...current, uploading: true, error: '' }));
    }

    const selectedSchoolFilterFile = schoolFilterState.file;
    if (selectedSchoolFilterFile) {
      setSchoolFilterState((current) => ({ ...current, uploading: true, error: '' }));
    }

    try {
      const uploadPromises = [];
      if (selectedInputFile) {
        uploadPromises.push(
          executionService
            .directUploadExecutionFile(executionId, 'input', selectedInputFile)
            .then((result) => ({ fileType: 'input', result }))
        );
      }
      if (selectedQuestionsFile) {
        uploadPromises.push(
          executionService
            .directUploadExecutionFile(executionId, 'questions', selectedQuestionsFile)
            .then((result) => ({ fileType: 'questions', result }))
        );
      }
      if (selectedSchoolFilterFile) {
        uploadPromises.push(
          executionService
            .uploadSchoolFilterFile(executionId, selectedSchoolFilterFile)
            .then((result) => ({ fileType: 'school_filter', result }))
        );
      }

      const uploadResults = await Promise.all(uploadPromises);
      uploadResults.forEach((uploadResult) => {
        if (uploadResult.fileType === 'input') {
          setInputFileState((current) => ({
            ...current,
            uploaded: Boolean(uploadResult.result?.uploaded),
            rowsDetected: uploadResult.result?.rows_detected ?? null,
            columnsDetected: Array.isArray(uploadResult.result?.columns_detected) ? uploadResult.result.columns_detected : [],
            message: 'Input file replaced successfully.',
            error: '',
            existingFileName: selectedInputFile?.name || current.existingFileName,
            existingUploaded: true,
            existingValidated: false,
          }));
        } else if (uploadResult.fileType === 'school_filter') {
          setSchoolFilterState((current) => ({
            ...current,
            rowsDetected: uploadResult.result?.rows_detected ?? null,
            existingFileName: selectedSchoolFilterFile?.name || current.existingFileName,
            existingFileSize: typeof selectedSchoolFilterFile?.size === 'number' ? selectedSchoolFilterFile.size : current.existingFileSize,
            existingUploaded: true,
            error: '',
          }));
        } else {
          setQuestionsFileState((current) => ({
            ...current,
            uploaded: Boolean(uploadResult.result?.uploaded),
            rowsDetected: uploadResult.result?.rows_detected ?? null,
            columnsDetected: Array.isArray(uploadResult.result?.columns_detected)
              ? uploadResult.result.columns_detected
              : [],
            message: 'Criteria file replaced successfully.',
            error: '',
            existingFileName: selectedQuestionsFile?.name || current.existingFileName,
            existingUploaded: true,
            existingValidated: false,
          }));
        }
      });
    } finally {
      setInputFileState((current) => ({ ...current, uploading: false }));
      setQuestionsFileState((current) => ({ ...current, uploading: false }));
      setSchoolFilterState((current) => ({ ...current, uploading: false }));
    }
  };

  const applyValidationState = (validationResult) => {
    const inputResult = validationResult?.input_file || {};
    const questionsResult = validationResult?.questions_file || {};

    setInputFileState((current) => ({
      ...current,
      existingUploaded: current.existingUploaded || Boolean(current.file),
      existingValidated: Boolean(inputResult.valid),
      rowsDetected: inputResult.rows_detected ?? current.rowsDetected,
      columnsDetected: Array.isArray(inputResult.columns_detected) ? inputResult.columns_detected : current.columnsDetected,
      message: inputResult.message || current.message,
      error: inputResult.valid === false ? (inputResult.message || 'Validation failed.') : '',
    }));

    setQuestionsFileState((current) => ({
      ...current,
      existingUploaded: current.existingUploaded || Boolean(current.file),
      existingValidated: Boolean(questionsResult.valid),
      rowsDetected: questionsResult.rows_detected ?? current.rowsDetected,
      columnsDetected: Array.isArray(questionsResult.columns_detected)
        ? questionsResult.columns_detected
        : current.columnsDetected,
      message: questionsResult.message || current.message,
      error: questionsResult.valid === false ? (questionsResult.message || 'Validation failed.') : '',
    }));
  };

  const handleProceed = async () => {
    if (!executionId) {
      setGlobalError('Missing execution id. Please create analysis again.');
      return;
    }

    if (!isEditableExecution) {
      setGlobalError('Only draft, validated, or queued executions can be updated.');
      return;
    }

    if (!hasInputAvailable || !hasQuestionsAvailable) {
      const missing = [];
      if (!hasInputAvailable) {
        missing.push('Input Data CSV');
      }
      if (!hasQuestionsAvailable) {
        missing.push('Criteria / Questions CSV');
      }
      setGlobalError(`Missing required file: ${missing.join(' and ')}.`);
      return;
    }

    setGlobalError('');
    setGlobalSuccess('');
    setSubmitting(true);

    try {
      if (hasAnyFileSelected) {
        try {
          await uploadSelectedFiles();
          setGlobalSuccess('Selected files uploaded. Running validation...');
        } catch (uploadError) {
          const uploadMessage = getApiErrorMessage(
            uploadError,
            'Unable to upload selected file(s). Please retry.'
          );

          if (inputFileState.file) {
            setInputFileState((current) => ({
              ...current,
              uploaded: false,
              rowsDetected: null,
              columnsDetected: [],
              message: '',
              error: uploadMessage,
            }));
          }
          if (questionsFileState.file) {
            setQuestionsFileState((current) => ({
              ...current,
              uploaded: false,
              rowsDetected: null,
              columnsDetected: [],
              message: '',
              error: uploadMessage,
            }));
          }
          if (schoolFilterState.file) {
            setSchoolFilterState((current) => ({
              ...current,
              error: uploadMessage,
            }));
          }

          setGlobalSuccess('');
          setGlobalError(`Upload failed: ${uploadMessage}`);
          return;
        }
      }

      try {
        const validationResult = await executionService.validateExecutionFiles(executionId);
        applyValidationState(validationResult);
        navigate(`/executions/create/validate?executionId=${executionId}`, {
          state: { validationResult },
        });
      } catch (validationError) {
        const validationMessage = getApiErrorMessage(
          validationError,
          'Unable to validate files. Please retry.'
        );
        setGlobalSuccess('');
        setGlobalError(`Validation failed: ${validationMessage}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderExistingFileStatus = (fileState) => {
    if (!fileState.existingUploaded) {
      return null;
    }

    return (
      <div className="rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mb-2">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Current file:</span>
          <p className="mt-1 text-sm font-medium text-slate-900 break-all">
            {fileState.existingFileName || 'Already uploaded'}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Uploaded
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
              fileState.existingValidated
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {fileState.existingValidated ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Validated
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3" />
                Not validated
              </>
            )}
          </span>
        </div>
      </div>
    );
  };

  const renderFileStatus = (fileState, fileTypeLabel) => (
    <div className="space-y-3">
      {renderExistingFileStatus(fileState)}

      {fileState.uploaded && (
        <div className="rounded-lg border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-100 px-4 py-3 shadow-sm">
          <div className="flex items-start gap-2">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-900">
                {fileState.message || `${fileTypeLabel} uploaded and validated`}
              </p>
              {typeof fileState.rowsDetected === 'number' && (
                <p className="mt-1.5 text-xs text-emerald-700">
                  <span className="font-medium">Rows detected:</span> <span className="font-mono">{fileState.rowsDetected.toLocaleString()}</span>
                </p>
              )}
              {fileState.columnsDetected.length > 0 && (
                <div className="mt-1.5 max-h-24 overflow-auto text-xs text-emerald-700">
                  <span className="font-medium">Columns ({fileState.columnsDetected.length}):</span>{' '}
                  <span className="font-mono">{fileState.columnsDetected.join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {fileState.message && !fileState.uploaded && !fileState.error && (
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 px-4 py-3 shadow-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-blue-600" />
            <p className="text-sm text-blue-900">{fileState.message}</p>
          </div>
        </div>
      )}

      {fileState.error && (
        <div className="rounded-lg border-2 border-rose-200 bg-gradient-to-r from-rose-50 to-rose-100 px-4 py-3 shadow-sm">
          <div className="flex items-start gap-2">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white">
              <XCircle className="h-4 w-4 text-rose-600" />
            </div>
            <p className="text-sm text-rose-900 break-words">{fileState.error}</p>
          </div>
        </div>
      )}
    </div>
  );

  if (!executionId) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="space-y-6 p-4 sm:p-6">
            <ExecutionWizardStepper activeStep={2} />
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <span className="font-semibold">Missing execution id. </span>
              Please complete Step 1 first to create an execution.
            </div>
            <div>
              <Button 
                type="button" 
                onClick={() => navigate('/executions/create')}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go To Create
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-6 p-4 sm:p-6">
          <ExecutionWizardStepper activeStep={2} />

          <div>
            <h2 className="text-xl sm:text-2xl font-semibold text-slate-800">Upload Files</h2>
            <p className="mt-1 text-sm text-slate-600">Upload your input data and criteria files to proceed with validation</p>
          </div>

          {loadingExecution ? (
            <div className="flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 p-8">
              <RefreshCw className="mr-2 h-5 w-5 animate-spin text-blue-600" />
              <span className="text-sm text-slate-600">Loading execution files...</span>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md">
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 border border-blue-100">
                        <FileText className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor="inputFile" className="text-sm font-semibold text-slate-800">
                          Input Data CSV
                        </Label>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-500">Upload evidence data file</p>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            onClick={() => handleDownloadSample('input')}
                            disabled={downloadingSample.input || isUploadingAny}
                            className="h-auto px-2 py-1 text-xs text-blue-600 hover:text-blue-800"
                          >
                            <Download className="mr-1 h-3 w-3" />
                            {downloadingSample.input ? 'Downloading...' : 'Download Sample'}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <Input
                      id="inputFile"
                      name="inputFile"
                      type="file"
                      accept=".csv"
                      disabled={inputFileState.uploading || submitting}
                      onChange={(event) => handleFileSelection('input', event)}
                      className="!h-auto cursor-pointer border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-all hover:border-blue-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:!bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:!text-white file:shadow-sm file:transition-all hover:file:!bg-blue-700 hover:file:shadow-md"
                    />
                    {renderFileStatus(inputFileState, 'Input file')}
                  </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md">
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-purple-50 border border-purple-100">
                        <FileText className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor="questionsFile" className="text-sm font-semibold text-slate-800">
                          Criteria CSV
                        </Label>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-500">Upload questions/criteria file</p>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            onClick={() => handleDownloadSample('criteria')}
                            disabled={downloadingSample.criteria || isUploadingAny}
                            className="h-auto px-2 py-1 text-xs text-purple-600 hover:text-purple-800"
                          >
                            <Download className="mr-1 h-3 w-3" />
                            {downloadingSample.criteria ? 'Downloading...' : 'Download Sample'}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <Input
                      id="questionsFile"
                      name="questionsFile"
                      type="file"
                      accept=".csv"
                      disabled={questionsFileState.uploading || submitting}
                      onChange={(event) => handleFileSelection('questions', event)}
                      className="!h-auto cursor-pointer border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-all hover:border-purple-400 focus-visible:border-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:!bg-purple-600 file:px-4 file:py-2 file:text-sm file:font-medium file:!text-white file:shadow-sm file:transition-all hover:file:!bg-purple-700 hover:file:shadow-md"
                    />
                    {renderFileStatus(questionsFileState, 'Criteria file')}
                  </CardContent>
                </Card>
              </div>

              {/* School Filter — Optional */}
              <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-4 sm:p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 border border-slate-200">
                    <Filter className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor="schoolFilterFile" className="text-sm font-semibold text-slate-800">School Filter CSV</Label>
                      <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
                        Optional
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Only rows matching schools in this list will be processed. Skip to process all schools.
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Must contain a{' '}
                      <span className="font-mono font-medium text-slate-600">UDISE+ SCHOOL CODE</span>{' '}
                      column
                    </p>
                    <a
                      href="/sample_school_filter.csv"
                      download="sample_school_filter.csv"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                    >
                      <Download className="h-3 w-3" />
                      Download Sample
                    </a>
                  </div>
                </div>

                {schoolFilterState.existingUploaded && (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <p className="text-xs font-medium text-slate-500">Current filter:</p>
                    <p className="mt-0.5 text-sm font-medium text-slate-900 break-all">{schoolFilterState.existingFileName}</p>
                    {schoolFilterState.existingFileSize != null && (
                      <p className="mt-0.5 text-xs text-slate-500">{formatFileSize(schoolFilterState.existingFileSize)}</p>
                    )}
                    {schoolFilterState.rowsDetected != null && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        <span className="font-medium">Rows:</span>{' '}
                        <span className="font-mono">{schoolFilterState.rowsDetected.toLocaleString()}</span>
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    id="schoolFilterFile"
                    name="schoolFilterFile"
                    type="file"
                    accept=".csv"
                    disabled={schoolFilterState.uploading || !isEditableExecution}
                    onChange={handleSchoolFilterFileSelect}
                    className="flex-1 !h-auto cursor-pointer border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-all hover:border-slate-400 focus-visible:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:!bg-slate-600 file:px-4 file:py-2 file:text-sm file:font-medium file:!text-white file:shadow-sm file:transition-all hover:file:!bg-slate-700 hover:file:shadow-md"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto border-slate-300 text-slate-700 hover:bg-slate-100"
                    disabled={!schoolFilterState.file || schoolFilterState.uploading || submitting || inputFileState.uploading || questionsFileState.uploading || !isEditableExecution}
                    onClick={() => void handleSchoolFilterUpload()}
                  >
                    {schoolFilterState.uploading ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        {schoolFilterState.existingUploaded ? 'Replace Filter' : 'Upload Filter'}
                      </>
                    )}
                  </Button>
                </div>

                {schoolFilterState.error && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-rose-600" />
                      <p className="text-sm text-rose-900">{schoolFilterState.error}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border border-slate-200 bg-slate-50 p-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => navigate(createStepPath)}
                    className="w-full sm:w-auto border-slate-300 text-slate-700 hover:bg-slate-100"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    type="button"
                    className="w-full sm:w-auto bg-blue-600 text-white hover:bg-blue-700"
                    disabled={loadingExecution || isUploadingAny || !hasInputAvailable || !hasQuestionsAvailable || !isEditableExecution}
                    onClick={() => void handleProceed()}
                  >
                    {isUploadingAny ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        {actionLabel}
                      </>
                    ) : (
                      <>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        {actionLabel}
                      </>
                    )}
                  </Button>
                </div>
            </div>
          )}

          {globalError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <span className="font-semibold">Error: </span>
              {globalError}
            </div>
          )}

          {globalSuccess && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
              <span className="font-semibold">Success: </span>
              {globalSuccess}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExecutionUpload;
