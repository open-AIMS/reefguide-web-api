import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
import { ReefGuideNetworking } from "./components/networking";
import { ReefGuideAPI } from "./components/reefGuideAPI";
import { WebAPI } from "./components/webAPI";
import { DeploymentConfig } from "./infra_config";
import { ReefGuideFrontend } from "./components/reefGuideFrontend";

export interface ReefguideWebApiProps extends cdk.StackProps {
  config: DeploymentConfig;
}

// All of these endpoints need to be added to CSP for front-end
const ARC_GIS_ENDPOINTS = [
  "https://js.arcgis.com",
  "https://www.arcgis.com",
  "https://static.arcgis.com",
  "https://basemaps.arcgis.com",
  "https://cdn.arcgis.com",
  "https://server.arcgisonline.com",
  "https://services.arcgisonline.com",
  "https://tiles.arcgis.com",
];

export class ReefguideWebApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ReefguideWebApiProps) {
    super(scope, id, props);

    // Pull out main config
    const config = props.config;

    // DNS SETUP
    // =========

    // Setup the hosted zone for domain definitions
    const hz = route53.HostedZone.fromHostedZoneAttributes(this, "hz", {
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
      "primary-cert",
      config.certificates.primary
    );

    // CloudFront certificate
    const cfnCert = acm.Certificate.fromCertificateArn(
      this,
      "cfn-cert",
      config.certificates.cloudfront
    );

    // NETWORKING
    // ==========

    // Setup networking infrastructure
    const networking = new ReefGuideNetworking(this, "networking", {
      certificate: primaryCert,
    });

    // ReefGuideAPI.jl
    // ===============

    // Deploy the reef guide API as a load balanced ECS service
    const reefGuideApi = new ReefGuideAPI(this, "reef-guide-api", {
      vpc: networking.vpc,
      certificate: primaryCert,
      domainName: domains.reefGuideAPI,
      hz: hz,
      sharedBalancer: networking.sharedBalancer,
      config: config.reefGuideAPI,
    });

    // Web API
    const webAPI = new WebAPI(this, "web-api", {
      certificate: primaryCert,
      config: config.webAPI,
      domainName: domains.webAPI,
      hz: hz,
    });

    // ========
    // FRONTEND
    // ========
    const reefGuideFrontend = new ReefGuideFrontend(this, "frontend", {
      usEastCertificate: cfnCert,
      config: config.frontend,
      domainName: domains.frontend,
      hz: hz,
      // This overrides CSP to allow the browser to use these endpoints
      cspEndpoints: [reefGuideApi.endpoint, webAPI.endpoint].concat(
        ARC_GIS_ENDPOINTS
      ),
    });
  }
}
