import express from 'express';
import { config, Config, ConfigSchema } from './config';
import { CapacityManager } from './manager';

// Create and start the express app for health checks
const app = express();
const port = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start the capacity manager
const manager = new CapacityManager(config);
manager.start();

// Start the express server
app.listen(port, () => {
  console.log(`Health check server listening on port ${port}`);
});

export { CapacityManager, Config, ConfigSchema };
