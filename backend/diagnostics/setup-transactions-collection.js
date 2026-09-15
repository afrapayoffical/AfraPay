/**
 * Transactions Collection Setup Script
 *
 * Ensures all required attributes and indexes exist for the
 * APPWRITE_TRANSACTIONS_COLLECTION_ID collection.
 *
 * Safe to run multiple times — 409 (already exists) responses are silently
 * skipped, so this script is fully idempotent.
 *
 * Run with:  node diagnostics/setup-transactions-collection.js
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
const collectionId = process.env.APPWRITE_TRANSACTIONS_COLLECTION_ID;

if (!databaseId || !collectionId) {
  console.error(
    "❌  Missing required env vars: APPWRITE_DATABASE_ID and/or APPWRITE_TRANSACTIONS_COLLECTION_ID",
  );
  process.exit(1);
}

console.log("🔧  Transactions collection ID:", collectionId);
console.log("🗄️   Database ID              :", databaseId);
console.log("");

// ─── helpers ────────────────────────────────────────────────────────────────

async function createString(key, size, required, defaultValue, array = false) {
  try {
    await databases.createStringAttribute(
      databaseId,
      collectionId,
      key,
      size,
      required,
      defaultValue,
      array,
    );
    console.log(`  ✅  string  ${key}`);
  } catch (e) {
    if (e.code === 409) {
      console.log(`  ⏭️   string  ${key} (already exists)`);
    } else {
      console.error(`  ❌  string  ${key} — ${e.message}`);
    }
  }
}

async function createFloat(key, required, min, max, defaultValue) {
  try {
    await databases.createFloatAttribute(
      databaseId,
      collectionId,
      key,
      required,
      min,
      max,
      defaultValue,
    );
    console.log(`  ✅  float   ${key}`);
  } catch (e) {
    if (e.code === 409) {
      console.log(`  ⏭️   float   ${key} (already exists)`);
    } else {
      console.error(`  ❌  float   ${key} — ${e.message}`);
    }
  }
}

async function createIndex(key, type, attributes, orders = []) {
  try {
    await databases.createIndex(
      databaseId,
      collectionId,
      key,
      type,
      attributes,
      orders,
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

// ─── attribute definitions ──────────────────────────────────────────────────

async function setupAttributes() {
  console.log("📋  Creating attributes...\n");

  // Sender
  await createString("senderId", 36, true, null);

  // Receiver info
  await createString("receiverPhone", 20, false, null);
  await createString("receiverProvider", 50, true, null);
  await createString("receiverAccountNumber", 50, false, null);
  await createString("receiverBankCode", 20, false, null);
  await createString("receiverAccountName", 200, false, null);

  // Transfer details
  await createFloat("amount", true, 0, 10000000, null);
  await createString("currency", 10, true, null);
  await createString("description", 500, false, null);

  // Status & type
  await createString("status", 20, false, "pending");
  // status values: pending | processing | completed | failed
  await createString("type", 30, false, "send_money");
  // type values: send_money | wallet_transfer | etc.

  // Provider reference (returned by payment gateway)
  await createString("providerReference", 200, false, null);

  // Timestamps (stored as ISO 8601 strings)
  await createString("createdAt", 30, true, null);
  await createString("updatedAt", 30, true, null);

  // Metadata
  await createString("ipAddress", 45, false, null);
  await createString("idempotencyKey", 64, true, null);

  // Optional failure reason
  await createString("failureReason", 500, false, null);
}

// ─── indexes ─────────────────────────────────────────────────────────────────

async function setupIndexes() {
  console.log("\n📑  Creating indexes...\n");

  // Single-attribute indexes to stay within MySQL's 767-byte key limit.
  // Appwrite can combine them at query time (multi-attribute filtering).

  // Required for getRecentTransfers: Query.equal("senderId", userId)
  await createIndex("idx_senderId", "key", ["senderId"]);

  // Required for Query.equal("type", ...)
  await createIndex("idx_type", "key", ["type"]);

  // Required for Query.orderDesc("createdAt")
  await createIndex("idx_createdAt", "key", ["createdAt"]);

  // Idempotency unique lookup
  await createIndex("idx_idempotencyKey", "unique", ["idempotencyKey"]);

  // Provider reference lookup (for webhook callbacks)
  await createIndex("idx_provider_ref", "key", ["providerReference"]);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await setupAttributes();

    // Appwrite requires a short pause between attribute creation and index creation
    console.log("\n⏳  Waiting 4 s for attributes to propagate...");
    await new Promise((r) => setTimeout(r, 4000));

    await setupIndexes();

    console.log("\n✅  Transactions collection setup complete.\n");
    console.log(
      "👉  Make sure APPWRITE_TRANSACTIONS_COLLECTION_ID is set in your .env file.",
    );
  } catch (err) {
    console.error("Fatal error during setup:", err);
    process.exit(1);
  }
}

main();
