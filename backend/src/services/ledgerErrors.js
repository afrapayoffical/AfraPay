/**
 * Ledger Errors — typed errors for double-entry accounting operations.
 *
 * These extend the existing APIError hierarchy so the central errorHandler
 * middleware can render them with appropriate HTTP status codes.
 */

"use strict";

const { APIError } = require("../middleware/monitoring/errorHandler");

// ── Ledger-specific error classes ─────────────────────────────────────────────

class InvalidLedgerEntryError extends APIError {
  constructor(message, details = []) {
    super(message, 400, "INVALID_LEDGER_ENTRY", details);
    this.name = "InvalidLedgerEntryError";
  }
}

class UnbalancedJournalError extends APIError {
  constructor(message = "Journal is unbalanced — debits do not equal credits") {
    super(message, 400, "UNBALANCED_JOURNAL");
    this.name = "UnbalancedJournalError";
  }
}

class InvalidCurrencyError extends APIError {
  constructor(message) {
    super(message, 400, "INVALID_CURRENCY");
    this.name = "InvalidCurrencyError";
  }
}

class DuplicateTransactionReferenceError extends APIError {
  constructor(message = "Transaction reference already exists") {
    super(message, 409, "DUPLICATE_TRANSACTION_REFERENCE");
    this.name = "DuplicateTransactionReferenceError";
  }
}

class ImmutableTransactionError extends APIError {
  constructor(message = "Posted transaction is immutable") {
    super(message, 409, "IMMUTABLE_TRANSACTION");
    this.name = "ImmutableTransactionError";
  }
}

class LedgerConflictError extends APIError {
  constructor(
    message = "A concurrent financial operation modified the expected state",
  ) {
    super(message, 409, "LEDGER_CONFLICT");
    this.name = "LedgerConflictError";
  }
}

class AccountNotActiveError extends APIError {
  constructor(accountId, status) {
    super(
      `Account ${accountId} is ${status.toUpperCase()} — financial operations are blocked`,
      403,
      "ACCOUNT_NOT_ACTIVE",
      [{ field: "accountId", message: `Account is ${status.toUpperCase()}` }],
    );
    this.name = "AccountNotActiveError";
  }
}

module.exports = {
  InvalidLedgerEntryError,
  UnbalancedJournalError,
  InvalidCurrencyError,
  DuplicateTransactionReferenceError,
  ImmutableTransactionError,
  LedgerConflictError,
  AccountNotActiveError,
};
