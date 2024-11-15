import { Duration, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

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

  // The credentials to be used by the manager and worker nodes
  managerCreds: sm.Secret;
  workerCreds: sm.Secret;
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

    // Create a security group for worker tasks
    const workerSg = new ec2.SecurityGroup(this, 'worker-sg', {
      vpc: props.vpc,
      description: 'Security group for workers',
      allowAllOutbound: true,
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
        },
        // pass in the worker creds
        // TODO do we want separate users for each worker?
        secrets: {
          API_USERNAME: ecs.Secret.fromSecretsManager(
            props.workerCreds,
            'username',
          ),
          API_PASSWORD: ecs.Secret.fromSecretsManager(
            props.workerCreds,
            'password',
          ),
        },
        healthCheck: {
          command: [
            'CMD-SHELL',
            `curl -f http://localhost:${config.serverPort}/health >> /proc/1/fd/1 2>&1 || exit 1`,
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

    // Also enable describing subnets
    capacityManagerTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ec2:DescribeSubnets'],
        resources: ['*'],
      }),
    );

    // Add permissions to pass the task execution and task roles
    capacityManagerTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        // Allow role passing through to all the task definitions
        resources: Object.values(this.taskDefinitions).reduce(
          (perms, taskDefinition) => {
            return perms.concat([
              // Allow passing the task execution role
              taskDefinition.executionRole!.roleArn,
              // Allow passing the task role
              taskDefinition.taskRole.roleArn,
            ]);
          },
          [] as string[],
        ),
        conditions: {
          // Only allow passing these roles to ECS tasks
          StringLike: {
            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
          },
        },
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
        // Which vpc to deploy into
        VPC_ID: props.vpc.vpcId,
      },
      // pass in the manager creds
      secrets: {
        API_USERNAME: ecs.Secret.fromSecretsManager(
          props.managerCreds,
          'username',
        ),
        API_PASSWORD: ecs.Secret.fromSecretsManager(
          props.managerCreds,
          'password',
        ),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:3000/health >> /proc/1/fd/1 2>&1 || exit 1',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      portMappings: [
        {
          containerPort: 3000,
          hostPort: 3000,
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
      taskDefEnvVars[`${jobType}_SECURITY_GROUP`] = workerSg.securityGroupId;
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
