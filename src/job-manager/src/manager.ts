import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import axios from 'axios';
import { Config, ConfigSchema, JobTypeConfig } from './config';

export class CapacityManager {
  private config: Config;
  private ecsClient: ECSClient;
  private lastScaleTime: Record<string, number> = {};

  constructor(config: Config) {
    this.config = ConfigSchema.parse(config);
    this.ecsClient = new ECSClient({ region: this.config.region });
  }

  private async pollJobQueue() {
    console.log('Poll...');
    try {
      const response = await axios.get(
        `${this.config.apiEndpoint}/api/jobs/poll`,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiAuthToken}`,
          },
        },
      );

      // Group jobs by type
      const jobsByType = response.data.jobs.reduce(
        (acc: Record<string, number>, job: any) => {
          acc[job.type] = (acc[job.type] || 0) + 1;
          return acc;
        },
        {},
      );

      console.log(jobsByType);

      await this.adjustCapacity(jobsByType);
    } catch (error) {
      console.error('Error polling job queue:', error);
    }

    setTimeout(() => this.pollJobQueue(), this.config.pollIntervalMs);
  }

  private async adjustCapacity(jobsByType: Record<string, number>) {
    for (const [jobType, pendingCount] of Object.entries(jobsByType)) {
      const config = this.config.jobTypes[jobType];
      if (!config) {
        console.warn(`No configuration found for job type: ${jobType}`);
        continue;
      }

      await this.adjustCapacityForType(jobType, pendingCount, config);
    }
  }

  private async adjustCapacityForType(
    jobType: string,
    pendingCount: number,
    config: JobTypeConfig,
  ) {
    const now = Date.now();
    const lastScale = this.lastScaleTime[jobType] || 0;

    // Check cooldown
    if (now - lastScale < config.cooldownSeconds * 1000) {
      console.log(`Still in cooldown period for ${jobType}`);
      return;
    }

    // Only scale up if we have more pending jobs than our threshold
    if (pendingCount >= config.scaleUpThreshold) {
      try {
        const command = new RunTaskCommand({
          cluster: config.clusterArn,
          taskDefinition: config.taskDefinitionArn,
          count: 1, // Start one task at a time
        });

        await this.ecsClient.send(command);
        this.lastScaleTime[jobType] = now;

        console.log(`Started new task for ${jobType}`);
      } catch (error) {
        console.error(`Error starting task for ${jobType}:`, error);
      }
    }
  }

  public start() {
    console.log('Starting capacity manager...');
    setTimeout(() => this.pollJobQueue(), this.config.pollIntervalMs);
  }
}
