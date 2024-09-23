import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { passport } from './auth/passportConfig';

import api from '.';
import * as middlewares from './middlewares';

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

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
