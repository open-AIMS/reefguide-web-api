import { Duration, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';

// Define job type configuration
export interface JobTypeConfig {
  // Task configuration
  cpu: number;
  memoryLimitMiB: number;

  // Worker Docker image
  // TODO use this - for now build sample
  // workerImage: string;

  // Scaling configuration
  desiredMinCapacity: number;
  desiredMaxCapacity: number;
  scaleUpThreshold: number;
  cooldownSeconds: number;
  serverPort: number;
  command: string[];
}

export interface JobSystemProps {
  // Networking
  vpc: ec2.IVpc;
  // Base cluster to run in
  cluster: ecs.ICluster;
  // Domain and auth
  apiEndpoint: string;

  // TODO use different form of creds...
  apiAuthToken: string;

  // Capacity manager configuration
  capacityManager: {
    cpu: number;
    memoryLimitMiB: number;
    pollIntervalMs: number;
  };

  // Configuration for each job type
  jobTypes: Record<string, JobTypeConfig>;
}

export class JobSystem extends Construct {
  // The S3 bucket for job results
  public readonly storageBucket: s3.Bucket;
  // Task definitions for each job type
  public readonly taskDefinitions: Record<string, ecs.TaskDefinition>;
  // The capacity manager service
  public readonly capacityManagerService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: JobSystemProps) {
    super(scope, id);

    // Create S3 bucket for job results
    this.storageBucket = new s3.Bucket(this, 'job-storage', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          // Clean up after 30 days
          expiration: Duration.days(30),
        },
      ],
    });

    // Create task definitions for each job type
    this.taskDefinitions = {};

    for (const [jobType, config] of Object.entries(props.jobTypes)) {
      const taskDef = new ecs.FargateTaskDefinition(
        this,
        `${jobType}-task-def`,
        {
          cpu: config.cpu,
          memoryLimitMiB: config.memoryLimitMiB,
        },
      );

      // Grant task role access to S3 bucket
      this.storageBucket.grantReadWrite(taskDef.taskRole);

      // Add container to task definition
      taskDef.addContainer(`${jobType}-container`, {
        // TODO use this
        // image: ecs.ContainerImage.fromRegistry(config.workerImage),
        // Docker command
        command: config.command,
        image: ecs.ContainerImage.fromAsset('.', {
          buildArgs: { PORT: config.serverPort.toString() },
        }),
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: `worker-${jobType.toLowerCase()}`,
          logRetention: logs.RetentionDays.ONE_WEEK,
        }),
        environment: {
          API_ENDPOINT: props.apiEndpoint,
          JOB_TYPES: jobType,
          AWS_REGION: Stack.of(this).region,
          S3_BUCKET_NAME: this.storageBucket.bucketName,
          // TODO use secret instead and username/pass
          API_AUTH_TOKEN: props.apiAuthToken,
        },
        secrets: {},
        healthCheck: {
          command: [
            'CMD-SHELL',
            `curl -f http://localhost:${config.serverPort}/health || exit 1`,
          ],
          interval: Duration.seconds(30),
          timeout: Duration.seconds(5),
          retries: 3,
          startPeriod: Duration.seconds(60),
        },
      });

      this.taskDefinitions[jobType] = taskDef;
    }

    // Create task definition for capacity manager
    const capacityManagerTask = new ecs.FargateTaskDefinition(
      this,
      'capacity-manager-task',
      {
        cpu: props.capacityManager.cpu,
        memoryLimitMiB: props.capacityManager.memoryLimitMiB,
      },
    );

    // Grant capacity manager permissions to manage ECS tasks
    capacityManagerTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:RunTask',
          'ecs:StopTask',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
        ],
        resources: ['*'],
      }),
    );

    // Add capacity manager container
    capacityManagerTask.addContainer('capacity-manager', {
      // Docker command
      command: ['npm', 'run', 'start-manager'],
      image: ecs.ContainerImage.fromAsset('.', {
        buildArgs: { PORT: '3000' },
      }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'capacity-manager',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        API_ENDPOINT: props.apiEndpoint,
        POLL_INTERVAL_MS: props.capacityManager.pollIntervalMs.toString(),
        AWS_REGION: Stack.of(this).region,
        // TODO don't do like this
        API_AUTH_TOKEN: props.apiAuthToken,
      },
      secrets: {},
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:3000/health || exit 1',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      portMappings: [
        {
          containerPort: 3000,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    // Create security group for capacity manager
    const capacityManagerSg = new ec2.SecurityGroup(
      this,
      'capacity-manager-sg',
      {
        vpc: props.vpc,
        description: 'Security group for job capacity manager',
        allowAllOutbound: true,
      },
    );

    // Create the capacity manager service
    this.capacityManagerService = new ecs.FargateService(
      this,
      'capacity-manager',
      {
        cluster: props.cluster,
        taskDefinition: capacityManagerTask,
        desiredCount: 1, // We only need one instance
        securityGroups: [capacityManagerSg],
        assignPublicIp: true,
        // Ensure service stays running
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        healthCheckGracePeriod: Duration.seconds(60),
        // Circuit breaker to prevent failing deployments
        circuitBreaker: {
          rollback: true,
        },
      },
    );

    // Add task definition configurations to capacity manager environment
    const taskDefEnvVars: Record<string, string> = {};
    for (const [jobType, config] of Object.entries(props.jobTypes)) {
      const taskDef = this.taskDefinitions[jobType];
      taskDefEnvVars[`${jobType}_TASK_DEF`] = taskDef.taskDefinitionArn;
      taskDefEnvVars[`${jobType}_CLUSTER`] = props.cluster.clusterArn;
      taskDefEnvVars[`${jobType}_MIN_CAPACITY`] =
        config.desiredMinCapacity.toString();
      taskDefEnvVars[`${jobType}_MAX_CAPACITY`] =
        config.desiredMaxCapacity.toString();
      taskDefEnvVars[`${jobType}_SCALE_THRESHOLD`] =
        config.scaleUpThreshold.toString();
      taskDefEnvVars[`${jobType}_COOLDOWN`] = config.cooldownSeconds.toString();
    }

    // Update capacity manager container with task definition configurations
    const capacityManagerContainer =
      capacityManagerTask.findContainer('capacity-manager');
    if (capacityManagerContainer) {
      Object.entries(taskDefEnvVars).forEach(([key, value]) => {
        capacityManagerContainer.addEnvironment(key, value);
      });
    }
  }
}
