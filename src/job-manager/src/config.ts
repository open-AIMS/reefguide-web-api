import { JobType } from '@prisma/client';
import { z } from 'zod';

// Configuration schema for job types and their corresponding ECS resources
export const JobTypeConfigSchema = z.object({
  taskDefinitionArn: z.string().min(1, 'Task Definition ARN is required'),
  clusterArn: z.string().min(1, 'Cluster ARN is required'),
  desiredMinCapacity: z
    .number()
    .min(0, 'Minimum capacity must be non-negative'),
  desiredMaxCapacity: z
    .number()
    .min(0, 'Maximum capacity must be non-negative'),
  scaleUpThreshold: z.number().min(1, 'Scale-up threshold must be at least 1'),
  cooldownSeconds: z.number().min(0, 'Cooldown seconds must be non-negative'),
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

// Job type specific environment variable fields that will be expected for each job type
const JOB_TYPE_ENV_FIELDS = {
  TASK_DEF: 'taskDefinitionArn',
  CLUSTER: 'clusterArn',
  MIN_CAPACITY: 'desiredMinCapacity',
  MAX_CAPACITY: 'desiredMaxCapacity',
  SCALE_THRESHOLD: 'scaleUpThreshold',
  COOLDOWN: 'cooldownSeconds',
  SECURITY_GROUP: 'securityGroup',
};

// Final configuration schema structure
export const ConfigSchema = z.object({
  pollIntervalMs: z.number().min(1000, 'Poll interval must be at least 1000ms'),
  apiEndpoint: z.string().url('API endpoint must be a valid URL'),
  region: z.string().min(1, 'AWS region is required'),
  jobTypes: z.record(z.nativeEnum(JobType), JobTypeConfigSchema),
  auth: z.object({
    email: z.string().min(1, 'Email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
  vpcId: z.string().min(1, 'VPC ID is required'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Creates a Zod schema for all environment variables based on available job types
 * Dynamically generates validation for each job type's environment variables
 *
 * @returns Zod schema for environment variables
 */
export function createEnvVarsSchema(): z.ZodObject<any> {
  // Start with the base config schema
  let envSchema: Record<string, any> = { ...BaseEnvConfigSchema.shape };

  // For each job type in the enum, add its specific environment variables
  Object.values(JobType).forEach(jobType => {
    const typePrefix = jobType.toString();

    // Add each field for this job type
    Object.entries(JOB_TYPE_ENV_FIELDS).forEach(([envSuffix, configField]) => {
      const envVarName = `${typePrefix}_${envSuffix}`;

      // Handle numeric fields with transformation
      if (
        [
          'MIN_CAPACITY',
          'MAX_CAPACITY',
          'SCALE_THRESHOLD',
          'COOLDOWN',
        ].includes(envSuffix)
      ) {
        envSchema[envVarName] = z
          .string()
          .transform(val => {
            const parsed = parseInt(val);
            if (isNaN(parsed)) {
              throw new Error(`${envVarName} must be a valid number`);
            }
            return parsed;
          })
          .describe(`${configField} for ${typePrefix} job type`);
      } else {
        // String fields
        envSchema[envVarName] = z
          .string()
          .min(1, `${envVarName} is required for ${typePrefix} job type`)
          .describe(`${configField} for ${typePrefix} job type`);
      }
    });
  });

  // Return the complete environment variables schema
  return z.object(envSchema);
}

/**
 * Builds job type configuration from environment variables
 *
 * @param env Validated environment variables
 * @param jobType The job type to build configuration for
 * @returns Configuration for the specified job type
 */
function buildJobTypeConfig(
  env: Record<string, any>,
  jobType: string,
): JobTypeConfig {
  try {
    return {
      taskDefinitionArn: env[`${jobType}_TASK_DEF`],
      clusterArn: env[`${jobType}_CLUSTER`],
      desiredMinCapacity: env[`${jobType}_MIN_CAPACITY`],
      desiredMaxCapacity: env[`${jobType}_MAX_CAPACITY`],
      scaleUpThreshold: env[`${jobType}_SCALE_THRESHOLD`],
      cooldownSeconds: env[`${jobType}_COOLDOWN`],
      securityGroup: env[`${jobType}_SECURITY_GROUP`],
    };
  } catch (error) {
    throw new Error(
      `Failed to build configuration for job type ${jobType}: ${error}`,
    );
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
    // Create the environment schema based on available job types
    const EnvVarsSchema = createEnvVarsSchema();

    // Validate all required environment variables
    const env = EnvVarsSchema.parse(process.env);

    // Initialize job types configuration object
    const jobTypesConfig: Record<string, JobTypeConfig> = {};

    // Build configuration for each job type
    Object.values(JobType).forEach(jobType => {
      const typeString = jobType.toString();
      jobTypesConfig[typeString] = buildJobTypeConfig(env, typeString);
    });

    // Construct the complete config object with validated values
    const config: Config = {
      pollIntervalMs: env.POLL_INTERVAL_MS,
      apiEndpoint: env.API_ENDPOINT,
      region: env.AWS_REGION,
      jobTypes: jobTypesConfig,
      auth: {
        email: env.API_USERNAME,
        password: env.API_PASSWORD,
      },
      vpcId: env.VPC_ID,
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
