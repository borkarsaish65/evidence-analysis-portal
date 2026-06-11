import axios from 'axios';
import { getAccessToken, clearStoredSession } from './authStorage';
import { ENV } from '../config/env';

let refreshHandler = null;
let logoutHandler = null;
let refreshPromise = null;

export const registerAuthHandlers = ({ onRefresh, onLogout }) => {
  refreshHandler = onRefresh || null;
  logoutHandler = onLogout || null;
};

const apiClient = axios.create({
  baseURL: `${ENV.API_ENDPOINT}${ENV.API_BASE_URL}`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include token
apiClient.interceptors.request.use(
  (config) => {
    const isFormDataPayload = typeof FormData !== 'undefined' && config.data instanceof FormData;
    if (isFormDataPayload && config.headers) {
      if (typeof config.headers.set === 'function') {
        config.headers.set('Content-Type', undefined);
      } else {
        delete config.headers['Content-Type'];
        delete config.headers['content-type'];
      }
    }

    const token = getAccessToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config || {};

    if (error.response?.status !== 401 || originalRequest._retry || originalRequest.skipAuthRefresh) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      if (!refreshHandler) {
        throw new Error('Refresh handler not registered');
      }

      if (!refreshPromise) {
        refreshPromise = refreshHandler().finally(() => {
          refreshPromise = null;
        });
      }

      const refreshedToken = await refreshPromise;
      if (!refreshedToken) {
        throw new Error('Failed to refresh token');
      }

      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers.Authorization = `Bearer ${refreshedToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      clearStoredSession();
      if (logoutHandler) {
        logoutHandler();
      } else {
        window.location.href = '/login';
      }
      return Promise.reject(refreshError);
    }
  }
);

export default apiClient;
