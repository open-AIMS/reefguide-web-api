import bcryptjs from "bcryptjs";
import express, { Request, Response } from "express";
import { processRequest } from "zod-express-middleware";
import {
  LoginInputSchema,
  LoginResponse,
  ProfileResponse,
  RegisterInputSchema,
  RegisterResponse,
} from "../../interfaces/Auth";
import { prisma } from "../apiSetup";
import * as Exceptions from "../exceptions";
import { signJwt } from "./jwtConfig";
import { passport } from "./passportConfig";

require("express-async-errors");
const router = express.Router();

/**
 * Register a new user
 */
router.post(
  "/register",
  processRequest({ body: RegisterInputSchema }),
  async (req: Request, res: Response<RegisterResponse>) => {
    const { password, email } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Exceptions.BadRequestException("User already exists");
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
  }
);

/**
 * Login user
 */
router.post(
  "/login",
  processRequest({ body: LoginInputSchema }),
  async (req: Request, res: Response<LoginResponse>) => {
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
      throw new Exceptions.UnauthorizedException("Invalid credentials");
    }

    // Check password
    const isPasswordValid = await bcryptjs.compare(
      submittedPassword,
      user.password
    );

    if (!isPasswordValid) {
      throw new Exceptions.UnauthorizedException("Invalid credentials");
    }

    // Generate JWT - include ID and email
    // NOTE here is where we control what is embedded into JWT
    const token = signJwt({
      id: user.id,
      email: user.email,
      roles: user.roles,
    });

    res.json({ token });
  }
);

/**
 * Get user profile (protected route)
 */
router.get(
  "/profile",
  passport.authenticate("jwt", { session: false }),
  (req: Request, res: Response<ProfileResponse>) => {
    if (!req.user) {
      throw new Exceptions.InternalServerError(
        "User object was not available after authorisation."
      );
    }
    // The user is attached to the request by Passport
    res.json({ user: req.user });
  }
);

export default router;
