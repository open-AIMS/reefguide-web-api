import { z } from 'zod';

export const ConfigSchema = z.object({
  // API connection settings
  apiEndpoint: z.string().url(),
  apiAuthToken: z.string(),

  // Worker identity
  ecsTaskArn: z.string(),
  ecsClusterArn: z.string(),

  // Worker behavior
  jobTypes: z.array(z.string()), // Which job types this worker can handle
  pollIntervalMs: z.number().min(1000).default(1000),
  maxConcurrentJobs: z.number().min(1).default(1),

  // HTTP server settings
  port: z.number().default(3000),
});

export type Config = z.infer<typeof ConfigSchema>;

// Load config from environment variables
export function loadConfig(): Config {
  const config = {
    apiEndpoint: process.env.API_ENDPOINT || 'http://localhost:5000',
    apiAuthToken: process.env.API_AUTH_TOKEN || '',
    ecsTaskArn: process.env.ECS_TASK_ARN,
    ecsClusterArn: process.env.ECS_CLUSTER_ARN,
    jobTypes: (process.env.JOB_TYPES || 'CRITERIA_POLYGONS').split(','),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '1'),
    port: parseInt(process.env.PORT || '3000'),
  };

  return ConfigSchema.parse(config);
}
