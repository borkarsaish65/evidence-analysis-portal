import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const getRequiredEnv = (env, key) => {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
};

const parseNumber = (value, key) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${key}: ${value}`);
  }
  return parsed;
};

const parseBoolean = (value, key) => {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`Invalid boolean value for ${key}: ${value}`);
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const applicationPort = parseNumber(getRequiredEnv(env, 'APPLICATION_PORT'), 'APPLICATION_PORT');
  const buildOutDir = getRequiredEnv(env, 'APPLICATION_BUILD_OUT_DIR');
  const buildSourcemap = parseBoolean(
    getRequiredEnv(env, 'APPLICATION_BUILD_SOURCEMAP'),
    'APPLICATION_BUILD_SOURCEMAP'
  );

  return {
    plugins: [react()],
    envPrefix: ['APPLICATION_', 'API_'],
    server: {
      port: applicationPort,
    },
    build: {
      outDir: buildOutDir,
      sourcemap: buildSourcemap,
    }
  };
})
