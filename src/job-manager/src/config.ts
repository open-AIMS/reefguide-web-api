import { z } from 'zod';

// Configuration schema for job types and their corresponding ECS resources
export const JobTypeConfigSchema = z.object({
  taskDefinitionArn: z.string().min(1, 'Task Definition ARN is required'),
  clusterArn: z.string().min(1, 'Cluster ARN is required'),
  desiredMinCapacity: z.number().min(0),
  desiredMaxCapacity: z.number().min(0),
  scaleUpThreshold: z.number().min(1),
  cooldownSeconds: z.number().min(0),
  // Security group ARN for this task
  securityGroup: z.string(),
});

// Schema for validating environment variables
export const EnvVarsSchema = z.object({
  POLL_INTERVAL_MS: z.string().transform(val => parseInt(val)),
  API_ENDPOINT: z.string().url(),
  AWS_REGION: z.string().min(1, 'AWS region is required'),
  API_USERNAME: z.string().min(1, 'API username is required'),
  API_PASSWORD: z.string().min(1, 'API password is required'),
  VPC_ID: z.string(),
  // CRITERIA_POLYGONS environment variables
  CRITERIA_POLYGONS_TASK_DEF: z
    .string()
    .min(1, 'Task definition ARN is required'),
  CRITERIA_POLYGONS_CLUSTER: z.string().min(1, 'Cluster ARN is required'),
  CRITERIA_POLYGONS_MIN_CAPACITY: z.string().transform(val => parseInt(val)),
  CRITERIA_POLYGONS_MAX_CAPACITY: z.string().transform(val => parseInt(val)),
  CRITERIA_POLYGONS_SCALE_THRESHOLD: z.string().transform(val => parseInt(val)),
  CRITERIA_POLYGONS_COOLDOWN: z.string().transform(val => parseInt(val)),
  CRITERIA_POLYGONS_SECURITY_GROUP: z.string(),
});

export const ConfigSchema = z.object({
  pollIntervalMs: z.number().min(1000),
  apiEndpoint: z.string().url(),
  region: z.string(),
  jobTypes: z.record(z.string(), JobTypeConfigSchema),
  auth: z.object({
    email: z.string(),
    password: z.string(),
  }),
  vpcId: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type JobTypeConfig = z.infer<typeof JobTypeConfigSchema>;

// Function to load and validate configuration
export function loadConfig(): Config {
  // First validate all required environment variables
  const env = EnvVarsSchema.parse(process.env);

  // Then construct the config object with validated values
  const config: Config = {
    pollIntervalMs: env.POLL_INTERVAL_MS,
    apiEndpoint: env.API_ENDPOINT,
    region: env.AWS_REGION,
    jobTypes: {
      CRITERIA_POLYGONS: {
        taskDefinitionArn: env.CRITERIA_POLYGONS_TASK_DEF,
        clusterArn: env.CRITERIA_POLYGONS_CLUSTER,
        desiredMinCapacity: env.CRITERIA_POLYGONS_MIN_CAPACITY,
        desiredMaxCapacity: env.CRITERIA_POLYGONS_MAX_CAPACITY,
        scaleUpThreshold: env.CRITERIA_POLYGONS_SCALE_THRESHOLD,
        cooldownSeconds: env.CRITERIA_POLYGONS_COOLDOWN,
        securityGroup: env.CRITERIA_POLYGONS_SECURITY_GROUP,
      },
    },
    auth: {
      email: env.API_USERNAME,
      password: env.API_PASSWORD,
    },
    vpcId: env.VPC_ID,
  };

  // Validate the entire config object
  return ConfigSchema.parse(config);
}