import { AssignPublicIp, ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { EC2Client, DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import { Config, ConfigSchema, JobTypeConfig } from './config';
import { AuthApiClient } from './authClient';

export class CapacityManager {
  private config: Config;
  private ecsClient: ECSClient;
  private ec2Client: EC2Client;
  private lastScaleTime: Record<string, number> = {};
  private client: AuthApiClient;

  constructor(config: Config, client: AuthApiClient) {
    this.config = ConfigSchema.parse(config);
    this.ecsClient = new ECSClient({ region: this.config.region });
    this.ec2Client = new EC2Client({ region: this.config.region });
    this.client = client;
  }

  private async pollJobQueue() {
    console.log('Poll...');
    try {
      // Type this better
      const response = await this.client.get<{ jobs: any[] }>(`/jobs/poll`);

      // Group jobs by type
      const jobsByType = response.jobs.reduce(
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
        // Get a random public subnet for this task
        const subnet = await this.getRandomPublicSubnet(this.config.vpcId);

        const command = new RunTaskCommand({
          cluster: config.clusterArn,
          taskDefinition: config.taskDefinitionArn,
          launchType: 'FARGATE',
          count: 1, // Start one task at a time
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: [subnet],
              securityGroups: [config.securityGroup],
              assignPublicIp: AssignPublicIp.ENABLED,
            },
          },
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
