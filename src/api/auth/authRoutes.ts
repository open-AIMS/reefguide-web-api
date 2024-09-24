import bcryptjs from 'bcryptjs';
import express, { Response } from 'express';
import { processRequest } from 'zod-express-middleware';
import {
  LoginInputSchema,
  LoginResponse,
  ProfileResponse,
  RegisterInputSchema,
  RegisterResponse,
  TokenInputSchema,
  TokenResponse,
} from '../../interfaces/Auth';
import { prisma } from '../apiSetup';
import * as Exceptions from '../exceptions';
import { generateRefreshToken, signJwt } from './jwtUtils';
import { passport } from './passportConfig';
import {
  decodeRefreshToken,
  getRefreshTokenObject,
  isRefreshTokenValid as validateRefreshToken,
} from './utils';

require('express-async-errors');
const router = express.Router();

/**
 * Register a new user
 */
router.post(
  '/register',
  processRequest({ body: RegisterInputSchema }),
  async (req, res: Response<RegisterResponse>) => {
    const { password, email } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Exceptions.BadRequestException('User already exists');
    }

    // Hash the password
    const hashedPassword = await bcryptjs.hash(password, 10);

    // Create new user
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        // No roles by default
        roles: [],
      },
    });

    res.status(201).json({ userId: newUser.id });
  },
);

/**
 * Login user
 */
router.post(
  '/login',
  processRequest({ body: LoginInputSchema }),
  async (req, res: Response<LoginResponse>) => {
    const { email, password: submittedPassword } = req.body;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        // Adjust fields here
        id: true,
        email: true,
        password: true,
        roles: true,
      },
    });

    if (!user) {
      throw new Exceptions.UnauthorizedException('Invalid credentials');
    }

    // Check password
    const isPasswordValid = await bcryptjs.compare(
      submittedPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new Exceptions.UnauthorizedException('Invalid credentials');
    }

    // Generate JWT - include ID and email
    // NOTE here is where we control what is embedded into JWT
    const token = signJwt({
      id: user.id,
      email: user.email,
      roles: user.roles,
    });

    // Generate a refresh token
    const refreshToken = await generateRefreshToken(user.id);

    // Return token and refresh token
    res.json({ token, refreshToken });
  },
);

/**
 * Get a new token using refresh token
 */
router.post(
  '/token',
  processRequest({ body: TokenInputSchema }),
  async (req, res: Response<TokenResponse>) => {
    // Pull out body contents
    const { refreshToken } = req.body;

    // Try to decode the token
    const decodedToken = decodeRefreshToken(refreshToken);

    // The decoded token contains both an ID and a token - check for both
    const tokenDbObject = await getRefreshTokenObject(decodedToken);

    // We have a valid, matching refresh token - now check it's valid
    validateRefreshToken(tokenDbObject);

    // Everything is okay - issue a new JWT
    const jwt = signJwt({
      id: tokenDbObject.user.id,
      email: tokenDbObject.user.email,
      roles: tokenDbObject.user.roles,
    });

    // Return token and refresh token
    res.json({ token: jwt });
  },
);

/**
 * Get user profile (protected route)
 */
router.get(
  '/profile',
  passport.authenticate('jwt', { session: false }),
  (req, res: Response<ProfileResponse>) => {
    if (!req.user) {
      throw new Exceptions.InternalServerError(
        'User object was not available after authorisation.',
      );
    }
    // The user is attached to the request by Passport
    res.json({ user: req.user });
  },
);

export default router;
