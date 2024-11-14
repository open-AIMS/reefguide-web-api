// @ts-ignore
import schema from '../db/schema.prisma';
// @ts-ignore
import x from '../../node_modules/.prisma/client/libquery_engine-rhel-openssl-1.0.x.so.node';
if (process.env.NODE_ENV !== 'production') {
  console.debug(schema, x);
}

import axios from 'axios';
import { ApiSecretConfig, ApiSecretConfigSchema } from './infra_config';
const serverlessExpress = require('@codegenie/serverless-express');

// persist this between invocations so we aren't repeatedly spinning up express
let handler: any;

interface CredsInterface {
  username: string;
  password: string;
}

async function getSecret(secretId: string): Promise<string> {
  // see https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
  const secretsExtensionEndpoint = `http://localhost:2773/secretsmanager/get?secretId=${secretId}`;
  const headers = {
    'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN!,
  };

  try {
    const response = await axios.get(secretsExtensionEndpoint, { headers });
    return response.data.secretString as string;
  } catch (error) {
    console.error('Error retrieving secret:', error);
    throw error;
  }
}

async function getJsonSecret<T = any>(secretId: string): Promise<T> {
  const secret = await getSecret(secretId);
  try {
    return JSON.parse(secret) as T;
  } catch (error) {
    console.error('Error parsing secret:', error);
    throw error;
  }
}

/**
 * Exports all key-value pairs from an object to process.env
 * @param {Record<string, string>} obj - The object containing key-value pairs to export
 * @throws {Error} If process.env is undefined or not writable
 */
function exportToEnv(obj: Record<string, string>): void {
  // Check if process.env is available and writable
  if (typeof process === 'undefined' || typeof process.env !== 'object') {
    throw new Error('process.env is not available or not writable');
  }

  // Iterate through all keys in the object
  for (const [key, value] of Object.entries(obj)) {
    // Ensure the value is a string before assigning to process.env
    process.env[key] = String(value);
  }

  // Log the number of exported variables (optional)
  console.log(`Exported ${Object.keys(obj).length} variables to process.env`);
}

exports.handler = async (event: any, context: any) => {
  if (handler) {
    return handler(event, context);
  } else {
    try {
      // Get the secret ARN from the environment variable
      const secretArn = process.env.API_SECRETS_ARN;

      // credentials for the worker and manager nodes - to initialise
      const workerCredsArn = process.env.WORKER_CREDS_ARN;
      const managerCredsArn = process.env.MANAGER_CREDS_ARN;
      const adminCredsArn = process.env.ADMIN_CREDS_ARN;

      if (
        [secretArn, workerCredsArn, managerCredsArn, adminCredsArn].some(
          v => !v,
        )
      ) {
        throw new Error('Missing environment variables for initialisation.');
      }

      // Retrieve the secret value using the Secrets Extension
      const secretJson = await getJsonSecret<ApiSecretConfig>(secretArn!);

      // Now get init token
      const managerCreds = await getJsonSecret<CredsInterface>(
        managerCredsArn!,
      );
      const workerCreds = await getJsonSecret<CredsInterface>(workerCredsArn!);
      const adminCreds = await getJsonSecret<CredsInterface>(adminCredsArn!);

      // Validate the secret
      try {
        ApiSecretConfigSchema.parse(secretJson);
      } catch (e) {
        console.error('Failed to validate secret details. Error: ', e);
        throw e;
      }

      // export secrets to environment
      exportToEnv({
        ...secretJson,
        ...{
          MANAGER_USERNAME: managerCreds.username,
          MANAGER_PASSWORD: managerCreds.password,
        },
        ...{
          WORKER_USERNAME: workerCreds.username,
          WORKER_PASSWORD: workerCreds.password,
        },
        ...{
          ADMIN_USERNAME: adminCreds.username,
          ADMIN_PASSWORD: adminCreds.password,
        },
      });

      // Call the serverlessExpress handler
      const { default: app, initialiseAdmins } = await import(
        '../api/apiSetup'
      );

      // Setup first
      await initialiseAdmins();

      handler = serverlessExpress({ app });
      return handler(event, context);
    } catch (error) {
      console.error('Error in Lambda handler:', error);
      throw error;
    }
  }
};
