/**
 * Argon2id PIN Security Module
 *
 * Uses Argon2id (memory-hard, side-channel resistant) for PIN hashing.
 * Parameter profile (V2 spec): m=19456 KiB, t=2 iterations, p=1 parallelism.
 *
 * Sliding-window rate limiting is handled by redisPinRateLimiter.js.
 */

"use strict";

const argon2 = require("argon2");
const crypto = require("crypto");
const config = require("../config/environment");
const logger = require("./logger");

const {
  memoryCost: MEMORY_COST,
  timeCost: TIME_COST,
  parallelism: PARALLELISM,
  hashLength: HASH_LENGTH,
  saltLength: SALT_LENGTH,
} = config.security.argon2id;

/**
 * Hash a raw PIN code with a random salt using Argon2id.
 * Returns the full base64-encoded hash (salt + options + hash).
 *
 * @param {string} pin - Raw PIN (4-6 digits)
 * @returns {Promise<string>} Argon2id hash string
 */
async function hashPin(pin) {
  try {
    const hash = await argon2.hash(pin, {
      type: argon2.argon2id,
      memoryCost: MEMORY_COST,
      timeCost: TIME_COST,
      parallelism: PARALLELISM,
      saltLength: SALT_LENGTH,
      hashLength: HASH_LENGTH,
    });
    return hash;
  } catch (error) {
    logger.error("PIN hash error", { error: error.message });
    throw new Error("PIN hashing failed");
  }
}

/**
 * Verify a raw PIN against a stored Argon2id hash.
 * Returns true if the PIN matches.
 *
 * @param {string} pin - Raw PIN to verify
 * @param {string} hash - Stored Argon2id hash
 * @returns {Promise<boolean>}
 */
async function verifyPin(pin, hash) {
  try {
    return await argon2.verify(hash, pin);
  } catch (error) {
    logger.error("PIN verify error", { error: error.message });
    // Fail closed on error: treat as failure to avoid false accept
    return false;
  }
}

/**
 * Generate a cryptographically random hex salt for PIN storage.
 * Kept as a fallback for migration scenarios where salt is stored separately.
 *
 * @param {number} bytes - Number of random bytes (default 16)
 * @returns {string} Hex-encoded salt
 */
function generateSalt(bytes = SALT_LENGTH) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * SHA-256 hash of sanitized request body — used for idempotency request hash.
 *
 * @param {Object} body - Request body object
 * @returns {string} hex-encoded SHA-256
 */
function requestHash(body) {
  const serialized = JSON.stringify(body);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

module.exports = { hashPin, verifyPin, generateSalt, requestHash };
