import axios from 'axios';
import { Config } from './config';
import { AuthApiClient } from './authClient';

interface Job {
  id: number;
  type: string;
  input_payload: any;
}

interface JobAssignment {
  id: number;
  job_id: number;
  storage_uri: string;
}

export class TestWorker {
  private config: Config;
  private activeJobs: Map<number, NodeJS.Timeout>;
  private isPolling: boolean;
  private client: AuthApiClient;

  constructor(config: Config, client: AuthApiClient) {
    this.config = config;
    this.activeJobs = new Map();
    this.isPolling = false;
    this.client = client;
  }

  async start() {
    console.log('Starting test worker with config:', {
      jobTypes: this.config.jobTypes,
      maxConcurrentJobs: this.config.maxConcurrentJobs,
      pollInterval: this.config.pollIntervalMs,
    });

    this.isPolling = true;
    this.poll();
  }

  async stop() {
    console.log('Stopping worker...');
    this.isPolling = false;

    // Cancel all active jobs
    for (const [jobId, timeout] of this.activeJobs.entries()) {
      clearTimeout(timeout);
      console.log(`Cancelled job ${jobId}`);
    }
    this.activeJobs.clear();
  }

  private async poll() {
    if (!this.isPolling) return;

    try {
      // Only poll if we have capacity
      if (this.activeJobs.size < this.config.maxConcurrentJobs) {
        await this.pollForJobs();
      }
    } catch (error) {
      console.error('Error in poll cycle:', error);
    }

    // Schedule next poll
    setTimeout(() => this.poll(), this.config.pollIntervalMs);
  }

  private async pollForJobs() {
    try {
      // Get available jobs
      const response = await this.client.get<{ jobs: Job[] }>(`/jobs/poll`, {
        params: { jobType: this.config.jobTypes[0] },
      });

      const jobs: Job[] = response.jobs;

      if (jobs.length === 0) {
        return;
      }

      // Try to claim first available job
      const job = jobs[0];
      await this.claimAndProcessJob(job);
    } catch (error) {
      console.error('Error polling for jobs:', error);
    }
  }

  private async claimAndProcessJob(job: Job) {
    try {
      // Try to claim the job
      const assignmentResponse = await this.client.post<{
        assignment: JobAssignment;
      }>('/jobs/assign', {
        jobId: job.id,
        // TODO make this real
        ecsTaskArn: 'TODO',
        ecsClusterArn: 'TODO',
      });

      const assignment = assignmentResponse.assignment;

      console.log(`Claimed job ${job.id}, assignment ${assignment.id}`);

      // Simulate processing by setting a timeout
      const timeout = setTimeout(
        () => this.completeJob(assignment.id, job),
        this.getRandomProcessingTime(),
      );

      this.activeJobs.set(job.id, timeout);
    } catch (error) {
      console.error(`Error claiming job ${job.id}:`, error);
    }
  }

  private async completeJob(assignmentId: number, job: Job) {
    try {
      console.log(`Completing job ${job.id}`);

      // Simulate success/failure randomly
      const success = Math.random() > 0.1; // 90% success rate

      await this.client.post<any>(`/jobs/assignments/${assignmentId}/result`, {
        status: success ? 'SUCCEEDED' : 'FAILED',
        resultPayload: success
          ? {
              message: 'Test worker processed successfully',
              processingTime: Date.now(),
              testData: `Processed ${job.type} job`,
            }
          : null,
      });

      console.log(
        `Job ${job.id} completed with status: ${success ? 'SUCCESS' : 'FAILURE'}`,
      );
    } catch (error) {
      console.error(`Error completing job ${job.id}:`, error);
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private getRandomProcessingTime(): number {
    // Random processing time between 5-15 seconds
    return Math.floor(Math.random() * 10000) + 5000;
  }

  public getActiveJobCount(): number {
    return this.activeJobs.size;
  }
}
