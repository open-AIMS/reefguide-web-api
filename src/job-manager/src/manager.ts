import {
  AssignPublicIp,
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  Task,
} from '@aws-sdk/client-ecs';
import { EC2Client, DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import { Config, ConfigSchema, JobTypeConfig } from './config';
import { AuthApiClient } from './authClient';
import { JobType } from '@prisma/client';
import { PollJobsResponse } from '../../api/jobs/routes';

// This interface are details for a worker which is pending or running
interface TrackedWorker {
  taskArn: string;
  clusterArn: string;
  startTime: Date;
  jobTypes: JobType[];
  status: 'PENDING' | 'RUNNING' | 'STOPPED';
}

export class CapacityManager {
  private config: Config;
  private ecsClient: ECSClient;
  private ec2Client: EC2Client;
  private lastScaleTime: Record<string, number> = {};
  private client: AuthApiClient;
  private isRunning: boolean = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  // Add tracking data structures
  private trackedWorkers: TrackedWorker[] = [];

  constructor(config: Config, client: AuthApiClient) {
    this.config = ConfigSchema.parse(config);
    this.ecsClient = new ECSClient({ region: this.config.region });
    this.ec2Client = new EC2Client({ region: this.config.region });
    this.client = client;
  }

  private async pollJobQueue() {
    if (!this.isRunning) return;

    const used = process.memoryUsage();
    console.log('Memory usage:', {
      heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
      rss: `${Math.round(used.rss / 1024 / 1024)} MB`,
    });

    try {
      console.log('Poll started at:', new Date().toISOString());

      // Update worker statuses
      await this.updateWorkerStatuses();

      // Get jobs with their IDs
      const response = await this.client.get<PollJobsResponse>('/jobs/poll');

      await this.adjustCapacity({ pollResponse: response.jobs });
    } catch (error) {
      console.error('Error polling job queue:', error);
    } finally {
      // Only schedule next poll if still running
      if (this.isRunning) {
        this.pollTimeout = setTimeout(
          () => this.pollJobQueue(),
          this.config.pollIntervalMs,
        );
      }
    }
  }

  private async updateWorkerStatuses() {
    if (this.trackedWorkers.length === 0) return;

    try {
      // Build set of distinct worker types from the tracked workers
      const clusterArns = new Set(this.trackedWorkers.map(w => w.clusterArn));

      // Create a Set to track which task ARNs were found in the API response
      const foundTaskArns = new Set<string>();

      // Now loop through each worker type and figure out the cluster ARN/task ARNs
      for (const clusterArn of clusterArns) {
        const relevantWorkers = this.trackedWorkers.filter(
          w => w.clusterArn === clusterArn,
        );
        // Which task ARNs to fetch
        const taskArns = relevantWorkers.map(w => w.taskArn);

        // Split into chunks if there are many tasks (ECS API has limits)
        const chunkSize = 100;
        for (let i = 0; i < taskArns.length; i += chunkSize) {
          const chunk = taskArns.slice(i, i + chunkSize);

          const command = new DescribeTasksCommand({
            cluster: clusterArn,
            tasks: chunk,
          });

          const response = await this.ecsClient.send(command);

          if (response.tasks) {
            // Add all found task ARNs to our tracking set
            response.tasks.forEach(task => {
              if (task.taskArn) {
                foundTaskArns.add(task.taskArn);
              }
            });

            this.updateWorkerStatusesFromTasks(response.tasks);
          }

          // Check if any tasks weren't found but were requested
          // AWS ECS API returns info in response.failures for tasks that weren't found
          if (response.failures && response.failures.length > 0) {
            response.failures.forEach(failure => {
              if (failure.arn && failure.reason === 'MISSING') {
                console.log(
                  `Task ${failure.arn} not found in ECS, removing from tracked workers`,
                );
                // We explicitly don't add this to foundTaskArns since it's missing
              }
            });
          }
        }
      }

      // Remove workers that weren't found in the API response
      const previousCount = this.trackedWorkers.length;
      this.trackedWorkers = this.trackedWorkers.filter(worker => {
        // Keep workers that were found in the API response
        return foundTaskArns.has(worker.taskArn);
      });

      const removedCount = previousCount - this.trackedWorkers.length;
      if (removedCount > 0) {
        console.log(
          `Removed ${removedCount} workers that were not found in ECS`,
        );
      }
    } catch (error) {
      console.error('Error updating worker statuses:', error);
    }
  }

  // Update worker statuses based on ECS task information
  private updateWorkerStatusesFromTasks(tasks: Task[]) {
    for (const task of tasks) {
      if (!task.taskArn) continue;

      const worker = this.trackedWorkers.find(w => w.taskArn === task.taskArn);
      if (!worker) continue;

      const lastStatus = task.lastStatus || '';
      let newStatus: 'PENDING' | 'RUNNING' | 'STOPPED';

      // Map AWS ECS task statuses to our internal tracking statuses
      if (['PROVISIONING', 'PENDING', 'ACTIVATING'].includes(lastStatus)) {
        newStatus = 'PENDING';
      } else if (lastStatus === 'RUNNING') {
        newStatus = 'RUNNING';
      } else if (
        [
          'DEACTIVATING',
          'STOPPING',
          'STOPPED',
          'DEPROVISIONING',
          'DEPROVISIONED',
        ].includes(lastStatus)
      ) {
        newStatus = 'STOPPED';
      } else {
        // For any unexpected status, log it but don't change worker status
        console.warn(
          `Worker ${task.taskArn} has unknown status: ${lastStatus}`,
        );
        continue;
      }

      // Only log if status changed
      if (worker.status !== newStatus) {
        console.log(
          `Worker ${task.taskArn} status changed: ${worker.status} -> ${newStatus}`,
        );
        worker.status = newStatus;
      }
    }

    // Remove stopped workers after updating
    this.trackedWorkers = this.trackedWorkers.filter(
      worker => worker.status !== 'STOPPED',
    );
  }

  /**
   * For each job which is polling, determine how many workers we have running
   * that can handle that type of job. Include pending tasks as part of the
   * threshold. Observe cooldown period.
   */
  private async adjustCapacity({
    pollResponse,
  }: {
    pollResponse: PollJobsResponse['jobs'];
  }): Promise<void> {
    // Count pending jobs by type
    const pendingByType: Record<JobType, number> = Object.values(
      JobType,
    ).reduce<Record<JobType, number>>(
      (current, acc) => {
        current[acc] = 0;
        return current;
      },
      {} as Record<JobType, number>,
    );
    for (const job of pollResponse) {
      // Increment count
      pendingByType[job.type] += 1;
    }

    // Determine how many workers are already tracked for each type of job
    const workersByType: Record<JobType, number> = Object.values(
      JobType,
    ).reduce<Record<JobType, number>>(
      (current, acc) => {
        current[acc] = 0;
        return current;
      },
      {} as Record<JobType, number>,
    );
    for (const worker of this.trackedWorkers) {
      // Count once for each type TODO consider if this has implications for
      // scaling - de emphasising workers which handle multiple jobs
      for (const type of worker.jobTypes) {
        workersByType[type] += 1;
      }
    }

    for (const jobType of Object.values(JobType)) {
      const pending = pendingByType[jobType];
      const workers = workersByType[jobType];

      const config = this.config.jobTypes[jobType as JobType];
      if (!config) {
        console.warn(`No configuration found for job type: ${jobType}`);
        continue;
      }

      await this.adjustCapacityForType({
        jobType,
        pending,
        workers,
        config,
      });
    }
  }

  /**
   * Launches n jobs of the specified type/config
   *
   * Updates the worker tracking
   */
  private async launchTask({
    count = 1,
    jobType,
    config,
  }: {
    count?: number;
    jobType: JobType;
    config: JobTypeConfig;
  }) {
    try {
      let done = 0;
      while (done < count) {
        const now = Date.now();

        // Get a random public subnet for this task
        const subnet = await this.getRandomPublicSubnet(this.config.vpcId);
        const command = new RunTaskCommand({
          cluster: config.clusterArn,
          taskDefinition: config.taskDefinitionArn,
          launchType: 'FARGATE',
          count: 1,
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: [subnet],
              securityGroups: [config.securityGroup],
              assignPublicIp: AssignPublicIp.ENABLED,
            },
          },
        });

        const result = await this.ecsClient.send(command);

        // If task was created successfully, track it
        if (
          result.tasks &&
          result.tasks.length > 0 &&
          result.tasks[0].taskArn
        ) {
          this.lastScaleTime[jobType] = now;
          this.trackedWorkers.push({
            clusterArn: config.clusterArn,
            taskArn: result.tasks[0].taskArn,
            startTime: new Date(),
            jobTypes: this.config.jobTypes[jobType]?.jobTypes ?? [jobType],
            status: 'PENDING',
          });

          console.log(
            `Started new task ${result.tasks[0].taskArn} for job type: ${jobType}`,
          );
        }
        done += 1;
      }
    } catch (e) {
      console.error('Failed to launch task(s). Exception: ' + e);
    }
  }

  /**
   * Computes the optimal number of workers to handle pending jobs using a logarithmic scale.
   *
   * This function uses a logarithmic relationship between pending jobs and worker count,
   * which provides diminishing returns as the number of jobs increases - appropriate for
   * many distributed processing scenarios.
   *
   * @param pendingJobs - The number of jobs waiting to be processed
   * @param sensitivity - Controls how aggressively to scale workers (higher = more workers)
   *                      Recommended range: 1.0 (conservative) to 3.0 (aggressive)
   * @param minWorkers - Minimum number of workers to maintain regardless of job count
   * @param maxWorkers - Maximum number of workers allowed regardless of job count
   * @param baseJobCount - Reference job count that maps to roughly 1×sensitivity workers
   *                      (helps calibrate the scale for your specific workload)
   * @returns The target number of workers as an integer
   */
  private computeOptimalWorkers({
    pendingJobs,
    sensitivity,
    minWorkers,
    maxWorkers,
    baseJobCount,
  }: {
    pendingJobs: number;
    sensitivity: number;
    minWorkers: number;
    maxWorkers: number;
    baseJobCount: number;
  }): number {
    // Handle edge cases
    if (pendingJobs <= 0) {
      return minWorkers;
    }
    // Compute workers using logarithmic scaling
    // The formula: sensitivity * log(pendingJobs/baseJobCount + 1) + minWorkers
    //
    // This gives us:
    // - When pendingJobs = 0: minWorkers
    // - When pendingJobs = baseJobCount: roughly minWorkers + sensitivity
    // - As pendingJobs grows, workers increase logarithmically
    const computedWorkers =
      sensitivity * Math.log(pendingJobs / baseJobCount + 1) + minWorkers;

    // Round to nearest integer and enforce bounds
    return Math.min(
      Math.max(Math.round(computedWorkers), minWorkers),
      maxWorkers,
    );
  }

  private async adjustCapacityForType({
    jobType,
    pending,
    workers,
    config,
  }: {
    jobType: JobType;
    pending: number;
    workers: number;
    config: JobTypeConfig;
  }) {
    const now = Date.now();
    const lastScale = this.lastScaleTime[jobType] || 0;

    // Check cooldown
    if (now - lastScale < config.scaling.cooldownSeconds * 1000) {
      console.log(`Still in cooldown period for ${jobType}`);
      return;
    }

    // Determine the ideal number of workers
    const idealTarget = this.computeOptimalWorkers({
      pendingJobs: pending,
      sensitivity: config.scaling.sensitivity,
      minWorkers: config.scaling.min,
      maxWorkers: config.scaling.max,
      baseJobCount: config.scaling.factor,
    });
    const diff = idealTarget - workers;
    if (diff > 0) {
      console.info(`Launching ${diff} tasks of type: ${jobType}.`);
      this.launchTask({ count: diff, jobType, config });
    }
  }

  public start() {
    if (this.isRunning) return;

    console.log('Starting capacity manager...');
    this.isRunning = true;
    this.pollJobQueue();

    // Add error handlers for uncaught errors
    process.on('uncaughtException', error => {
      console.error('Uncaught exception:', error);
      this.stop();
    });

    process.on('unhandledRejection', error => {
      console.error('Unhandled rejection:', error);
      this.stop();
    });
  }

  public stop() {
    console.log('Stopping capacity manager...');
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  private async getRandomPublicSubnet(vpcId: string): Promise<string> {
    try {
      const command = new DescribeSubnetsCommand({
        Filters: [
          {
            Name: 'vpc-id',
            Values: [vpcId],
          },
          {
            Name: 'map-public-ip-on-launch',
            Values: ['true'],
          },
        ],
      });

      const response = await this.ec2Client.send(command);
      const publicSubnets = response.Subnets || [];

      if (publicSubnets.length === 0) {
        throw new Error(`No public subnets found in VPC ${vpcId}`);
      }

      // Randomly select a subnet
      const randomIndex = Math.floor(Math.random() * publicSubnets.length);
      const selectedSubnet = publicSubnets[randomIndex];

      console.log(
        `Selected subnet ${selectedSubnet.SubnetId} in AZ ${selectedSubnet.AvailabilityZone}`,
      );
      return selectedSubnet.SubnetId!;
    } catch (error) {
      console.error('Error getting public subnets:', error);
      throw error;
    }
  }
}
