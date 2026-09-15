/**
 * Environment Configuration
 * Centralized configuration management with validation
 */

require("dotenv").config();
const Joi = require("joi");

function normalizeOriginList(value) {
  if (!value) {
    return [];
  }

  const rawValues = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      rawValues
        .flatMap((entry) =>
          String(entry)
            .split(",")
            .map((origin) => origin.trim().replace(/^['\"]|['\"]$/g, "")),
        )
        .filter(Boolean),
    ),
  ];
}

function getDefaultCorsOrigins(env) {
  const defaults = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "https://www.afrapayafrica.com",
    "https://afrapayafrica.com",
    "https://admin.afrapayafrica.com",
  ];

  if (env.APP_URL) {
    defaults.push(env.APP_URL);

    try {
      const appUrl = new URL(env.APP_URL);

      if (appUrl.hostname.startsWith("www.")) {
        const apexUrl = new URL(env.APP_URL);
        apexUrl.hostname = appUrl.hostname.replace(/^www\./, "");
        defaults.push(apexUrl.toString().replace(/\/$/, ""));
      } else if (!appUrl.hostname.startsWith("localhost")) {
        const wwwUrl = new URL(env.APP_URL);
        wwwUrl.hostname = `www.${appUrl.hostname}`;
        defaults.push(wwwUrl.toString().replace(/\/$/, ""));
      }
    } catch (error) {
      // Ignore malformed APP_URL here; Joi validation handles it separately.
    }
  }

  return [...new Set(defaults.map((origin) => origin.replace(/\/$/, "")))];
}

// Environment validation schema
const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "staging", "production")
    .default("development"),
  PORT: Joi.number().port().default(5000),
  HOST: Joi.string().default("0.0.0.0"),

  // Database Configuration
  APPWRITE_ENDPOINT: Joi.string().uri().required(),
  APPWRITE_PROJECT_ID: Joi.string().required(),
  APPWRITE_API_KEY: Joi.string().required(),
  APPWRITE_DATABASE_ID: Joi.string().required(),
  APPWRITE_USER_COLLECTION_ID: Joi.string().required(),
  APPWRITE_TRANSACTIONS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_PAYMENTS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_WALLETS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_MERCHANT_WALLETS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_DISPUTES_COLLECTION_ID: Joi.string().required(),
  APPWRITE_WALLET_ACCOUNTS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_ACCOUNT_BALANCES_COLLECTION_ID: Joi.string().required(),
  APPWRITE_LEDGER_TRANSACTIONS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_LEDGER_ENTRIES_COLLECTION_ID: Joi.string().required(),
  APPWRITE_IDEMPOTENCY_RECORDS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_OUTBOX_EVENTS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_INTEGRITY_CHECKS_COLLECTION_ID: Joi.string().required(),
  APPWRITE_EDUCATION_CONTENT_COLLECTION_ID: Joi.string().allow(""),
  APPWRITE_EDUCATION_CATEGORIES_COLLECTION_ID: Joi.string().allow(""),
  APPWRITE_LEARNING_PATHS_COLLECTION_ID: Joi.string().allow(""),
  APPWRITE_ENROLLMENTS_COLLECTION_ID: Joi.string().allow(""),
  APPWRITE_PROGRESS_COLLECTION_ID: Joi.string().allow(""),
  APPWRITE_BOOKMARKS_COLLECTION_ID: Joi.string().allow(""),
  APPWRITE_CONTENT_STORAGE_BUCKET_ID: Joi.string().allow(""),
  APPWRITE_NEWSLETTER_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_SUPPORT_TICKETS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_SUPPORT_MESSAGES_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_CHAT_SESSIONS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_CHAT_MESSAGES_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_NOTIFICATIONS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_CAREERS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_APPLICATIONS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_BLOG_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_USER_CARDS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_MERCHANTS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_TILLS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_MERCHANT_WALLETS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_PAYOUTS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_DOCUMENTS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_AUDIT_LOGS_COLLECTION: Joi.string().allow("").default(""),
  APPWRITE_FRAUD_FLAGS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_SUBSCRIPTION_PLANS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_SUBSCRIPTIONS_COLLECTION_ID: Joi.string().allow("").default(""),
  APPWRITE_BILLING_HISTORY_COLLECTION_ID: Joi.string().allow("").default(""),

  // Redis Configuration
  REDIS_HOST: Joi.string().default("localhost"),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow(""),
  REDIS_DB: Joi.number().default(0),
  REDIS_ENABLED: Joi.boolean().default(false),

  // JWT Configuration
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default("7d"),

  // Encryption
  ENCRYPTION_KEY: Joi.string().length(32).required(),

  // Rate Limiting
  RATE_LIMIT_WINDOW: Joi.number().default(15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),

  // File Upload
  MAX_FILE_SIZE: Joi.number().default(5 * 1024 * 1024), // 5MB
  UPLOAD_PATH: Joi.string().default("./uploads"),

  // External Services
  TWILIO_ACCOUNT_SID: Joi.string().allow(""),
  TWILIO_AUTH_TOKEN: Joi.string().allow(""),
  TWILIO_PHONE_NUMBER: Joi.string().allow(""),

  SENDGRID_API_KEY: Joi.string().allow(""),
  FROM_EMAIL: Joi.string().email().default("noreply@afrapay.com"),

  RESEND_API_KEY: Joi.string().allow(""),
  APP_URL: Joi.string().uri().default("http://localhost:3000"),

  RESEND_API_KEY: Joi.string().allow(""),
  APP_URL: Joi.string().uri().default("http://localhost:3000"),

  // Google OAuth
  GOOGLE_CLIENT_ID: Joi.string().allow("").default(""),
  GOOGLE_CLIENT_SECRET: Joi.string().allow("").default(""),

  // Facebook OAuth
  FACEBOOK_APP_ID: Joi.string().allow("").default(""),
  FACEBOOK_APP_SECRET: Joi.string().allow("").default(""),

  // Expo Push Notifications
  EXPO_ACCESS_TOKEN: Joi.string().allow("").default(""),

  // Payment Gateways
  STRIPE_SECRET_KEY: Joi.string().allow(""),
  STRIPE_PUBLISHABLE_KEY: Joi.string().allow(""),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow(""),

  PAYSTACK_SECRET_KEY: Joi.string().allow(""),
  PAYSTACK_PUBLIC_KEY: Joi.string().allow(""),
  PAYSTACK_CALLBACK_URL: Joi.string().uri().allow(""),

  FLUTTERWAVE_SECRET_KEY: Joi.string().allow(""),
  FLUTTERWAVE_PUBLIC_KEY: Joi.string().allow(""),
  FLUTTERWAVE_ENCRYPTION_KEY: Joi.string().allow(""),
  FLUTTERWAVE_WEBHOOK_SECRET: Joi.string().allow(""),
  FLUTTERWAVE_REDIRECT_URL: Joi.string().uri().allow(""),
  STRIPE_RETURN_URL: Joi.string().uri().allow(""),

  // M-Pesa (Safaricom Daraja)
  MPESA_CONSUMER_KEY: Joi.string().allow("").default(""),
  MPESA_CONSUMER_SECRET: Joi.string().allow("").default(""),
  MPESA_SHORTCODE: Joi.string().allow("").default(""),
  MPESA_PASSKEY: Joi.string().allow("").default(""),
  MPESA_CALLBACK_URL: Joi.string().uri().allow("").default(""),
  MPESA_ENV: Joi.string().valid("sandbox", "production").default("sandbox"),

  // MTN Mobile Money
  MTN_MOMO_SUBSCRIPTION_KEY: Joi.string().allow("").default(""),
  MTN_MOMO_API_USER_ID: Joi.string().allow("").default(""),
  MTN_MOMO_API_KEY: Joi.string().allow("").default(""),
  MTN_MOMO_CALLBACK_URL: Joi.string().uri().allow("").default(""),
  MTN_MOMO_TARGET_ENV: Joi.string().allow("").default("sandbox"),
  MTN_MOMO_CURRENCY: Joi.string().length(3).default("EUR"),

  // Orchestration
  PAYMENT_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
  PAYMENT_RETRY_BASE_MS: Joi.number().integer().min(100).default(500),
  PAYMENT_IDEMPOTENCY_TTL: Joi.number().integer().min(60).default(86400),
  PAYMENT_PREFERRED_PROVIDER: Joi.string()
    .valid("stripe", "paystack", "flutterwave")
    .allow(""),
  CB_FAILURE_THRESHOLD: Joi.number().integer().min(1).default(5),
  CB_OPEN_DURATION_MS: Joi.number().integer().min(1000).default(30000),

  // Monitoring
  LOG_LEVEL: Joi.string()
    .valid("error", "warn", "info", "debug")
    .default("info"),
  ENABLE_REQUEST_LOGGING: Joi.boolean().default(true),
  SENTRY_DSN: Joi.string().allow(""),

  // Argon2id for PIN hashing
  ARGON2ID_MEMORY_COST: Joi.number().default(19456), // 19 MiB in KiB
  ARGON2ID_TIME_COST: Joi.number().default(2),
  ARGON2ID_PARALLELISM: Joi.number().default(1),
  ARGON2ID_HASH_LENGTH: Joi.number().default(32),
  ARGON2ID_SALT_LENGTH: Joi.number().default(16),

  // Security
  CORS_ORIGIN: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .default("*"),
  COOKIE_SECRET: Joi.string().min(32).required(),
  // In production set to ".afrapayafrica.com" (leading dot = all subdomains)
  COOKIE_DOMAIN: Joi.string().allow("").default(""),
  // "strict" works when API and frontend share the same domain/subdomain.
  // Set to "none" only when they run on completely different origins AND
  // HTTPS is enforced — otherwise browsers will reject the cookie.
  COOKIE_SAME_SITE: Joi.string()
    .valid("strict", "lax", "none")
    .default("strict"),

  // Features
  ENABLE_SWAGGER: Joi.boolean().default(true),
  ENABLE_WEBSOCKETS: Joi.boolean().default(true),
  ENABLE_RATE_LIMITING: Joi.boolean().default(true),
}).unknown();

// Validate environment variables
const { error, value: env } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Environment validation error: ${error.message}`);
}

// Configuration object
const allowedOrigins = (() => {
  const configuredOrigins = normalizeOriginList(env.CORS_ORIGIN).map((origin) =>
    origin.replace(/\/$/, ""),
  );

  if (configuredOrigins.includes("*")) {
    return true;
  }

  const fallbackOrigins = getDefaultCorsOrigins(env);

  if (!configuredOrigins.length) {
    return fallbackOrigins;
  }

  return [...new Set([...configuredOrigins, ...fallbackOrigins])];
})();

const config = {
  app: {
    name: "AfraPay API",
    version: "1.0.0",
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === "development",
    isProduction: env.NODE_ENV === "production",
    isStaging: env.NODE_ENV === "staging",
  },

  server: {
    port: env.PORT,
    host: env.HOST,
    https: env.NODE_ENV === "production",
  },

  database: {
    appwrite: {
      endpoint: env.APPWRITE_ENDPOINT,
      projectId: env.APPWRITE_PROJECT_ID,
      apiKey: env.APPWRITE_API_KEY,
      databaseId: env.APPWRITE_DATABASE_ID,
      userCollectionId: env.APPWRITE_USER_COLLECTION_ID,
      transactionsCollectionId: env.APPWRITE_TRANSACTIONS_COLLECTION_ID,
      paymentsCollectionId: env.APPWRITE_PAYMENTS_COLLECTION_ID,
      walletsCollectionId: env.APPWRITE_WALLETS_COLLECTION_ID,
      disputesCollectionId: env.APPWRITE_DISPUTES_COLLECTION_ID,
      educationContentCollectionId:
        env.APPWRITE_EDUCATION_CONTENT_COLLECTION_ID || "",
      educationCategoriesCollectionId:
        env.APPWRITE_EDUCATION_CATEGORIES_COLLECTION_ID || "",
      learningPathsCollectionId:
        env.APPWRITE_LEARNING_PATHS_COLLECTION_ID || "",
      enrollmentsCollectionId: env.APPWRITE_ENROLLMENTS_COLLECTION_ID || "",
      progressCollectionId: env.APPWRITE_PROGRESS_COLLECTION_ID || "",
      bookmarksCollectionId: env.APPWRITE_BOOKMARKS_COLLECTION_ID || "",
      contentStorageBucketId: env.APPWRITE_CONTENT_STORAGE_BUCKET_ID || "",
      storageBucketId:
        env.APPWRITE_STORAGE_BUCKET_ID ||
        env.APPWRITE_CONTENT_STORAGE_BUCKET_ID ||
        "",
      newsletterCollectionId: env.APPWRITE_NEWSLETTER_COLLECTION_ID || "",
      supportTicketsCollectionId:
        env.APPWRITE_SUPPORT_TICKETS_COLLECTION_ID || "",
      supportMessagesCollectionId:
        env.APPWRITE_SUPPORT_MESSAGES_COLLECTION_ID || "",
      chatSessionsCollectionId: env.APPWRITE_CHAT_SESSIONS_COLLECTION_ID || "",
      chatMessagesCollectionId: env.APPWRITE_CHAT_MESSAGES_COLLECTION_ID || "",
      notificationsCollectionId: env.APPWRITE_NOTIFICATIONS_COLLECTION_ID || "",
      careersCollectionId: env.APPWRITE_CAREERS_COLLECTION_ID || "",
      applicationsCollectionId: env.APPWRITE_APPLICATIONS_COLLECTION_ID || "",
      userCardsCollectionId: env.APPWRITE_USER_CARDS_COLLECTION_ID || "",
      auditLogsCollectionId: env.APPWRITE_AUDIT_LOGS_COLLECTION || "",
      fraudFlagsCollectionId: env.APPWRITE_FRAUD_FLAGS_COLLECTION_ID || "",
      subscriptionPlansCollectionId:
        env.APPWRITE_SUBSCRIPTION_PLANS_COLLECTION_ID || "",
      subscriptionsCollectionId: env.APPWRITE_SUBSCRIPTIONS_COLLECTION_ID || "",
      billingHistoryCollectionId:
        env.APPWRITE_BILLING_HISTORY_COLLECTION_ID || "",
      merchantsCollectionId: env.APPWRITE_MERCHANTS_COLLECTION_ID || "",
      merchantWalletsCollectionId:
        env.APPWRITE_MERCHANT_WALLETS_COLLECTION_ID || "",
      payoutsCollectionId: env.APPWRITE_PAYOUTS_COLLECTION_ID || "",
      walletAccountsCollectionId:
        env.APPWRITE_WALLET_ACCOUNTS_COLLECTION_ID || "",
      accountBalancesCollectionId:
        env.APPWRITE_ACCOUNT_BALANCES_COLLECTION_ID || "",
      ledgerTransactionsCollectionId:
        env.APPWRITE_LEDGER_TRANSACTIONS_COLLECTION_ID || "",
      ledgerEntriesCollectionId:
        env.APPWRITE_LEDGER_ENTRIES_COLLECTION_ID || "",
      idempotencyRecordsCollectionId:
        env.APPWRITE_IDEMPOTENCY_RECORDS_COLLECTION_ID || "",
      outboxEventsCollectionId:
        env.APPWRITE_OUTBOX_EVENTS_COLLECTION_ID || "",
      integrityChecksCollectionId:
        env.APPWRITE_INTEGRITY_CHECKS_COLLECTION_ID || "",
    },
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      enabled: env.REDIS_ENABLED,
    },
  },

  security: {
    jwt: {
      secret: env.JWT_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    encryption: {
      key: env.ENCRYPTION_KEY,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW,
      max: env.RATE_LIMIT_MAX_REQUESTS,
      enabled: env.ENABLE_RATE_LIMITING,
    },
    argon2id: {
      memoryCost: env.ARGON2ID_MEMORY_COST,
      timeCost: env.ARGON2ID_TIME_COST,
      parallelism: env.ARGON2ID_PARALLELISM,
      hashLength: env.ARGON2ID_HASH_LENGTH,
      saltLength: env.ARGON2ID_SALT_LENGTH,
    },
    cors: {
      allowedOrigins,
      allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Origin",
        "X-Requested-With",
        "Content-Type",
        "Accept",
        "Authorization",
        "X-CSRF-Token",
        "X-Device-Fingerprint",
        "X-Device-ID",
        "X-Request-ID",
        "X-API-Key",
        "X-Client-Type",
        "X-App-Language",
      ],
      credentials: true,
      maxAge: 86400, // 24 hours
    },
    cookie: {
      secret: env.COOKIE_SECRET,
      secure: env.NODE_ENV === "production",
      httpOnly: true,
      // Empty string = no domain attribute (browser default — dev-friendly).
      // In production this becomes ".afrapayafrica.com" via COOKIE_DOMAIN.
      domain: env.COOKIE_DOMAIN || undefined,
      sameSite: env.COOKIE_SAME_SITE,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  },

  upload: {
    maxSize: env.MAX_FILE_SIZE,
    path: env.UPLOAD_PATH,
    allowedTypes: ["image/jpeg", "image/png", "image/gif", "application/pdf"],
  },

  external: {
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      phoneNumber: env.TWILIO_PHONE_NUMBER,
    },
    sendgrid: {
      apiKey: env.SENDGRID_API_KEY,
      fromEmail: env.FROM_EMAIL,
    },
    resend: {
      apiKey: env.RESEND_API_KEY || "",
      fromEmail: env.FROM_EMAIL,
    },
    appUrl: env.APP_URL,
    google: {
      clientId: env.GOOGLE_CLIENT_ID || "",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    },
    facebook: {
      appId: env.FACEBOOK_APP_ID || "",
      appSecret: env.FACEBOOK_APP_SECRET || "",
    },
    expo: {
      accessToken: env.EXPO_ACCESS_TOKEN || "",
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      returnUrl:
        env.STRIPE_RETURN_URL || "https://afrapay.com/payments/complete",
    },
    paystack: {
      secretKey: env.PAYSTACK_SECRET_KEY,
      publicKey: env.PAYSTACK_PUBLIC_KEY,
      callbackUrl:
        env.PAYSTACK_CALLBACK_URL || "https://afrapay.com/payments/complete",
    },
    flutterwave: {
      secretKey: env.FLUTTERWAVE_SECRET_KEY,
      publicKey: env.FLUTTERWAVE_PUBLIC_KEY,
      encryptionKey: env.FLUTTERWAVE_ENCRYPTION_KEY,
      webhookSecret: env.FLUTTERWAVE_WEBHOOK_SECRET,
      redirectUrl:
        env.FLUTTERWAVE_REDIRECT_URL || "https://afrapay.com/payments/complete",
    },
    mpesa: {
      consumerKey: env.MPESA_CONSUMER_KEY || "",
      consumerSecret: env.MPESA_CONSUMER_SECRET || "",
      shortcode: env.MPESA_SHORTCODE || "",
      passkey: env.MPESA_PASSKEY || "",
      callbackUrl:
        env.MPESA_CALLBACK_URL || "https://afrapay.com/api/v1/webhooks/mpesa",
      env: env.MPESA_ENV || "sandbox",
    },
    mtnMomo: {
      subscriptionKey: env.MTN_MOMO_SUBSCRIPTION_KEY || "",
      apiUserId: env.MTN_MOMO_API_USER_ID || "",
      apiKey: env.MTN_MOMO_API_KEY || "",
      callbackUrl:
        env.MTN_MOMO_CALLBACK_URL || "https://afrapay.com/api/v1/webhooks/mtn",
      targetEnv: env.MTN_MOMO_TARGET_ENV || "sandbox",
      currency: env.MTN_MOMO_CURRENCY || "EUR",
    },
  },

  orchestration: {
    maxRetries: env.PAYMENT_MAX_RETRIES,
    retryBaseMs: env.PAYMENT_RETRY_BASE_MS,
    idempotencyTtl: env.PAYMENT_IDEMPOTENCY_TTL,
    preferredProvider: env.PAYMENT_PREFERRED_PROVIDER || null,
    circuitBreaker: {
      failureThreshold: env.CB_FAILURE_THRESHOLD,
      openDurationMs: env.CB_OPEN_DURATION_MS,
    },
  },

  logging: {
    level: env.LOG_LEVEL,
    enableRequestLogging: env.ENABLE_REQUEST_LOGGING,
    sentryDsn: env.SENTRY_DSN,
  },

  features: {
    swagger: env.ENABLE_SWAGGER,
    websockets: env.ENABLE_WEBSOCKETS,
    rateLimiting: env.ENABLE_RATE_LIMITING,
  },

  // Collection ID mappings for backward compatibility with admin controller
  collections: {
    usersId: env.APPWRITE_USER_COLLECTION_ID,
    transactionsId: env.APPWRITE_TRANSACTIONS_COLLECTION_ID,
    paymentsId: env.APPWRITE_PAYMENTS_COLLECTION_ID,
    walletsId: env.APPWRITE_WALLETS_COLLECTION_ID,
    disputesId: env.APPWRITE_DISPUTES_COLLECTION_ID,
    merchantsId: env.APPWRITE_MERCHANTS_COLLECTION_ID || "",
    tillsId: env.APPWRITE_TILLS_COLLECTION_ID || "",
    cardsId: env.APPWRITE_USER_CARDS_COLLECTION_ID || "",
    documentsId: env.APPWRITE_DOCUMENTS_COLLECTION_ID || "",
    blogId: env.APPWRITE_BLOG_COLLECTION_ID || "",
    careersId: env.APPWRITE_CAREERS_COLLECTION_ID || "",
    applicationsId: env.APPWRITE_APPLICATIONS_COLLECTION_ID || "",
    chatSessionsId: env.APPWRITE_CHAT_SESSIONS_COLLECTION_ID || "",
    chatMessagesId: env.APPWRITE_CHAT_MESSAGES_COLLECTION_ID || "",
    notificationsId: env.APPWRITE_NOTIFICATIONS_COLLECTION_ID || "",
    supportTicketsId: env.APPWRITE_SUPPORT_TICKETS_COLLECTION_ID || "",
    supportMessagesId: env.APPWRITE_SUPPORT_MESSAGES_COLLECTION_ID || "",
    newsletterId: env.APPWRITE_NEWSLETTER_COLLECTION_ID || "",
    educationContentId: env.APPWRITE_EDUCATION_CONTENT_COLLECTION_ID || "",
    educationCategoriesId:
      env.APPWRITE_EDUCATION_CATEGORIES_COLLECTION_ID || "",
    learningPathsId: env.APPWRITE_LEARNING_PATHS_COLLECTION_ID || "",
    enrollmentsId: env.APPWRITE_ENROLLMENTS_COLLECTION_ID || "",
    progressId: env.APPWRITE_PROGRESS_COLLECTION_ID || "",
    bookmarksId: env.APPWRITE_BOOKMARKS_COLLECTION_ID || "",
    auditLogsId: env.APPWRITE_AUDIT_LOGS_COLLECTION || "",
    fraudFlagsId: env.APPWRITE_FRAUD_FLAGS_COLLECTION_ID || "",
    walletAccountsId: env.APPWRITE_WALLET_ACCOUNTS_COLLECTION_ID || "",
    accountBalancesId: env.APPWRITE_ACCOUNT_BALANCES_COLLECTION_ID || "",
    ledgerTransactionsId: env.APPWRITE_LEDGER_TRANSACTIONS_COLLECTION_ID || "",
    ledgerEntriesId: env.APPWRITE_LEDGER_ENTRIES_COLLECTION_ID || "",
    idempotencyRecordsId: env.APPWRITE_IDEMPOTENCY_RECORDS_COLLECTION_ID || "",
    outboxEventsId: env.APPWRITE_OUTBOX_EVENTS_COLLECTION_ID || "",
    integrityChecksId: env.APPWRITE_INTEGRITY_CHECKS_COLLECTION_ID || "",
  },

  // Webhook shared secrets — used for HMAC signature verification.
  // These mirror the values already present in config.external.*
  // but are exposed under a single `webhooks` key for the WebhookController.
  webhooks: {
    stripe: {
      secret: env.STRIPE_WEBHOOK_SECRET || "",
    },
    paystack: {
      secret: env.PAYSTACK_SECRET_KEY || "",
    },
    flutterwave: {
      secret: env.FLUTTERWAVE_WEBHOOK_SECRET || "",
    },
  },
};

// Freeze configuration to prevent modifications
Object.freeze(config);

module.exports = config;
