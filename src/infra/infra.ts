import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { ReefGuideNetworking } from './components/networking';
import { ReefGuideAPI } from './components/reefGuideAPI';
import { WebAPI } from './components/webAPI';
import { DeploymentConfig } from './infra_config';
import { ReefGuideFrontend } from './components/reefGuideFrontend';
import { JobSystem } from './components/jobs';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';
import { Db } from './components/db';

export interface ReefguideWebApiProps extends cdk.StackProps {
  config: DeploymentConfig;
}

// All of these endpoints need to be added to CSP for front-end
const ARC_GIS_ENDPOINTS = [
  'https://*.arcgis.com',
  'https://*.arcgisonline.com',
];

export class ReefguideWebApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ReefguideWebApiProps) {
    super(scope, id, props);

    // Pull out main config
    const config = props.config;

    /**
     * Generates an AWS secret manager secret for a given email to be used as
     * seeded credentials by the API
     * @param id The id of the secret to generate
     * @param email The email to use as username field
     * @returns Secret generated with {username: <email>, password: <random>}
     */
    const credBuilder = (id: string, email: string) => {
      return new sm.Secret(this, id, {
        // {username, password}
        generateSecretString: {
          passwordLength: 16,
          secretStringTemplate: JSON.stringify({
            username: email,
          }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: 'password',
        },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    };

    // Manager service creds
    const managerCreds = credBuilder('manager-userpass', 'manager@service.com');
    const adminCreds = credBuilder('admin-userpass', 'admin@service.com');
    const workerCreds = credBuilder('worker-userpass', 'worker@service.com');

    // DNS SETUP
    // =========

    // Setup the hosted zone for domain definitions
    const hz = route53.HostedZone.fromHostedZoneAttributes(this, 'hz', {
      hostedZoneId: config.hostedZone.id,
      zoneName: config.hostedZone.name,
    });

    // Domain configurations
    const domains = {
      reefGuideAPI: `${config.domains.reefGuideAPI}.${config.domains.baseDomain}`,
      webAPI: `${config.domains.webAPI}.${config.domains.baseDomain}`,
      frontend: `${config.domains.frontend}.${config.domains.baseDomain}`,
    };

    // CERTIFICATES
    // ============

    // Primary certificate for the hosted zone
    const primaryCert = acm.Certificate.fromCertificateArn(
      this,
      'primary-cert',
      config.certificates.primary,
    );

    // CloudFront certificate
    const cfnCert = acm.Certificate.fromCertificateArn(
      this,
      'cfn-cert',
      config.certificates.cloudfront,
    );

    // NETWORKING
    // ==========

    // Setup networking infrastructure
    const networking = new ReefGuideNetworking(this, 'networking', {
      certificate: primaryCert,
    });

    // Setup RDS if desired
    let db = undefined;
    if (config.db) {
      // Deploy RDS postgresql 16_4 instance if specified
      db = new Db(this, 'db', {
        vpc: networking.vpc,
        instanceSize: config.db.instanceSize,
        storageGb: config.db.storageGb,
      });
    }

    // ReefGuideAPI.jl
    // ===============

    // Deploy the reef guide API as a load balanced ECS service
    const reefGuideApi = new ReefGuideAPI(this, 'reef-guide-api', {
      vpc: networking.vpc,
      certificate: primaryCert,
      domainName: domains.reefGuideAPI,
      hz: hz,
      sharedBalancer: networking.sharedBalancer,
      config: config.reefGuideAPI,
    });
    const cluster = reefGuideApi.fargateService.cluster;

    // Web API
    const webAPI = new WebAPI(this, 'web-api', {
      certificate: primaryCert,
      config: config.webAPI,
      domainName: domains.webAPI,
      hz: hz,
      managerCreds: managerCreds,
      workerCreds: workerCreds,
      adminCreds: adminCreds,

      // Expose the cluster information to web API so that it can control it
      ecsClusterName: cluster.clusterName,
      ecsServiceName: reefGuideApi.fargateService.serviceName,
    });

    // Let the Web API interact with the Julia cluster
    webAPI.registerCluster(reefGuideApi.fargateService);

    // ========
    // FRONTEND
    // ========
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const reefGuideFrontend = new ReefGuideFrontend(this, 'frontend', {
      usEastCertificate: cfnCert,
      config: config.frontend,
      domainName: domains.frontend,
      hz: hz,
      // This overrides CSP to allow the browser to use these endpoints
      // App may generate blob object URLs.
      cspEntries: [reefGuideApi.endpoint, webAPI.endpoint, 'blob:'].concat(
        ARC_GIS_ENDPOINTS,
      ),
    });

    const jobSystem = new JobSystem(this, 'job-system', {
      vpc: networking.vpc,
      cluster: cluster,
      apiEndpoint: webAPI.endpoint,
      capacityManager: {
        cpu: 256,
        memoryLimitMiB: 512,
        pollIntervalMs: 5000,
      },
      jobTypes: {
        CRITERIA_POLYGONS: {
          cpu: 512,
          memoryLimitMiB: 1024,
          serverPort: 3000,
          command: ['npm', 'run', 'start-worker'],
          desiredMinCapacity: 0,
          desiredMaxCapacity: 5,
          scaleUpThreshold: 1,
          cooldownSeconds: 60,
        },
      },
      workerCreds,
      managerCreds,
    });

    // let the webAPI read write the data storage bucket and tell it about
    // storage bucket
    webAPI.addEnv('S3_BUCKET_NAME', jobSystem.storageBucket.bucketName);
    jobSystem.storageBucket.grantReadWrite(webAPI.lambda);
  }
}
