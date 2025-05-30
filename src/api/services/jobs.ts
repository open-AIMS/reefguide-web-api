// jobs.ts
import {
  Job,
  JobRequest,
  JobStatus,
  JobType,
  StorageScheme,
} from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../apiSetup';
import { config } from '../config';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '../exceptions';
import { hashObject } from '../util';

/**
 * Type definition mapping job types to their input/output schemas
 */
type JobSchemaMap = {
  [K in JobType]?: {
    input: z.ZodType<any>;
    result?: z.ZodType<any>;
  };
};

/** Expiry time map */
type JobExpiryMap = {
  [K in JobType]?: {
    expiryMinutes: number;
  };
};

const sharedCriteriaSchema = z.object({
  // High level config - common to all current scenarios
  region: z.string().describe('Region for assessment'),
  reef_type: z.string().describe('The type of reef, slopes or flats'),

  // Criteria - all optional to match the Union{Float64,Nothing} in worker
  depth_min: z.number().optional()
    .describe('The depth minimum (the deeper more negative value)'),
  depth_max: z.number().optional()
    .describe('The depth maximum (the shallower less negative value)'),
  slope_min: z.number().optional().describe('The slope range (min)'),
  slope_max: z.number().optional().describe('The slope range (max)'),
  rugosity_min: z.number().optional().describe('The rugosity range (min)'),
  rugosity_max: z.number().optional().describe('The rugosity range (max)'),
  waves_period_min: z
    .number()
    .optional()
    .describe('The wave period range (min)'),
  waves_period_max: z
    .number()
    .optional()
    .describe('The wave period range (max)'),
  waves_height_min: z
    .number()
    .optional()
    .describe('The wave height range (min)'),
  waves_height_max: z
    .number()
    .optional()
    .describe('The wave height range (max)'),
  threshold: z
    .number()
    .optional()
    .describe('Suitability threshold integer (min)'),
});

/**
 * Schema definitions for each job type's input and output payloads.
 * Each job type must define an input schema and may optionally define a result schema.
 */
export const jobTypeSchemas: JobSchemaMap = {
  TEST: {
    input: z
      .object({
        // This is just to break up the hash
        id: z.number(),
      })
      .strict(),
    result: z.object({}).strict().optional(),
  },
  // The suitability assessment job takes in regional parameters and returns the location of the file relative to the job storage location.
  SUITABILITY_ASSESSMENT: {
    // base criteria + x/y size
    input: sharedCriteriaSchema
      .extend({
        x_dist: z.number().describe('Length (m) of the target polygon'),
        y_dist: z.number().describe('Width (m) of the target polygon'),
      })
      .strict(),
    result: z
      .object({
        geojson_path: z
          .string()
          .describe(
            'Relative path in job storage location to the GeoJSON file containing assessment results',
          ),
      })
      .strict(),
  },
  REGIONAL_ASSESSMENT: {
    // Just base criteria
    input: sharedCriteriaSchema.strict(),
    result: z
      .object({
        cog_path: z
          .string()
          .describe(
            'Relative location of the COG file in the output directory',
          ),
      })
      .strict(),
  },
};

export const jobExpiryMap: JobExpiryMap = {
  TEST: {
    // expires in one hour
    expiryMinutes: 60,
  },
  SUITABILITY_ASSESSMENT: {
    // expires in one hour
    expiryMinutes: 60,
  },
};

/**
 * Service class handling job-related operations including creation, assignment,
 * result submission, and job management.
 */
export class JobService {
  /**
   * Generates a storage location for job results
   * @param jobType - Type of job being processed
   * @param jobId - ID of the job
   * @returns Object containing storage scheme and URI
   */
  private generateStorageLocation(
    jobType: JobType,
    jobId: number,
  ): {
    scheme: StorageScheme;
    uri: string;
  } {
    const bucketName = config.s3.bucketName;
    const bucketPrefix = 'results';
    return {
      scheme: StorageScheme.S3,
      uri: `s3://${bucketName}/${bucketPrefix}/${jobType.toLowerCase()}/${jobId}/${Date.now()}`,
    };
  }

  /**
   * Validates a job's input payload against its type-specific schema
   * @param jobType - Type of job being validated
   * @param payload - Input payload to validate
   * @throws BadRequestException if validation fails
   */
  async validateJobPayload(jobType: JobType, payload: any) {
    const schema = jobTypeSchemas[jobType]?.input;
    if (!schema) {
      throw new BadRequestException(`Invalid job type: ${jobType}`);
    }
    try {
      return schema.parse(payload);
    } catch (e) {
      throw new BadRequestException(`Invalid payload for job type ${jobType}`);
    }
  }

  /**
   * Validates a job's result payload against its type-specific schema
   * @param jobType - Type of job being validated
   * @param payload - Result payload to validate
   * @throws BadRequestException if validation fails
   */
  async validateResultPayload(jobType: JobType, payload: any) {
    const schema = jobTypeSchemas[jobType]?.result;
    if (!schema) return true; // No validation if no schema
    try {
      return schema.parse(payload);
    } catch (e) {
      throw new BadRequestException(
        `Invalid result payload for job type ${jobType}`,
      );
    }
  }

  public async checkJobCache(
    jobPaylod: any,
    jobType: JobType,
  ): Promise<Job | undefined> {
    // Calculate job hash
    const hash = await this.generateJobHash({ jobType, payload: jobPaylod });
    // Find jobs with a matching hash
    const existingJobs = await prisma.job.findMany({ where: { hash } });

    // What jobs are we interested in - those that are incomplete, or
    // successful. Choose the latest edition.
    let bestCandidate: Job | undefined = undefined;
    for (const job of existingJobs) {
      if (!bestCandidate) {
        bestCandidate = job;
        continue;
      }

      // If the job is successful, always prioritise unless another successful job which is newer
      if (job.status === 'SUCCEEDED') {
        // We have a candidate, is this one better?
        if (job.created_at > bestCandidate.created_at) {
          // this one is newer - so let's keep it
          bestCandidate = job;
          continue;
        }

        // Otherwise - proceed on
        continue;
      }

      // The job is not successful, is it in progress at least?
      if (job.status === 'PENDING' || job.status === 'IN_PROGRESS') {
        // If current job is succesful, keep it
        if (bestCandidate.status === 'SUCCEEDED') {
          // keep the successful
          continue;
        }

        // Is it also a pending/in progress?
        if (
          bestCandidate.status === 'PENDING' ||
          bestCandidate.status === 'IN_PROGRESS'
        ) {
          // This is a 'tie' - choose newer
          if (job.created_at > bestCandidate.created_at) {
            // this one is newer - so let's keep it
            bestCandidate = job;
            continue;
          }
        }

        // Otherwise it must have failed, pick new one
        bestCandidate = job;
        continue;
      }

      // The job must be failed - if we have any job of superior status, keep it
      if (
        bestCandidate.status === 'SUCCEEDED' ||
        bestCandidate.status === 'IN_PROGRESS' ||
        bestCandidate.status === 'PENDING'
      ) {
        // keep the successful
        continue;
      }

      // This is a 'tie' - choose newer
      if (job.created_at > bestCandidate.created_at) {
        // this one is newer - so let's keep it
        bestCandidate = job;
        continue;
      }
    }

    // return the best candidate with hash match
    return bestCandidate;
  }

  /**
   * Creates a new job request and either returns a cached job or creates a new
   * one
   * @param userId - ID of user creating the job
   * @param jobType - Type of job to create
   * @param inputPayload - Input parameters for the job
   * @returns Object containing the job and whether it was cached
   */
  async createJobRequest(userId: number, jobType: JobType, inputPayload: any) {
    await this.validateJobPayload(jobType, inputPayload);

    // Check cache first
    const cachedJob = await this.checkJobCache(inputPayload, jobType);
    const cacheHit = cachedJob !== undefined;

    // Start a transaction to create both the job request and job if needed
    const result = await prisma.$transaction(async prisma => {
      let job: Job;

      if (cacheHit && cachedJob) {
        job = cachedJob;
      } else {
        // Create new job
        job = await prisma.job.create({
          data: {
            type: jobType,
            user_id: userId,
            input_payload: inputPayload,
            status: JobStatus.PENDING,
            hash: await this.generateJobHash({
              payload: inputPayload,
              jobType: jobType,
            }),
          },
        });
      }

      // Create job request record
      const jobRequest = await prisma.jobRequest.create({
        data: {
          user_id: userId,
          type: jobType,
          input_payload: inputPayload,
          cache_hit: cacheHit,
          job_id: job.id,
        },
      });

      return { job, jobRequest, cached: cacheHit };
    });

    return result;
  }

  /**
   * Polls for available jobs that haven't been assigned or have expired assignments
   * @param jobType - Optional job type to filter by
   * @returns Array of available jobs, limited to 10 at a time
   */
  async pollJobs(jobType?: JobType) {
    const now = new Date();
    return prisma.job.findMany({
      where: {
        status: JobStatus.PENDING,
        ...(jobType && { type: jobType }),
        assignments: {
          // Only jobs with NO assignment which is incomplete and valid should
          // be considered
          none: {
            // If either not complete, or not expired, we can't reassign this
            OR: [{ completed_at: null }, { expires_at: { gt: now } }],
          },
        },
      },
      // Max of 10
      take: 10,
      // Oldest first
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Assigns a job to a worker node
   * @param jobId - ID of job to assign
   * @param ecsTaskArn - ARN of ECS task
   * @param ecsClusterArn - ARN of ECS cluster
   * @returns Created job assignment
   * @throws NotFoundException if job doesn't exist
   * @throws BadRequestException if job isn't available
   */
  async assignJob(jobId: number, ecsTaskArn: string, ecsClusterArn: string) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { assignments: true },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== JobStatus.PENDING) {
      throw new BadRequestException('Job is not available for assignment');
    }

    const storage = this.generateStorageLocation(job.type, job.id);

    // One hour default - get job type expiry
    const expiryMinutes = jobExpiryMap[job.type]?.expiryMinutes ?? 60;
    const expiryTime = new Date();
    expiryTime.setMinutes(expiryTime.getMinutes() + expiryMinutes);

    const [assignment] = await prisma.$transaction([
      prisma.jobAssignment.create({
        data: {
          job_id: jobId,
          ecs_task_arn: ecsTaskArn,
          ecs_cluster_arn: ecsClusterArn,
          expires_at: expiryTime,
          storage_scheme: storage.scheme,
          storage_uri: storage.uri,
        },
      }),
      prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.IN_PROGRESS },
      }),
    ]);

    return assignment;
  }

  /**
   * Submits results for a job assignment
   * @param assignmentId - ID of the assignment
   * @param status - Final status of the job
   * @param resultPayload - Optional result data
   * @throws NotFoundException if assignment doesn't exist
   * @throws BadRequestException if assignment already completed
   */
  async submitResult(
    assignmentId: number,
    status: JobStatus,
    resultPayload?: any,
  ) {
    const assignment = await prisma.jobAssignment.findUnique({
      where: { id: assignmentId },
      include: { job: true },
    });

    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.completed_at) {
      throw new BadRequestException('Assignment already completed!');
    }

    if (resultPayload) {
      await this.validateResultPayload(assignment.job.type, resultPayload);
    }

    await prisma.$transaction([
      prisma.jobResult.create({
        data: {
          assignment_id: assignmentId,
          job_id: assignment.job_id,
          result_payload: resultPayload,
          storage_scheme: assignment.storage_scheme,
          storage_uri: assignment.storage_uri,
        },
      }),
      prisma.jobAssignment.update({
        where: { id: assignmentId },
        data: { completed_at: new Date() },
      }),
      prisma.job.update({
        where: { id: assignment.job_id },
        data: { status },
      }),
    ]);
  }

  /**
   * Retrieves detailed information about a job
   * @param jobId - ID of the job
   * @param userId - ID of requesting user
   * @returns Job details including assignments and results
   * @throws NotFoundException if job doesn't exist
   */
  async getJobDetails(jobId: number) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        assignments: {
          include: {
            result: true,
          },
        },
      },
    });

    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  /**
   * Cancels a job if it hasn't completed
   * @param jobId - ID of job to cancel
   * @param userId - ID of requesting user
   * @param isAdmin - Whether requesting user is an admin
   * @returns Updated job record
   * @throws NotFoundException if job doesn't exist
   * @throws UnauthorizedException if user doesn't have access
   * @throws BadRequestException if job already completed
   */
  async cancelJob(jobId: number, userId: number, isAdmin: boolean) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (!isAdmin && job.user_id !== userId) {
      throw new UnauthorizedException();
    }

    if (!(job.status === 'PENDING')) {
      throw new BadRequestException(
        'Cannot cancel jobs in a non PENDING state',
      );
    }

    return prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.CANCELLED },
    });
  }

  /**
   * Lists jobs with optional filtering by status and user
   * If userId is undefined (admin query), returns all jobs
   * If userId is provided, returns only jobs for that user
   * @param params.userId - Optional user ID to filter by
   * @param params.status - Optional status to filter by
   * @returns Object containing jobs array and total count
   */
  async listJobs(params: {
    userId?: number;
    status?: JobStatus;
  }): Promise<{ jobs: Job[]; total: number }> {
    // Build where clause based on parameters
    const where = {
      ...(params.userId && { user_id: params.userId }),
      ...(params.status && { status: params.status }),
    };

    // Execute both queries in parallel for efficiency
    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          assignments: {
            include: {
              result: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
        // Reasonable page size for initial implementation
        take: 50,
      }),
      prisma.job.count({ where }),
    ]);

    return {
      jobs,
      total,
    };
  }

  /**
   * Lists jobs with optional filtering by status and user
   * If userId is undefined (admin query), returns all jobs
   * If userId is provided, returns only jobs for that user
   * @param params.userId - Optional user ID to filter by
   * @param params.status - Optional status to filter by
   * @returns Object containing jobs array and total count
   */
  async listRequests(params: {
    userId?: number;
  }): Promise<{ jobs: JobRequest[]; total: number }> {
    // Build where clause based on parameters
    const where = {
      ...(params.userId && { user_id: params.userId }),
    };

    const [requests, total] = await Promise.all([
      prisma.jobRequest.findMany({
        where,
        include: {
          job: { include: { assignments: true, results: true } },
        },
        orderBy: [{ created_at: 'desc' }],
        // Reasonable page size for initial implementation
        take: 50,
      }),
      prisma.jobRequest.count({ where }),
    ]);

    return {
      jobs: requests,
      total,
    };
  }

  /**
   * Produces a deterministic hash of a job based on a deterministic string
   * serialisation of a job and the job type.
   * @param payload The payload contents to hash
   * @param jobType The jobType to hash
   */
  public async generateJobHash({
    payload,
    jobType,
  }: {
    payload: any;
    jobType: JobType;
  }) {
    const payloadHash = hashObject(payload);
    return crypto
      .createHash('sha256')
      .update(payloadHash)
      .update(jobType)
      .digest('hex');
  }
}
