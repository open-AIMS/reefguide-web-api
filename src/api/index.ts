import express from 'express';
import { getJwks } from './auth/jwtUtils';
import { router as adminRoutes } from './admin/routes';
import { router as authRoutes } from './auth/routes';
import { router as noteRoutes } from './notes/routes';
import { router as polygonRoutes } from './polygons/routes';
import { router as userRoutes } from './users/routes';

require('express-async-errors');
const router = express.Router();

// jwks.json wkt endpoint
router.get('/.well-known/jwks.json', (req, res) => {
  res.json(getJwks());
});

/** Health check GET route */
router.get('/', (req, res) => {
  res
    .json({
      message: 'API healthy.',
    })
    .send();
});

// Passport auth routes
router.use('/auth', authRoutes);
router.use('/polygons', polygonRoutes);
router.use('/notes', noteRoutes);
router.use('/admin', adminRoutes);
router.use('/users', userRoutes);

export default router;
