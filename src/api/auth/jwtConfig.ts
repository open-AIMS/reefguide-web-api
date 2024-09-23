import jwt from 'jsonwebtoken';

// Load and format config from environment variable
import { config } from '../index';

const privateKey = config.jwt.privateKey;
const publicKey = config.jwt.publicKey;
const keyId = config.jwt.keyId;
const issuer = config.apiDomain;

/**
 * Signs a JWT with the given payload.
 * @param {object} payload - The payload to be included in the JWT.
 * @returns {string} The signed JWT string.
 */
export function signJwt(payload: object): string {
  return jwt.sign(
    { ...payload, iss: issuer }, // Add issuer to payload
    privateKey,
    {
      algorithm: 'RS256', // Use RSA with SHA-256
      expiresIn: '1h', // Token expires in 1 hour
      header: {
        alg: 'RS256',
        kid: keyId, // Include key ID in header
      },
    },
  );
}

/**
 * Verifies a JWT and returns the decoded payload.
 * @param {string} token - The JWT string to verify.
 * @returns {jwt.JwtPayload} The decoded JWT payload.
 * @throws {jwt.JsonWebTokenError} If the token is invalid.
 */
export function verifyJwt(token: string): jwt.JwtPayload {
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'], // Only allow RS256 algorithm
    issuer: issuer, // Verify the issuer claim
  }) as jwt.JwtPayload;
}

// Export the public key in PEM format
export const publicKeyPem = publicKey;

/**
 * Generates a JSON Web Key Set (JWKS) containing the public key information.
 * @returns {object} An object representing the JWKS.
 */
export function getJwks() {
  return {
    keys: [
      {
        kty: 'RSA', // Key Type: RSA
        use: 'sig', // Key Usage: Signature
        alg: 'RS256', // Algorithm: RSA with SHA-256
        kid: keyId, // Key ID
        n: Buffer.from(publicKey).toString('base64'), // Modulus (base64 encoded)
        e: 'AQAB', // Exponent (65537 in base64)
      },
    ],
  };
}
