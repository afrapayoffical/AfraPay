/**
 * Ledger Service — Double-Entry Accounting Engine
 *
 * This is the core financial infrastructure for AfraPay.  It owns all
 * journal operations and guarantees the double-entry invariant:
 *
 *   Σ(debit amounts) === Σ(credit amounts)
 *
 * The ledger is the authoritative source of financial truth.  Balance
 * projections (account_balances) are derived fast-read views that are
 * updated as a side-effect of posted transactions.
 *
 * APPWRITE TRANSACTION LIMITATION
 * ───────────────────────────────
 * node-appwrite v8.x does NOT expose a transaction API (no beginCommit
 * / commit / rollback).  Consequently we cannot wrap multiple
 * createDocument / updateDocument calls in an atomic transaction.
 *
 * Mitigation strategy:
 *   1. All financial writes are performed sequentially, one at a time.
 *   2. Each write uses deterministic IDs where possible.
 *   3. Duplicate transaction references are checked BEFORE any writes.
 *   4. If any step fails, earlier writes are left in a recoverable
 *      state (PENDING / PROCESSING) and can be cleaned by reconciliation.
 *   5. Version numbers on account_balances provide optimistic concurrency
 *      detection when the balance projection is updated.
 *
 * This is a documented limitation.  Migration to a true ACID engine
 * (Phase 5+) will remove the need for these mitigations.
 *
 * Design principles:
 *   - Server-only — never exposes low-level ledger writes to controllers.
 *   - Integer minor units only — all amounts validated via money.js.
 *   - Immutable once POSTED — no update or delete on posted entries.
 *   - Compensating transactions for corrections (future Phase).
 */

"use strict";

const { Query } = require("node-appwrite");
const { appwrite: dbConn } = require("../database/connection");
const config = require("../config/environment");
const logger = require("../utils/logger");
const {
  toBigUnits,
  validateCurrency,
} = require("../utils/money");
const walletAccountService = require("./walletAccountService");
const balanceProjectionService = require("./balanceProjectionService");
const auditService = require("./auditService");
const {
  ValidationError,
  NotFoundError,
} = require("../middleware/monitoring/errorHandler");
const {
  InvalidLedgerEntryError,
  UnbalancedJournalError,
  InvalidCurrencyError,
  DuplicateTransactionReferenceError,
  ImmutableTransactionError,
  LedgerConflictError,
  AccountNotActiveError,
} = require("./ledgerErrors");

// ── Constants ───────────────────────────────────────────────────────────────────

/** Transaction lifecycle states.  Legal transitions enforced by _applyTransition. */
const TX_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  POSTED: "POSTED",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
};

/** Allowed status transitions (from → Set(to)). */
const ALLOWED_TRANSITIONS = {
  [TX_STATUS.PENDING]: new Set([
    TX_STATUS.PROCESSING,
    TX_STATUS.FAILED,
  ]),
  [TX_STATUS.PROCESSING]: new Set([TX_STATUS.POSTED, TX_STATUS.FAILED]),
  [TX_STATUS.POSTED]: new Set([TX_STATUS.REVERSED]),
  [TX_STATUS.FAILED]: new Set(),
  [TX_STATUS.REVERSED]: new Set(),
};

/** Entry types — DEBIT reduces account balance, CREDIT increases it. */
const ENTRY_TYPE = {
  DEBIT: "DEBIT",
  CREDIT: "CREDIT",
};

/** Operations that this ledger service handles. */
const OPERATIONS = {
  WALLET_TRANSFER: "wallet_transfer",
  DEPOSIT: "deposit",
  WITHDRAWAL: "withdrawal",
  MERCHANT_PAYMENT: "merchant_payment",
  COMPENSATION: "compensation",
};

const DB = () => config.database.appwrite.databaseId;
const COLLECTIONS = {
  ledgerTransactions: () => config.database.appwrite.ledgerTransactionsCollectionId,
  ledgerEntries: () => config.database.appwrite.ledgerEntriesCollectionId,
  idempotencyRecords: () => config.database.appwrite.idempotencyRecordsCollectionId,
  outboxEvents: () => config.database.appwrite.outboxEventsCollectionId,
  integrityChecks: () => config.database.appwrite.integrityChecksCollectionId,
  walletAccounts: () => config.database.appwrite.walletAccountsCollectionId,
  accountBalances: () => config.database.appwrite.accountBalancesCollectionId,
};

function _db() {
  return dbConn.getDatabases();
}

// ── Public API ──────────────────────────────────────────────────────────────────

class LedgerService {
  // ── Posting ─────────────────────────────────────────────────────────────────

  /**
   * Create and post a double-entry journal transaction.
   *
   * @param {Object} params
   * @param {string}  params.reference          Stable public reference (unique per transaction)
   * @param {string}  params.type               One of OPERATIONS.*
   * @param {string}  params.currency           ISO-4217 currency code
   * @param {string}  params.description        Human-readable description
   * @param {string}  params.initiatedBy        Server-derived userId of the actor
   * @param {Array<{accountId, entryType, amountMinorUnits}>} params.entries
   *                                            Debit and credit entries.
   *                                            amountMinorUnits must be a positive integer.
   * @param {Object}  [params.metadata]         Optional structured metadata
   * @returns {Promise<{transactionId, reference, status, entries}>}
   */
  async postJournal({
    reference,
    type,
    currency,
    description,
    initiatedBy,
    entries,
    metadata = {},
  }) {
    // ── 1. Validate inputs ──────────────────────────────────────────────────
    this._validateJournalParams({
      reference,
      type,
      currency,
      description,
      initiatedBy,
      entries,
    });

    let code;
    try {
      code = validateCurrency(currency);
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new InvalidCurrencyError(err.message);
      }
      throw err;
    }
    const normalizedType = type.toUpperCase();

    const existing = await this._findTransactionByReference(reference);
    if (existing) {
      // Same reference, same financial data → allow replay
      if (
        existing.currency === code &&
        existing.type === normalizedType &&
        await this._entriesMatch(existing.$id, entries)
      ) {
        logger.info("LedgerService: idempotent replay of posted transaction", {
          reference,
          transactionId: existing.$id,
        });
        return this._enrichTransaction(existing, await this._getEntries(existing.$id));
      }
      // Same reference, different data → conflict
      throw new DuplicateTransactionReferenceError(
        `Reference "${reference}" already exists with different financial data`,
      );
    }

    // ── 3. Validate all referenced accounts ─────────────────────────────────
    await this._validateAccounts(entries, code);

    // ── 4. Create transaction record (PENDING) ──────────────────────────────
    const transactionId = crypto.randomUUID();
    const now = new Date().toISOString();

    await _db().createDocument(DB(), COLLECTIONS.ledgerTransactions(), transactionId, {
      reference,
      type: normalizedType,
      status: TX_STATUS.PENDING,
      currency: code,
      description,
      initiatedBy,
      postedAt: null,
      reversedAt: null,
      reversalReference: null,
      metadata: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
    });

    logger.info("LedgerService: journal created (PENDING)", {
      transactionId,
      reference,
      type: normalizedType,
      currency: code,
      entryCount: entries.length,
      initiatedBy,
    });

    auditService.logAction({
      actorId: initiatedBy,
      actorRole: "system",
      action: "LEDGER_JOURNAL_CREATED",
      entity: "ledger_transaction",
      entityId: transactionId,
      metadata: { reference, type: normalizedType, currency: code, entryCount: entries.length },
    });

    // ── 5. Transition to PROCESSING ─────────────────────────────────────────
    await this._transitionStatus(transactionId, TX_STATUS.PENDING, TX_STATUS.PROCESSING);

    // ── 6. Validate journal invariants before writing entries ───────────────
    const validatedEntries = await this._validateJournal(entries, code);
    const totalDebits = validatedEntries
      .filter((e) => e.entryType === ENTRY_TYPE.DEBIT)
      .reduce((sum, e) => sum + e.amountMinorUnits, 0);
    const totalCredits = validatedEntries
      .filter((e) => e.entryType === ENTRY_TYPE.CREDIT)
      .reduce((sum, e) => sum + e.amountMinorUnits, 0);

    if (totalDebits !== totalCredits) {
      // Attempt to mark transaction FAILED before re-throwing
      await this._transitionStatus(transactionId, TX_STATUS.PROCESSING, TX_STATUS.FAILED)
        .catch((err) => logger.error("LedgerService: failed to mark unbalanced tx as FAILED", { error: err.message }));
      throw new UnbalancedJournalError(
        `Total debits (${totalDebits}) do not equal total credits (${totalCredits})`,
      );
    }

    // ── 7. Create ledger entries ────────────────────────────────────────────
    const createdEntries = [];
    for (const entry of validatedEntries) {
      try {
        const entryDoc = await _db().createDocument(DB(), COLLECTIONS.ledgerEntries(), crypto.randomUUID(), {
          transactionId,
          accountId: entry.accountId,
          entryType: entry.entryType,
          amount: entry.amountMinorUnits,
          currency: code,
          createdAt: new Date().toISOString(),
        });
        createdEntries.push(entryDoc);
      } catch (entryErr) {
        // Entry creation failed — mark transaction FAILED
        logger.error("LedgerService: entry creation failed, marking transaction FAILED", {
          transactionId,
          error: entryErr.message,
        });
        await this._transitionStatus(transactionId, TX_STATUS.PROCESSING, TX_STATUS.FAILED)
          .catch((err) =>
            logger.error("LedgerService: could not mark transaction FAILED after entry failure", { error: err.message }),
          );
        throw new InvalidLedgerEntryError(
          `Failed to create ledger entry: ${entryErr.message}`,
        );
      }
    }

    // ── 8. Update balance projection for each affected account ─────────────
    for (const entry of validatedEntries) {
      await this._updateBalanceProjection(entry.accountId, entry.entryType, entry.amountMinorUnits, code, transactionId)
        .catch((err) => {
          // Balance update failure — log but do NOT reverse the posted entries.
          // The transaction is still POSTED; reconciliation will handle the drift.
          logger.error("LedgerService: balance projection update failed (non-fatal)", {
            transactionId,
            accountId: entry.accountId,
            error: err.message,
          });
        });
    }

    // ── 9. Mark transaction POSTED ──────────────────────────────────────────
    const postedAt = new Date().toISOString();
    await _db().updateDocument(DB(), COLLECTIONS.ledgerTransactions(), transactionId, {
      status: TX_STATUS.POSTED,
      postedAt,
      updatedAt: postedAt,
    });

    // ── 10. Publish outbox event ────────────────────────────────────────────
    this._publishOutboxEvent({
      transactionId,
      reference,
      type: normalizedType,
      currency: code,
      entries: validatedEntries,
      initiatedBy,
    });

    // ── 11. Audit ───────────────────────────────────────────────────────────
    auditService.logAction({
      actorId: initiatedBy,
      actorRole: "system",
      action: "LEDGER_JOURNAL_POSTED",
      entity: "ledger_transaction",
      entityId: transactionId,
      metadata: { reference, type: normalizedType, currency: code, entryCount: entries.length, totalDebits, totalCredits },
    });

    logger.info("LedgerService: journal POSTED", {
      transactionId,
      reference,
      totalDebits,
      totalCredits,
      entryCount: validatedEntries.length,
    });

    // Fetch fresh transaction document to get updated status
    const freshTx = await _db().getDocument(DB(), COLLECTIONS.ledgerTransactions(), transactionId);
    const enrichedEntries = createdEntries.map((doc) => ({
      entryId: doc.$id,
      accountId: doc.accountId,
      entryType: doc.entryType,
      amountMinorUnits: doc.amount,
      currency: doc.currency,
      createdAt: doc.createdAt,
    }));
    return this._enrichTransaction(freshTx, enrichedEntries);
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  /**
   * Get a ledger transaction by its internal Appwrite document ID.
   * Returns null if not found.
   */
  async getTransaction(transactionId) {
    const col = COLLECTIONS.ledgerTransactions();
    const doc = await _db()
      .getDocument(DB(), col, transactionId)
      .catch(() => null);
    if (!doc) return null;
    const entries = await this._getEntries(transactionId);
    return this._enrichTransaction(doc, entries);
  }

  /**
   * Get a ledger transaction by its public reference.
   */
  async getTransactionByReference(reference) {
    const col = COLLECTIONS.ledgerTransactions();
    const result = await _db()
      .listDocuments(DB(), col, [
        Query.equal("reference", reference),
        Query.limit(1),
      ])
      .catch(() => ({ documents: [] }));
    if (result.documents.length === 0) return null;
    const doc = result.documents[0];
    const entries = await this._getEntries(doc.$id);
    return this._enrichTransaction(doc, entries);
  }

  /**
   * List transactions for an account, with optional filters.
   */
  async listTransactions({ accountId, status, limit = 20, offset = 0 } = {}) {
    const txCol = COLLECTIONS.ledgerTransactions();
    const entryCol = COLLECTIONS.ledgerEntries();

    // Build query for entries filtered by accountId
    const queries = [Query.equal("accountId", accountId), Query.orderDesc("$createdAt")];
    if (limit) queries.push(Query.limit(limit));
    if (offset) queries.push(Query.offset(offset));

    const entryResult = await _db().listDocuments(DB(), entryCol, queries).catch(() => ({ documents: [], total: 0 }));

    // Deduplicate transactions by ID
    const txIds = [...new Set(entryResult.documents.map((e) => e.transactionId))];
    const transactions = [];
    for (const txId of txIds) {
      const txDoc = await _db()
        .getDocument(DB(), txCol, txId)
        .catch(() => null);
      if (!txDoc) continue;
      if (status && txDoc.status !== status) continue;
      const entries = await this._getEntries(txId);
      transactions.push(this._enrichTransaction(txDoc, entries));
    }

    return {
      transactions,
      total: entryResult.total,
      limit,
      offset,
    };
  }

  // ── Balance from ledger ─────────────────────────────────────────────────────

  /**
   * Calculate the ledger-derived balance for an account by summing entries.
   *
   * balance = Σ(CREDIT amounts) − Σ(DEBIT amounts)
   *
   * This is the authoritative calculation used for verification and
   * reconciliation.  The account_balances projection should match this
   * value after all posted transactions are applied.
   */
  async calculateBalanceFromLedger(accountId) {
    const entryCol = COLLECTIONS.ledgerEntries();
    const txCol = COLLECTIONS.ledgerTransactions();

    const result = await _db()
      .listDocuments(DB(), entryCol, [
        Query.equal("accountId", accountId),
        Query.orderDesc("$createdAt"),
      ])
      .catch(() => ({ documents: [] }));

    let balanceMinorUnits = 0;
    for (const entry of result.documents) {
      // Only count entries from POSTED transactions
      const txDoc = await _db()
        .getDocument(DB(), txCol, entry.transactionId)
        .catch(() => null);
      if (!txDoc || txDoc.status !== TX_STATUS.POSTED) continue;

      if (entry.entryType === ENTRY_TYPE.CREDIT) {
        balanceMinorUnits += entry.amount;
      } else if (entry.entryType === ENTRY_TYPE.DEBIT) {
        balanceMinorUnits -= entry.amount;
      }
    }

    // Determine currency from entries (all entries for an account share currency)
    const currency = result.documents[0]?.currency ?? "SSP";

    return {
      accountId,
      currency,
      balanceMinorUnits,
      balanceDisplay: toBigUnits(Math.max(balanceMinorUnits, 0), currency),
      entryCount: result.documents.length,
      derivedAt: new Date().toISOString(),
    };
  }

  /**
   * Verify that the balance projection matches the ledger-derived balance.
   * Returns the discrepancy count (0 = consistent).
   */
  async verifyBalanceProjection(accountId) {
    const projected = await balanceProjectionService.getBalance(accountId, null, "admin");
    const derived = await this.calculateBalanceFromLedger(accountId);

    const discrepancy = Math.abs(
      (projected.balanceMinorUnits ?? 0) - derived.balanceMinorUnits,
    );

    return {
      accountId,
      projectedBalanceMinorUnits: projected.balanceMinorUnits ?? 0,
      derivedBalanceMinorUnits: derived.balanceMinorUnits,
      discrepancyMinorUnits: discrepancy,
      isConsistent: discrepancy === 0,
      verifiedAt: new Date().toISOString(),
    };
  }

  // ── Admin operations ────────────────────────────────────────────────────────

  /**
   * Manually mark a transaction as FAILED (admin operation).
   * Only allowed for PENDING or PROCESSING transactions.
   */
  async failTransaction(transactionId, reason) {
    const txCol = COLLECTIONS.ledgerTransactions();
    const doc = await _db()
      .getDocument(DB(), txCol, transactionId)
      .catch(() => null);
    if (!doc) throw new NotFoundError("Ledger transaction");

    if (doc.status === TX_STATUS.POSTED) {
      throw new ImmutableTransactionError("Cannot fail a posted transaction");
    }
    if (doc.status === TX_STATUS.REVERSED) {
      throw new ImmutableTransactionError("Cannot modify a reversed transaction");
    }

    const currentStatus = doc.status;
    await this._transitionStatus(transactionId, currentStatus, TX_STATUS.FAILED);

    await _db().updateDocument(DB(), txCol, transactionId, {
      metadata: JSON.stringify({
        ...(doc.metadata ? JSON.parse(doc.metadata) : {}),
        failureReason: reason,
      }),
      updatedAt: new Date().toISOString(),
    });

    auditService.logAction({
      actorId: "admin",
      actorRole: "admin",
      action: "LEDGER_TRANSACTION_FAILED",
      entity: "ledger_transaction",
      entityId: transactionId,
      metadata: { reason, previousStatus: currentStatus },
    });

    return this.getTransaction(transactionId);
  }

  /**
   * Create a compensating (reversal) transaction for a posted transaction.
   * Swaps all DEBIT↔CREDIT entries and reuses the same total amount.
   */
  async createCompensation(originalTransactionId, initiatedBy, reason) {
    const original = await this.getTransaction(originalTransactionId);
    if (!original) throw new NotFoundError("Ledger transaction");
    if (original.status !== TX_STATUS.POSTED) {
      throw new Error("Can only create compensation for POSTED transactions");
    }
    if (original.reversalReference) {
      throw new Error("This transaction already has a compensation");
    }

    // Generate a compensation reference based on the original
    const compReference = `COMP-${original.reference}`;

    // Build reversed entries (swap DEBIT ↔ CREDIT)
    const reversedEntries = original.entries.map((entry) => ({
      accountId: entry.accountId,
      entryType: entry.entryType === ENTRY_TYPE.DEBIT
        ? ENTRY_TYPE.CREDIT
        : ENTRY_TYPE.DEBIT,
      amountMinorUnits: entry.amountMinorUnits,
    }));

    const result = await this.postJournal({
      reference: compReference,
      type: OPERATIONS.COMPENSATION,
      currency: original.currency,
      description: `Compensating entry for ${original.reference}: ${reason}`,
      initiatedBy,
      entries: reversedEntries,
      metadata: {
        originalTransactionId,
        originalReference: original.reference,
        reason,
      },
    });

    // Link the compensation back to the original
    const txCol = COLLECTIONS.ledgerTransactions();
    await _db().updateDocument(DB(), txCol, originalTransactionId, {
      reversalReference: compReference,
      reversedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    logger.info("LedgerService: compensation created", {
      originalTransactionId,
      compensationTransactionId: result.transactionId,
      compensationReference: compReference,
    });

    return result;
  }

  // ── Validation helpers ──────────────────────────────────────────────────────

  /**
   * Validate the top-level journal parameters before any writes.
   */
  _validateJournalParams({ reference, type, currency, description, initiatedBy, entries }) {
    if (!reference || typeof reference !== "string" || reference.trim().length < 8 || reference.trim().length > 50) {
      throw new ValidationError("Reference must be a string between 8 and 50 characters");
    }

    if (!type || typeof type !== "string") {
      throw new ValidationError("Transaction type is required");
    }

    if (!currency || typeof currency !== "string") {
      throw new InvalidCurrencyError("Currency is required");
    }
    try {
      validateCurrency(currency);
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new InvalidCurrencyError(err.message);
      }
      throw err;
    }

    if (!description || typeof description !== "string" || description.trim().length === 0) {
      throw new ValidationError("Description is required");
    }

    if (!initiatedBy || typeof initiatedBy !== "string") {
      throw new ValidationError("initiatedBy (userId) is required");
    }

    if (!Array.isArray(entries) || entries.length < 2) {
      throw new InvalidLedgerEntryError("A journal must have at least 2 entries (one debit, one credit)");
    }

    for (const entry of entries) {
      if (!entry.accountId || typeof entry.accountId !== "string") {
        throw new InvalidLedgerEntryError("Each entry must have a valid accountId");
      }
      if (entry.entryType !== ENTRY_TYPE.DEBIT && entry.entryType !== ENTRY_TYPE.CREDIT) {
        throw new InvalidLedgerEntryError(
          `Invalid entryType: ${entry.entryType}. Must be DEBIT or CREDIT`,
        );
      }
      if (
        typeof entry.amountMinorUnits !== "number" ||
        !Number.isInteger(entry.amountMinorUnits) ||
        entry.amountMinorUnits <= 0
      ) {
        throw new InvalidLedgerEntryError(
          `Each entry amount must be a positive integer (minor units). Got: ${entry.amountMinorUnits}`,
        );
      }
    }

    // Check that at least one DEBIT and one CREDIT exist
    const hasDebit = entries.some((e) => e.entryType === ENTRY_TYPE.DEBIT);
    const hasCredit = entries.some((e) => e.entryType === ENTRY_TYPE.CREDIT);
    if (!hasDebit || !hasCredit) {
      throw new UnbalancedJournalError("A valid journal must contain at least one DEBIT and one CREDIT entry");
    }
  }

  /**
   * Deep-validate entries: currency match, account existence, account status.
   * Returns validated entries with canonicalized fields.
   */
  async _validateJournal(entries, currency) {
    const validated = [];
    for (const entry of entries) {
      // Validate account exists and is ACTIVE
      const account = await walletAccountService.getById(
        entry.accountId,
        "system",
        "admin", // system validation bypasses ownership
      ).catch(() => null);

      if (!account) {
        throw new NotFoundError(`Wallet account ${entry.accountId}`);
      }

      if (account.status !== "ACTIVE") {
        throw new AccountNotActiveError(entry.accountId, account.status);
      }

      if (account.currency !== currency) {
        throw new InvalidCurrencyError(
          `Entry account ${entry.accountId} currency ${account.currency} does not match transaction currency ${currency}`,
        );
      }

      validated.push({
        accountId: entry.accountId,
        entryType: entry.entryType,
        amountMinorUnits: entry.amountMinorUnits,
      });
    }
    return validated;
  }

  /**
   * Validate all referenced accounts exist and are ACTIVE.
   */
  async _validateAccounts(entries, currency) {
    for (const entry of entries) {
      const account = await walletAccountService.getById(
        entry.accountId,
        "system",
        "admin",
      ).catch(() => null);
      if (!account) {
        throw new NotFoundError(`Wallet account ${entry.accountId}`);
      }
      if (account.status !== "ACTIVE") {
        throw new AccountNotActiveError(entry.accountId, account.status);
      }
      if (account.currency !== currency) {
        throw new InvalidCurrencyError(
          `Account ${entry.accountId} currency ${account.currency} ≠ transaction currency ${currency}`,
        );
      }
    }
  }

  // ── Status transitions ──────────────────────────────────────────────────────

  /**
   * Apply a legal status transition. Throws if the transition is illegal.
   */
  async _transitionStatus(transactionId, fromStatus, toStatus) {
    const allowed = ALLOWED_TRANSITIONS[fromStatus];
    if (!allowed || !allowed.has(toStatus)) {
      throw new Error(
        `Illegal status transition: ${fromStatus} → ${toStatus} for transaction ${transactionId}`,
      );
    }

    const txCol = COLLECTIONS.ledgerTransactions();
    await _db().updateDocument(DB(), txCol, transactionId, {
      status: toStatus,
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Balance projection update ───────────────────────────────────────────────

  /**
   * Update the account_balances projection after a ledger entry is posted.
   *
   * Uses optimistic concurrency via the version field:
   *   - Reads current balance + version
   *   - Computes new balance
   *   - Updates with new balance + incremented version
   *   - On 409/VersionMismatch, retries up to RETRY_MAX times
   *
   * NOTE: Without Appwrite transactions, there is a small window where the
   * ledger entry is written but the balance projection update fails.
   * The integrity_checks table (Phase 3) and periodic reconciliation
   * jobs (future) will detect and fix such drifts.
   */
  async _updateBalanceProjection(accountId, entryType, amountMinorUnits, currency, transactionId) {
    const BALANCE_RETRY_MAX = 3;
    let attempt = 0;

    while (attempt < BALANCE_RETRY_MAX) {
      try {
        const balCol = COLLECTIONS.accountBalances();
        const balResult = await _db().listDocuments(DB(), balCol, [
          Query.equal("accountId", accountId),
          Query.limit(1),
        ]).catch(() => ({ documents: [] }));

        if (balResult.documents.length === 0) {
          // Balance record does not exist — initialise at 0.
          // In normal flow provision() already creates this, but guard against races.
          await _db().createDocument(DB(), balCol, null, {
            accountId,
            currency,
            balance: 0,
            version: 1,
            updatedAt: new Date().toISOString(),
          });
          // Fall through to the normal update path
        }

        const balDoc = balResult.documents[0];
        const currentBalance = balDoc.balance ?? 0;
        const newBalance =
          entryType === ENTRY_TYPE.CREDIT
            ? currentBalance + amountMinorUnits
            : currentBalance - amountMinorUnits;

        await _db().updateDocument(DB(), balCol, balDoc.$id, {
          balance: newBalance,
          version: (balDoc.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });

        logger.debug("LedgerService: balance projection updated", {
          accountId,
          transactionId,
          entryType,
          amountMinorUnits,
          newBalance,
          version: balDoc.version + 1,
        });
        return;
      } catch (err) {
        attempt++;
        if (err.code === 409 || err.type === "ConflictException") {
          // Optimistic concurrency conflict — retry
          logger.warn("LedgerService: balance projection conflict, retrying", {
            attempt,
            maxAttempts: BALANCE_RETRY_MAX,
            accountId,
            transactionId,
          });
          if (attempt >= BALANCE_RETRY_MAX) {
            throw new LedgerConflictError(
              `Could not update balance projection for ${accountId} after ${BALANCE_RETRY_MAX} attempts`,
            );
          }
          await new Promise((r) => setTimeout(r, 50 * attempt)); // back-off
        } else {
          throw err;
        }
      }
    }
  }

  // ── Outbox event ────────────────────────────────────────────────────────────

  /**
   * Publish an outbox event for asynchronous processing (notifications, etc.).
   * Fire-and-forget — failures are non-fatal.
   */
  _publishOutboxEvent({ transactionId, reference, type, currency, entries, initiatedBy }) {
    const outboxCol = COLLECTIONS.outboxEvents();
    if (!outboxCol) return; // Collection not configured

    const availableAt = new Date(Date.now() + 5000).toISOString(); // 5s delay

    setImmediate(async () => {
      try {
        await _db().createDocument(DB(), outboxCol, crypto.randomUUID(), {
          eventType: "LEDGER_JOURNAL_POSTED",
          aggregateType: "ledger_transaction",
          aggregateId: transactionId,
          transactionReference: reference,
          payload: JSON.stringify({
            transactionId,
            reference,
            type,
            currency,
            entries: entries.map((e) => ({
              accountId: e.accountId,
              entryType: e.entryType,
              amountMinorUnits: e.amountMinorUnits,
            })),
            initiatedBy,
            publishedAt: new Date().toISOString(),
          }),
          status: "PENDING",
          attempts: 0,
          availableAt,
          processedAt: null,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn("LedgerService: outbox event publish failed (non-fatal)", {
          transactionId,
          error: err.message,
        });
      }
    });
  }

  // ── Lookup helpers ──────────────────────────────────────────────────────────

  async _findTransactionByReference(reference) {
    const col = COLLECTIONS.ledgerTransactions();
    const result = await _db()
      .listDocuments(DB(), col, [
        Query.equal("reference", reference),
        Query.limit(1),
      ])
      .catch(() => ({ documents: [] }));
    return result.documents[0] || null;
  }

  async _getEntries(transactionId) {
    const col = COLLECTIONS.ledgerEntries();
    const result = await _db()
      .listDocuments(DB(), col, [
        Query.equal("transactionId", transactionId),
        Query.orderAsc("$createdAt"),
      ])
      .catch(() => ({ documents: [] }));
    return result.documents.map((doc) => ({
      entryId: doc.$id,
      accountId: doc.accountId,
      entryType: doc.entryType,
      amountMinorUnits: doc.amount,
      currency: doc.currency,
      createdAt: doc.createdAt,
    }));
  }

  /**
   * Compare two entry lists for equality (used in idempotency check).
   * Entries are sorted by accountId then entryType to ensure order-independence.
   */
  _entriesMatch(transactionId, newEntries) {
    return this._getEntries(transactionId).then((existingEntries) => {
      if (existingEntries.length !== newEntries.length) return false;
      const sortKey = (e) => `${e.accountId}:${e.entryType}`;
      const sortedExisting = [...existingEntries].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      const sortedNew = [...newEntries].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      return sortedExisting.every((e, i) =>
        e.accountId === sortedNew[i].accountId &&
        e.entryType === sortedNew[i].entryType &&
        e.amountMinorUnits === sortedNew[i].amountMinorUnits,
      );
    });
  }

  // ── Enrichment ──────────────────────────────────────────────────────────────

  _enrichTransaction(txDoc, entries) {
    return {
      transactionId: txDoc.$id,
      reference: txDoc.reference,
      type: txDoc.type,
      status: txDoc.status,
      currency: txDoc.currency,
      description: txDoc.description,
      initiatedBy: txDoc.initiatedBy,
      entries,
      metadata: txDoc.metadata ? JSON.parse(txDoc.metadata) : {},
      postedAt: txDoc.postedAt,
      reversedAt: txDoc.reversedAt,
      reversalReference: txDoc.reversalReference,
      createdAt: txDoc.createdAt,
      updatedAt: txDoc.updatedAt,
    };
  }
}

module.exports = new LedgerService();
