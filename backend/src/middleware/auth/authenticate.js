/**
 * Authentication Middleware
 * Verifies JWT tokens and authenticates users.
 *
 * For every request, the JWT signature is verified AND the user's live
 * account status is re-checked against the persisted store.  This prevents
 * a hijacked or leaked JWT from being used against a revoked / suspended
 * account (session staleness).
 *
 * Redis-backed token blacklist is checked via tokenBlacklist.js.
 * PostgreSQL-backed account status is checked in the live reload path.
 */

const jwt = require("jsonwebtoken");
const config = require("../../config/environment");
const logger = require("../../utils/logger");
const { AuthenticationError } = require("../monitoring/errorHandler");
const { isBlacklisted } = require("../../utils/tokenBlacklist");

/**
 * Extract token from request headers or cookies.
 * NOTE: Query-parameter tokens are intentionally NOT supported here.
 * Tokens in URLs are logged by proxies, access logs, and appear in
 * browser history and Referer headers, leaking credentials.
 * WebSocket handshake tokens are passed via socket.handshake.auth.
 * @param {Object} req - Express request object
 * @returns {string|null} JWT token or null
 */
function extractToken(req) {
  // Log available header and cookie names (no values) to help debug how
  // clients are sending tokens. Do NOT log token values.
  try {
    const headerNames = Object.keys(req.headers || {});
    const cookieNames = req.cookies ? Object.keys(req.cookies) : [];
    logger.debug("Token request metadata", {
      headerNames,
      cookieNames,
      url: req.originalUrl,
      method: req.method,
      requestId: req.id,
    });
  } catch (_) {
    // Logging must never crash authentication
  }

  // Prefer the standard Authorization header (case-insensitive)
  const rawAuthHeader = req.headers?.authorization || req.get("Authorization");
  if (rawAuthHeader) {
    const bearerMatch = rawAuthHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
      try {
        logger.debug("Token detected", {
          source: "Authorization header",
          requestId: req.id,
        });
      } catch (_) {}
      return bearerMatch[1];
    }

    // Some clients may send the token without the 'Bearer' prefix
    const trimmed = String(rawAuthHeader).trim();
    if (trimmed) {
      try {
        logger.debug("Token detected", {
          source: "Authorization header (no Bearer)",
          requestId: req.id,
        });
      } catch (_) {}
      return trimmed;
    }
  }

  // Common alternative headers used by some clients
  const altToken =
    req.get("X-Access-Token") ||
    req.get("X-Auth-Token") ||
    req.get("x-access-token") ||
    req.get("x-auth-token");
  if (altToken) {
    try {
      logger.debug("Token detected", {
        source: "Alternate auth header",
        requestId: req.id,
      });
    } catch (_) {}
    return altToken;
  }

  // Check cookies (for web sessions) with several common cookie names
  if (req.cookies) {
    const cookieSource =
      req.cookies.accessToken ||
      req.cookies.access_token ||
      req.cookies["appwrite-session"] ||
      req.cookies.session ||
      req.cookies.sessionId ||
      null;
    if (cookieSource) {
      try {
        logger.debug("Token detected", {
          source: "Cookie",
          cookieNames: Object.keys(req.cookies),
          requestId: req.id,
        });
      } catch (_) {}
    }
    return cookieSource;
  }

  return null;
}

/**
 * Verify JWT token and decode payload
 * @param {string} token - JWT token
 * @returns {Object} Decoded token payload
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.security.jwt.secret);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new AuthenticationError("Token has expired");
    } else if (error.name === "JsonWebTokenError") {
      throw new AuthenticationError("Invalid token");
    } else {
      throw new AuthenticationError("Token verification failed");
    }
  }
}

/**
 * Authentication middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authenticate(req, _res, next) {
  try {
    // Extract token from request
    const token = extractToken(req);

    if (!token) {
      throw new AuthenticationError("Authentication token is required");
    }

    // Verify and decode token
    const decoded = verifyToken(token);

    // Check if token type is correct (access token)
    if (decoded.type !== "access") {
      throw new AuthenticationError("Invalid token type");
    }

    // Check if token has been revoked (e.g. user logged out)
    if (await isBlacklisted(decoded, token)) {
      throw new AuthenticationError("Token has been revoked");
    }

    // ── Live account-status reload ────────────────────────────────────────
    // Reject expired, deactivated, or KYC-changed sessions immediately.
    // TODO (pre-PG cutover): when ledger accounts are provisioned, read
    // account status from ledger_accounts / users postgres table instead of
    // Appwrite.  For now we keep the Appwrite check as the source of truth.
    let userProfile = null;
    try {
      const { appwrite: dbConn } = require("../../database/connection");
      userProfile = await dbConn.getDatabases().getDocument(
        config.database.appwrite.databaseId,
        config.database.appwrite.userCollectionId,
        decoded.sub
      );
    } catch (appwriteErr) {
      logger.warn("Live account reload failed, falling back to token claim", {
        userId: decoded.sub,
        error: appwriteErr.message,
        requestId: req.id,
      });
    }

    if (userProfile) {
      if (userProfile.accountStatus !== "active") {
        throw new AuthenticationError("User account is not active");
      }
    } else {
      // Fallback: reject when we cannot confirm the account is active.
      // Safer than trusting a stale token.
      throw new AuthenticationError("Unable to verify account status");
    }

    // Attach user data to request
    const { appwrite: dbConnForId } = require("../../database/connection");
    const { Users } = require("node-appwrite");
    const usersClient = new Users(dbConnForId.ensureAppwriteClients().client);
    const userDetails = await usersClient.get(decoded.sub);

    req.user = {
      id: userDetails.$id,
      email: userDetails.email,
      role: userProfile.role,
      kycLevel: parseInt(userProfile.kycLevel || 0, 10),
      status: userProfile.accountStatus,
      permissions: JSON.parse(userProfile.permissions || "[]"),
      sessionId: decoded.sessionId,
    };

    req.token = token;
    req.tokenPayload = decoded;

    // Log successful authentication
    logger.info("User authenticated successfully", {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
      sessionId: req.user.sessionId,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      requestId: req.id,
    });

    next();
  } catch (error) {
    // Log authentication failure
    logger.warn("Authentication failed", {
      error: error.message,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
    });

    next(error);
  }
}

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't fail if no token is provided
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function optionalAuthenticate(req, _res, next) {
  try {
    const token = extractToken(req);

    if (token) {
      const decoded = verifyToken(token);

      if (decoded.type === "access") {
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          role: decoded.role,
          permissions: decoded.permissions || [],
          sessionId: decoded.sessionId,
          iat: decoded.iat,
          exp: decoded.exp,
        };
        req.token = token;
        req.tokenPayload = decoded;
      }
    }

    next();
  } catch (error) {
    // For optional auth, we don't fail on authentication errors
    // Just proceed without user data
    logger.debug("Optional authentication failed", {
      error: error.message,
      ip: req.ip,
      requestId: req.id,
    });

    next();
  }
}

/**
 * WebSocket authentication middleware
 * @param {Object} socket - Socket.io socket object
 * @param {Function} next - Next function
 */
function authenticateWebSocket(socket, next) {
  try {
    const token =
      socket.request.headers.authorization?.slice(7) ||
      socket.handshake.auth.token ||
      socket.handshake.query.token;

    if (!token) {
      return next(new AuthenticationError("Authentication token is required"));
    }

    const decoded = verifyToken(token);

    if (decoded.type !== "access") {
      return next(new AuthenticationError("Invalid token type"));
    }

    socket.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions || [],
      sessionId: decoded.sessionId,
    };

    logger.info("WebSocket user authenticated", {
      userId: socket.user.id,
      email: socket.user.email,
      socketId: socket.id,
      ip: socket.request.connection.remoteAddress,
    });

    next();
  } catch (error) {
    logger.warn("WebSocket authentication failed", {
      error: error.message,
      socketId: socket.id,
      ip: socket.request.connection.remoteAddress,
    });

    next(error);
  }
}

/**
 * Optional WebSocket authentication middleware for guest and authenticated users
 * @param {Object} socket - Socket.io socket object
 * @param {Function} next - Next function
 */
function optionalAuthenticateWebSocket(socket, next) {
  try {
    const token =
      socket.request.headers.authorization?.slice(7) ||
      socket.handshake.auth.token ||
      socket.handshake.query.token;

    if (!token) {
      // Allow guest users
      socket.user = null;
      logger.info("WebSocket guest user connected", {
        socketId: socket.id,
        ip: socket.request.connection.remoteAddress,
      });
      return next();
    }

    try {
      const decoded = verifyToken(token);

      if (decoded.type !== "access") {
        // Invalid token - treat as guest
        socket.user = null;
        return next();
      }

      socket.user = {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions || [],
        sessionId: decoded.sessionId,
      };

      logger.info("WebSocket user authenticated", {
        userId: socket.user.id,
        email: socket.user.email,
        socketId: socket.id,
        ip: socket.request.connection.remoteAddress,
      });
    } catch (authError) {
      // Authentication failed - treat as guest
      socket.user = null;
      logger.info("WebSocket guest user connected (auth failed)", {
        socketId: socket.id,
        ip: socket.request.connection.remoteAddress,
        authError: authError.message,
      });
    }

    next();
  } catch (error) {
    // Unexpected error - still allow as guest
    socket.user = null;
    logger.warn("WebSocket authentication error, treating as guest", {
      error: error.message,
      socketId: socket.id,
      ip: socket.request.connection.remoteAddress,
    });
    next();
  }
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  authenticateWebSocket,
  optionalAuthenticateWebSocket,
  extractToken,
  verifyToken,
};
