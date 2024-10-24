import { UserRole } from '@prisma/client';
import express, { Response } from 'express';
import { z } from 'zod';
import { processRequest } from 'zod-express-middleware';
import { passport } from '../auth/passportConfig';
import { userIsAdminMiddleware } from '../auth/utils';
import { InternalServerError, NotFoundException } from '../exceptions';

require('express-async-errors');
export const router = express.Router();

import { prisma } from '../apiSetup';
import { changePassword, registerUser } from '../services/auth';

const UpdateUserRolesSchema = z.object({
  roles: z.array(z.nativeEnum(UserRole)),
});

// Response Types
const UserResponseSchema = z.object({
  id: z.number(),
});

type UserResponse = z.infer<typeof UserResponseSchema>;

const UpdateUserPasswordSchema = z.object({
  password: z.string().min(8),
});

// Schema Definitions
const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  roles: z.array(z.nativeEnum(UserRole)).optional(),
});

/**
 * Get all users (admin only)
 */
router.get(
  '/',
  passport.authenticate('jwt', { session: false }),
  userIsAdminMiddleware,
  async (req, res: Response<UserResponse[]>) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          roles: true,
        },
      });
      res.json(users);
    } catch (error) {
      throw new InternalServerError('Failed to fetch users');
    }
  },
);

/**
 * Get a specific user by ID (admin only)
 */
router.get(
  '/:id',
  passport.authenticate('jwt', { session: false }),
  userIsAdminMiddleware,
  processRequest({ params: z.object({ id: z.string() }) }),
  async (req, res: Response<UserResponse>) => {
    const userId = parseInt(req.params.id);

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          roles: true,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      res.json(user);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerError('Failed to fetch user');
    }
  },
);

/**
 * Create a new user (admin only)
 */
router.post(
  '/',
  passport.authenticate('jwt', { session: false }),
  userIsAdminMiddleware,
  processRequest({
    body: CreateUserSchema,
  }),
  async (req, res: Response<UserResponse>) => {
    const { email, password, roles = [] } = req.body;
    // Create the user
    const newUserId = await registerUser({ email, password, roles });
    res.status(201).json({ id: newUserId });
  },
);

/**
 * Update user roles (admin only)
 */
router.put(
  '/:id/roles',
  passport.authenticate('jwt', { session: false }),
  userIsAdminMiddleware,
  processRequest({
    body: UpdateUserRolesSchema,
    params: z.object({ id: z.string() }),
  }),
  async (req, res: Response<UserResponse>) => {
    const userId = parseInt(req.params.id);
    const { roles } = req.body;

    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: { roles },
        select: {
          id: true,
          email: true,
          roles: true,
        },
      });

      res.json(user);
    } catch (error) {
      throw new InternalServerError('Failed to update user roles');
    }
  },
);

/**
 * Update user password (admin only)
 */
router.put(
  '/:id/password',
  passport.authenticate('jwt', { session: false }),
  userIsAdminMiddleware,
  processRequest({
    body: UpdateUserPasswordSchema,
  }),
  async (req, res: Response<UserResponse>) => {
    const userId = parseInt(req.params.id);
    const { password } = req.body;

    await changePassword({ id: userId, password });
    res.sendStatus(200);
  },
);

/**
 * Delete a user (admin only)
 */
router.delete(
  '/:id',
  passport.authenticate('jwt', { session: false }),
  userIsAdminMiddleware,
  async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      await prisma.user.delete({
        where: { id: userId },
      });

      res.sendStatus(204);
    } catch (error) {
      throw new InternalServerError('Failed to delete user');
    }
  },
);
