/**
 * Balance Projection Service
 *
 * Provides read-only balance queries derived from the ledger (Phase 3+).
 * Phase 2 stores a simple cached balance in account_balances that is
 * initialised to zero on account creation.
 *
 * CRITICAL: This service MUST NOT mutate balance.  Debit/credit belong
 * to the ledger engine (Phase 3) and atomic transfer engine (Phase 4).
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
} = require("../middleware/monitoring/errorHandler");
const {
  validateCurrency,
  assertInteger,
  assertNonNegative,
  toBigUnits,
} = require("../utils/money");

const DB = () => config.database.appwrite.databaseId;
const COLLECTIONS = {
  accountBalances: () => config.database.appwrite.accountBalancesCollectionId,
  walletAccounts: () => config.database.appwrite.walletAccountsCollectionId,
};

function _db() {
  return dbConn.getDatabases();
}

class BalanceProjectionService {
  /**
   * Get balance for a wallet account.
   * Verifies ownership before returning data.
   */
  async getBalance(accountId, requesterUserId, role) {
    // Verify account exists and belongs to requester
    const account = await _db()
      .getDocument(DB(), COLLECTIONS.walletAccounts(), accountId)
      .catch(() => null);

    if (!account) {
      throw new NotFoundError("Wallet account");
    }

    if (!["admin", "super_admin"].includes(role) && account.userId !== requesterUserId) {
      throw new AuthorizationError("Access denied to this balance");
    }

    // Read balance projection
    const col = COLLECTIONS.accountBalances();
    const result = await _db().listDocuments(DB(), col, [
      Query.equal("accountId", accountId),
      Query.limit(1),
    ]).catch(() => ({ documents: [] }));

    if (result.documents.length === 0) {
      return { balanceMinorUnits: 0, currency: account.currency, version: 0 };
    }

    const bal = result.documents[0];
    assertInteger(bal.balance, "balance");
    assertNonNegative(bal.balance, "balance");

    return {
      balanceMinorUnits: bal.balance,
      balanceDisplay: toBigUnits(bal.balance, bal.currency),
      currency: bal.currency,
      version: bal.version,
      updatedAt: bal.updatedAt,
    };
  }

  /**
   * Verify that a balance record exists and matches expectations.
   * Used for integrity checks and debugging.
   */
  async verifyBalance(accountId, expectedCurrency) {
    const col = COLLECTIONS.accountBalances();
    const result = await _db().listDocuments(DB(), col, [
      Query.equal("accountId", accountId),
      Query.limit(1),
    ]).catch(() => ({ documents: [] }));

    if (result.documents.length === 0) {
      throw new NotFoundError(`Balance record for account ${accountId}`);
    }

    const bal = result.documents[0];
    const validatedCurrency = validateCurrency(expectedCurrency);

    if (bal.currency !== validatedCurrency) {
      throw new ValidationError(
        `Currency mismatch: expected ${validatedCurrency}, got ${bal.currency}`,
      );
    }

    assertInteger(bal.balance, "balance");
    assertNonNegative(bal.balance, "balance");
    assertInteger(bal.version, "version");

    return {
      accountId,
      currency: bal.currency,
      balanceMinorUnits: bal.balance,
      version: bal.version,
      verified: true,
    };
  }
}

module.exports = new BalanceProjectionService();
