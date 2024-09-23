import express from 'express';
import authRoutes from './auth/authRoutes';
import { getJwks } from './auth/jwtConfig';
import { getConfig, Config } from './config';
import polygons from './polygons/routes';
import notes from './notes/routes';

require('express-async-errors');
const router = express.Router();

// This can be used at other parts of the app to understand the config
export let config: Config;

try {
  console.log('Config loading...');
  config = getConfig();
  console.log('Config loaded and validated from environment.');
} catch (error) {
  console.error('Failed to load configuration:', error);
  process.exit(1);
}

// jwks.json wkt endpoint
router.get('/.well-known/jwks.json', (req, res) => {
  res.json(getJwks());
});

/** Health check GET route */
router.get('/', (req, res) => {
  res.json({
    message: 'API healthy.',
  }).send();
});

// Passport auth routes
router.use('/auth', authRoutes);
router.use('/polygons', polygons);
router.use('/notes', notes);

export default router;
