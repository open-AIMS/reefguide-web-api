import { z } from 'zod';

// Configuration schema for job types and their corresponding ECS resources
export const JobTypeConfigSchema = z.object({
  taskDefinitionArn: z.string(),
  clusterArn: z.string(),
  desiredMinCapacity: z.number().min(0),
  desiredMaxCapacity: z.number().min(0),
  scaleUpThreshold: z.number().min(1),
  cooldownSeconds: z.number().min(0),
});

export const ConfigSchema = z.object({
  pollIntervalMs: z.number().min(1000),
  apiEndpoint: z.string().url(),
  apiAuthToken: z.string(),
  region: z.string(),
  jobTypes: z.record(z.string(), JobTypeConfigSchema),
});

export type Config = z.infer<typeof ConfigSchema>;
export type JobTypeConfig = z.infer<typeof JobTypeConfigSchema>;

// Read configuration from environment
export const config: Config = {
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000'),
  apiEndpoint: process.env.API_ENDPOINT || 'http://localhost:5000',
  apiAuthToken: process.env.API_AUTH_TOKEN || '',
  region: process.env.AWS_REGION || 'ap-southeast-2',
  jobTypes: {
    CRITERIA_POLYGONS: {
      taskDefinitionArn: process.env.CRITERIA_POLYGONS_TASK_DEF || '',
      clusterArn: process.env.CRITERIA_POLYGONS_CLUSTER || '',
      desiredMinCapacity: parseInt(process.env.CRITERIA_POLYGONS_MIN_CAPACITY || '0'),
      desiredMaxCapacity: parseInt(process.env.CRITERIA_POLYGONS_MAX_CAPACITY || '5'),
      scaleUpThreshold: parseInt(process.env.CRITERIA_POLYGONS_SCALE_THRESHOLD || '1'),
      cooldownSeconds: parseInt(process.env.CRITERIA_POLYGONS_COOLDOWN || '60'),
    },
  },
};