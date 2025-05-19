import { JobType } from '@prisma/client';
import { z } from 'zod';

export const ScalingConfiguration = z.object({
  min: z.number().min(0, 'Minimum capacity must be non-negative'),
  max: z.number().min(0, 'Maximum capacity must be non-negative'),
  sensitivity: z
    .number()
    .min(1, 'Logarithmic sensitivity - see scaling algorithm'),
  factor: z
    .number()
    .min(
      1,
      'Division factor for jobs - this allows you to consider different job count scales.',
    ),
  cooldownSeconds: z.number().min(0, 'Cooldown seconds must be non-negative'),
});
// Configuration schema for job types and their corresponding ECS resources
export const JobTypeConfigSchema = z.object({
  taskDefinitionArn: z.string().min(1, 'Task Definition ARN is required'),
  clusterArn: z.string().min(1, 'Cluster ARN is required'),
  scaling: ScalingConfiguration,
  // Security group ARN for this task
  securityGroup: z.string().min(1, 'Security group ARN is required'),
});

export type JobTypeConfig = z.infer<typeof JobTypeConfigSchema>;

// Base configuration schema (not job-type specific)
export const BaseEnvConfigSchema = z.object({
  POLL_INTERVAL_MS: z.string().transform(val => parseInt(val)),
  API_ENDPOINT: z.string().url('API endpoint must be a valid URL'),
  AWS_REGION: z.string().min(1, 'AWS region is required'),
  API_USERNAME: z.string().min(1, 'API username is required'),
  API_PASSWORD: z.string().min(1, 'API password is required'),
  VPC_ID: z.string().min(1, 'VPC ID is required'),
});

// Final configuration schema structure
export const ConfigSchema = z.object({
  pollIntervalMs: z.number().min(1000, 'Poll interval must be at least 1000ms'),
  apiEndpoint: z.string().url('API endpoint must be a valid URL'),
  region: z.string().min(1, 'AWS region is required'),
  jobTypes: z.record(
    z.nativeEnum(JobType),
    JobTypeConfigSchema.extend({ jobTypes: z.array(z.nativeEnum(JobType)) }),
  ),
  auth: z.object({
    email: z.string().min(1, 'Email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
  vpcId: z.string().min(1, 'VPC ID is required'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Builds job type configuration from environment variables
 *
 * @param env Validated environment variables
 * @param jobType The job type to build configuration for
 * @returns Configuration for the specified job type
 */
function buildJobTypeConfig(
  env: Record<string, string | number>,
  jobType: string,
): JobTypeConfig {
  const optimisticParse = {
    taskDefinitionArn: env[`${jobType}_TASK_DEF`] as string,
    clusterArn: env[`${jobType}_CLUSTER`] as string,
    scaling: {
      min: env[`${jobType}_MIN_CAPACITY`] as number,
      max: env[`${jobType}_MAX_CAPACITY`] as number,
      cooldownSeconds: env[`${jobType}_COOLDOWN`] as number,
      sensitivity: env[`${jobType}_SENSITIVITY`] as number,
      factor: env[`${jobType}_FACTOR`] as number,
    },
    securityGroup: env[`${jobType}_SECURITY_GROUP`] as string,
  } satisfies JobTypeConfig;
  try {
    return JobTypeConfigSchema.parse(optimisticParse);
  } catch (e) {
    console.error(
      `Job type ${jobType} did not have valid environment variables. Error: ${e}.`,
    );
    throw e;
  }
}

/**
 * Loads and validates application configuration from environment variables
 * Dynamically handles all job types defined in the JobType enum
 *
 * @returns Validated configuration object
 * @throws Error if configuration validation fails
 */
export function loadConfig(): Config {
  try {
    // Force types here as we zod process everything!
    const env = process.env as Record<string, string | number>;
    // Initialize job types configuration object
    const jobTypesConfig: Record<
      string,
      JobTypeConfig & { jobTypes?: JobType[] }
    > = {};

    // Build configuration for each job type
    Object.values(JobType).forEach(jobType => {
      const typeString = jobType.toString();
      jobTypesConfig[typeString] = buildJobTypeConfig(
        env as Record<string, number | string>,
        typeString,
      );
    });

    // Group the job types by task ARN
    const arnToTypes: Map<string, JobType[]> = new Map();
    for (const [jobType, config] of Object.entries(jobTypesConfig)) {
      arnToTypes.set(
        config.taskDefinitionArn,
        (arnToTypes.get(config.taskDefinitionArn) ?? []).concat([
          jobType as JobType,
        ]),
      );
    }

    // Update with grouped types
    for (let config of Object.values(jobTypesConfig)) {
      config.jobTypes = arnToTypes.get(config.taskDefinitionArn);
    }

    // Construct the complete config object with validated values
    const config: Config = {
      pollIntervalMs: env.POLL_INTERVAL_MS as number,
      apiEndpoint: env.API_ENDPOINT as string,
      region: env.AWS_REGION as string,
      jobTypes: jobTypesConfig,
      auth: {
        email: env.API_USERNAME as string,
        password: env.API_PASSWORD as string,
      },
      vpcId: env.VPC_ID as string,
    };

    // Validate the entire config object
    return ConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Format Zod validation errors for better readability
      const formattedErrors = error.errors
        .map(err => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`Configuration validation failed:\n${formattedErrors}`);
    }
    throw new Error(`Failed to load configuration: ${error}`);
  }
}
