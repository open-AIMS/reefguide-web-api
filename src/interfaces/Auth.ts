import { z } from 'zod';

// Auth schemas
export const RegisterInputSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const RegisterResponseSchema = z.object({
  userId: z.number(),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

// Login schemas
export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// Profile schema
export const ProfileResponseSchema = z.object({
  user: z.object({
    id: z.number(),
    email: z.string().email(),
    // Add any other user properties you want to include
  }),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
