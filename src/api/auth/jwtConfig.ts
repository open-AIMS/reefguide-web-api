import jwt from "jsonwebtoken";

// Load and format config from environment variable
import { config } from "../index";

// Key signing and validation parameters
const PRIVATE_KEY = config.jwt.privateKey;
export const PUBLIC_KEY = config.jwt.publicKey;
const KEY_ID = config.jwt.keyId;
const ISSUER = config.apiDomain;
const TOKEN_EXPIRY = "4h";
export const ALGORITHM = "RS256";
const KEY_TYPE = "RSA";
const KEY_USE = "sig";
const KEY_EXPONENT = "AQAB";

/**
 * Base64 encodes a string
 * @param key The key string to encode
 * @returns Base64 encoding
 */
function keyToBase64(key: string) {
  return Buffer.from(key).toString("base64");
}

/**
 * Signs a JWT with the given payload.
 * @param {object} payload - The payload to be included in the JWT.
 * @returns {string} The signed JWT string.
 */
export function signJwt(payload: object): string {
  return jwt.sign({ ...payload, iss: ISSUER }, PRIVATE_KEY, {
    algorithm: ALGORITHM,
    expiresIn: TOKEN_EXPIRY,
    header: {
      alg: ALGORITHM,
      kid: KEY_ID,
    },
  });
}

/**
 * Verifies a JWT and returns the decoded payload.
 * @param {string} token - The JWT string to verify.
 * @returns {jwt.JwtPayload} The decoded JWT payload.
 * @throws {jwt.JsonWebTokenError} If the token is invalid.
 */
export function verifyJwt(token: string): jwt.JwtPayload {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
  }) as jwt.JwtPayload;
}
/**
 * Generates a JSON Web Key Set (JWKS) containing the public key information.
 * @returns {object} An object representing the JWKS.
 */
export function getJwks() {
  return {
    keys: [
      {
        kty: KEY_TYPE,
        use: KEY_USE, // Key Usage: Signature
        alg: ALGORITHM, // Algorithm: RSA with SHA-256
        kid: KEY_ID, // Key ID
        n: keyToBase64(PUBLIC_KEY), // Modulus (base64 encoded)
        e: KEY_EXPONENT, // Exponent (65537 in base64)
      },
    ],
  };
}
