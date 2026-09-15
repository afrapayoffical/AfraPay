/**
 * Financial Tables Setup Script
 *
 * Adds the required attributes to existing financial collections.
 * Safe to run multiple times — 409 (already exists) responses are silently
 * skipped, so this script is fully idempotent.
 *
 * Run with:  node diagnostics/setup-financial-tables.js
 */

"use strict";

const { Client, Databases } = require("node-appwrite");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

const databaseId = process.env.APPWRITE_DATABASE_ID;

if (!databaseId || !process.env.APPWRITE_ENDPOINT || !process.env.APPWRITE_PROJECT_ID || !process.env.APPWRITE_API_KEY) {
  console.error(
    "❌  Missing required env vars: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, and/or APPWRITE_DATABASE_ID",
  );
  process.exit(1);
}

const collectionIds = {
  walletAccounts: process.env.APPWRITE_WALLET_ACCOUNTS_COLLECTION_ID || "wallet_accounts",
  accountBalances: process.env.APPWRITE_ACCOUNT_BALANCES_COLLECTION_ID || "account_balances",
  ledgerTransactions: process.env.APPWRITE_LEDGER_TRANSACTIONS_COLLECTION_ID || "ledger_transactions",
  ledgerEntries: process.env.APPWRITE_LEDGER_ENTRIES_COLLECTION_ID || "ledger_entries",
  idempotencyRecords: process.env.APPWRITE_IDEMPOTENCY_RECORDS_COLLECTION_ID || "idempotency_records",
  auditLogs: process.env.APPWRITE_AUDIT_LOGS_COLLECTION_ID || process.env.APPWRITE_AUDIT_LOGS_COLLECTION || "audit_logs",
  outboxEvents: process.env.APPWRITE_OUTBOX_EVENTS_COLLECTION_ID || "outbox_events",
  integrityChecks: process.env.APPWRITE_INTEGRITY_CHECKS_COLLECTION_ID || "integrity_checks",
};

const duplicateCollectionIds = Object.entries(collectionIds).reduce((duplicates, [name, id], index, entries) => {
  const matchingNames = entries
    .slice(0, index)
    .filter(([, existingId]) => existingId === id)
    .map(([existingName]) => existingName);

  if (matchingNames.length > 0) {
    duplicates.push(`${name}=${id} duplicates ${matchingNames.join(", ")}`);
  }

  return duplicates;
}, []);

if (duplicateCollectionIds.length > 0) {
  console.error("❌  Duplicate collection IDs detected:");
  duplicateCollectionIds.forEach((duplicate) => console.error(`  - ${duplicate}`));
  console.error("   Update backend/.env so each financial collection uses its own Appwrite collection ID.");
  process.exit(1);
}

// Define the existing collections we want to update
const TABLES = [
  {
    id: collectionIds.walletAccounts,
    name: "Wallet Accounts",
    attributes: [
      { key: "userId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "accountType", type: "string", size: 20, required: true, defaultValue: null },
      { key: "currency", type: "string", size: 10, required: true, defaultValue: null },
      { key: "status", type: "string", size: 20, required: true, defaultValue: null }, // ACTIVE, FROZEN, SUSPENDED, CLOSED
    ],
    indexes: [
      { key: "idx_userId", type: "key", attributes: ["userId"] },
      { key: "idx_status", type: "key", attributes: ["status"] },
      { key: "idx_currency", type: "key", attributes: ["currency"] },
      { key: "idx_userId_currency", type: "key", attributes: ["userId", "currency"] },
    ]
  },
  {
    id: collectionIds.accountBalances,
    name: "Account Balances",
    attributes: [
      { key: "accountId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "currency", type: "string", size: 10, required: true, defaultValue: null },
      { key: "balance", type: "integer", required: true, defaultValue: 0 }, // minor units
      { key: "version", type: "integer", required: true, defaultValue: 1 }, // for optimistic concurrency
    ],
    indexes: [
      { key: "idx_accountId", type: "key", attributes: ["accountId"] },
      { key: "idx_accountId_currency", type: "key", attributes: ["accountId", "currency"] },
    ]
  },
  {
    id: collectionIds.ledgerTransactions,
    name: "Ledger Transactions",
    attributes: [
      { key: "reference", type: "string", size: 50, required: true, defaultValue: null },
      { key: "type", type: "string", size: 30, required: true, defaultValue: null }, // wallet_transfer, deposit, withdrawal, payment, etc.
      { key: "status", type: "string", size: 20, required: true, defaultValue: null }, // PENDING, PROCESSING, POSTED, FAILED, REVERSED
      { key: "currency", type: "string", size: 10, required: true, defaultValue: null },
      { key: "description", type: "string", size: 500, required: true, defaultValue: null },
      { key: "initiatedBy", type: "string", size: 36, required: true, defaultValue: null },
      { key: "postedAt", type: "string", size: 30, required: false, defaultValue: null },
      { key: "reversedAt", type: "string", size: 30, required: false, defaultValue: null },
      { key: "reversalReference", type: "string", size: 50, required: false, defaultValue: null },
      { key: "metadata", type: "string", size: 2000, required: false, defaultValue: null }, // JSON string
    ],
    indexes: [
      { key: "idx_reference", type: "key", attributes: ["reference"] },
      { key: "idx_status", type: "key", attributes: ["status"] },
      { key: "idx_createdAt", type: "key", attributes: ["$createdAt"] },
      { key: "idx_initiatedBy", type: "key", attributes: ["initiatedBy"] },
    ]
  },
  {
    id: collectionIds.ledgerEntries,
    name: "Ledger Entries",
    attributes: [
      { key: "transactionId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "accountId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "entryType", type: "string", size: 10, required: true, defaultValue: null }, // DEBIT or CREDIT
      { key: "amount", type: "integer", required: true, defaultValue: 0 }, // minor units, positive
      { key: "currency", type: "string", size: 10, required: true, defaultValue: null },
    ],
    indexes: [
      { key: "idx_transactionId", type: "key", attributes: ["transactionId"] },
      { key: "idx_accountId", type: "key", attributes: ["accountId"] },
      { key: "idx_createdAt", type: "key", attributes: ["$createdAt"] },
      { key: "idx_transactionId_accountId", type: "key", attributes: ["transactionId", "accountId"] },
    ]
  },
  {
    id: collectionIds.idempotencyRecords,
    name: "Idempotency Records",
    attributes: [
      { key: "actorId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "operation", type: "string", size: 50, required: true, defaultValue: null },
      { key: "idempotencyKey", type: "string", size: 64, required: true, defaultValue: null },
      { key: "requestHash", type: "string", size: 64, required: true, defaultValue: null }, // hash of request payload
      { key: "transactionReference", type: "string", size: 50, required: false, defaultValue: null },
      { key: "status", type: "string", size: 20, required: true, defaultValue: null }, // PENDING, SUCCESS, FAILED
      { key: "expiresAt", type: "string", size: 30, required: true, defaultValue: null },
      { key: "completedAt", type: "string", size: 30, required: false, defaultValue: null },
    ],
    indexes: [
      { key: "idx_actor_operation_key", type: "unique", attributes: ["actorId", "operation", "idempotencyKey"] },
      { key: "idx_expiresAt", type: "key", attributes: ["$expiresAt"] },
      { key: "idx_status", type: "key", attributes: ["$status"] },
    ]
  },
  {
    id: collectionIds.auditLogs,
    name: "Audit Logs",
    attributes: [
      { key: "actorId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "action", type: "string", size: 50, required: true, defaultValue: null },
      { key: "entityType", type: "string", size: 50, required: true, defaultValue: null },
      { key: "entityId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "transactionReference", type: "string", size: 50, required: false, defaultValue: null },
      { key: "result", type: "string", size: 20, required: true, defaultValue: null }, // SUCCESS, FAILED
      { key: "requestId", type: "string", size: 100, required: true, defaultValue: null }, // HTTP request ID for tracing
      { key: "timestamp", type: "string", size: 30, required: true, defaultValue: null },
      { key: "metadata", type: "string", size: 2000, required: false, defaultValue: null }, // JSON string
    ],
    indexes: [
      { key: "idx_actorId", type: "key", attributes: ["actorId"] },
      { key: "idx_entityType_entityId", type: "key", attributes: ["entityType", "entityId"] },
      { key: "idx_transactionReference", type: "key", attributes: ["transactionReference"] },
      { key: "idx_timestamp", type: "key", attributes: ["timestamp"] },
      { key: "idx_action", type: "key", attributes: ["action"] },
    ]
  },
  {
    id: collectionIds.outboxEvents,
    name: "Outbox Events",
    attributes: [
      { key: "eventType", type: "string", size: 50, required: true, defaultValue: null },
      { key: "aggregateType", type: "string", size: 50, required: true, defaultValue: null },
      { key: "aggregateId", type: "string", size: 36, required: true, defaultValue: null },
      { key: "transactionReference", type: "string", size: 50, required: false, defaultValue: null },
      { key: "payload", type: "string", size: 2000, required: true, defaultValue: null }, // JSON string
      { key: "status", type: "string", size: 20, required: true, defaultValue: null }, // PENDING, PROCESSING, PUBLISHED, FAILED
      { key: "attempts", type: "integer", required: true, defaultValue: 0 },
      { key: "availableAt", type: "string", size: 30, required: true, defaultValue: null },
      { key: "processedAt", type: "string", size: 30, required: false, defaultValue: null },
    ],
    indexes: [
      { key: "idx_status", type: "key", attributes: ["status"] },
      { key: "idx_availableAt", type: "key", attributes: ["availableAt"] },
      { key: "idx_aggregateType_aggregateId", type: "key", attributes: ["aggregateType", "aggregateId"] },
      { key: "idx_transactionReference", type: "key", attributes: ["transactionReference"] },
    ]
  },
  {
    id: collectionIds.integrityChecks,
    name: "Integrity Checks",
    attributes: [
      { key: "checkType", type: "string", size: 50, required: true, defaultValue: null },
      { key: "status", type: "string", size: 20, required: true, defaultValue: null }, // PENDING, COMPLETED, FAILED
      { key: "startedAt", type: "string", size: 30, required: true, defaultValue: null },
      { key: "completedAt", type: "string", size: 30, required: false, defaultValue: null },
      { key: "discrepancyCount", type: "integer", required: true, defaultValue: 0 },
      { key: "detailsReference", type: "string", size: 100, required: false, defaultValue: null },
    ],
    indexes: [
      { key: "idx_status", type: "key", attributes: ["status"] },
      { key: "idx_checkType", type: "key", attributes: ["checkType"] },
      { key: "idx_createdAt", type: "key", attributes: ["$createdAt"] },
    ]
  },
];

async function createStringAttribute(collectionId, key, size, required, defaultValue, array = false) {
  try {
    await databases.createStringAttribute(
      databaseId,
      collectionId,
      key,
      size,
      required,
      defaultValue,
      array
    );
    console.log(`  ✅  string  ${key}`);
  } catch (e) {
    if (e.code === 409) {
      console.log(`  ⏭️   string  ${key} (already exists)`);
    } else {
      console.error(`  ❌  string  ${key} — ${e.message}`);
      throw e;
    }
  }
}

async function createIntegerAttribute(collectionId, key, required, defaultValue) {
  try {
    // Note: Appwrite integer attribute doesn't have min/max in the SDK we're using?
    // We'll use the method without min/max if the existing one doesn't have it.
    // Looking at the existing setup-transactions-collection.js, they use createFloat for amount.
    // We'll create a similar function for integer.
    await databases.createIntegerAttribute(
      databaseId,
      collectionId,
      key,
      required,
      defaultValue
    );
    console.log(`  ✅  integer ${key}`);
  } catch (e) {
    if (e.code === 409) {
      console.log(`  ⏭️   integer ${key} (already exists)`);
    } else {
      console.error(`  ❌  integer ${key} — ${e.message}`);
      throw e;
    }
  }
}

async function createIndex(collectionId, key, type, attributes, orders = []) {
  try {
    await databases.createIndex(
      databaseId,
      collectionId,
      key,
      type,
      attributes,
      orders
    );
    console.log(`  ✅  index   ${key}`);
  } catch (e) {
    if (e.code === 409) {
      console.log(`  ⏭️   index   ${key} (already exists)`);
    } else {
      console.error(`  ❌  index   ${key} — ${e.message}`);
    }
  }
}

async function setupTable(table) {
  console.log(`🔧  Setting up collection: ${table.id}`);

  console.log(`  📋  Creating attributes...`);
  for (const attr of table.attributes) {
    if (attr.type === "string") {
      await createStringAttribute(table.id, attr.key, attr.size, attr.required, attr.defaultValue, attr.array || false);
    } else if (attr.type === "integer") {
      await createIntegerAttribute(table.id, attr.key, attr.required, attr.defaultValue);
    }
    // Add other types if needed (float, boolean, etc.) but we don't have any in this setup
  }

  console.log(`  ✅  Collection ${table.id} attributes setup complete.\n`);
}

async function main() {
  console.log("🚀  Starting financial tables setup...\n");
  console.log(`🗄️   Database ID: ${databaseId}\n`);

  for (const table of TABLES) {
    await setupTable(table);
  }

  console.log("🎉  All financial collection attributes setup complete.");
}

main().catch((err) => {
  console.error("❌  Fatal error during setup:", err);
  process.exit(1);
});