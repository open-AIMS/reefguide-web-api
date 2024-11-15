// jobs.ts
import { z } from 'zod';
import { prisma } from '../apiSetup';
import { StorageScheme, JobType, JobStatus } from '@prisma/client';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '../exceptions';
import { config } from '../config';

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

/**
 * Schema definitions for each job type's input and output payloads.
 * Each job type must define an input schema and may optionally define a result schema.
 */
export const jobTypeSchemas: JobSchemaMap = {
  CRITERIA_POLYGONS: {
    input: z
      .object({
        // TODO actual payload
      })
      .strict(),
    result: z
      .object({
        // TODO actual payload
      })
      .strict()
      .optional(),
  },
};

export const jobExpiryMap: JobExpiryMap = {
  CRITERIA_POLYGONS: {
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

  /**
   * Creates a new job
   * @param userId - ID of user creating the job
   * @param jobType - Type of job to create
   * @param inputPayload - Input parameters for the job
   * @returns Created job record
   */
  async createJob(userId: number, jobType: JobType, inputPayload: any) {
    await this.validateJobPayload(jobType, inputPayload);

    return prisma.job.create({
      data: {
        type: jobType,
        user_id: userId,
        input_payload: inputPayload,
        status: JobStatus.PENDING,
      },
    });
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
   * @param isAdmin - Whether requesting user is an admin
   * @returns Job details including assignments and results
   * @throws NotFoundException if job doesn't exist
   * @throws UnauthorizedException if user doesn't have access
   */
  async getJobDetails(jobId: number, userId: number, isAdmin: boolean) {
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
    if (!isAdmin && job.user_id !== userId) {
      throw new UnauthorizedException(
        'You cannot view details about a job you do not own.',
      );
    }

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

    if (job.status === JobStatus.SUCCEEDED || job.status === JobStatus.FAILED) {
      throw new BadRequestException(
        'Cannot cancel completed (succeeded or failed) job',
      );
    }

    return prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.CANCELLED },
    });
  }
}
