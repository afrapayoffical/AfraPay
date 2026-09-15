/**
 * Redis PIN Rate Limiter — Sliding-Window Implementation
 *
 * Tracks failed PIN attempts per user using Redis sorted sets.
 * Window: 15 minutes. Max attempts: 5.
 * Upon the 5th consecutive failure the user's transaction capability
 * is disabled (tx_locked = true in their database record).
 *
 * Keys:
 *   rate:pin:<actor_id>        — sorted set of failure timestamps
 *   pin:lockout:<actor_id>     — TTL flag when account is locked
 */

"use strict";

const logger = require("./logger");
const config = require("../config/environment");
const { redis } = require("../database/connection");

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

/**
 * Record a failed PIN attempt for the given actor.
 * Returns the current count of failures within the sliding window.
 *
 * @param {string} actorId - The authenticated user / merchant ID
 * @param {object} client - { getClient } from database/connection
 * @returns {Promise<{ count: number, locked: boolean }>}
 */
async function recordFailedAttempt(actorId, clientOverride) {
  const getClient = clientOverride
    ? () => clientOverride
    : _getClient();

  if (!getClient) {
    logger.warn("Redis unavailable for PIN rate limiter, skipping");
    return { count: 0, locked: false };
  }

  const client = getClient();
  if (!client || client.status !== "ready") {
    logger.warn("Redis not ready for PIN rate limiter");
    return { count: 0, locked: false };
  }

  try {
    const now = Date.now().toString();
    const key = `rate:pin:${actorId}`;
    const lockKey = `pin:lockout:${actorId}`;

    // Check if already locked out
    const isLocked = await client.get(lockKey);
    if (isLocked) {
      return { count: MAX_ATTEMPTS, locked: true };
    }

    // Add failure timestamp to sorted set (score = timestamp)
    await client.zadd(key, now, now);

    // Remove entries outside the sliding window
    const windowStart = Date.now() - WINDOW_MS;
    await client.zremrangebyscore(key, 0, windowStart.toString());

    // Count remaining failures in window
    const count = await client.zcard(key);

    if (count >= MAX_ATTEMPTS) {
      // Lock the account — TTL is double the window so it self-corrects
      await client.setex(lockKey, WINDOW_MS * 2, "1");
      logger.warn("PIN lockout triggered", { actorId, attempts: count });
      return { count, locked: true };
    }

    return { count, locked: false };
  } catch (error) {
    logger.error("PIN rate limiter error", { actorId, error: error.message });
    // Fail open: do not lock account on Redis errors
    return { count: 0, locked: false };
  }
}

/**
 * Record a successful PIN attempt — clears the sliding window.
 *
 * @param {string} actorId
 */
async function recordSuccessfulAttempt(actorId) {
  const getClient = _getClient();
  if (!getClient) return;

  const client = getClient();
  if (!client || client.status !== "ready") return;

  try {
    const key = `rate:pin:${actorId}`;
    const lockKey = `pin:lockout:${actorId}`;
    await client.del(key);
    await client.del(lockKey);
  } catch (error) {
    logger.error("PIN success cleanup error", { actorId, error: error.message });
  }
}

/**
 * Check whether a given actor is currently locked out from PIN operations.
 *
 * @param {string} actorId
 * @returns {Promise<boolean>}
 */
async function isPinLocked(actorId) {
  const getClient = _getClient();
  if (!getClient) return false;

  const client = getClient();
  if (!client || client.status !== "ready") return false;

  try {
    const lockKey = `pin:lockout:${actorId}`;
    return (await client.get(lockKey)) !== null;
  } catch {
    return false;
  }
}

function _getClient() {
  try {
    return redis.getClient();
  } catch {
    return null;
  }
}

module.exports = {
  recordFailedAttempt,
  recordSuccessfulAttempt,
  isPinLocked,
  WINDOW_MS,
  MAX_ATTEMPTS,
};
