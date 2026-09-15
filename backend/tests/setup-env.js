/**
 * Jest setup file — must run BEFORE any application modules load.
 * This sets all required environment variables so environment.js validates.
 */
"use strict";

process.env.NODE_ENV = "development";
process.env.ENCRYPTION_KEY = "test-encryption-key-1234567890ab";
process.env.JWT_SECRET = "test-jwt-secret-minimum-32-chars-long";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-minimum-32-char";
process.env.COOKIE_SECRET = "test-cookie-secret-minimum-32-chars-long";
process.env.APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
process.env.APPWRITE_PROJECT_ID = "6972090b003512312836";
process.env.APPWRITE_API_KEY = "test-key";
process.env.APPWRITE_DATABASE_ID = "test-db";
process.env.APPWRITE_USER_COLLECTION_ID = "users";
process.env.APPWRITE_TRANSACTIONS_COLLECTION_ID = "tx";
process.env.APPWRITE_PAYMENTS_COLLECTION_ID = "payments";
process.env.APPWRITE_WALLETS_COLLECTION_ID = "wallets";
process.env.APPWRITE_MERCHANT_WALLETS_COLLECTION_ID = "merchant_wallets";
process.env.APPWRITE_DISPUTES_COLLECTION_ID = "disputes";
process.env.APPWRITE_WALLET_ACCOUNTS_COLLECTION_ID = "wallet_accounts";
process.env.APPWRITE_ACCOUNT_BALANCES_COLLECTION_ID = "account_balances";
process.env.APPWRITE_LEDGER_TRANSACTIONS_COLLECTION_ID = "ledger_transactions";
process.env.APPWRITE_LEDGER_ENTRIES_COLLECTION_ID = "ledger_entries";
process.env.APPWRITE_IDEMPOTENCY_RECORDS_COLLECTION_ID = "idempotency_records";
process.env.APPWRITE_AUDIT_LOGS_COLLECTION_ID = "audit_logs";
process.env.APPWRITE_OUTBOX_EVENTS_COLLECTION_ID = "outbox_events";
process.env.APPWRITE_INTEGRITY_CHECKS_COLLECTION_ID = "integrity_checks";
