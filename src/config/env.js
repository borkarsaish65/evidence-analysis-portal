const getRequiredEnv = (key) => {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
};

const getEnvOrDefault = (key, defaultValue) => {
  const value = import.meta.env[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return defaultValue;
};

const parseNumber = (value, key) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${key}: ${value}`);
  }
  return parsed;
};

export const ENV = {
  API_ENDPOINT: getRequiredEnv('API_ENDPOINT'),
  API_BASE_URL: getRequiredEnv('APPLICATION_BASE_URL'),
  AUTH_REFRESH_BUFFER_MS: parseNumber(
    getRequiredEnv('APPLICATION_AUTH_REFRESH_BUFFER_MS'),
    'APPLICATION_AUTH_REFRESH_BUFFER_MS'
  ),
  AUTH_FALLBACK_EXPIRY_HOURS: parseNumber(
    getRequiredEnv('APPLICATION_AUTH_FALLBACK_EXPIRY_HOURS'),
    'APPLICATION_AUTH_FALLBACK_EXPIRY_HOURS'
  ),
  AUTH_TOKEN_STORAGE_KEY: getRequiredEnv('APPLICATION_AUTH_TOKEN_STORAGE_KEY'),
  AUTH_USER_STORAGE_KEY: getRequiredEnv('APPLICATION_AUTH_USER_STORAGE_KEY'),
  AUTH_EXPIRES_AT_STORAGE_KEY: getRequiredEnv('APPLICATION_AUTH_EXPIRES_AT_STORAGE_KEY'),
  AUTH_REMEMBER_ME_STORAGE_KEY: getRequiredEnv('APPLICATION_AUTH_REMEMBER_ME_STORAGE_KEY'),
  DEFAULT_CSV_TYPE_ID: getEnvOrDefault('APPLICATION_DEFAULT_CSV_TYPE_ID', 'project_report'),
  VALIDATE_CRITERIA_MAX_ITEMS: parseNumber(
    getEnvOrDefault('APPLICATION_VALIDATE_CRITERIA_MAX_ITEMS', '25'),
    'APPLICATION_VALIDATE_CRITERIA_MAX_ITEMS'
  ),
};
