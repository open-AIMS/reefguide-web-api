import express from 'express';
import authRoutes from './auth/authRoutes';
import { router as admin } from './admin/routes';
import { router as users } from './users/routes';
import { getJwks } from './auth/jwtUtils';
import polygons from './polygons/routes';
import notes from './notes/routes';

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
router.use('/polygons', polygons);
router.use('/notes', notes);
router.use('/admin', admin);
router.use('/users', users);

export default router;
