/**
 * PIN Verification Middleware — Argon2id + Sliding-Window Rate Limit
 *
 * Verifies a user-supplied PIN against their stored Argon2id hash.
 * Tracks failed attempts in Redis; locks the account after MAX_ATTEMPTS
 * failures within the sliding window.
 *
 * Usage: apply to routes that require PIN confirmation (e.g. transfers).
 */

"use strict";

const { verifyPin } = require("../../utils/argon2pin");
const {
  recordFailedAttempt,
  recordSuccessfulAttempt,
  isPinLocked,
} = require("../../utils/redisPinRateLimiter");
const logger = require("../../utils/logger");
const { ValidationError, AuthorizationError } = require("../monitoring/errorHandler");

/**
 * PIN verification middleware factory.
 *
 * @param {Object} options
 * @param {string} [options.pinField='pin']               — req.body field containing the raw PIN
 * @param {string} [options.hashField='pinHash']          — req.user.pinHash (set at registration)
 * @param {boolean} [options.checkLockout=true]           — enforce lockout check
 * @param {boolean} [options.requirePin=true]             — fail if pinField is missing
 */
function verifyPinMiddleware(options = {}) {
  const {
    pinField = "pin",
    hashField = "pinHash",
    checkLockout = true,
    requirePin = true,
  } = options;

  return async function pinVerifyMiddleware(req, res, next) {
    const { user } = req;
    if (!user) {
      return next(new AuthorizationError("Authentication required"));
    }

    // Check lockout status first (skip hash comparison)
    if (checkLockout) {
      const locked = await isPinLocked(user.id);
      if (locked) {
        logger.warn("PIN operation blocked — account locked", {
          userId: user.id,
          requestId: req.id,
          ip: req.ip,
        });
        return next(
          new AuthorizationError(
            "Your account is temporarily locked due to too many failed PIN attempts. " +
              "Please contact support or wait 30 minutes.",
          ),
        );
      }
    }

    // Require PIN field presence
    const pin = req.body?.[pinField];
    if (requirePin && !pin) {
      return next(
        new ValidationError(
          `PIN is required for this operation. Supply ${pinField} in the request body.`,
        ),
      );
    }
    if (!pin) return next(); // optional PIN — nothing to verify

    // Read stored hash (set during registration/onboarding)
    const storedHash = user[hashField];
    if (!storedHash) {
      logger.error("PIN verification attempted without stored hash", {
        userId: user.id,
        requestId: req.id,
      });
      return next(
        new ValidationError(
          "PIN not configured for this account. Contact support.",
        ),
      );
    }

    // Verify the PIN using Argon2id
    const isValid = await verifyPin(String(pin), storedHash);

    if (!isValid) {
      // Record failure and check lockout
      const { count, locked } = await recordFailedAttempt(user.id);
      logger.warn("PIN verification failed", {
        userId: user.id,
        attempts: count,
        locked,
        requestId: req.id,
        ip: req.ip,
      });

      // Audit event — NEVER log the raw PIN
      logger.audit("PIN_FAILED", user.id, {
        attemptsInWindow: count,
        accountLocked: locked,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        requestId: req.id,
      });

      if (locked) {
        // Mark user record as tx_locked via Appwrite (pre-PG cutover)
        try {
          const { appwrite: dbConn } = require("../../database/connection");
          await dbConn.getDatabases().updateDocument(
            require("../../config/environment").database.appwrite.databaseId,
            require("../../config/environment").database.appwrite.userCollectionId,
            user.id,
            { txLocked: true },
          );
        } catch (_) {
          /* best-effort; lockout already recorded in Redis */
        }
      }

      return next(
        new ValidationError(
          locked
            ? "Account locked. Too many failed PIN attempts."
            : `Invalid PIN. ${5 - count} attempts remaining.`,
        ),
      );
    }

    // Successful verification — clear the sliding window
    await recordSuccessfulAttempt(user.id);
    logger.info("PIN verification successful", {
      userId: user.id,
      requestId: req.id,
      ip: req.ip,
    });
    logger.audit("PIN_SUCCESS", user.id, {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      requestId: req.id,
    });

    // Attach verified flag so downstream handlers know PIN was checked
    req.pinVerified = true;
    next();
  };
}

module.exports = { verifyPinMiddleware };
