/**
 * Database Connection Manager
 * Handles Appwrite client initialization and Redis connection
 */

const { Client, Databases, Users, Account } = require("node-appwrite");
const Redis = require("ioredis");
const config = require("../config/environment");
const logger = require("../utils/logger");
const pg = require("./pgConnection");

class DatabaseManager {
  constructor() {
    this.appwriteClient = null;
    this.databases = null;
    this.users = null;
    this.account = null;
    this.redis = null;
    this.isConnected = false;
  }

  /**
   * Ensure Appwrite clients exist even if the singleton was reset or accessed
   * before startup completed.
   */
  ensureAppwriteClients() {
    if (
      !this.appwriteClient ||
      !this.databases ||
      !this.users ||
      !this.account
    ) {
      this.appwriteClient = new Client()
        .setEndpoint(config.database.appwrite.endpoint)
        .setProject(config.database.appwrite.projectId)
        .setKey(config.database.appwrite.apiKey);

      this.databases = new Databases(this.appwriteClient);
      this.users = new Users(this.appwriteClient);
      this.account = new Account(this.appwriteClient);
    }

    return {
      client: this.appwriteClient,
      databases: this.databases,
      users: this.users,
      account: this.account,
    };
  }

  /**
   * Initialize Appwrite client
   */
  async initializeAppwrite() {
    this.ensureAppwriteClients();

    // Test connectivity — warn but do NOT throw; the server can still start
    try {
      await this.databases.list();
      logger.info("✅ Appwrite connection established");
    } catch (error) {
      logger.warn(
        `⚠️  Appwrite connectivity test failed (${error.message}). The server will start anyway — requests will fail until Appwrite is reachable.`,
      );
    }

    return true;
  }

  /**
   * Initialize Redis connection
   */
  async initializeRedis() {
    try {
      // Skip Redis initialization if disabled
      if (!config.database.redis.enabled) {
        logger.warn("⚠️ Redis disabled in configuration");
        return false;
      }

      const redisConfig = {
        host: config.database.redis.host,
        port: config.database.redis.port,
        password: config.database.redis.password,
        db: config.database.redis.db,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
      };

      this.redis = new Redis(redisConfig);

      // Redis event handlers
      this.redis.on("connect", () => {
        logger.info("✅ Redis connection established");
      });

      this.redis.on("error", (error) => {
        logger.error("❌ Redis connection error:", error.message);
      });

      this.redis.on("close", () => {
        logger.warn("⚠️ Redis connection closed");
      });

      this.redis.on("reconnecting", () => {
        logger.info("🔄 Redis reconnecting...");
      });

      // Test Redis connection
      await this.redis.connect();
      await this.redis.ping();

      return true;
    } catch (error) {
      logger.error("❌ Redis connection failed:", error.message);

      // Redis is optional in development
      if (config.app.isDevelopment) {
        logger.warn("⚠️ Continuing without Redis in development mode");
        return false;
      }

      throw error;
    }
  }

  /**
   * Connect to all databases
   */
  async connect() {
    await this.initializeAppwrite();

    try {
      await this.initializeRedis();
    } catch (error) {
      // Redis is optional — log and continue
      logger.warn(`⚠️  Redis initialization skipped: ${error.message}`);
    }

    this.isConnected = true;
    logger.info("🎉 Database manager initialized (Appwrite client ready)");
    return true;
  }

  /**
   * Disconnect from all databases
   */
  async disconnect() {
    try {
      if (this.redis && this.redis.status === "ready") {
        await this.redis.quit();
        logger.info("✅ Redis disconnected");
      }

      // Appwrite client doesn't have explicit disconnect
      this.appwriteClient = null;
      this.databases = null;
      this.users = null;
      this.account = null;

      this.isConnected = false;
      logger.info("✅ All database connections closed");
    } catch (error) {
      logger.error("❌ Error during database disconnect:", error.message);
    }
  }

  /**
   * Health check for database connections
   */
  async healthCheck() {
    const health = {
      appwrite: false,
      redis: false,
      overall: false,
    };

    try {
      // Check Appwrite with a 5-second timeout
      if (this.databases) {
        const ping = this.databases.list();
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000),
        );
        await Promise.race([ping, timeout]);
        health.appwrite = true;
      }

      // Check Redis
      if (this.redis && this.redis.status === "ready") {
        await this.redis.ping();
        health.redis = true;
      } else if (config.app.isDevelopment) {
        // Redis is optional in development
        health.redis = true;
      }

      health.overall = health.appwrite && health.redis;
    } catch (error) {
      logger.error("Database health check failed:", error.message);
    }

    return health;
  }

  /**
   * Get Appwrite databases instance
   */
  getDatabases() {
    if (!this.databases) {
      throw new Error("Appwrite not initialized");
    }
    return this.databases;
  }

  /**
   * Get Appwrite users instance
   */
  getUsers() {
    if (!this.users) {
      throw new Error("Appwrite not initialized");
    }
    return this.users;
  }

  /**
   * Get Redis instance
   */
  getRedis() {
    if (!this.redis) {
      throw new Error("Redis not initialized");
    }
    return this.redis;
  }

  /**
   * Get connection status
   */
  isHealthy() {
    return this.isConnected;
  }
}

// Create singleton instance
const databaseManager = new DatabaseManager();

// Export functions and instances
module.exports = {
  connectDatabase: () => databaseManager.connect(),
  disconnectDatabase: () => databaseManager.disconnect(),
  getDatabaseHealth: () => databaseManager.healthCheck(),
  appwrite: {
    getDatabases: () => databaseManager.getDatabases(),
    getUsers: () => databaseManager.getUsers(),
  },
  redis: {
    getClient: () => databaseManager.getRedis(),
  },
  databaseManager,
  // PostgreSQL pool — lazy-initialised on first use
  pg,
};
