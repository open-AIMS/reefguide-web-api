import express from 'express';
import { loadConfig } from './config';
import { TestWorker } from './worker';

async function main() {
  // Load configuration
  const config = loadConfig();
  
  // Create express app for health checks
  const app = express();
  
  // Create worker instance
  const worker = new TestWorker(config);
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    const activeJobs = worker.getActiveJobCount();
    res.json({
      status: 'healthy',
      activeJobs,
      maxJobs: config.maxConcurrentJobs
    });
  });
  
  // Start HTTP server
  app.listen(config.port, () => {
    console.log(`Health check server listening on port ${config.port}`);
  });
  
  // Handle shutdown gracefully
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal, shutting down...');
    await worker.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('Received SIGINT signal, shutting down...');
    await worker.stop();
    process.exit(0);
  });
  
  // Start the worker
  await worker.start();
}

// Start the application
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});