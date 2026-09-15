/**
 * Wallet Account Controller
 *
 * Handles wallet account provisioning and balance retrieval.
 * All financial state is server-derived; clients never submit balances,
 * statuses, or ownership fields.
 */

"use strict";

const walletAccountService = require("../services/walletAccountService");
const balanceProjectionService = require("../services/balanceProjectionService");
const logger = require("../utils/logger");
const { ValidationError, AuthorizationError } = require("../middleware/monitoring/errorHandler");

class WalletAccountController {
  /**
   * POST /api/v1/wallet/provision
   *
   * Create (or return existing) wallet account for the authenticated user.
   * Idempotent: repeated calls return the same account.
   */
  async provision(req, res, next) {
    try {
      const { user } = req;
      if (!user || !user.id) {
        throw new AuthorizationError("Authentication required");
      }

      // Currency from request body — validated server-side
      const { currency } = req.body;
      if (!currency) {
        throw new ValidationError("Currency is required", [
          { field: "currency", message: "Currency is required" },
        ]);
      }

      // Server never trusts client-supplied userId — always use authenticated user
      const account = await walletAccountService.provision({
        userId: user.id,
        currency,
        accountType: req.body.accountType || "PERSONAL",
      });

      res.created(account, "Wallet account provisioned successfully");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/wallet
   *
   * Return the authenticated user's wallet account(s).
   */
  async getMyWallet(req, res, next) {
    try {
      const { user } = req;
      if (!user || !user.id) {
        throw new AuthorizationError("Authentication required");
      }

      // Find all accounts for this user
      const { appwrite: dbConn } = require("../database/connection");
      const config = require("../config/environment");
      const { Query } = require("node-appwrite");

      const col = config.database.appwrite.walletAccountsCollectionId;
      const result = await dbConn.getDatabases().listDocuments(config.database.appwrite.databaseId, col, [
        Query.equal("userId", user.id),
      ]);

      const accounts = (result.documents || []).map((doc) => ({
        id: doc.$id,
        userId: doc.userId,
        accountType: doc.accountType,
        currency: doc.currency,
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }));

      res.success(accounts, "Wallet accounts retrieved");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/wallet/:accountId
   *
   * Return a specific wallet account (ownership enforced).
   */
  async getWallet(req, res, next) {
    try {
      const { user } = req;
      const { accountId } = req.params;

      const account = await walletAccountService.getById(
        accountId,
        user.id,
        user.role,
      );

      res.success(account, "Wallet account retrieved");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/wallet/:accountId/balance
   *
   * Return balance for a wallet account (ownership enforced).
   * Balance is in integer minor units; display value provided separately.
   */
  async getBalance(req, res, next) {
    try {
      const { user } = req;
      const { accountId } = req.params;

      const balance = await balanceProjectionService.getBalance(
        accountId,
        user.id,
        user.role,
      );

      res.success(balance, "Balance retrieved");
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new WalletAccountController();
