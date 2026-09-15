/**
 * Rate Limiting Middleware
 * Implements various rate limiting strategies for different endpoints
 */

const rateLimit = require('express-rate-limit');
const config = require('../../config/environment');
const logger = require('../../utils/logger');
const { redis } = require('../../database/connection');

/**
 * Custom rate limit store using Redis
 */
class RedisStore {
  constructor(client, prefix = 'rl:') {
    this.client = client;
    this.prefix = prefix;
  }

  async get(key) {
    try {
      const redisClient = this.client.getClient();
      const result = await redisClient.get(this.prefix + key);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      logger.error('Redis rate limit get error:', error);
      return null;
    }
  }

  async set(key, value, windowMs) {
    try {
      const redisClient = this.client.getClient();
      await redisClient.setex(
        this.prefix + key,
        Math.ceil(windowMs / 1000),
        JSON.stringify(value)
      );
    } catch (error) {
      logger.error('Redis rate limit set error:', error);
    }
  }

  async increment(key, windowMs) {
    try {
      const redisClient = this.client.getClient();
      const multi = redisClient.multi();
      const fullKey = this.prefix + key;
      
      multi.incr(fullKey);
      multi.expire(fullKey, Math.ceil(windowMs / 1000));
      
      const results = await multi.exec();
      return results[0][1]; // Return the incremented value
    } catch (error) {
      logger.error('Redis rate limit increment error:', error);
      return 1;
    }
  }

  async decrement(key) {
    try {
      const redisClient = this.client.getClient();
      await redisClient.decr(this.prefix + key);
    } catch (error) {
      logger.error('Redis rate limit decrement error:', error);
    }
  }

  async resetKey(key) {
    try {
      const redisClient = this.client.getClient();
      await redisClient.del(this.prefix + key);
    } catch (error) {
      logger.error('Redis rate limit reset error:', error);
    }
  }
}

/**
 * Create rate limiter with custom configuration
 * @param {Object} options - Rate limiter options
 * @returns {Function} Rate limiter middleware
 */
function createRateLimiter(options = {}) {
  const defaultOptions = {
    windowMs: config.security.rateLimit.windowMs,
    max: config.security.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(config.security.rateLimit.windowMs / 1000)
      }
    },
    keyGenerator: (req) => {
      // Use IP address and user ID if available
      const ip = req.ip || req.connection.remoteAddress;
      const userId = req.user?.id || 'anonymous';
      return `${ip}:${userId}`;
    },
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health' || req.path === '/api/health';
    },
    handler: (req, res, next, options) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        userId: req.user?.id
      });
      
      res.status(options.statusCode || 429).json(options.message);
    }
  };

  const mergedOptions = { ...defaultOptions, ...options };

  // Use Redis store if available
  try {
    const redisClient = redis.getClient();
    if (redisClient && redisClient.status === 'ready') {
      mergedOptions.store = new RedisStore(redis);
    }
  } catch (error) {
    logger.warn('Using memory store for rate limiting (Redis unavailable)');
  }

  return rateLimit(mergedOptions);
}

// Global rate limiter for all API endpoints
const globalLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per window
  message: {
    success: false,
    error: {
      code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP. Please try again later.'
    }
  }
});

// Authentication rate limiter (more restrictive)
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  skipSuccessfulRequests: true, // Don't count successful requests
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again later.'
    }
  },
  keyGenerator: (req) => {
    // More specific key for auth attempts
    const ip = req.ip || req.connection.remoteAddress;
    const identifier = req.body?.email || req.body?.phone || req.body?.identifier || 'unknown';
    return `auth:${ip}:${identifier}`;
  }
});

// Payment rate limiter (very restrictive)
const paymentLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 payment attempts per window
  message: {
    success: false,
    error: {
      code: 'PAYMENT_RATE_LIMIT_EXCEEDED',
      message: 'Too many payment attempts. Please try again in a few minutes.'
    }
  },
  keyGenerator: (req) => {
    // Use user ID for payment rate limiting
    const userId = req.user?.id || req.ip;
    return `payment:${userId}`;
  }
});

// Admin rate limiter (less restrictive for authenticated admins)
const adminLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 500, // 500 requests per window
  message: {
    success: false,
    error: {
      code: 'ADMIN_RATE_LIMIT_EXCEEDED',
      message: 'Too many admin requests. Please try again later.'
    }
  },
  keyGenerator: (req) => {
    return `admin:${req.user?.id || req.ip}`;
  }
});

// File upload rate limiter
const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads per hour
  message: {
    success: false,
    error: {
      code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
      message: 'Too many file uploads. Please try again later.'
    }
  }
});

// Webhook rate limiter (separate limits for external systems)
const webhookLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 webhook calls per minute
  keyGenerator: (req) => {
    // Use webhook source identifier
    const source = req.headers['x-webhook-source'] || req.ip;
    return `webhook:${source}`;
  },
  message: {
    success: false,
    error: {
      code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
      message: 'Webhook rate limit exceeded'
    }
  }
});

// PIN rate limiter (strict: 5 attempts per 15 minutes)
const pinLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: {
      code: 'PIN_RATE_LIMIT_EXCEEDED',
      message: 'Too many failed PIN attempts. Account temporarily locked for 15 minutes.'
    }
  },
  keyGenerator: (req) => {
    const userId = req.user?.id || req.ip;
    return `pin:${userId}`;
  }
});

module.exports = {
  createRateLimiter,
  globalLimiter,
  authLimiter,
  paymentLimiter,
  adminLimiter,
  uploadLimiter,
  webhookLimiter,
  pinLimiter,
  RedisStore
};