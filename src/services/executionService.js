import apiClient from './api';

const ENTITY_ID_KEYS = ['id', '_id', 'value', 'entityId', 'stateId', 'districtId', 'code', 'externalId'];
const ENTITY_NAME_KEYS = ['name', 'label', 'title', 'entityName', 'state_name', 'district_name', 'value'];

const pickFirstString = (objectValue, keys) => {
  for (const key of keys) {
    const value = objectValue?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return '';
};

const normalizeEntityItem = (item, index) => {
  if (typeof item === 'string' || typeof item === 'number') {
    const rawValue = String(item).trim();
    return {
      id: rawValue || `entity-${index}`,
      name: rawValue || `Entity ${index + 1}`,
      raw: item,
    };
  }

  if (!item || typeof item !== 'object') {
    return {
      id: `entity-${index}`,
      name: `Entity ${index + 1}`,
      raw: item,
    };
  }

  const name = pickFirstString(item, ENTITY_NAME_KEYS);
  const id = pickFirstString(item, ENTITY_ID_KEYS) || name || `entity-${index}`;

  return {
    id,
    name: name || id,
    raw: item,
  };
};

const parseEntityResponse = (responseData, entityLabel) => {
  if (responseData?.success === false) {
    const details = responseData?.error?.details;
    const code = responseData?.error?.code;
    const serverMessage = responseData?.message || `Failed to fetch ${entityLabel}.`;
    const detailMessage = typeof details === 'string' ? details : '';
    throw new Error([serverMessage, code, detailMessage].filter(Boolean).join(' - '));
  }

  const items = Array.isArray(responseData?.data) ? responseData.data : [];
  return items.map((item, index) => normalizeEntityItem(item, index));
};

const parseConfigResponse = (responseData, configLabel) => {
  if (responseData?.success === false) {
    const details = responseData?.error?.details;
    const code = responseData?.error?.code;
    const serverMessage = responseData?.message || `Failed to fetch ${configLabel}.`;
    const detailMessage = typeof details === 'string' ? details : '';
    throw new Error([serverMessage, code, detailMessage].filter(Boolean).join(' - '));
  }

  return Array.isArray(responseData?.data) ? responseData.data : [];
};

const normalizeSourceTypeItem = (item, index) => {
  if (!item || typeof item !== 'object') {
    const fallbackKey = `source_type_${index + 1}`;
    return {
      id: fallbackKey,
      typeKey: fallbackKey,
      name: fallbackKey,
      displayName: fallbackKey,
      hasGeo: false,
      hasProgram: false,
      raw: item,
    };
  }

  const typeKey = typeof item.type_key === 'string' && item.type_key.trim() ? item.type_key.trim() : `source_type_${index + 1}`;
  const displayName =
    typeof item.display_name === 'string' && item.display_name.trim()
      ? item.display_name.trim()
      : typeKey;

  return {
    id: typeKey,
    typeKey,
    name: displayName,
    displayName,
    hasGeo: Boolean(item.has_geo),
    hasProgram: Boolean(item.has_program),
    raw: item,
  };
};

const uploadFileToSignedUrl = async (signedUpload, file) => {
  const headers = { ...(signedUpload?.headers || {}) };
  const hasCustomHeaders = Object.keys(headers).length > 0;
  const uploadBody = hasCustomHeaders ? file : await file.arrayBuffer();

  let response;
  try {
    response = await fetch(signedUpload.url, {
      method: signedUpload.method || 'PUT',
      headers,
      body: uploadBody,
      mode: 'cors',
    });
  } catch (error) {
    throw new Error(
      'Cloud upload failed before completion. Check signed URL expiry/CORS and retry with a fresh upload request.'
    );
  }

  if (!response.ok) {
    let backendMessage = '';
    try {
      const responseText = await response.text();
      if (responseText) {
        const messageMatch = responseText.match(/<Message>(.*?)<\/Message>/i);
        backendMessage = messageMatch?.[1] || responseText.slice(0, 200);
      }
    } catch (error) {
      backendMessage = '';
    }
    const suffix = backendMessage ? ` - ${backendMessage}` : '';
    throw new Error(`Cloud upload failed with status ${response.status}${suffix}`);
  }
};

const formatErrorDetailItem = (item) => {
  if (typeof item === 'string' && item.trim()) {
    return item.trim();
  }

  if (!item || typeof item !== 'object') {
    return '';
  }

  const message = typeof item.msg === 'string' && item.msg.trim() ? item.msg.trim() : '';
  const location = Array.isArray(item.loc)
    ? item.loc
        .map((segment) => (typeof segment === 'string' || typeof segment === 'number' ? String(segment).trim() : ''))
        .filter(Boolean)
        .join('.')
    : '';

  if (location && message) {
    return `${location}: ${message}`;
  }
  if (message) {
    return message;
  }

  const detail = typeof item.detail === 'string' && item.detail.trim() ? item.detail.trim() : '';
  if (detail) {
    return detail;
  }

  return '';
};

export const getApiErrorMessage = (error, fallbackMessage = 'Request failed.') => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }

  if (Array.isArray(detail)) {
    const parts = detail.map(formatErrorDetailItem).filter(Boolean);
    if (parts.length > 0) {
      return parts.join('; ');
    }
  }

  if (detail && typeof detail === 'object') {
    const part = formatErrorDetailItem(detail);
    if (part) {
      return part;
    }
  }

  const message = error?.response?.data?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
};

const buildDownloadErrorMessage = (error, fallbackMessage) => {
  const rawResponseData = error?.response?.data;

  if (typeof rawResponseData === 'string' && rawResponseData.trim()) {
    const responseText = rawResponseData.trim();

    try {
      const parsed = JSON.parse(responseText);
      if (typeof parsed?.detail === 'string' && parsed.detail.trim()) {
        return parsed.detail.trim();
      }
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch (parseError) {
      // Non-JSON text response; return short plain text as-is.
      if (!responseText.startsWith('<')) {
        return responseText;
      }
    }
  }

  return getApiErrorMessage(error, fallbackMessage);
};

const triggerBrowserDownload = (blob, filename) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.setAttribute('download', filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
};

export const executionService = {
  // Validate evidence criteria against an evidence image URL
  validateCriteria: async ({ evidence_url, evidence_criteria, prompt = null }) => {
    const payload = {
      evidence_url,
      evidence_criteria,
      prompt,
    };
    const response = await apiClient.post('/criteria/validate', payload);
    return response.data;
  },

  // Step 1: Create analysis draft
  createExecutionDraft: async ({
    name,
    csv_type_id,
    states,
    program_name,
    ai_model_id,
    program_ref_id,
    criterias_mode,
    threshold_config,
    evidence_threshold,
  }) => {
    const payload = {
      name,
      csv_type_id,
      states,
      program_name,
      ai_model_id,
      program_ref_id,
      criterias_mode,
      threshold_config,
    };
    if (evidence_threshold != null) {
      payload.evidence_threshold = evidence_threshold;
    }
    const response = await apiClient.post('/executions/', payload);
    return response.data;
  },

  // Step 2: Get signed URL for file section
  requestExecutionFileUploadUrl: async (executionId, fileType, file) => {
    const payload = {
      file: {
        file_name: file.name,
        content_type: file.type || 'text/csv',
        size_bytes: file.size,
      },
    };
    const response = await apiClient.post(`/executions/${executionId}/files/${fileType}/upload-url`, payload);
    return response.data;
  },

  // Step 2 (common): Get signed URLs for multiple files at once
  getCommonExecutionUploadUrls: async (executionId, files) => {
    const payload = {
      request: {
        [executionId]: {
          files: files.map((file) => file.name),
        },
      },
      ref: 'execution',
    };
    const response = await apiClient.post('/cloud-services/getSignedUrl', payload);
    return response.data;
  },

  uploadToSignedUrl: async (signedUpload, file) => {
    await uploadFileToSignedUrl(signedUpload, file);
  },

  // Step 2: Confirm upload and detect rows/columns
  completeExecutionFileUpload: async (executionId, fileType) => {
    const response = await apiClient.post(`/executions/${executionId}/files/${fileType}/complete`);
    return response.data;
  },

  // Step 2 fallback: Upload via backend (avoids browser-to-cloud CORS issues)
  directUploadExecutionFile: async (executionId, fileType, file) => {
    const formData = new FormData();
    formData.append('execution_id', executionId);
    formData.append('file_type', fileType);
    formData.append('file', file);
    const response = await apiClient.post('/cloud-services/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Optimized: Upload both files in a single API call
  uploadBothFiles: async (executionId, inputFile, questionsFile) => {
    const formData = new FormData();
    formData.append('input_file', inputFile);
    formData.append('questions_file', questionsFile);
    const response = await apiClient.post(`/executions/${executionId}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Step 3: Validate both uploaded files
  validateExecutionFiles: async (executionId) => {
    const response = await apiClient.post(`/executions/${executionId}/validate`);
    return response.data;
  },

  // Step 4: Start analysis
  startExecution: async (executionId) => {
    const response = await apiClient.post(`/executions/${executionId}/start`);
    return response.data;
  },

  // Rerun a failed analysis
  rerunExecution: async (executionId) => {
    const response = await apiClient.post(`/executions/${executionId}/rerun`);
    return response.data;
  },

  // Create execution with signed URL upload flow
  createExecution: async ({
    name,
    csv_type_id,
    states,
    program_name,
    ai_model_id,
    program_ref_id,
    criterias_mode,
    inputFile,
    questionsFile,
  }) => {
    const initPayload = {
      name,
      csv_type_id,
      states,
      program_name,
      ai_model_id,
      program_ref_id,
      criterias_mode,
      input_file: {
        file_name: inputFile.name,
        content_type: inputFile.type || 'text/csv',
        size_bytes: inputFile.size,
      },
      questions_file: {
        file_name: questionsFile.name,
        content_type: questionsFile.type || 'text/csv',
        size_bytes: questionsFile.size,
      },
    };

    const initResponse = await apiClient.post('/executions/init-upload', initPayload);
    const initData = initResponse.data;

    await Promise.all([
      uploadFileToSignedUrl(initData.input_upload, inputFile),
      uploadFileToSignedUrl(initData.questions_upload, questionsFile),
    ]);

    const completeResponse = await apiClient.post(`/executions/${initData.execution_id}/complete-upload`);
    return completeResponse.data;
  },

  // Get execution list
  getExecutions: async (page = 1, pageSize = 20, statusOrOptions = null, options = {}) => {
    const params = { page, page_size: pageSize };

    if (statusOrOptions && typeof statusOrOptions === 'object' && !Array.isArray(statusOrOptions)) {
      Object.assign(params, statusOrOptions);
    } else {
      if (statusOrOptions) params.status_filter = statusOrOptions;
      if (options && typeof options === 'object') {
        Object.assign(params, options);
      }
    }

    const response = await apiClient.get('/executions/', { params });
    return response.data;
  },

  // Get execution details
  getExecution: async (executionId) => {
    const response = await apiClient.get(`/executions/${executionId}`);
    return response.data;
  },

  // Get execution status
  getExecutionStatus: async (executionId) => {
    const response = await apiClient.get(`/executions/${executionId}/status`);
    return response.data;
  },

  // Get read-only preview rows for one execution file
  getExecutionFilePreview: async (executionId, fileType, limit = 10) => {
    const response = await apiClient.get(`/executions/${executionId}/files/${fileType}/preview`, {
      params: { limit },
    });
    return response.data;
  },

  // Update execution (only drafts)
  updateExecution: async (executionId, updateData) => {
    const response = await apiClient.patch(`/executions/${executionId}`, updateData);
    return response.data;
  },

  // Delete execution
  deleteExecution: async (executionId) => {
    await apiClient.delete(`/executions/${executionId}`);
  },

  // Upload optional school filter CSV
  uploadSchoolFilterFile: async (executionId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/executions/${executionId}/files/school_filter/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};

export const entityService = {
  getStates: async () => {
    const response = await apiClient.get('/states');
    return parseEntityResponse(response.data, 'states');
  },

  getDistricts: async (stateId) => {
    const response = await apiClient.get('/districts', {
      params: { stateId },
    });
    return parseEntityResponse(response.data, 'districts');
  },
};

export const configService = {
  listProjectCsvSourceTypes: async () => {
    const response = await apiClient.get('/config/list', {
      params: { type: 'project' },
    });
    const items = parseConfigResponse(response.data, 'project CSV source types');
    return items.map((item, index) => normalizeSourceTypeItem(item, index));
  },

  getSampleCsvUrl: async (typeId, fileType) => {
    const response = await apiClient.get(`/config/csv-source-types/${typeId}/sample/${fileType}`);
    return response.data;
  },
};

export const reportService = {
  // Get report data
  getReport: async (executionId) => {
    const response = await apiClient.get(`/reports/${executionId}`);
    return response.data;
  },

  // Get paginated report data with pre-aggregated summary (replaces full-CSV download)
  getReportDataPage: async (executionId, { page = 1, pageSize = 1000, state, district, block, school, relevance } = {}) => {
    const params = { page, page_size: pageSize };
    if (state) params.state = state;
    if (district) params.district = district;
    if (block) params.block = block;
    if (school) params.school = school;
    if (relevance) params.relevance = relevance;
    const response = await apiClient.get(`/reports/${executionId}/data`, { params });
    return response.data;
  },

  // Get validated CSV content for report rendering (legacy path — kept for ReportsList local upload)
  getReportCsv: async (executionId) => {
    const response = await apiClient.get(`/reports/${executionId}/csv`, {
      responseType: 'text',
    });
    return response.data;
  },

  // Get HTML report
  getHtmlReport: async (executionId) => {
    const response = await apiClient.get(`/reports/${executionId}/html`);
    return response.data;
  },

  // Download report CSV via backend and save locally
  downloadReport: async (executionId, format = 'csv') => {
    if (format !== 'csv') {
      throw new Error(`Unsupported format: ${format}`);
    }

    try {
      const response = await apiClient.get(`/reports/${executionId}/csv`, {
        responseType: 'text',
      });

      const csvText = typeof response?.data === 'string' ? response.data : '';
      if (!csvText.trim()) {
        throw new Error('Downloaded report is empty.');
      }

      triggerBrowserDownload(
        new Blob([csvText], { type: 'text/csv;charset=utf-8;' }),
        `execution_${executionId}_output.csv`
      );
    } catch (error) {
      throw new Error(buildDownloadErrorMessage(error, 'Failed to download report CSV.'));
    }
  },
};
