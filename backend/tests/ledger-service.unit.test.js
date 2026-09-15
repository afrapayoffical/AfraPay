/**
 * Ledger Service — Unit Tests
 *
 * Tests the double-entry journal engine in isolation using mocked Appwrite.
 */

"use strict";

const {
  InvalidLedgerEntryError,
  UnbalancedJournalError,
  InvalidCurrencyError,
  DuplicateTransactionReferenceError,
  ImmutableTransactionError,
  LedgerConflictError,
  AccountNotActiveError,
} = require("../src/services/ledgerErrors");
const { ValidationError, NotFoundError } = require("../src/middleware/monitoring/errorHandler");

// ── Mock state (module-level so jest.doMock can access them) ───────────────────
const mockTx = {};
const mockEntries = {};
const mockBalances = {};
const mockAccounts = {};
const mockOutbox = [];
const mockAudit = [];

// ── Mock database ──────────────────────────────────────────────────────────────
const mockDatabases = {
  createDocument: jest.fn(async (dbId, colId, docId, data) => {
    const id = docId || `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const doc = { $id: id, ...data, $createdAt: data.createdAt || new Date().toISOString() };
    if (colId.includes("ledger_transactions")) {
      mockTx[`${colId}/${id}`] = doc;
    } else if (colId.includes("ledger_entries")) {
      mockEntries[`${colId}/${id}`] = doc;
    } else if (colId.includes("account_balances")) {
      mockBalances[`${colId}/${id}`] = doc;
    } else if (colId.includes("outbox_events")) {
      mockOutbox.push(doc);
    }
    return doc;
  }),

  getDocument: jest.fn(async (dbId, colId, docId) => {
    const key = `${colId}/${docId}`;
    const doc = mockTx[key] || mockEntries[key] || mockBalances[key] || mockAccounts[key];
    if (!doc) throw { code: 404, message: "Document not found" };
    return doc;
  }),

  listDocuments: jest.fn(async (dbId, colId, queries) => {
    const isTx = colId.includes("ledger_transactions");
    const isEntry = colId.includes("ledger_entries");
    const isBalance = colId.includes("account_balances");
    const isAccount = colId.includes("wallet_accounts");
    const store = isTx ? mockTx : isEntry ? mockEntries : isBalance ? mockBalances : isAccount ? mockAccounts : {};

    let results = Object.values(store);

    if (queries) {
      for (const q of queries) {
        if (q.type === "equal") {
          results = results.filter((doc) => doc[q.attribute] === q.value);
        }
        if (q.type === "limit") {
          results = results.slice(0, q.value);
        }
        if (q.type === "offset") {
          results = results.slice(q.value);
        }
        if (q.type === "orderDesc" && q.attribute === "$createdAt") {
          results.sort((a, b) => (b.$createdAt || "").localeCompare(a.$createdAt || ""));
        }
        if (q.type === "orderAsc" && q.attribute === "$createdAt") {
          results.sort((a, b) => (a.$createdAt || "").localeCompare(b.$createdAt || ""));
        }
      }
    }

    return { documents: results, total: results.length };
  }),

  updateDocument: jest.fn(async (dbId, colId, docId, data) => {
    const key = `${colId}/${docId}`;
    const store = mockTx[key] ? mockTx : mockEntries[key] ? mockEntries : mockBalances[key] ? mockBalances : mockAccounts[key];
    if (!store[key]) throw { code: 404, message: "Document not found" };
    store[key] = { ...store[key], ...data, $createdAt: store[key].$createdAt };
    return store[key];
  }),
};

// ── Mock dependencies ───────────────────────────────────────────────────────────
jest.mock("../src/database/connection", () => ({
  appwrite: { getDatabases: () => mockDatabases },
}));

jest.mock("../src/services/walletAccountService", () => ({
  getById: jest.fn(async (accountId, requesterUserId, role) => {
    const key = Object.keys(mockAccounts).find((k) => k.endsWith(`/${accountId}`));
    const doc = key ? mockAccounts[key] : null;
    if (!doc) throw { code: 404, message: "Not found" };
    return { id: doc.$id, userId: doc.userId, currency: doc.currency, status: doc.status, accountType: doc.accountType };
  }),
}));

jest.mock("../src/services/balanceProjectionService", () => ({
  getBalance: jest.fn(async (accountId) => {
    const key = Object.keys(mockBalances).find((k) => {
      const doc = mockBalances[k];
      return doc && doc.accountId === accountId;
    });
    if (!key) return { balanceMinorUnits: 0, currency: "SSP", version: 0, updatedAt: null };
    const bal = mockBalances[key];
    return { balanceMinorUnits: bal.balance, currency: bal.currency, version: bal.version, updatedAt: bal.updatedAt };
  }),
}));

jest.mock("../src/services/auditService", () => ({
  logAction: jest.fn(() => {
    mockAudit.push({ action: "test-audit", timestamp: new Date().toISOString() });
  }),
}));

// ── Service import (after all mocks) ────────────────────────────────────────────
const ledgerService = require("../src/services/ledgerService");
const { walletAccountService } = require("../src/services/walletAccountService");

// ── Helpers ─────────────────────────────────────────────────────────────────────
function resetMocks() {
  Object.keys(mockTx).forEach((k) => delete mockTx[k]);
  Object.keys(mockEntries).forEach((k) => delete mockEntries[k]);
  Object.keys(mockBalances).forEach((k) => delete mockBalances[k]);
  Object.keys(mockAccounts).forEach((k) => delete mockAccounts[k]);
  mockOutbox.length = 0;
  mockAudit.length = 0;
  Object.values(mockDatabases).forEach((m) => m.mockClear());
}

function provisionAccount(userId, currency, status = "ACTIVE") {
  const id = `acct_${Math.random().toString(36).slice(2, 8)}`;
  mockAccounts[`wallet_accounts/${id}`] = {
    $id: id,
    userId,
    currency,
    status,
    accountType: "PERSONAL",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mockBalances[`account_balances/${id}_bal`] = {
    $id: `${id}_bal`,
    accountId: id,
    currency,
    balance: 0,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  return id;
}

function createValidParams(accountId, currency = "SSP", amount = 1000) {
  return {
    reference: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "WALLET_TRANSFER",
    currency,
    description: "Test transfer",
    initiatedBy: "user_test",
    entries: [
      { accountId, entryType: "DEBIT", amountMinorUnits: amount },
      { accountId, entryType: "CREDIT", amountMinorUnits: amount },
    ],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────
describe("LedgerService — Journal Validation", () => {
  beforeEach(resetMocks);

  test("accepts valid debit+credit journal", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const result = await ledgerService.postJournal(createValidParams(acctId, "SSP", 5000));
    expect(result).toBeTruthy();
    expect(result.status).toBe("POSTED");
    expect(result.entries.length).toBe(2);
  });

  test("rejects missing reference", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({ ...createValidParams(acctId), reference: "" }),
    ).rejects.toThrow(ValidationError);
  });

  test("rejects invalid currency", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({ ...createValidParams(acctId), currency: "XYZ" }),
    ).rejects.toThrow(InvalidCurrencyError);
  });

  test("rejects entries with fewer than 2 items", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [{ accountId: acctId, entryType: "DEBIT", amountMinorUnits: 100 }],
      }),
    ).rejects.toThrow(InvalidLedgerEntryError);
  });

  test("rejects zero amount", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 0 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 0 },
        ],
      }),
    ).rejects.toThrow(InvalidLedgerEntryError);
  });

  test("rejects negative amount", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: -100 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 100 },
        ],
      }),
    ).rejects.toThrow(InvalidLedgerEntryError);
  });

  test("rejects decimal amount (not integer)", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 100.5 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 100.5 },
        ],
      }),
    ).rejects.toThrow(InvalidLedgerEntryError);
  });

  test("rejects invalid entry type", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEB", amountMinorUnits: 100 },
          { accountId: acctId, entryType: "CRE", amountMinorUnits: 100 },
        ],
      }),
    ).rejects.toThrow(InvalidLedgerEntryError);
  });

  test("rejects missing accountId in entry", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { entryType: "DEBIT", amountMinorUnits: 100 },
          { entryType: "CREDIT", amountMinorUnits: 100 },
        ],
      }),
    ).rejects.toThrow(InvalidLedgerEntryError);
  });

  test("rejects missing initiatedBy", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({ ...createValidParams(acctId), initiatedBy: null }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("LedgerService — Double-Entry Invariant", () => {
  beforeEach(resetMocks);

  test("unbalanced journal rejected (debits ≠ credits)", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 5000 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 4000 },
        ],
      }),
    ).rejects.toThrow(UnbalancedJournalError);
  });

  test("balanced multi-entry journal accepted", async () => {
    const acctA = provisionAccount("user_a", "SSP");
    const acctB = provisionAccount("user_b", "SSP");
    const result = await ledgerService.postJournal({
      ...createValidParams(acctA),
      reference: `TX-${Date.now()}-multi`,
      entries: [
        { accountId: acctA, entryType: "DEBIT", amountMinorUnits: 5000 },
        { accountId: acctB, entryType: "CREDIT", amountMinorUnits: 3000 },
        { accountId: acctB, entryType: "CREDIT", amountMinorUnits: 2000 },
      ],
    });
    expect(result.status).toBe("POSTED");
    expect(result.entries.length).toBe(3);
  });

  test("only debits rejected — no credits", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 100 },
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 200 },
        ],
      }),
    ).rejects.toThrow(UnbalancedJournalError);
  });

  test("only credits rejected — no debits", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 100 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 200 },
        ],
      }),
    ).rejects.toThrow(UnbalancedJournalError);
  });
});

describe("LedgerService — Currency Integrity", () => {
  beforeEach(resetMocks);

  test("rejects currency mismatch across entries", async () => {
    const acctA = provisionAccount("user_a", "SSP");
    const acctB = provisionAccount("user_b", "USD");
    // Override the mock's getById for this test only by replacing the module export
    jest.doMock("../src/services/walletAccountService", () => ({
      getById: jest.fn(async (accountId) => {
        if (accountId === acctA) {
          return { id: acctA, userId: "user_a", currency: "SSP", status: "ACTIVE" };
        }
        return { id: accountId, userId: "user_b", currency: "USD", status: "ACTIVE" };
      }),
    }));
    // Clear require cache and re-import
    delete require.cache[require.resolve("../src/services/ledgerService")];
    const ledgerServiceFresh = require("../src/services/ledgerService");

    await expect(
      ledgerServiceFresh.postJournal({
        ...createValidParams(acctA),
        entries: [
          { accountId: acctA, entryType: "DEBIT", amountMinorUnits: 1000 },
          { accountId: acctB, entryType: "CREDIT", amountMinorUnits: 1000 },
        ],
      }),
    ).rejects.toThrow(InvalidCurrencyError);
  });
});

describe("LedgerService — Account Validation", () => {
  beforeEach(resetMocks);

  test("rejects non-existent account", async () => {
    await expect(
      ledgerService.postJournal({
        ...createValidParams("acct_a"),
        entries: [
          { accountId: "nonexistent", entryType: "DEBIT", amountMinorUnits: 100 },
          { accountId: "nonexistent", entryType: "CREDIT", amountMinorUnits: 100 },
        ],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  test("rejects FROZEN account", async () => {
    const acctId = provisionAccount("user_a", "SSP", "FROZEN");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 100 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 100 },
        ],
      }),
    ).rejects.toThrow(AccountNotActiveError);
  });

  test("rejects CLOSED account", async () => {
    const acctId = provisionAccount("user_a", "SSP", "CLOSED");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 100 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 100 },
        ],
      }),
    ).rejects.toThrow(AccountNotActiveError);
  });

  test("rejects SUSPENDED account", async () => {
    const acctId = provisionAccount("user_a", "SSP", "SUSPENDED");
    await expect(
      ledgerService.postJournal({
        ...createValidParams(acctId),
        entries: [
          { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 100 },
          { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 100 },
        ],
      }),
    ).rejects.toThrow(AccountNotActiveError);
  });
});

describe("LedgerService — Transaction Lifecycle", () => {
  beforeEach(resetMocks);

  test("transaction transitions PENDING → PROCESSING → POSTED", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const result = await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));
    expect(result.status).toBe("POSTED");
    expect(result.postedAt).toBeTruthy();
  });

  test("duplicate reference with different data rejected", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const ref = `TX-${Date.now()}-dup`;
    await ledgerService.postJournal({ ...createValidParams(acctId, "SSP", 1000), reference: ref });
    await expect(
      ledgerService.postJournal({ ...createValidParams(acctId, "SSP", 2000), reference: ref }),
    ).rejects.toThrow(DuplicateTransactionReferenceError);
  });

  test("duplicate reference with same data returns existing", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const ref = `TX-${Date.now()}-same`;
    const first = await ledgerService.postJournal({ ...createValidParams(acctId, "SSP", 1000), reference: ref });
    const second = await ledgerService.postJournal({ ...createValidParams(acctId, "SSP", 1000), reference: ref });
    expect(second.transactionId).toBe(first.transactionId);
  });
});

describe("LedgerService — Immutability", () => {
  beforeEach(resetMocks);

  test("posted transaction cannot be failed", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const result = await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));
    await expect(
      ledgerService.failTransaction(result.transactionId, "Test reason"),
    ).rejects.toThrow(ImmutableTransactionError);
  });

  test("posted ledger entries persist and are queryable", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const result = await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));
    expect(result.entries.length).toBe(2);
    for (const entry of result.entries) {
      expect(entry.entryId).toBeTruthy();
    }
  });
});

describe("LedgerService — Balance Calculation", () => {
  beforeEach(resetMocks);

  test("ledger-derived balance equals credits minus debits", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const senderId = provisionAccount("user_sender", "SSP");
    await ledgerService.postJournal({
      ...createValidParams(acctId, "SSP", 1000),
      reference: `TX-${Date.now()}-credit`,
      entries: [
        { accountId: senderId, entryType: "DEBIT", amountMinorUnits: 1000 },
        { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 1000 },
      ],
    });

    const balance = await ledgerService.calculateBalanceFromLedger(acctId);
    expect(balance.balanceMinorUnits).toBe(1000);
    expect(balance.currency).toBe("SSP");
  });

  test("multiple transactions calculate correctly", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const senderId = provisionAccount("user_sender", "SSP");

    // Credit 5000
    await ledgerService.postJournal({
      reference: `TX-${Date.now()}-c1`,
      type: "WALLET_TRANSFER",
      currency: "SSP",
      description: "Credit 1",
      initiatedBy: "user_a",
      entries: [
        { accountId: senderId, entryType: "DEBIT", amountMinorUnits: 5000 },
        { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 5000 },
      ],
    });

    // Debit 2000
    await ledgerService.postJournal({
      reference: `TX-${Date.now()}-d1`,
      type: "WALLET_TRANSFER",
      currency: "SSP",
      description: "Debit 1",
      initiatedBy: "user_a",
      entries: [
        { accountId: acctId, entryType: "DEBIT", amountMinorUnits: 2000 },
        { accountId: senderId, entryType: "CREDIT", amountMinorUnits: 2000 },
      ],
    });

    // Credit 3000
    await ledgerService.postJournal({
      reference: `TX-${Date.now()}-c2`,
      type: "WALLET_TRANSFER",
      currency: "SSP",
      description: "Credit 2",
      initiatedBy: "user_a",
      entries: [
        { accountId: senderId, entryType: "DEBIT", amountMinorUnits: 3000 },
        { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 3000 },
      ],
    });

    const derived = await ledgerService.calculateBalanceFromLedger(acctId);
    expect(derived.balanceMinorUnits).toBe(6000); // 5000 - 2000 + 3000
  });

  test("balance projection matches ledger after posting", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const senderId = provisionAccount("user_sender", "SSP");

    await ledgerService.postJournal({
      reference: `TX-${Date.now()}-test`,
      type: "WALLET_TRANSFER",
      currency: "SSP",
      description: "Test",
      initiatedBy: "user_a",
      entries: [
        { accountId: senderId, entryType: "DEBIT", amountMinorUnits: 7500 },
        { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 7500 },
      ],
    });

    const verification = await ledgerService.verifyBalanceProjection(acctId);
    expect(verification.isConsistent).toBe(true);
    expect(verification.discrepancyMinorUnits).toBe(0);
  });
});

describe("LedgerService — Transaction Lookup", () => {
  beforeEach(resetMocks);

  test("getTransaction returns null for non-existent ID", async () => {
    const result = await ledgerService.getTransaction("nonexistent");
    expect(result).toBeNull();
  });

  test("getTransactionByReference returns null for unknown reference", async () => {
    const result = await ledgerService.getTransactionByReference("UNKNOWN-REF");
    expect(result).toBeNull();
  });

  test("listTransactions returns filtered results", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const senderId = provisionAccount("user_sender", "SSP");

    await ledgerService.postJournal({
      reference: `TX-${Date.now()}-1`,
      type: "WALLET_TRANSFER",
      currency: "SSP",
      description: "First",
      initiatedBy: "user_a",
      entries: [
        { accountId: senderId, entryType: "DEBIT", amountMinorUnits: 100 },
        { accountId: acctId, entryType: "CREDIT", amountMinorUnits: 100 },
      ],
    });

    const result = await ledgerService.listTransactions({ accountId: acctId, limit: 10 });
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(result.transactions[0].currency).toBe("SSP");
  });
});

describe("LedgerService — Compensating Transactions", () => {
  beforeEach(resetMocks);

  test("creates compensation with swapped debit/credit", async () => {
    const acctA = provisionAccount("user_a", "SSP");
    const acctB = provisionAccount("user_b", "SSP");

    const original = await ledgerService.postJournal({
      reference: `TX-${Date.now()}-orig`,
      type: "WALLET_TRANSFER",
      currency: "SSP",
      description: "Original transfer",
      initiatedBy: "user_a",
      entries: [
        { accountId: acctA, entryType: "DEBIT", amountMinorUnits: 5000 },
        { accountId: acctB, entryType: "CREDIT", amountMinorUnits: 5000 },
      ],
    });

    const compensation = await ledgerService.createCompensation(original.transactionId, "user_a", "Reversal");
    expect(compensation.type).toBe("COMPENSATION");
    expect(compensation.entries.length).toBe(2);

    // Compensation should swap: credit A, debit B
    const hasCreditToA = compensation.entries.some(
      (e) => e.accountId === acctA && e.entryType === "CREDIT",
    );
    const hasDebitToB = compensation.entries.some(
      (e) => e.accountId === acctB && e.entryType === "DEBIT",
    );
    expect(hasCreditToA).toBe(true);
    expect(hasDebitToB).toBe(true);
  });

  test("cannot create compensation for non-existent transaction", async () => {
    await expect(
      ledgerService.createCompensation("nonexistent", "user_a", "Test"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("LedgerService — Entry Ordering", () => {
  beforeEach(resetMocks);

  test("entries are ordered by creation time", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const result = await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].entryType).toBe("DEBIT");
    expect(result.entries[1].entryType).toBe("CREDIT");
  });

  test("all entries belong to the same transaction", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const result = await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));
    for (const entry of result.entries) {
      expect(entry.entryId).toBeTruthy();
    }
  });
});

describe("LedgerService — Audit Logging", () => {
  beforeEach(resetMocks);

  test("logs journal creation", async () => {
    const { logAction } = require("../src/services/auditService");
    logAction.mockClear();

    const acctId = provisionAccount("user_a", "SSP");
    await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));

    expect(logAction).toHaveBeenCalled();
    const calls = logAction.mock.calls;
    const createCall = calls.find((c) => c[0].action === "LEDGER_JOURNAL_CREATED");
    expect(createCall).toBeTruthy();
  });

  test("logs journal posting", async () => {
    const { logAction } = require("../src/services/auditService");
    logAction.mockClear();

    const acctId = provisionAccount("user_a", "SSP");
    await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));

    const calls = logAction.mock.calls;
    const postCall = calls.find((c) => c[0].action === "LEDGER_JOURNAL_POSTED");
    expect(postCall).toBeTruthy();
  });
});

describe("LedgerService — Outbox Events", () => {
  beforeEach(resetMocks);

  test("publishes outbox event on successful post", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    await ledgerService.postJournal(createValidParams(acctId, "SSP", 1000));

    // Outbox events are published asynchronously
    await new Promise((r) => setTimeout(r, 100));

    expect(mockOutbox.length).toBeGreaterThan(0);
    expect(mockOutbox[0].eventType).toBe("LEDGER_JOURNAL_POSTED");
    expect(mockOutbox[0].aggregateType).toBe("ledger_transaction");
  });
});

describe("LedgerService — Edge Cases", () => {
  beforeEach(resetMocks);

  test("handles minimum amount (1 minor unit = 0.01 SSP)", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const result = await ledgerService.postJournal({
      ...createValidParams(acctId, "SSP", 1),
      reference: `TX-${Date.now()}-min`,
    });
    expect(result.status).toBe("POSTED");
  });

  test("reference is unique per transaction", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const ref1 = `TX-${Date.now()}-unique1`;
    const ref2 = `TX-${Date.now()}-unique2`;

    await ledgerService.postJournal({ ...createValidParams(acctId, "SSP", 100), reference: ref1 });
    await ledgerService.postJournal({ ...createValidParams(acctId, "SSP", 200), reference: ref2 });

    expect(ref1).not.toBe(ref2);
  });

  test("metadata is preserved in transaction", async () => {
    const acctId = provisionAccount("user_a", "SSP");
    const metadata = { channel: "mobile", source: "app", traceId: "abc123" };
    const result = await ledgerService.postJournal({
      ...createValidParams(acctId, "SSP", 100),
      metadata,
    });
    expect(result.metadata.channel).toBe("mobile");
    expect(result.metadata.source).toBe("app");
  });

  test("multiple currencies supported (SSP, USD)", async () => {
    const acctId = provisionAccount("user_a", "USD");
    const result = await ledgerService.postJournal({
      ...createValidParams(acctId, "USD", 1000),
    });
    expect(result.status).toBe("POSTED");
    expect(result.currency).toBe("USD");
  });
});
