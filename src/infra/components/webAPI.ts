import * as cdk from 'aws-cdk-lib';
import {
  aws_apigateway as apigateway,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_secretsmanager as sm,
} from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { WebAPIConfig } from '../infra_config';

/**
 * Properties for the WebAPI construct
 */
export interface WebAPIProps {
  // Fully qualified domain name
  domainName: string;
  /** The Hosted Zone to produce record in */
  hz: r53.IHostedZone;
  /** The DNS certificate to use for API Gateway */
  certificate: acm.ICertificate;
  /** The configuration object for the web api service */
  config: WebAPIConfig;
}

/**
 * Construct for the web api service
 */
export class WebAPI extends Construct {
  /** Internal port for the Web API service */
  public readonly internalPort: number;

  /** External HTTPS port for the Web API service */
  public readonly externalPort: number = 443;

  /** Endpoint for Web API access (format: https://domain:port) */
  public readonly endpoint: string;

  constructor(scope: Construct, id: string, props: WebAPIProps) {
    super(scope, id);

    const config = props.config;

    // OUTPUTS
    // ================

    // Build the public URL and expose
    this.internalPort = props.config.port;
    this.endpoint = `https://${props.domainName}`;

    // ==================
    // Web API deployment
    // ==================

    const paramsAndSecrets = lambda.ParamsAndSecretsLayerVersion.fromVersion(
      lambda.ParamsAndSecretsVersions.V1_0_103,
      {
        cacheSize: 500,
        logLevel: lambda.ParamsAndSecretsLogLevel.DEBUG,
      },
    );

    const dbSecret = sm.Secret.fromSecretCompleteArn(
      this,
      'db-creds',
      config.apiSecretsArn,
    );

    // Use the Node JS L3 stack to help esbuild/bundle the Node function see
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html
    const api = new nodejs.NodejsFunction(this, 'api', {
      entry: 'src/infra/lambda.ts',
      handler: 'handler',
      environment: {
        PORT: String(this.internalPort),
        NODE_ENV: config.nodeEnv,
        API_SECRETS_ARN: config.apiSecretsArn,
        // Fully qualified domain for API domain - this defines the JWT iss
        API_DOMAIN: this.endpoint,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        esbuildArgs: {
          // This tells esbuild how to handle the imports of the prisma schema
          // and the necesary libraries
          '--loader:.prisma': 'file',
          '--loader:.so.node': 'file',
          // Include assets as their exact name - then prisma can pick it up
          '--asset-names': '[name]',
        },
      },
      paramsAndSecrets,
    });

    // allow read of db secrets
    dbSecret.grantRead(api);

    // Create an API Gateway REST API
    const restApi = new apigateway.RestApi(this, 'apigw', {
      restApiName: 'Reefguide Web API',
      description: 'This service serves the Reefguide Web API.',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      // Include certs
      domainName: {
        domainName: props.domainName,
        certificate: props.certificate,
      },
    });

    // Create an API Gateway Lambda Integration
    const lambdaIntegration = new apigateway.LambdaIntegration(api);

    // Add a root resource and method - proxy through all routes
    const rootResource = restApi.root.addResource('{proxy+}');
    rootResource.addMethod('ANY', lambdaIntegration, {
      // no auth - app handles this
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    // Output the URL of the API
    new cdk.CfnOutput(this, 'web-api-url', {
      value: this.endpoint,
      description: 'Web REST API endpoint',
    });

    // Add a route to the API gateway URL on hosted zone at configured domain
    new route53.ARecord(this, 'route', {
      zone: props.hz,
      target: route53.RecordTarget.fromAlias(new targets.ApiGateway(restApi)),
      recordName: props.domainName,
    });
  }
}
