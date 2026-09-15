/**
 * Token Blacklist Utility
 * Handles JWT token blacklisting for logout and security events
 */

const { redis: { getClient } } = require("../database/connection");
const logger = require("./logger");

/**
 * Check if a token is blacklisted
 * @param {Object} tokenPayload - Decoded JWT payload
 * @param {string} tokenString - Original JWT token
 * @returns {Promise<boolean>} True if blacklisted
 */
async function isBlacklisted(tokenPayload, tokenString) {
  try {
    const redis = getClient();
    if (!redis) {
      logger.warn("Redis not available for token blacklist check");
      return false;
    }

    // Check by token jti (JWT ID) if available
    const jti = tokenPayload.jti || tokenPayload.sessionId;
    if (jti) {
      const isBlacklisted = await redis.get(`bl:${jti}`);
      return isBlacklisted !== null;
    }

    // Fallback: check by token string (less efficient, but works)
    const isBlacklistedByToken = await redis.get(`bl:token:${tokenString}`);
    return isBlacklistedByToken !== null;
  } catch (error) {
    logger.error("Error checking token blacklist:", error.message);
    // Fail closed: if we can't check, treat as blacklisted for safety
    return true;
  }
}

/**
 * Add a token to the blacklist
 * @param {Object} tokenPayload - Decoded JWT payload
 * @param {string} tokenString - Original JWT token
 * @param {number} ttlSeconds - Time to live in seconds (defaults to token expiry)
 */
async function blacklistToken(tokenPayload, tokenString, ttlSeconds) {
  try {
    const redis = getClient();
    if (!redis) {
      logger.warn("Redis not available for token blacklisting");
      return false;
    }

    const jti = tokenPayload.jti || tokenPayload.sessionId;
    const expiry = tokenPayload.exp * 1000 - Date.now(); // milliseconds until expiry
    const ttl = Math.floor(expiry / 1000); // seconds until expiry

    // Use the smaller of provided TTL or token's remaining TTL
    const finalTTL = ttlSeconds ? Math.min(ttlSeconds, ttl) : ttl;

    if (jti) {
      await redis.set(`bl:${jti}`, "1", { EX: finalTTL });
    }

    // Also blacklist by token string for extra safety
    await redis.set(`bl:token:${tokenString}`, "1", { EX: finalTTL });

    logger.info("Token blacklisted", { jti, ttl: finalTTL });
    return true;
  } catch (error) {
    logger.error("Error blacklisting token:", error.message);
    return false;
  }
}

module.exports = {
  isBlacklisted,
  blacklistToken,
};