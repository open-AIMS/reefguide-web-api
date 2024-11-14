import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { passport } from './auth/passportConfig';

import api from '.';
import * as middlewares from './middlewares';

import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { registerUser } from './services/auth';

export const prisma = new PrismaClient();

export const initialiseAdmins = async () => {
  const initialise: { email: string; password: string }[] = [
    {
      email: config.creds.managerUsername,
      password: config.creds.managerPassword,
    },
    {
      email: config.creds.workerUsername,
      password: config.creds.workerPassword,
    },
    {
      email: config.creds.adminUsername,
      password: config.creds.adminPassword,
    },
  ];

  for (const { email, password } of initialise) {
    // Check if the users already exist
    try {
      prisma.user.findUniqueOrThrow({
        where: { email },
      });
    } catch {
      // doesn't exist, create new user
      try {
        await registerUser({
          email,
          password,
          roles: ['ADMIN'],
        });
      } catch (e) {
        console.error('Failed to initialise!', email);
        console.error(e);
      }
    }
  }
};

require('dotenv').config();

require('express-async-errors');
const app = express();

app.use(morgan('dev'));
app.use(helmet());
app.use(cors());
app.use(express.json());

// Passport authentication
app.use(passport.initialize());

// API base router
app.use('/api', api);

// Passes status code from custom exceptions through to error response
app.use(middlewares.errorMiddleware);

export default app;
