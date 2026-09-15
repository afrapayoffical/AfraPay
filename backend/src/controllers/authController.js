/**
 * Authentication Controller
 * Handles user authentication, registration, and session management
 * Based on the comprehensive AUTH_FLOW.md specifications
 */

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { OAuth2Client } = require("google-auth-library");
const axios = require("axios");
const config = require("../config/environment");
const logger = require("../utils/logger");
const {
  AuthenticationError,
  ValidationError,
  ConflictError,
  RateLimitError,
  EmailNotVerifiedError,
} = require("../middleware/monitoring/errorHandler");

// Import Appwrite clients from services
const { account, users, db, ID, Query } = require("../../services/appwriet");

// Real token revocation (wired to Redis / in-memory blacklist)
const { addToBlacklist, isBlacklisted } = require("../utils/tokenBlacklist");

// Resend-backed email service
const emailService = require("../services/emailService");

// In-app notification helper (lazy require to break circular-dependency risk)
const getCreateNotification = () =>
  require("./notificationController").createNotification;

// Admin notification helper
const getCreateAdminNotification = () =>
  require("../services/notificationService").createAdminNotification;

// ---------------------------------------------------------------------------
// In-process session store. For multi-server/multi-process deployments replace
// with a shared Redis store (the ioredis client is already wired in the project).
// ---------------------------------------------------------------------------
const activeSessions = new Map();
const registrationIdempotencyStore = new Map();
const REGISTRATION_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// AES-256-GCM helpers — used to store TOTP secrets encrypted at rest so that
// a database/prefs leak cannot be used to clone authenticator codes.
// ENCRYPTION_KEY must be exactly 32 bytes (set in .env).
// ---------------------------------------------------------------------------
function encryptSecret(plaintext) {
  const key = Buffer.from(config.security.encryption.key, "utf8");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Packed form: base64(iv):base64(authTag):base64(ciphertext)
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(packed) {
  const [ivB64, authTagB64, cipherB64] = packed.split(":");
  const key = Buffer.from(config.security.encryption.key, "utf8");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Wraps a promise with a timeout to prevent indefinite hangs
 * (e.g. when Appwrite cloud is slow or unreachable)
 */
function withTimeout(promise, ms = 10000, label = "Operation") {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}

/**
 * Safe prefs update — Appwrite's updatePrefs REPLACES the entire prefs object,
 * so we must always read–merge–write to avoid wiping unrelated keys
 * (e.g. passwordHash, totpSecret, trustedDevices).
 */
async function mergePrefs(userId, updates) {
  const current = await withTimeout(
    users.get(userId),
    10000,
    "Appwrite users.get (mergePrefs)",
  );
  return users.updatePrefs(userId, { ...(current.prefs || {}), ...updates });
}

class AuthController {
  /**
   * User Registration Flow
   * Implements multi-step registration with KYC Level 0 verification
   */
  async debugAppwriteUser(req, res) {
    const { email, phone } = req.query || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPhone = String(phone || "").trim();

    if (!normalizedEmail && !normalizedPhone) {
      throw new ValidationError(
        "Provide at least one of email or phone to look up the Appwrite user.",
      );
    }

    const emailMatches = normalizedEmail
      ? await withTimeout(
          users.list([Query.equal("email", normalizedEmail)]),
          10000,
          "Appwrite users.list (email lookup)",
        )
      : { users: [] };

    const phoneMatches = normalizedPhone
      ? await withTimeout(
          users.list([Query.equal("phone", normalizedPhone)]),
          10000,
          "Appwrite users.list (phone lookup)",
        )
      : { users: [] };

    const merged = {};
    for (const user of [...(emailMatches.users || []), ...(phoneMatches.users || [])]) {
      merged[user.$id] = {
        $id: user.$id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        labels: user.labels,
        registration: user.registration,
        status: user.status,
      };
    }

    return res.success(
      {
        projectId: config.database.appwrite.projectId,
        endpoint: config.database.appwrite.endpoint,
        email: normalizedEmail || null,
        phone: normalizedPhone || null,
        matches: Object.values(merged),
        emailMatchesCount: emailMatches.total || 0,
        phoneMatchesCount: phoneMatches.total || 0,
      },
      "Appwrite Auth lookup completed.",
    );
  }

  async register(req, res) {
    logger.debug("Registration request received", {
      email: req.body?.email,
      ip: req?.ip,
      appwriteEndpoint: config.database.appwrite.endpoint,
      appwriteProjectId: config.database.appwrite.projectId,
    });
    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      country,
      termsAccepted,
      marketingAccepted,
      idempotencyKey,
    } = req.body;

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const rawPhone = String(phone || "").trim();
    const normalizedPhone = this.normalizePhoneForAppwrite(rawPhone);
    const requestKey = idempotencyKey || `${normalizedEmail}:${normalizedPhone || ""}`;

    const cachedRegistration = registrationIdempotencyStore.get(requestKey);
    if (
      cachedRegistration &&
      Date.now() - cachedRegistration.timestamp < REGISTRATION_IDEMPOTENCY_TTL_MS
    ) {
      logger.warn("Duplicate registration request suppressed", {
        email: normalizedEmail,
        requestKey,
      });
      return res.success(
        cachedRegistration.payload,
        "Registration already submitted. Please check your email for the verification link.",
      );
    }

    try {
      // Must agree to Terms before we do anything
      if (!termsAccepted) {
        throw new ValidationError(
          "You must accept the Terms of Service and Privacy Policy to create an account.",
        );
      }

      // Step 1: Do not preflight Appwrite users.list for duplicate detection.
      // Appwrite is the source of truth for Auth uniqueness, and relying on a
      // list query here can produce false positives or stale duplicates.
      // The create call itself is the authoritative check.

      // Step 2: KYC Level 0 - Basic identity verification
      const kycLevel0Result = await this.performKYCLevel0({
        email,
        firstName,
        lastName,
        phone,
        dateOfBirth,
        country,
      });

      if (!kycLevel0Result.passed) {
        throw new ValidationError(
          "KYC Level 0 verification failed",
          kycLevel0Result.errors,
        );
      }

      logger.debug("KYC Level 0 passed");

      // Step 3: Hash password for our own verification (stored in Appwrite prefs)
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Step 4: Create user in Appwrite (pass plain password — Appwrite hashes it internally;
      //          we keep our own bcrypt hash in prefs to avoid double-hash mismatch on login)
      logger.debug("Creating user in Appwrite");
      const userId = ID.unique();
      let user;

      try {
        const appwritePhone = normalizedPhone || undefined;
        user = await users.create(
          userId,
          normalizedEmail,
          appwritePhone,
          password,
          `${firstName} ${lastName}`,
        );
      } catch (createError) {
        logger.warn("Appwrite user creation rejected", {
          email: normalizedEmail,
          phone: normalizedPhone,
          requestKey,
          code: createError?.code,
          type: createError?.type,
          message: createError?.message,
        });

        if (
          createError?.code === 409 ||
          createError?.type === "user_already_exists" ||
          /already exists|duplicate/i.test(createError?.message || "")
        ) {
          let duplicateMessage =
            "An account with this email or phone already exists. Please sign in or reset your password.";

          if (normalizedEmail) {
            const emailMatches = await withTimeout(
              users.list([Query.equal("email", normalizedEmail)]),
              10000,
              "Appwrite users.list (duplicate email check)",
            );
            if ((emailMatches?.total || 0) > 0) {
              duplicateMessage =
                "This email is already registered to another account.";
            }
          }

          if (!normalizedEmail || normalizedPhone) {
            const phoneMatches = await withTimeout(
              users.list([Query.equal("phone", normalizedPhone)]),
              10000,
              "Appwrite users.list (duplicate phone check)",
            );
            if ((phoneMatches?.total || 0) > 0) {
              duplicateMessage =
                "This phone number is already registered to another account.";
            }
          }

          throw new ConflictError(duplicateMessage);
        }

        throw createError;
      }

      logger.debug("Appwrite user created", { userId });

      try {
        // Step 5a: Store bcrypt hash in user prefs so login can verify without double-hashing
        await mergePrefs(userId, {
          passwordHash: hashedPassword,
          termsAccepted: true,
          termsAcceptedAt: new Date().toISOString(),
          marketingAccepted: !!marketingAccepted,
        });

        // Step 5b: Set user role label (Appwrite labels must be a flat string array)
        await users.updateLabels(userId, ["user"]);

        // Step 6: Store user data in database collection
        logger.debug("Storing user profile document", { userId });
        const userData = {
          userId,
          email,
          firstName,
          lastName,
          phone: normalizedPhone || "",
          country,
          dateOfBirth: dateOfBirth
            ? new Date(dateOfBirth).toISOString()
            : new Date("2000-01-01").toISOString(),
          kycLevel: 0,
          accountStatus: "active",
          role: "user",
          permissions: JSON.stringify([
            "profile:read",
            "profile:update",
            "wallet:view",
            "payment:send",
            "payment:receive",
            "transaction:view",
          ]),
          registrationIP: req.ip || "",
          deviceFingerprint: this.generateDeviceFingerprint(req) || "",
          emailVerified: false,
          phoneVerified: false,
          mfaEnabled: false,
        };

        try {
          await db.createDocument(
            config.database.appwrite.databaseId,
            config.database.appwrite.userCollectionId,
            userId,
            userData,
          );
        } catch (createDocError) {
          logger.error("createDocument failed", {
            userId,
            message: createDocError.message,
            code: createDocError.code,
          });
          throw createDocError;
        }

        logger.debug("User profile document stored", { userId });

        // Step 6b: Newsletter subscription — non-fatal, runs after core doc is saved
        if (marketingAccepted) {
          await this.subscribeToNewsletter({
            userId,
            email,
            firstName,
            lastName,
          }).catch((err) =>
            logger.warn("Newsletter subscription failed (non-fatal)", {
              userId,
              error: err.message,
            }),
          );
        }

        // Step 7: Determine verification method based on client type
        const isMobile = this.isMobileRequest(req);
        let verificationSent = false;

        if (isMobile) {
          // Mobile: Send 6-digit verification code
          const verificationCode = this.generateVerificationCode();
          const codeHash = crypto
            .createHash("sha256")
            .update(verificationCode)
            .digest("hex");
          const codeExpiry = new Date(
            Date.now() + 10 * 60 * 1000,
          ).toISOString(); // 10 minutes

          await mergePrefs(userId, {
            emailVerificationCodeHash: codeHash,
            emailVerificationCodeExpiry: codeExpiry,
          });

          try {
            await emailService.sendEmailVerificationCode(
              email,
              verificationCode,
              firstName,
            );
            verificationSent = true;
            logger.debug("Email verification code sent to mobile user", {
              userId,
              email,
            });
          } catch (sendErr) {
            logger.warn("Failed to send verification code (non-fatal)", {
              userId,
              error: sendErr.message,
            });
          }
        } else {
          // Web: Send verification link
          const rawToken = crypto.randomBytes(32).toString("hex");
          const tokenHash = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");
          const tokenExpiry = new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(); // 24 hours

          await mergePrefs(userId, {
            emailVerificationHash: tokenHash,
            emailVerificationExpiry: tokenExpiry,
          });

          const verificationToken = `${userId}.${rawToken}`;

          try {
            await this.sendVerificationEmail(
              email,
              verificationToken,
              firstName,
            );
            verificationSent = true;
            logger.debug("Email verification link sent to web user", {
              userId,
              email,
            });
          } catch (sendErr) {
            logger.warn("Failed to send verification link (non-fatal)", {
              userId,
              error: sendErr.message,
            });
          }
        }

        // Step 8: Generate SMS OTP if phone provided
        let smsOTP = null;
        if (phone) {
          smsOTP = this.generateOTP();
          await this.sendSMSOTP(phone, smsOTP);
          // TODO: Store OTP in database with expiry
        }

        // Step 10: Log successful registration
        logger.audit("USER_REGISTRATION", userId, {
          email,
          phone,
          country,
          ip: req.ip,
          userAgent: req.get("User-Agent"),
          deviceFingerprint: this.generateDeviceFingerprint(req),
        });

        // Step 11: Notify admins of the new sign-up (fire-and-forget)
        setImmediate(() => {
          getCreateAdminNotification()(
            "user_signup",
            "New User Registered",
            `${firstName} ${lastName} (${email}) has created an account.`,
            { link: `/users/${userId}` },
          ).catch(() => {});
        });

        const responsePayload = {
          user: {
            id: userId,
            email: normalizedEmail,
            firstName,
            lastName,
            phone: normalizedPhone,
            country,
            kycLevel: 0,
            status: "pending_verification",
            emailVerified: false,
            phoneVerified: false,
          },
          verificationRequired: {
            email: true,
            phone: !!normalizedPhone,
          },
        };

        registrationIdempotencyStore.set(requestKey, {
          payload: responsePayload,
          timestamp: Date.now(),
        });

        res.created(
          responsePayload,
          "Registration successful. Please verify your email and phone.",
        );
      } catch (postCreateError) {
        // Roll back: delete the Appwrite user so the email isn't orphaned
        logger.warn(
          "Registration post-create failed, rolling back Appwrite user",
          {
            userId,
            error: postCreateError.message,
          },
        );
        try {
          await users.delete(userId);
        } catch (_) {}
        throw postCreateError;
      }
    } catch (error) {
      logger.error("Registration failed", {
        email,
        error: error.message,
        stack: error.stack,
        ip: req.ip,
      });
      throw error;
    }
  }

  /**
   * User Login Flow with MFA Support
   * Implements comprehensive authentication with device tracking
   */
  async login(req, res) {
    const { email, password, mfaCode, rememberMe = false } = req.body;

    try {
      // Step 1: Rate limit check (handled by middleware)

      // Step 2: Get user from Appwrite
      const userList = await withTimeout(
        users.list([Query.equal("email", email)]),
        10000,
        "Appwrite users.list",
      );
      if (userList.total === 0) {
        await this.logFailedLogin(null, email, "user_not_found", req);
        throw new AuthenticationError("Invalid credentials");
      }

      const user = userList.users[0];
      const userId = user.$id;

      // Step 3: Fetch profile from DB collection for account status / settings
      let userProfile = null;
      try {
        userProfile = await db.getDocument(
          config.database.appwrite.databaseId,
          config.database.appwrite.userCollectionId,
          userId,
        );
      } catch (profileErr) {
        logger.warn("Could not fetch user profile document", { userId });
      }

      // Check account status
      const accountStatus = userProfile?.accountStatus || "active";
      if (accountStatus === "blocked" || accountStatus === "suspended") {
        await this.logFailedLogin(userId, email, "account_blocked", req);
        throw new AuthenticationError("Account is blocked or suspended");
      }

      // Check account lockout (too many failed login attempts)
      const lockoutUntil = user.prefs?.lockoutUntil;
      if (lockoutUntil && new Date(lockoutUntil) > new Date()) {
        const minutes = Math.ceil(
          (new Date(lockoutUntil) - Date.now()) / 60000,
        );
        await this.logFailedLogin(userId, email, "account_locked", req);
        throw new AuthenticationError(
          `Account temporarily locked. Try again in ${minutes} minute${
            minutes !== 1 ? "s" : ""
          }.`,
        );
      }

      // Step 4a: Enforce email verification — read authoritative value from
      // Appwrite user object (user.emailVerification is set by the server,
      // not by client-supplied data, so it cannot be spoofed).
      if (!user.emailVerification) {
        await this.logFailedLogin(userId, email, "email_not_verified", req);
        throw new EmailNotVerifiedError();
      }
      const storedHash = user.prefs?.passwordHash;
      if (!storedHash) {
        await this.logFailedLogin(userId, email, "invalid_password", req);
        await this.incrementFailedAttempts(userId);
        throw new AuthenticationError("Invalid credentials");
      }
      const isPasswordValid = await bcrypt.compare(password, storedHash);
      if (!isPasswordValid) {
        await this.logFailedLogin(userId, email, "invalid_password", req);
        await this.incrementFailedAttempts(userId);
        throw new AuthenticationError("Invalid credentials");
      }

      // Step 5: Check if MFA is required
      const mfaEnabled = userProfile?.mfaEnabled === true;
      const totpEnabled = user.prefs?.totpEnabled === true;
      const deviceFingerprint = this.generateDeviceFingerprint(req);
      const isTrustedDevice = await this.isTrustedDevice(
        userId,
        deviceFingerprint,
      );

      if (mfaEnabled && !isTrustedDevice && !mfaCode) {
        let mfaToken = null;
        let challengeType;

        if (totpEnabled) {
          // User has an authenticator app — no OTP to send, just prompt for code
          challengeType = "totp";
        } else {
          // Deliver a one-time code via email (or SMS when Twilio is wired)
          mfaToken = await this.sendMFAChallenge(
            userId,
            user.phone || user.email,
          );
          challengeType = user.phone ? "sms" : "email";
        }

        res.success(
          { mfaRequired: true, mfaToken, challengeType },
          "MFA verification required",
        );
        return;
      }

      // Step 6: Verify MFA if provided
      if (mfaCode) {
        const mfaValid = await this.verifyMFACode(userId, mfaCode);
        if (!mfaValid) {
          await this.logFailedLogin(userId, email, "invalid_mfa", req);
          throw new AuthenticationError("Invalid MFA code");
        }
      }

      // Reset failed-login counter now that identity is confirmed
      await this.resetFailedAttempts(userId);

      // Trust this device for 30 days after a successful MFA so the next
      // login from the same browser/device skips the MFA challenge.
      if (mfaCode) {
        await this.trustDevice(
          userId,
          deviceFingerprint,
          req.get("User-Agent"),
          req.ip,
        );
      }

      // Step 7: Create session
      const sessionId = ID.unique();
      const session = await this.createSession(
        userId,
        sessionId,
        req,
        rememberMe,
      );

      // Step 8: Generate JWT tokens
      const tokens = await this.generateTokens(
        user,
        sessionId,
        userProfile,
        !!mfaCode,
      );

      // Step 9: last login tracking skipped (no lastLogin field in collection schema)

      // Step 10: Log successful login
      logger.audit("USER_LOGIN", userId, {
        email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        sessionId,
        deviceFingerprint,
        mfaUsed: !!mfaCode,
      });

      // Step 11: Set secure cookies
      this.setTokenCookies(res, tokens, rememberMe);

      // ── Login alert: notify user if they have loginAlerts enabled ────────
      // Fire-and-forget — never block or error the login response
      setImmediate(async () => {
        try {
          const loginAlertsEnabled = user.prefs?.loginAlerts === "true";
          if (loginAlertsEnabled) {
            const ua = req.get("User-Agent") || "Unknown device";
            const ipAddr = req.ip || "Unknown";
            const loginInfo = {
              ip: ipAddr,
              device: ua.length > 80 ? ua.slice(0, 80) + "…" : ua,
              time: new Date().toISOString(),
            };
            const firstName = (user.name || email).split(" ")[0];
            // In-app notification
            await getCreateNotification()(
              userId,
              "security",
              "New sign-in to your account",
              `Sign-in from ${loginInfo.device} (${loginInfo.ip})`,
              "/settings/security",
            );
            // Email notification
            await emailService.sendLoginAlertEmail(email, firstName, loginInfo);
          }
        } catch (alertErr) {
          logger.warn("Login alert dispatch failed (non-fatal)", {
            userId,
            error: alertErr.message,
          });
        }
      });

      res.success(
        {
          user: {
            id: userId,
            email: user.email,
            name: user.name,
            role: userProfile?.role || "user",
            kycLevel: parseInt(userProfile?.kycLevel ?? 0),
            emailVerified: user.emailVerification,
            phoneVerified: user.phoneVerification,
            mfaEnabled,
            permissions: (() => {
              try {
                return JSON.parse(userProfile?.permissions || "[]");
              } catch {
                return [];
              }
            })(),
          },
          tokens,
          session: {
            id: sessionId,
            expiresAt: session.expiresAt,
          },
        },
        "Login successful",
      );
    } catch (error) {
      logger.error("Login failed", {
        email,
        error: error.message,
        ip: req.ip,
      });
      throw error;
    }
  }

  /**
   * User Logout
   * Invalidates session and tokens
   */
  async logout(req, res) {
    try {
      const { user, tokenPayload } = req;
      const sessionId = tokenPayload.sessionId;

      // Invalidate session
      await this.invalidateSession(sessionId);

      // Blacklist the ACCESS token
      if (req.token && req.tokenPayload) {
        await addToBlacklist(req.tokenPayload, req.token);
      }

      // Blacklist the REFRESH token so it cannot be used to issue new access
      // tokens after the user has logged out (prevents token-reuse attacks).
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
      if (refreshToken) {
        try {
          const refreshDecoded = require("jsonwebtoken").verify(
            refreshToken,
            config.security.jwt.refreshSecret,
          );
          await addToBlacklist(refreshDecoded, refreshToken);
        } catch {
          // If the refresh token is already invalid/expired, silently ignore
        }
      }

      // Clear cookies — the options (domain, sameSite, secure) MUST match
      // exactly what was used when the cookies were set, otherwise browsers
      // will not delete them.
      const clearOptions = {
        httpOnly: true,
        secure: config.security.cookie.secure,
        sameSite: config.security.cookie.sameSite,
        ...(config.security.cookie.domain
          ? { domain: config.security.cookie.domain }
          : {}),
      };
      res.clearCookie("accessToken", clearOptions);
      res.clearCookie("refreshToken", clearOptions);

      logger.audit("USER_LOGOUT", user.id, {
        sessionId,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.success(null, "Logout successful");
    } catch (error) {
      logger.error("Logout failed", {
        userId: req.user?.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Refresh Token
   * Generates new access token using refresh token
   */
  async refreshToken(req, res) {
    try {
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

      if (!refreshToken) {
        throw new AuthenticationError("Refresh token is required");
      }

      // Verify refresh token
      let decoded;
      try {
        decoded = jwt.verify(refreshToken, config.security.jwt.refreshSecret);
      } catch (error) {
        throw new AuthenticationError("Invalid refresh token");
      }

      // Check if refresh token is blacklisted (real revocation store)
      if (await isBlacklisted(decoded, refreshToken)) {
        throw new AuthenticationError("Token has been revoked");
      }

      // Get user from Appwrite — JWT signature + blacklist check is the security boundary;
      // the in-memory session store is not reliable across server restarts in development.
      const user = await users.get(decoded.sub);

      // Optionally update session activity if session still exists in memory
      const session = await this.getSession(decoded.sessionId);
      if (session) {
        await this.updateSessionActivity(decoded.sessionId);
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user, decoded.sessionId);

      // Blacklist the consumed refresh token to prevent replay attacks
      await addToBlacklist(decoded, refreshToken);

      res.success({ tokens }, "Token refreshed successfully");
    } catch (error) {
      logger.error("Token refresh failed", {
        error: error.message,
        ip: req.ip,
      });
      throw error;
    }
  }

  /**
   * Verify Email
   * Activates user account after email verification.
   *
   * The URL token has the form "<userId>.<rawToken>".
   * We look up the user by userId, hash rawToken with SHA-256, and compare it
   * against the stored emailVerificationHash in prefs.
   */
  async verifyEmail(req, res) {
    try {
      const { token } = req.params;

      // --- 1. Parse token ---
      const dotIndex = token.indexOf(".");
      if (dotIndex === -1) {
        throw new ValidationError("Invalid verification token format");
      }
      const userId = token.substring(0, dotIndex);
      const rawToken = token.substring(dotIndex + 1);

      if (!userId || !rawToken) {
        throw new ValidationError("Invalid verification token format");
      }

      // --- 2. Fetch user from Appwrite ---
      let user;
      try {
        user = await withTimeout(
          users.get(userId),
          10000,
          "Appwrite users.get",
        );
      } catch {
        throw new ValidationError("Invalid or expired verification token");
      }

      // --- 3. Check stored hash and expiry ---
      const storedHash = user.prefs?.emailVerificationHash;
      const expiryStr = user.prefs?.emailVerificationExpiry;

      if (!storedHash || !expiryStr) {
        throw new ValidationError("Invalid or expired verification token");
      }

      // Check expiry
      if (new Date(expiryStr) < new Date()) {
        throw new ValidationError(
          "Verification token has expired. Please request a new one.",
        );
      }

      // Check email already verified
      if (user.emailVerification) {
        res.success(null, "Email is already verified");
        return;
      }

      // Constant-time comparison of SHA-256 hashes
      const incomingHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
      const storedHashBuf = Buffer.from(storedHash, "hex");
      const incomingHashBuf = Buffer.from(incomingHash, "hex");

      if (
        storedHashBuf.length !== incomingHashBuf.length ||
        !crypto.timingSafeEqual(storedHashBuf, incomingHashBuf)
      ) {
        throw new ValidationError("Invalid or expired verification token");
      }

      // --- 4. Mark email as verified in Appwrite ---
      await users.updateEmailVerification(userId, true);
      await users.updateLabels(userId, ["emailVerified", "active"]);

      // Update profile document
      try {
        await db.updateDocument(
          config.database.appwrite.databaseId,
          config.database.appwrite.userCollectionId,
          userId,
          { emailVerified: true, accountStatus: "active" },
        );
      } catch (docErr) {
        logger.warn("verifyEmail: could not update profile document", {
          userId,
          error: docErr.message,
        });
      }

      // --- 5. Clear token from prefs so it cannot be reused ---
      try {
        await mergePrefs(userId, {
          emailVerificationHash: null,
          emailVerificationExpiry: null,
        });
      } catch {
        // Non-fatal — token expiry prevents replay anyway
      }

      logger.audit("EMAIL_VERIFIED", userId, {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.success(null, "Email verified successfully");
    } catch (error) {
      logger.error("Email verification failed", {
        error: error.message,
        ip: req.ip,
      });
      throw error;
    }
  }

  // Helper Methods

  /**
   * Subscribe a user to the newsletter collection in Appwrite.
   * Called after successful registration when the user opts in to marketing.
   */
  async subscribeToNewsletter({ userId, email, firstName, lastName }) {
    const collectionId = config.database.appwrite.newsletterCollectionId;
    if (!collectionId) {
      logger.warn("Newsletter collection ID not configured — skipping");
      return;
    }

    await db.createDocument(
      config.database.appwrite.databaseId,
      collectionId,
      ID.unique(),
      {
        userId,
        email,
        firstName,
        lastName,
        subscribedAt: new Date().toISOString(),
        status: "active",
        source: "registration",
      },
    );

    logger.info("User subscribed to newsletter", { userId, email });
  }

  async performKYCLevel0(userData) {
    // Basic validation checks for KYC Level 0
    const errors = [];

    // Email validation
    if (!this.isValidEmail(userData.email)) {
      errors.push("Invalid email format");
    }

    // Name validation
    if (!userData.firstName || userData.firstName.length < 2) {
      errors.push("First name must be at least 2 characters");
    }

    if (!userData.lastName || userData.lastName.length < 2) {
      errors.push("Last name must be at least 2 characters");
    }

    const normalizedPhone = this.normalizePhoneForAppwrite(userData.phone);

    // Phone validation (if provided)
    if (normalizedPhone && !this.isValidPhoneNumber(normalizedPhone)) {
      errors.push("Invalid phone number format");
    }

    // Age validation (if DOB provided)
    if (userData.dateOfBirth) {
      const age = this.calculateAge(userData.dateOfBirth);
      if (age < 18) {
        errors.push("Must be at least 18 years old");
      }
    }

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  generateDeviceFingerprint(req) {
    const fingerprint = crypto
      .createHash("sha256")
      .update(req.get("User-Agent") + req.ip)
      .digest("hex");
    // Appwrite deviceFingerprint field is capped at 60 chars; SHA256 hex is 64
    return fingerprint.substring(0, 60);
  }

  generateOTP(length = 6) {
    return crypto.randomInt(100000, 999999).toString();
  }

  generateVerificationCode() {
    // Generate a random 6-digit code
    return crypto.randomInt(100000, 999999).toString();
  }

  isMobileRequest(req) {
    // First, check if the client explicitly declared its type
    const clientType = req.get("X-Client-Type");
    if (clientType === "mobile") return true;
    if (clientType === "web") return false;

    // Fallback: check User-Agent for React Native / Expo specific indicators
    // (more reliable than generic "mobile" keyword which can be in web browsers)
    const userAgent = req.get("User-Agent") || "";
    return /okhttp|expo|react-native/i.test(userAgent);
  }

  async verifyEmailCode(req, res) {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        throw new ValidationError("Email and verification code are required");
      }

      // Fetch user by email
      let users_list;
      try {
        users_list = await withTimeout(
          users.list([Query.equal("email", email)]),
          10000,
          "Appwrite users.list",
        );
      } catch {
        throw new ValidationError("User not found");
      }

      if (users_list.total === 0) {
        throw new ValidationError("User not found");
      }

      const user = users_list.users[0];
      const userId = user.$id;

      // Check stored code hash and expiry
      const storedCodeHash = user.prefs?.emailVerificationCodeHash;
      const expiryStr = user.prefs?.emailVerificationCodeExpiry;

      if (!storedCodeHash || !expiryStr) {
        throw new ValidationError(
          "No verification code found. Please request a new one.",
        );
      }

      // Check expiry
      if (new Date(expiryStr) < new Date()) {
        throw new ValidationError("Verification code has expired");
      }

      // Check if email already verified
      if (user.emailVerification) {
        res.success(null, "Email is already verified");
        return;
      }

      // Hash the provided code and compare
      const incomingHash = crypto
        .createHash("sha256")
        .update(code)
        .digest("hex");
      const storedHashBuf = Buffer.from(storedCodeHash, "hex");
      const incomingHashBuf = Buffer.from(incomingHash, "hex");

      if (
        storedHashBuf.length !== incomingHashBuf.length ||
        !crypto.timingSafeEqual(storedHashBuf, incomingHashBuf)
      ) {
        throw new ValidationError("Invalid verification code");
      }

      // Mark email as verified
      await users.updateEmailVerification(userId, true);
      await users.updateLabels(userId, ["emailVerified", "active"]);

      // Update profile document
      try {
        await db.updateDocument(
          config.database.appwrite.databaseId,
          config.database.appwrite.userCollectionId,
          userId,
          { emailVerified: true, accountStatus: "active" },
        );
      } catch (docErr) {
        logger.warn("verifyEmailCode: could not update profile document", {
          userId,
          error: docErr.message,
        });
      }

      // Clear code from prefs
      try {
        await mergePrefs(userId, {
          emailVerificationCodeHash: null,
          emailVerificationCodeExpiry: null,
        });
      } catch {
        // Non-fatal
      }

      logger.audit("EMAIL_VERIFIED_WITH_CODE", userId, {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.success(
        {
          user: {
            id: userId,
            email: user.email,
            emailVerified: true,
          },
        },
        "Email verified successfully",
      );
    } catch (error) {
      logger.error("Email code verification failed", {
        email: req.body?.email,
        error: error.message,
        ip: req.ip,
      });
      throw error;
    }
  }

  async resendEmailVerificationCode(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        throw new ValidationError("Email is required");
      }

      // Fetch user by email
      let users_list;
      try {
        users_list = await withTimeout(
          users.list([Query.equal("email", email)]),
          10000,
          "Appwrite users.list",
        );
      } catch {
        throw new ValidationError("User not found");
      }

      if (users_list.total === 0) {
        throw new ValidationError("User not found");
      }

      const user = users_list.users[0];
      const userId = user.$id;

      if (user.emailVerification) {
        res.success(null, "Email is already verified");
        return;
      }

      // Generate new code
      const verificationCode = this.generateVerificationCode();
      const codeHash = crypto
        .createHash("sha256")
        .update(verificationCode)
        .digest("hex");
      const codeExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

      // Store code hash in prefs
      await mergePrefs(userId, {
        emailVerificationCodeHash: codeHash,
        emailVerificationCodeExpiry: codeExpiry,
      });

      // Send code email
      const firstName = user.name?.split(" ")[0] || "User";
      await emailService.sendEmailVerificationCode(
        email,
        verificationCode,
        firstName,
      );

      logger.audit("EMAIL_VERIFICATION_CODE_RESENT", userId, {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.success(
        { codeExpiry },
        "Verification code sent. Please check your email.",
      );
    } catch (error) {
      logger.error("Resend email verification code failed", {
        email: req.body?.email,
        error: error.message,
        ip: req.ip,
      });
      throw error;
    }
  }

  async generateTokens(
    user,
    sessionId,
    userProfile = null,
    mfaVerified = false,
  ) {
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();

    const accessTokenPayload = {
      sub: user.$id,
      jti: accessJti,
      iss: config.app.name,
      aud: "afrapay-client",
      type: "access",
      email: user.email,
      role: userProfile?.role || "user",
      permissions: (() => {
        try {
          return JSON.parse(userProfile?.permissions || "[]");
        } catch {
          return [];
        }
      })(),
      sessionId,
      kycLevel: parseInt(userProfile?.kycLevel ?? 0),
      mfaVerified,
    };

    const refreshTokenPayload = {
      sub: user.$id,
      jti: refreshJti,
      type: "refresh",
      sessionId,
    };

    const accessToken = jwt.sign(
      accessTokenPayload,
      config.security.jwt.secret,
      {
        expiresIn: config.security.jwt.expiresIn,
      },
    );

    const refreshToken = jwt.sign(
      refreshTokenPayload,
      config.security.jwt.refreshSecret,
      { expiresIn: config.security.jwt.refreshExpiresIn },
    );

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  setTokenCookies(res, tokens, rememberMe) {
    // Build the base options from centralised config so that domain, sameSite,
    // and secure flags are consistent between set and clear operations and are
    // controlled entirely through environment variables.
    //
    // Development  : no domain attr, sameSite=strict, secure=false
    // Production   : domain=.afrapayafrica.com, sameSite=strict, secure=true
    //
    // If the API ever moves to a separate subdomain (e.g. api.afrapayafrica.com)
    // and the frontend stays on afrapayafrica.com, change COOKIE_SAME_SITE to
    // "none" and ensure HTTPS is in place — browsers require secure:true for
    // SameSite=None. See COOKIE_DOMAIN / COOKIE_SAME_SITE in .env.
    const cookieOptions = {
      httpOnly: true,
      secure: config.security.cookie.secure,
      sameSite: config.security.cookie.sameSite,
      // domain is undefined in dev so the browser uses its default behaviour
      ...(config.security.cookie.domain
        ? { domain: config.security.cookie.domain }
        : {}),
    };

    res.cookie("accessToken", tokens.accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refreshToken", tokens.refreshToken, {
      ...cookieOptions,
      maxAge: rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000, // 7 days or 1 day
    });
  }

  async sendVerificationEmail(email, token, firstName) {
    await emailService.sendVerificationEmail(email, token, firstName);
  }

  async sendSMSOTP(phone, otp) {
    // NOTE: never log the OTP value — it would appear in log aggregators
    logger.info("SMS OTP stub called — OTP not actually sent", {
      phoneSuffix: phone?.slice(-4),
    });
    // Implementation depends on SMS service (Twilio, AWS SNS, etc.)
  }

  async createSession(userId, sessionId, req, rememberMe) {
    const session = {
      id: sessionId,
      userId,
      deviceFingerprint: this.generateDeviceFingerprint(req),
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(
        Date.now() + (rememberMe ? 7 : 1) * 24 * 60 * 60 * 1000,
      ),
      isActive: true,
    };

    activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * PIN Hashing using scrypt (standard nodejs built-in)
   */
  async hashPin(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  async verifyPin(userId, pin) {
    const user = await users.get(userId);
    const stored = user.prefs?.pinHash;
    if (!stored) return false;

    const [salt, hash] = stored.split(':');
    const newHash = crypto.scryptSync(pin, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(newHash, 'hex'));
  }

  async setPin(userId, pin) {
    const hash = await this.hashPin(pin);
    await mergePrefs(userId, { pinHash: hash });
  }

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  normalizePhoneForAppwrite(phone) {
    if (phone === null || phone === undefined) return "";

    let cleaned = String(phone).trim();
    if (!cleaned) return "";

    cleaned = cleaned.replace(/\s+/g, "");
    cleaned = cleaned.replace(/[()\-]/g, "");
    cleaned = cleaned.replace(/^[\u200B-\u200D\uFEFF]+/, "");

    if (cleaned.startsWith("00")) {
      cleaned = `+${cleaned.slice(2)}`;
    }

    cleaned = cleaned.replace(/[^\d+]/g, "");

    if (!cleaned.startsWith("+")) {
      cleaned = `+${cleaned.replace(/^\+/, "")}`;
    }

    const digits = cleaned.replace(/^\+/, "");
    if (/^\d{7,15}$/.test(digits)) {
      return `+${digits}`;
    }

    return "";
  }

  isValidPhoneNumber(phone) {
    // Accepts E.164 (+254111579473), local with leading 0 (0111579473),
    // and international without + (254111579473). Total digits: 7–15.
    return /^\+?[0-9]\d{6,14}$/.test(phone);
  }

  calculateAge(dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }

  // ---------------------------------------------------------------------------
  // Session management (in-process store — switch to Redis for multi-server)
  // ---------------------------------------------------------------------------

  async getSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return null;
    if (!session.isActive || session.expiresAt < new Date()) {
      activeSessions.delete(sessionId);
      return null;
    }
    return session;
  }

  async invalidateSession(sessionId) {
    activeSessions.delete(sessionId);
    logger.info("Session invalidated", { sessionId });
  }

  async updateSessionActivity(sessionId) {
    const session = activeSessions.get(sessionId);
    if (session) session.lastActivity = new Date();
  }

  // Kept for backward-compatibility — real revocation uses addToBlacklist()
  async blacklistToken(_token) {
    logger.warn("blacklistToken stub called — use addToBlacklist() directly");
  }

  async isTokenBlacklisted(_token) {
    return false;
  }

  // ---------------------------------------------------------------------------
  // Account lockout
  // ---------------------------------------------------------------------------

  async logFailedLogin(userId, email, reason, req) {
    logger.warn("Failed login attempt", {
      userId,
      email,
      reason,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });
  }

  async incrementFailedAttempts(userId) {
    try {
      const userDetails = await withTimeout(
        users.get(userId),
        10000,
        "Appwrite users.get",
      );
      const LOCKOUT_THRESHOLD = 5;
      const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
      const attempts =
        (parseInt(userDetails.prefs?.failedLogins ?? 0, 10) || 0) + 1;
      const lockoutUntil =
        attempts >= LOCKOUT_THRESHOLD
          ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
          : userDetails.prefs?.lockoutUntil || null;

      await mergePrefs(userId, { failedLogins: attempts, lockoutUntil });
      logger.warn("Failed login attempt recorded", {
        userId,
        attempts,
        locked: attempts >= LOCKOUT_THRESHOLD,
      });
    } catch (err) {
      logger.warn("incrementFailedAttempts failed", {
        userId,
        error: err.message,
      });
    }
  }

  async resetFailedAttempts(userId) {
    try {
      const userDetails = await withTimeout(
        users.get(userId),
        10000,
        "Appwrite users.get",
      );
      if (userDetails.prefs?.failedLogins) {
        await mergePrefs(userId, {
          failedLogins: 0,
          lockoutUntil: null,
        });
      }
    } catch {
      // Non-fatal
    }
  }

  // ---------------------------------------------------------------------------
  // Trusted devices — stored as a JSON array in user.prefs.trustedDevices
  // ---------------------------------------------------------------------------

  async isTrustedDevice(userId, deviceFingerprint) {
    try {
      const userDetails = await withTimeout(
        users.get(userId),
        10000,
        "Appwrite users.get",
      );
      const raw = userDetails.prefs?.trustedDevices;
      if (!raw) return false;
      const devices = JSON.parse(raw);
      const now = new Date();
      return devices.some(
        (d) =>
          d.fingerprint === deviceFingerprint && new Date(d.expiresAt) > now,
      );
    } catch {
      return false;
    }
  }

  async trustDevice(userId, deviceFingerprint, userAgent, ipAddress) {
    try {
      const userDetails = await withTimeout(
        users.get(userId),
        10000,
        "Appwrite users.get",
      );
      let devices = [];
      try {
        devices = userDetails.prefs?.trustedDevices
          ? JSON.parse(userDetails.prefs.trustedDevices)
          : [];
      } catch {
        devices = [];
      }

      const now = new Date();
      // Remove expired entries and any existing record for this fingerprint
      devices = devices.filter(
        (d) =>
          new Date(d.expiresAt) > now && d.fingerprint !== deviceFingerprint,
      );
      // Cap at 10 trusted devices per user (drop oldest first)
      const MAX_DEVICES = 10;
      if (devices.length >= MAX_DEVICES) {
        devices = devices.slice(-(MAX_DEVICES - 1));
      }
      devices.push({
        fingerprint: deviceFingerprint,
        trustedAt: now.toISOString(),
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(), // 30 days
        userAgent: userAgent || "",
        ipAddress: ipAddress || "",
      });

      await mergePrefs(userId, {
        trustedDevices: JSON.stringify(devices),
      });
    } catch (err) {
      // Non-fatal — trust failure should not block a successful login
      logger.warn("trustDevice failed", { userId, error: err.message });
    }
  }

  // ---------------------------------------------------------------------------
  // MFA: send challenge OTP + verify (TOTP or email OTP)
  // ---------------------------------------------------------------------------

  async sendMFAChallenge(userId, contact) {
    const otp = this.generateOTP(); // 6-digit numeric
    // SHA-256 hash — raw OTP is never persisted
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    const userDetails = await withTimeout(
      users.get(userId),
      10000,
      "Appwrite users.get",
    );
    await mergePrefs(userId, {
      mfaOtpHash: otpHash,
      mfaOtpExpiry: otpExpiry,
    });

    const isEmail = contact.includes("@");
    if (isEmail) {
      const firstName = (userDetails.name || "").split(" ")[0] || "there";
      await emailService.sendMFAOtpEmail(contact, otp, firstName);
    } else {
      // SMS via Twilio — wire TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN for production
      logger.info("SMS MFA OTP stub — Twilio not yet configured", {
        contactSuffix: contact.slice(-4),
      });
    }
    // Return an opaque reference token the client echoes back (not the OTP itself)
    return crypto.randomBytes(16).toString("hex");
  }

  async verifyMFACode(userId, mfaCode) {
    const userDetails = await withTimeout(
      users.get(userId),
      10000,
      "Appwrite users.get",
    );

    // --- 1. TOTP authenticator app (preferred when enabled) ---
    if (userDetails.prefs?.totpEnabled && userDetails.prefs?.totpSecret) {
      try {
        const plainSecret = decryptSecret(userDetails.prefs.totpSecret);
        const totpValid = speakeasy.totp.verify({
          secret: plainSecret,
          encoding: "base32",
          token: String(mfaCode),
          window: 1, // ±1 step = ±30 second tolerance
        });
        if (totpValid) return true;
      } catch (err) {
        logger.warn("verifyMFACode: TOTP decryption failed", {
          userId,
          error: err.message,
        });
      }
    }

    // --- 2. Email / SMS OTP fallback ---
    const storedHash = userDetails.prefs?.mfaOtpHash;
    const expiryStr = userDetails.prefs?.mfaOtpExpiry;
    if (!storedHash || !expiryStr) return false;
    if (new Date(expiryStr) < new Date()) return false;

    const incomingHash = crypto
      .createHash("sha256")
      .update(String(mfaCode))
      .digest("hex");
    const storedBuf = Buffer.from(storedHash, "hex");
    const incomingBuf = Buffer.from(incomingHash, "hex");
    if (storedBuf.length !== incomingBuf.length) return false;

    const valid = crypto.timingSafeEqual(storedBuf, incomingBuf);
    if (valid) {
      // Consume the OTP — prevents replay attacks
      await mergePrefs(userId, { mfaOtpHash: null, mfaOtpExpiry: null });
    }
    return valid;
  }

  async getEmailVerificationToken(_token) {
    // Token verification is now handled inline in verifyEmail using user prefs.
    return null;
  }

  async resendEmailVerification(req, res) {
    try {
      const { user } = req;

      // Fetch full user details from Appwrite
      const userDetails = await withTimeout(
        users.get(user.id),
        10000,
        "Appwrite users.get",
      );

      if (userDetails.emailVerification) {
        res.success(null, "Email is already verified");
        return;
      }

      // Generate a fresh token and store its hash in user prefs
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
      const emailVerificationExpiry = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();

      await mergePrefs(user.id, {
        emailVerificationHash: tokenHash,
        emailVerificationExpiry,
      });

      const verificationToken = `${user.id}.${rawToken}`;
      const firstName = (userDetails.name || "").split(" ")[0] || "there";
      await this.sendVerificationEmail(
        userDetails.email,
        verificationToken,
        firstName,
      );

      res.success(null, "Verification email resent successfully");
    } catch (error) {
      logger.error("Resend verification failed", { error: error.message });
      throw error;
    }
  }

  // Alias used by v1 routes
  async resendVerification(req, res) {
    return this.resendEmailVerification(req, res);
  }

  /**
   * Public endpoint — resend verification email by email address.
   * Does NOT require an access token so an unverified user can call it
   * immediately after the "email not verified" login error.
   * Always returns success to prevent email enumeration.
   */
  async resendVerificationByEmail(req, res) {
    try {
      const { email } = req.body;
      if (!email) {
        throw new ValidationError("Email is required");
      }

      const userList = await withTimeout(
        users.list([Query.equal("email", email)]),
        10000,
        "Appwrite users.list",
      );

      // If user exists and is not yet verified, issue a fresh token
      if (userList.total > 0) {
        const user = userList.users[0];
        if (!user.emailVerification) {
          const rawToken = crypto.randomBytes(32).toString("hex");
          const tokenHash = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");
          const emailVerificationExpiry = new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString();

          await mergePrefs(user.$id, {
            emailVerificationHash: tokenHash,
            emailVerificationExpiry,
          });

          const verificationToken = `${user.$id}.${rawToken}`;
          const firstName = (user.name || "").split(" ")[0] || "there";
          await this.sendVerificationEmail(
            user.email,
            verificationToken,
            firstName,
          );
        }
        // If already verified, silently do nothing — response is the same
      }

      // Always respond success to avoid email enumeration
      res.success(
        null,
        "If that email is registered and unverified, a new verification link has been sent.",
      );
    } catch (error) {
      if (error.name === "ValidationError") throw error;
      logger.error("resendVerificationByEmail failed", {
        error: error.message,
      });
      // Swallow other errors to avoid enumeration
      res.success(
        null,
        "If that email is registered and unverified, a new verification link has been sent.",
      );
    }
  }

  async getCurrentUser(req, res) {
    try {
      const { user } = req;
      if (!user) throw new AuthenticationError("Not authenticated");
      const userDetails = await withTimeout(
        users.get(user.id),
        10000,
        "Appwrite users.get",
      );
      res.success(
        {
          id: userDetails.$id,
          email: userDetails.email,
          name: userDetails.name,
          phone: userDetails.phone,
          emailVerified: userDetails.emailVerification,
          phoneVerified: userDetails.phoneVerification,
          labels: userDetails.labels || {},
        },
        "User retrieved successfully",
      );
    } catch (error) {
      logger.error("Get current user failed", { error: error.message });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Google OAuth — verify Google ID token, find-or-create user, issue JWT
  // ---------------------------------------------------------------------------

  async googleOAuth(req, res) {
    try {
      const { credential } = req.body;
      if (!credential)
        throw new ValidationError("Google credential is required");

      const googleClientId = config.external.google.clientId;
      if (!googleClientId) {
        throw new Error("GOOGLE_CLIENT_ID is not configured on the server.");
      }

      // --- 1. Verify the ID token with Google’s servers ---
      const oauthClient = new OAuth2Client(googleClientId);
      let payload;
      try {
        const ticket = await oauthClient.verifyIdToken({
          idToken: credential,
          audience: googleClientId,
        });
        payload = ticket.getPayload();
      } catch (err) {
        logger.warn("Google ID token verification failed", {
          error: err.message,
        });
        throw new AuthenticationError(
          "Google sign-in failed. The token is invalid or has expired.",
        );
      }

      const {
        sub: googleId, // unique Google user ID
        email,
        email_verified: emailVerified,
        given_name: firstName,
        family_name: lastNameRaw,
        name: fullName,
      } = payload;

      if (!email || !emailVerified) {
        throw new AuthenticationError(
          "Google account does not have a verified email address.",
        );
      }

      // --- 2. Find or create user ---
      const existingList = await withTimeout(
        users.list([Query.equal("email", email)]),
        10000,
        "Appwrite users.list",
      );

      let user;
      let userProfile;
      let isNewUser = false;

      if (existingList.total > 0) {
        // — Existing user: load profile
        user = existingList.users[0];

        try {
          userProfile = await db.getDocument(
            config.database.appwrite.databaseId,
            config.database.appwrite.userCollectionId,
            user.$id,
          );
        } catch {
          logger.warn("googleOAuth: profile doc not found", {
            userId: user.$id,
          });
        }

        // Block suspended / blocked accounts
        const accountStatus = userProfile?.accountStatus || "active";
        if (accountStatus === "blocked" || accountStatus === "suspended") {
          throw new AuthenticationError("Account is blocked or suspended.");
        }

        // Store googleId in prefs if this is the first Google sign-in for
        // an existing email/password account (account linking)
        if (!user.prefs?.googleId) {
          await mergePrefs(user.$id, { googleId });
        }

        // Ensure email is marked verified — Google guarantees it
        if (!user.emailVerification) {
          await users.updateEmailVerification(user.$id, true);
        }
      } else {
        // — New user: create account without a password (Google-only sign-in)
        isNewUser = true;
        const userId = ID.unique();
        const lastName = lastNameRaw || "";

        // Create Appwrite user (pass undefined password — Appwrite accepts it)
        user = await withTimeout(
          users.create(
            userId,
            email,
            undefined,
            undefined,
            fullName || `${firstName} ${lastName}`.trim(),
          ),
          10000,
          "Appwrite users.create",
        );

        // Mark email verified (Google guarantees it) and set role label
        await users.updateEmailVerification(userId, true);
        await users.updateLabels(userId, ["user", "emailVerified", "active"]);
        await mergePrefs(userId, { googleId });

        // Create profile document
        const userData = {
          userId,
          email,
          firstName: firstName || fullName?.split(" ")[0] || "",
          lastName: lastName || fullName?.split(" ").slice(1).join(" ") || "",
          phone: "",
          country: "",
          dateOfBirth: new Date("2000-01-01").toISOString(),
          kycLevel: 0,
          accountStatus: "active",
          role: "user",
          permissions: JSON.stringify([
            "profile:read",
            "profile:update",
            "wallet:view",
            "payment:send",
            "payment:receive",
            "transaction:view",
          ]),
          registrationIP: req.ip || "",
          deviceFingerprint: this.generateDeviceFingerprint(req) || "",
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
        };

        await db.createDocument(
          config.database.appwrite.databaseId,
          config.database.appwrite.userCollectionId,
          userId,
          userData,
        );

        userProfile = userData;

        logger.audit("USER_REGISTRATION_GOOGLE", userId, {
          email,
          ip: req.ip,
          userAgent: req.get("User-Agent"),
        });
      }

      // --- 3. Check MFA (TOTP) --- Google sign-in still requires TOTP if enabled ---
      const mfaEnabled = userProfile?.mfaEnabled === true;
      const totpEnabled = user.prefs?.totpEnabled === true;
      const deviceFingerprint = this.generateDeviceFingerprint(req);
      const isTrusted = await this.isTrustedDevice(user.$id, deviceFingerprint);
      const { mfaCode } = req.body;

      if (mfaEnabled && totpEnabled && !isTrusted) {
        if (!mfaCode) {
          // First call — challenge: return mfaRequired so the client shows the TOTP form
          res.success(
            { mfaRequired: true, mfaToken: null, challengeType: "totp" },
            "TOTP verification required",
          );
          return;
        }
        // Second call — verify the TOTP code before issuing tokens
        const isValid = await this.verifyMFACode(user.$id, mfaCode);
        if (!isValid) {
          throw new AuthenticationError(
            "Invalid authenticator code. Please try again.",
          );
        }
        await this.trustDevice(
          user.$id,
          deviceFingerprint,
          req.get("User-Agent"),
          req.ip,
        );
      }

      // --- 4. Create session and generate tokens ---
      const sessionId = ID.unique();
      const session = await this.createSession(
        user.$id,
        sessionId,
        req,
        false, // rememberMe: Google sessions expire with the access token
      );

      const tokens = await this.generateTokens(
        user,
        sessionId,
        userProfile,
        false,
      );

      logger.audit("USER_LOGIN_GOOGLE", user.$id, {
        email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        sessionId,
        isNewUser,
      });

      // --- 5. Set cookies + return user data ---
      this.setTokenCookies(res, tokens, false);

      res.success(
        {
          user: {
            id: user.$id,
            email: user.email,
            name: user.name,
            role: userProfile?.role || "user",
            kycLevel: parseInt(userProfile?.kycLevel ?? 0),
            emailVerified: true,
            phoneVerified: user.phoneVerification || false,
            mfaEnabled: mfaEnabled,
            isNewUser,
          },
          tokens,
          session: { id: sessionId, expiresAt: session.expiresAt },
        },
        isNewUser
          ? "Account created successfully via Google"
          : "Login successful",
      );
    } catch (error) {
      logger.error("Google OAuth failed", {
        error: error.message,
        ip: req.ip,
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Facebook OAuth — verify access token via Graph API, find-or-create user
  // ---------------------------------------------------------------------------

  async facebookOAuth(req, res) {
    try {
      const { accessToken, userID } = req.body;
      if (!accessToken || !userID)
        throw new ValidationError(
          "Facebook access token and user ID are required",
        );

      const appId = config.external.facebook.appId;
      const appSecret = config.external.facebook.appSecret;
      if (!appId || !appSecret) {
        throw new Error(
          "FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is not configured on the server.",
        );
      }

      // --- 1. Verify the token is valid and was issued to OUR app ---
      // Facebook's debug_token endpoint lets us confirm the token is authentic
      // and not stolen from a different app (audience binding).
      const appToken = `${appId}|${appSecret}`;
      let debugData;
      try {
        const { data } = await axios.get(
          "https://graph.facebook.com/debug_token",
          {
            params: { input_token: accessToken, access_token: appToken },
            timeout: 10000,
          },
        );
        debugData = data.data;
      } catch (err) {
        logger.warn("Facebook debug_token failed", { error: err.message });
        throw new AuthenticationError(
          "Facebook sign-in failed. Could not verify token.",
        );
      }

      // is_valid must be true, app must match ours, and userID must match the
      // one the client claims — prevents token substitution attacks.
      if (
        !debugData?.is_valid ||
        String(debugData.app_id) !== String(appId) ||
        String(debugData.user_id) !== String(userID)
      ) {
        throw new AuthenticationError(
          "Facebook token is invalid or does not belong to this application.",
        );
      }

      // --- 2. Fetch user profile from Graph API ---
      let fbUser;
      try {
        const { data } = await axios.get("https://graph.facebook.com/me", {
          params: {
            fields: "id,name,email,first_name,last_name",
            access_token: accessToken,
          },
          timeout: 10000,
        });
        fbUser = data;
      } catch (err) {
        logger.warn("Facebook Graph profile fetch failed", {
          error: err.message,
        });
        throw new AuthenticationError(
          "Facebook sign-in failed. Could not retrieve user profile.",
        );
      }

      const {
        id: facebookId,
        email,
        first_name: firstName,
        last_name: lastNameRaw,
        name: fullName,
      } = fbUser;

      // Facebook only returns email if the user granted the email permission.
      if (!email) {
        throw new AuthenticationError(
          "Facebook sign-in requires access to your email address. " +
            "Please log out of Facebook and sign in again, granting the email permission.",
        );
      }

      // --- 3. Find or create user ---
      const existingList = await withTimeout(
        users.list([Query.equal("email", email)]),
        10000,
        "Appwrite users.list",
      );

      let user;
      let userProfile;
      let isNewUser = false;

      if (existingList.total > 0) {
        user = existingList.users[0];

        try {
          userProfile = await db.getDocument(
            config.database.appwrite.databaseId,
            config.database.appwrite.userCollectionId,
            user.$id,
          );
        } catch {
          logger.warn("facebookOAuth: profile doc not found", {
            userId: user.$id,
          });
        }

        const accountStatus = userProfile?.accountStatus || "active";
        if (accountStatus === "blocked" || accountStatus === "suspended") {
          throw new AuthenticationError("Account is blocked or suspended.");
        }

        // Link facebookId on first Facebook sign-in for an existing account
        if (!user.prefs?.facebookId) {
          await mergePrefs(user.$id, { facebookId });
        }

        // Facebook does not provide email_verified — mark email verified
        // only if the Appwrite account was created via Facebook (no password)
        if (!user.emailVerification && !user.prefs?.passwordHash) {
          await users.updateEmailVerification(user.$id, true);
        }
      } else {
        isNewUser = true;
        const userId = ID.unique();
        const lastName = lastNameRaw || "";

        user = await withTimeout(
          users.create(
            userId,
            email,
            undefined,
            undefined,
            fullName || `${firstName} ${lastName}`.trim(),
          ),
          10000,
          "Appwrite users.create",
        );

        // Facebook is a trusted email source — mark as verified
        await users.updateEmailVerification(userId, true);
        await users.updateLabels(userId, ["user", "emailVerified", "active"]);
        await mergePrefs(userId, { facebookId });

        const userData = {
          userId,
          email,
          firstName: firstName || fullName?.split(" ")[0] || "",
          lastName: lastName || fullName?.split(" ").slice(1).join(" ") || "",
          phone: "",
          country: "",
          dateOfBirth: new Date("2000-01-01").toISOString(),
          kycLevel: 0,
          accountStatus: "active",
          role: "user",
          permissions: JSON.stringify([
            "profile:read",
            "profile:update",
            "wallet:view",
            "payment:send",
            "payment:receive",
            "transaction:view",
          ]),
          registrationIP: req.ip || "",
          deviceFingerprint: this.generateDeviceFingerprint(req) || "",
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
        };

        await db.createDocument(
          config.database.appwrite.databaseId,
          config.database.appwrite.userCollectionId,
          userId,
          userData,
        );

        userProfile = userData;

        logger.audit("USER_REGISTRATION_FACEBOOK", userId, {
          email,
          ip: req.ip,
          userAgent: req.get("User-Agent"),
        });
      }

      // --- 4. Check TOTP MFA (if enabled) ---
      const mfaEnabled = userProfile?.mfaEnabled === true;
      const totpEnabled = user.prefs?.totpEnabled === true;
      const deviceFingerprint = this.generateDeviceFingerprint(req);
      const isTrusted = await this.isTrustedDevice(user.$id, deviceFingerprint);
      const { mfaCode } = req.body;

      if (mfaEnabled && totpEnabled && !isTrusted) {
        if (!mfaCode) {
          res.success(
            { mfaRequired: true, mfaToken: null, challengeType: "totp" },
            "TOTP verification required",
          );
          return;
        }
        // Verify the TOTP code before issuing tokens
        const isValid = await this.verifyMFACode(user.$id, mfaCode);
        if (!isValid) {
          throw new AuthenticationError(
            "Invalid authenticator code. Please try again.",
          );
        }
        await this.trustDevice(
          user.$id,
          deviceFingerprint,
          req.get("User-Agent"),
          req.ip,
        );
      }

      // --- 5. Create session and issue tokens ---
      const sessionId = ID.unique();
      const session = await this.createSession(user.$id, sessionId, req, false);

      const tokens = await this.generateTokens(
        user,
        sessionId,
        userProfile,
        false,
      );

      logger.audit("USER_LOGIN_FACEBOOK", user.$id, {
        email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        sessionId,
        isNewUser,
      });

      this.setTokenCookies(res, tokens, false);

      res.success(
        {
          user: {
            id: user.$id,
            email: user.email,
            name: user.name,
            role: userProfile?.role || "user",
            kycLevel: parseInt(userProfile?.kycLevel ?? 0),
            emailVerified: user.emailVerification || true,
            phoneVerified: user.phoneVerification || false,
            mfaEnabled,
            isNewUser,
          },
          tokens,
          session: { id: sessionId, expiresAt: session.expiresAt },
        },
        isNewUser
          ? "Account created successfully via Facebook"
          : "Login successful",
      );
    } catch (error) {
      logger.error("Facebook OAuth failed", {
        error: error.message,
        ip: req.ip,
      });
      throw error;
    }
  }

  async resetPassword(req, res) {
    try {
      const { token, password } = req.body;

      // Parse "<userId>.<rawToken>" — same format as email verification
      const dotIndex = token.indexOf(".");
      if (dotIndex === -1) throw new ValidationError("Invalid reset token.");
      const userId = token.substring(0, dotIndex);
      const rawToken = token.substring(dotIndex + 1);
      if (!userId || !rawToken)
        throw new ValidationError("Invalid reset token.");

      let user;
      try {
        user = await withTimeout(
          users.get(userId),
          10000,
          "Appwrite users.get",
        );
      } catch {
        throw new ValidationError("Invalid or expired reset token.");
      }

      const storedHash = user.prefs?.passwordResetHash;
      const expiryStr = user.prefs?.passwordResetExpiry;
      if (!storedHash || !expiryStr)
        throw new ValidationError("Invalid or expired reset token.");
      if (new Date(expiryStr) < new Date())
        throw new ValidationError(
          "Reset token has expired. Please request a new password reset.",
        );

      // Constant-time comparison
      const incomingHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
      const storedBuf = Buffer.from(storedHash, "hex");
      const incomingBuf = Buffer.from(incomingHash, "hex");
      if (
        storedBuf.length !== incomingBuf.length ||
        !crypto.timingSafeEqual(storedBuf, incomingBuf)
      )
        throw new ValidationError("Invalid or expired reset token.");

      // Reject if new password is the same as the current one
      const existingPasswordHash = user.prefs?.passwordHash;
      if (existingPasswordHash) {
        const isSamePassword = await bcrypt.compare(
          password,
          existingPasswordHash,
        );
        if (isSamePassword)
          throw new ValidationError(
            "New password must be different from your current password.",
          );
      }

      // Update password — Appwrite hashes internally
      await users.updatePassword(userId, password);
      // Keep bcrypt copy in sync so login's bcrypt.compare still works
      const newHash = await bcrypt.hash(password, 12);
      await mergePrefs(userId, {
        passwordHash: newHash,
        passwordResetHash: null,
        passwordResetExpiry: null,
      });

      // Invalidate all in-process sessions for this user so old sessions
      // cannot be reused after a password change.
      for (const [sessionId, session] of activeSessions.entries()) {
        if (session.userId === userId) activeSessions.delete(sessionId);
      }

      logger.audit("PASSWORD_RESET", userId, { ip: req.ip });
      res.success(
        null,
        "Password reset successful. Please log in with your new password.",
      );
    } catch (error) {
      logger.error("Reset password failed", { error: error.message });
      throw error;
    }
  }

  async changePassword(req, res) {
    try {
      const { user } = req;
      const { currentPassword, newPassword } = req.body;
      const userDetails = await withTimeout(
        users.get(user.id),
        10000,
        "Appwrite users.get",
      );
      // Verify against our bcrypt copy — Appwrite does not expose its hash
      const storedHash = userDetails.prefs?.passwordHash;
      if (!storedHash)
        throw new AuthenticationError("Unable to verify current password.");
      const isValid = await bcrypt.compare(currentPassword, storedHash);
      if (!isValid)
        throw new AuthenticationError("Current password is incorrect.");

      // Update password in Appwrite (plain — Appwrite hashes internally)
      await users.updatePassword(user.id, newPassword);
      // Keep bcrypt copy in sync
      const newHash = await bcrypt.hash(newPassword, 12);
      await mergePrefs(user.id, { passwordHash: newHash });

      logger.audit("PASSWORD_CHANGED", user.id, { ip: req.ip });
      res.success(null, "Password changed successfully.");
    } catch (error) {
      logger.error("Change password failed", { error: error.message });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 2FA — TOTP authenticator app (speakeasy + QR code)
  // ---------------------------------------------------------------------------

  async enable2FA(req, res) {
    try {
      const { user } = req;
      const userDetails = await withTimeout(
        users.get(user.id),
        10000,
        "Appwrite users.get",
      );

      if (userDetails.prefs?.totpEnabled) {
        return res.success(
          { alreadyEnabled: true },
          "Two-factor authentication is already active on this account.",
        );
      }

      // Generate a 20-byte TOTP secret
      const secret = speakeasy.generateSecret({
        name: `AfraPay (${userDetails.email})`,
        issuer: "AfraPay",
        length: 20,
      });

      // Encrypt before storing — raw secret never hits the database in plain text
      const encryptedSecret = encryptSecret(secret.base32);
      // Store as "pending" until the user confirms with a valid code (/verify-2fa)
      await mergePrefs(user.id, { totpSecretPending: encryptedSecret });

      // Base64 QR code for the frontend (<img src={qrCode} />)
      const qrCode = await QRCode.toDataURL(secret.otpauth_url);

      logger.audit("2FA_SETUP_INITIATED", user.id, { ip: req.ip });

      res.success(
        {
          secret: secret.base32, // manual entry into authenticator app
          qrCode, // data URL — render as <img />
          otpauthUrl: secret.otpauth_url, // deep-link for mobile
        },
        "Scan the QR code with Google Authenticator or Authy, then confirm with POST /verify-2fa",
      );
    } catch (error) {
      logger.error("Enable 2FA failed", { error: error.message });
      throw error;
    }
  }

  async verify2FA(req, res) {
    try {
      const { user } = req;
      const { code } = req.body;

      const userDetails = await withTimeout(
        users.get(user.id),
        10000,
        "Appwrite users.get",
      );

      const encPending = userDetails.prefs?.totpSecretPending;
      const encActive = userDetails.prefs?.totpSecret;

      if (!encPending && !encActive) {
        throw new ValidationError(
          "No 2FA setup in progress. Please call /enable-2fa first.",
        );
      }

      // --- Pending confirmation — first valid code activates TOTP ---
      if (encPending) {
        let plainSecret;
        try {
          plainSecret = decryptSecret(encPending);
        } catch {
          throw new ValidationError(
            "Invalid 2FA setup state. Please restart setup via /enable-2fa.",
          );
        }

        const isValid = speakeasy.totp.verify({
          secret: plainSecret,
          encoding: "base32",
          token: String(code),
          window: 1,
        });
        if (!isValid) {
          throw new AuthenticationError(
            "Invalid code. Please wait for the next 30-second window and try again.",
          );
        }

        // Promote pending → active
        await mergePrefs(user.id, {
          totpSecret: encPending,
          totpEnabled: true,
          totpSecretPending: null,
        });
        // Reflect in profile document
        try {
          await db.updateDocument(
            config.database.appwrite.databaseId,
            config.database.appwrite.userCollectionId,
            user.id,
            { mfaEnabled: true },
          );
        } catch (docErr) {
          logger.warn("verify2FA: could not update profile doc", {
            userId: user.id,
            error: docErr.message,
          });
        }

        logger.audit("2FA_ENABLED", user.id, { ip: req.ip });
        return res.success(null, "Two-factor authentication has been enabled.");
      }

      // --- Already active — allow re-verify (e.g. after app reinstall) ---
      let plainSecret;
      try {
        plainSecret = decryptSecret(encActive);
      } catch {
        throw new ValidationError(
          "2FA configuration error. Please contact support.",
        );
      }
      const isValid = speakeasy.totp.verify({
        secret: plainSecret,
        encoding: "base32",
        token: String(code),
        window: 1,
      });
      if (!isValid) throw new AuthenticationError("Invalid 2FA code.");

      res.success({ alreadyEnabled: true }, "2FA code verified successfully.");
    } catch (error) {
      logger.error("Verify 2FA failed", { error: error.message });
      throw error;
    }
  }

  async disable2FA(req, res) {
    try {
      const { user } = req;
      const { code, password } = req.body;

      const userDetails = await withTimeout(
        users.get(user.id),
        10000,
        "Appwrite users.get",
      );

      if (!userDetails.prefs?.totpEnabled || !userDetails.prefs?.totpSecret) {
        return res.success(null, "2FA is not enabled on this account.");
      }

      // Require the current account password as an extra guard against
      // session-hijacking attacks (same pattern as GitHub / Stripe).
      if (!password) {
        throw new ValidationError("Password is required to disable 2FA.");
      }
      const storedPasswordHash = userDetails.prefs?.passwordHash;
      if (storedPasswordHash) {
        const passwordOk = await bcrypt.compare(password, storedPasswordHash);
        if (!passwordOk) throw new AuthenticationError("Incorrect password.");
      }

      // Verify current TOTP code
      let plainSecret;
      try {
        plainSecret = decryptSecret(userDetails.prefs.totpSecret);
      } catch {
        throw new ValidationError(
          "2FA configuration error. Please contact support.",
        );
      }
      const isValid = speakeasy.totp.verify({
        secret: plainSecret,
        encoding: "base32",
        token: String(code),
        window: 1,
      });
      if (!isValid) throw new AuthenticationError("Invalid 2FA code.");

      // Clear TOTP data and revoke trusted devices
      // (security context changed — force re-MFA on next login)
      await mergePrefs(user.id, {
        totpSecret: null,
        totpEnabled: false,
        totpSecretPending: null,
        trustedDevices: null,
      });
      try {
        await db.updateDocument(
          config.database.appwrite.databaseId,
          config.database.appwrite.userCollectionId,
          user.id,
          { mfaEnabled: false },
        );
      } catch (docErr) {
        logger.warn("disable2FA: could not update profile doc", {
          userId: user.id,
          error: docErr.message,
        });
      }

      logger.audit("2FA_DISABLED", user.id, { ip: req.ip });
      res.success(null, "Two-factor authentication has been disabled.");
    } catch (error) {
      logger.error("Disable 2FA failed", { error: error.message });
      throw error;
    }
  }

  async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      const userList = await withTimeout(
        users.list([Query.equal("email", email)]),
        10000,
        "Appwrite users.list",
      );

      // Explicitly tell the user when no account is found — avoids the
      // confusing experience of waiting for an email that will never arrive.
      // Note: this trades a minor email-enumeration risk for clear UX; in a
      // B2C fintech app, email addresses are not considered sensitive enough
      // to justify silently swallowing this error.
      if (userList.total === 0) {
        res.status(404).json({
          success: false,
          error: {
            code: "USER_NOT_FOUND",
            message:
              "No account found with that email address. Please check the email and try again.",
          },
        });
        return;
      }

      const user = userList.users[0];

      // Block reset attempts for OAuth-only accounts (no password to reset)
      if (!user.prefs?.passwordHash) {
        res.status(400).json({
          success: false,
          error: {
            code: "OAUTH_ACCOUNT",
            message:
              "This account was created with Google or Facebook sign-in and does not have a password. Please sign in with your social account.",
          },
        });
        return;
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
      const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      await mergePrefs(user.$id, {
        passwordResetHash: tokenHash,
        passwordResetExpiry: expiry,
      });

      // Same "<userId>.<rawToken>" format as email verification
      const resetToken = `${user.$id}.${rawToken}`;
      const firstName = (user.name || "").split(" ")[0] || "there";
      await emailService.sendPasswordResetEmail(
        user.email,
        resetToken,
        firstName,
      );

      res.success(
        null,
        "Password reset link sent. Please check your inbox (and spam folder).",
      );
    } catch (error) {
      logger.error("Forgot password failed", { error: error.message });
      throw error;
    }
  }
}

const authControllerInstance = new AuthController();
module.exports = authControllerInstance;
// Export the session store so other controllers (e.g. profileController) can
// read and revoke sessions without the Map being duplicated.
module.exports.activeSessions = activeSessions;