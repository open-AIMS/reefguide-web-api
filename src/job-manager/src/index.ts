import express from 'express';
import { z } from 'zod';
import { Config, loadConfig } from './config';
import { CapacityManager } from './manager';
import { AuthApiClient } from './authClient';

// Create and start the express app for health checks
const app = express();
const port = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  console.log('Health check, returning 200 OK');
  res.status(200).send('OK');
});

let config: Config;

try {
  config = loadConfig();
  console.log('Configuration loaded successfully');
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Configuration validation failed:', error.errors);
  } else {
    console.error('Failed to load configuration:', error);
  }
  process.exit(1);
}

// Create API client (base should include /api)
const client = new AuthApiClient(config.apiEndpoint + '/api', {
  email: config.auth.email,
  password: config.auth.password,
});

// Start the express server
app.listen(port, () => {
  console.log(`Health check server listening on port ${port}`);
});

// Start the capacity manager
const manager = new CapacityManager(config, client);
manager.start();
