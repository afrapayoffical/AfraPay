/**
 * Wallet Account Service
 *
 * Manages wallet account lifecycle: provisioning, lookup, status checks.
 *
 * Financial truth resides in the ledger (Phase 3).  This service provides:
 *   - Safe idempotent provisioning
 *   - Ownership protection (server-derived userId, never trust client)
 *   - Account status validation for future financial operations
 *   - Balance projection read-through (Phase 2: placeholder, Phase 3+ connects to ledger)
 */

"use strict";

const { Query } = require("node-appwrite");
const { appwrite: dbConn } = require("../database/connection");
const config = require("../config/environment");
const logger = require("../utils/logger");
const {
  ValidationError,
  NotFoundError,
  AuthorizationError,
  ConflictError,
} = require("../middleware/monitoring/errorHandler");
const { validateCurrency, assertInteger, assertNonNegative } = require("../utils/money");

// ── Constants ──────────────────────────────────────────────────────────────────
const ACCOUNT_TYPES = new Set(["PERSONAL", "MERCHANT"]);
const ACCOUNT_STATUSES = new Set(["ACTIVE", "FROZEN", "SUSPENDED", "CLOSED"]);

const DB = () => config.database.appwrite.databaseId;
const COLLECTIONS = {
  walletAccounts: () => config.database.appwrite.walletAccountsCollectionId,
  accountBalances: () => config.database.appwrite.accountBalancesCollectionId,
};

// ── Helper ─────────────────────────────────────────────────────────────────────
function _db() {
  return dbConn.getDatabases();
}

class WalletAccountService {
  // ── Provisioning ───────────────────────────────────────────────────────────

  /**
   * Find or create a wallet account for the given owner + currency.
   * Idempotent: if an ACTIVE account already exists, returns it.
   * Server-derived userId — never trust req.body.userId.
   */
  async provision({ userId, currency, accountType = "PERSONAL" }) {
    const code = validateCurrency(currency);
    if (!ACCOUNT_TYPES.has(accountType)) {
      throw new ValidationError(`Invalid account type: ${accountType}`, [
        { field: "accountType", message: `Must be one of: ${[...ACCOUNT_TYPES].join(", ")}` },
      ]);
    }

    const col = COLLECTIONS.walletAccounts();
    if (!col) {
      throw new Error("Wallet accounts collection not configured");
    }

    // Lookup existing account for this user + currency
    const existing = await this._findByOwnerAndCurrency(userId, code);
    if (existing) {
      logger.info("WalletAccountService: idempotent provision (existing found)", {
        userId,
        currency: code,
        accountId: existing.$id,
        status: existing.status,
        requestId: globalThis.lastRequestId || "unknown",
      });
      return this._enrich(existing);
    }

    // Create new account
    const now = new Date().toISOString();
    const doc = await _db().createDocument(DB(), col, null, {
      userId,
      accountType,
      currency: code,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });

    logger.info("WalletAccountService: account provisioned", {
      userId,
      accountId: doc.$id,
      currency: code,
      requestId: globalThis.lastRequestId || "unknown",
    });

    // Initialise balance record (0 minor units)
    await this._initBalance(doc.$id, code);

    return this._enrich(doc);
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  /**
   * Find account by ID with ownership check.
   * Admins bypass ownership; regular users can only see their own accounts.
   */
  async getById(accountId, requesterUserId, role) {
    const col = COLLECTIONS.walletAccounts();
    const doc = await _db().getDocument(DB(), col, accountId).catch(() => null);
    if (!doc) {
      throw new NotFoundError("Wallet account");
    }

    // Ownership / admin check
    if (!["admin", "super_admin"].includes(role) && doc.userId !== requesterUserId) {
      throw new AuthorizationError("Access denied to this wallet account");
    }

    return this._enrich(doc);
  }

  /**
   * Find account by user + currency (used during provisioning).
   */
  async _findByOwnerAndCurrency(userId, currency) {
    const col = COLLECTIONS.walletAccounts();
    const result = await _db().listDocuments(DB(), col, [
      Query.equal("userId", userId),
      Query.equal("currency", currency.toUpperCase()),
      Query.limit(1),
    ]).catch(() => ({ documents: [] }));
    return result.documents[0] || null;
  }

  // ── Status helpers ───────────────────────────────────────────────────────────

  /**
   * Check whether an account can perform financial operations.
   * Returns the enriched account or throws an AuthorizationError.
   */
  async validateAccountForFinancialOperation(accountId, requesterUserId, role) {
    const account = await this.getById(accountId, requesterUserId, role);
    if (account.status !== "ACTIVE") {
      throw new AuthorizationError(
        `Wallet account is ${account.status.toUpperCase()}. Financial operations are blocked.`,
      );
    }
    return account;
  }

  /**
   * Change account status (server-only operation — not exposed to clients).
   * Admin/super_admin only.
   */
  async changeStatus(accountId, newStatus, changedByUserId, reason = null) {
    if (!ACCOUNT_STATUSES.has(newStatus)) {
      throw new ValidationError(`Invalid status: ${newStatus}`, [
        { field: "status", message: `Must be one of: ${[...ACCOUNT_STATUSES].join(", ")}` },
      ]);
    }

    const col = COLLECTIONS.walletAccounts();
    const existing = await _db().getDocument(DB(), col, accountId).catch(() => null);
    if (!existing) {
      throw new NotFoundError("Wallet account");
    }

    const now = new Date().toISOString();
    const updated = await _db().updateDocument(DB(), col, accountId, {
      status: newStatus,
      updatedAt: now,
      // Optional: store reason in metadata for audit trail
      ...(reason ? { _meta: { statusChangeReason: reason, changedBy: changedByUserId } } : {}),
    });

    logger.info("WalletAccountService: status changed", {
      accountId,
      from: existing.status,
      to: newStatus,
      changedBy: changedByUserId,
      reason,
    });

    return this._enrich(updated);
  }

  // ── Balance projection (placeholder for Phase 3) ─────────────────────────────

  /**
   * Get the projected balance for a wallet account.
   *
   * In Phase 2 this returns the value stored in account_balances (initialized to 0).
   * Phase 3 will replace this with a ledger-derived projection.
   */
  async getBalance(accountId) {
    const col = COLLECTIONS.accountBalances();
    const result = await _db().listDocuments(DB(), col, [
      Query.equal("accountId", accountId),
      Query.limit(1),
    ]).catch(() => ({ documents: [] }));

    if (result.documents.length === 0) {
      // Balance record not yet initialised — return 0
      return { balanceMinorUnits: 0, currency: "SSP", version: 0, updatedAt: null };
    }

    const bal = result.documents[0];
    return {
      balanceMinorUnits: bal.balance,
      currency: bal.currency,
      version: bal.version,
      updatedAt: bal.updatedAt,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  async _initBalance(accountId, currency) {
    const col = COLLECTIONS.accountBalances();
    const now = new Date().toISOString();
    try {
      await _db().createDocument(DB(), col, null, {
        accountId,
        currency,
        balance: 0,
        version: 1,
        updatedAt: now,
      });
    } catch (e) {
      // Already exists — ignore (idempotent)
      if (e.code !== 409) throw e;
    }
  }

  _enrich(doc) {
    return {
      id: doc.$id,
      userId: doc.userId,
      accountType: doc.accountType,
      currency: doc.currency,
      status: doc.status,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}

module.exports = new WalletAccountService();
