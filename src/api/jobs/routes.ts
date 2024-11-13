import express, { Response } from 'express';
import { z } from 'zod';
import { processRequest } from 'zod-express-middleware';
import { JobType, JobStatus, StorageScheme } from '@prisma/client';
import { passport } from '../auth/passportConfig';
import { JobService } from '../services/jobs';
import { userIsAdmin } from '../auth/utils';
import { UnauthorizedException } from '../exceptions';
require('express-async-errors');

// Create DTOs for complex response types
export const jobAssignmentSchema = z.object({
  id: z.number(),
  created_at: z.date(),
  updated_at: z.date(),
  job_id: z.number(),
  ecs_task_arn: z.string(),
  ecs_cluster_arn: z.string(),
  expires_at: z.date(),
  storage_scheme: z.nativeEnum(StorageScheme),
  storage_uri: z.string(),
  heartbeat_at: z.date().nullable(),
  completed_at: z.date().nullable(),
});

export const jobResultSchema = z.object({
  id: z.number(),
  created_at: z.date(),
  job_id: z.number(),
  assignment_id: z.number(),
  result_payload: z.any().nullable(),
  storage_scheme: z.nativeEnum(StorageScheme),
  storage_uri: z.string(),
  metadata: z.any().nullable(),
});

export const jobDetailsSchema = z.object({
  id: z.number(),
  created_at: z.date(),
  updated_at: z.date(),
  type: z.nativeEnum(JobType),
  status: z.nativeEnum(JobStatus),
  user_id: z.number(),
  input_payload: z.any(),
});

export const router = express.Router();
const jobService = new JobService();

// Input/Output validation schemas
export const createJobSchema = z.object({
  type: z.nativeEnum(JobType),
  inputPayload: z.any(),
});
export const createJobResponseSchema = z.object({
  jobId: z.number(),
});

export const pollJobsSchema = z.object({
  jobType: z.nativeEnum(JobType).optional(),
});
export const pollJobsResponseSchema = z.object({
  jobs: z.array(jobDetailsSchema),
});

export const assignJobSchema = z.object({
  jobId: z.number(),
  ecsTaskArn: z.string(),
  ecsClusterArn: z.string(),
});
export const assignJobResponseSchema = z.object({
  assignment: jobAssignmentSchema,
});

export const submitResultSchema = z.object({
  status: z.nativeEnum(JobStatus),
  resultPayload: z.any().optional(),
});

export const jobDetailsResponseSchema = z.object({
  job: jobDetailsSchema,
});

// Type inferencing from schemas
export type CreateJobResponse = z.infer<typeof createJobResponseSchema>;
export type PollJobsResponse = z.infer<typeof pollJobsResponseSchema>;
export type AssignJobResponse = z.infer<typeof assignJobResponseSchema>;
export type JobDetailsResponse = z.infer<typeof jobDetailsResponseSchema>;

// Routes
router.post(
  '/',
  processRequest({
    body: createJobSchema,
  }),
  passport.authenticate('jwt', { session: false }),
  async (req, res: Response<CreateJobResponse>) => {
    if (!req.user) throw new UnauthorizedException();
    const job = await jobService.createJob(
      req.user.id,
      req.body.type,
      req.body.inputPayload,
    );
    res.status(201).json({ jobId: job.id });
  },
);

router.get(
  '/poll',
  processRequest({
    query: pollJobsSchema,
  }),
  async (req, res: Response<PollJobsResponse>) => {
    const jobs = await jobService.pollJobs(req.query.jobType as JobType);
    res.json({ jobs });
  },
);

router.post(
  '/assign',
  processRequest({
    body: assignJobSchema,
  }),
  async (req, res: Response<AssignJobResponse>) => {
    const assignment = await jobService.assignJob(
      req.body.jobId,
      req.body.ecsTaskArn,
      req.body.ecsClusterArn,
    );
    res.json({ assignment });
  },
);

router.post(
  '/assignments/:id/result',
  processRequest({
    params: z.object({ id: z.string() }),
    body: submitResultSchema,
  }),
  async (req, res: Response<void>) => {
    const assignmentId = parseInt(req.params.id);
    await jobService.submitResult(
      assignmentId,
      req.body.status,
      req.body.resultPayload,
    );
    res.status(200).send();
  },
);

router.get(
  '/:id',
  processRequest({
    params: z.object({ id: z.string() }),
  }),
  passport.authenticate('jwt', { session: false }),
  async (req, res: Response<JobDetailsResponse>) => {
    if (!req.user) throw new UnauthorizedException();
    const jobId = parseInt(req.params.id);
    const job = await jobService.getJobDetails(
      jobId,
      req.user.id,
      userIsAdmin(req.user),
    );
    res.json({ job });
  },
);

router.post(
  '/:id/cancel',
  processRequest({
    params: z.object({ id: z.string() }),
  }),
  passport.authenticate('jwt', { session: false }),
  async (req, res: Response<JobDetailsResponse>) => {
    if (!req.user) throw new UnauthorizedException();
    const jobId = parseInt(req.params.id);
    const job = await jobService.cancelJob(
      jobId,
      req.user.id,
      userIsAdmin(req.user),
    );
    res.json({ job });
  },
);
