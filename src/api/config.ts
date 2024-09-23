import { z } from 'zod';

/**
 * Environment variable schema definition using Zod
 */
const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number),
  JWT_PRIVATE_KEY: z.string(),
  JWT_PUBLIC_KEY: z.string(),
  JWT_KEY_ID: z.string(),
  API_DOMAIN: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
});

/**
 * Configuration interface derived from the environment schema
 */
export interface Config {
  port: number;
  jwt: {
    privateKey: string;
    publicKey: string;
    keyId: string;
  };
  apiDomain: string;
  isDevelopment: boolean;
  database: {
    url: string;
    directUrl: string;
  };
}

/**
 * Retrieves and validates the configuration from environment variables
 * @returns {Config} The validated configuration object
 * @throws {Error} If environment variables are missing or invalid
 */
export function getConfig(): Config {
  // Parse and validate environment variables
  const env = envSchema.parse(process.env);

  // Replace escaped newlines in JWT keys
  const privateKey = env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
  const publicKey = env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');

  // Construct the configuration object
  const config: Config = {
    port: env.PORT,
    jwt: {
      privateKey,
      publicKey,
      keyId: env.JWT_KEY_ID,
    },
    apiDomain: env.API_DOMAIN,
    isDevelopment: env.NODE_ENV !== 'production',
    database: {
      url: env.DATABASE_URL,
      directUrl: env.DIRECT_URL,
    },
  };

  // Log configuration in non-production environments
  if (config.isDevelopment) {
    console.debug('API Configuration:', JSON.stringify(config, null, 2));
  }

  // Update process.env with parsed values
  process.env.DATABASE_URL = config.database.url;
  process.env.DIRECT_URL = config.database.directUrl;

  return config;
}

/**
 * Example usage of getConfig function
 */
try {
  const config = getConfig();
  console.log(`Server starting on port ${config.port}`);
} catch (error) {
  console.error('Failed to load configuration:', error);
  process.exit(1);
}