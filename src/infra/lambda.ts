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

async function getSecret<T = any>(secretId: string): Promise<T> {
  // see https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
  const secretsExtensionEndpoint = `http://localhost:2773/secretsmanager/get?secretId=${secretId}`;
  const headers = {
    'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN!,
  };

  try {
    const response = await axios.get(secretsExtensionEndpoint, { headers });
    return JSON.parse(response.data.SecretString) as T;
  } catch (error) {
    console.error('Error retrieving secret:', error);
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
    // Get the secret ARN from the environment variable
    const secretArn = process.env.API_SECRETS_ARN;

    if (!secretArn) {
      throw new Error('API_SECRETS_ARN environment variable is not set');
    }

    try {
      // Retrieve the secret value using the Secrets Extension
      const secretValue = await getSecret<ApiSecretConfig>(secretArn);

      // Validate the secret
      try {
        ApiSecretConfigSchema.parse(secretValue);
      } catch (e) {
        console.error('Failed to validate secret details. Error: ', e);
        throw e;
      }

      // export secret to environment
      exportToEnv(secretValue);

      // Call the serverlessExpress handler
      const { default: app } = await import('../api/apiSetup');
      handler = serverlessExpress({ app });
      return handler(event, context);
    } catch (error) {
      console.error('Error in Lambda handler:', error);
      throw error;
    }
  }
};
