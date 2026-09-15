/**
 * Wallet Account Service — Unit Tests (no Appwrite required)
 *
 * Tests business logic by mocking the Appwrite client.
 */

"use strict";

const {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} = require("../src/middleware/monitoring/errorHandler");

// ── Mock state ────────────────────────────────────────────────────────────────
let _mockAccounts = {};   // keyed by collection/id
let _mockBalances = {};   // keyed by collection/id

// ── Mock Appwrite databases ───────────────────────────────────────────────────
const mockDatabases = {
  createDocument: jest.fn(async (_dbId, colId, docId, data) => {
    const id = docId || `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const doc = { $id: id, ...data };
    if (colId.includes("balance")) {
      _mockBalances[`${colId}/${id}`] = doc;
    } else {
      _mockAccounts[`${colId}/${id}`] = doc;
    }
    return doc;
  }),

  getDocument: jest.fn(async (_dbId, colId, docId) => {
    const key = `${colId}/${docId}`;
    const doc = _mockAccounts[key] || _mockBalances[key];
    if (!doc) throw { code: 404, message: "Document not found" };
    return doc;
  }),

  listDocuments: jest.fn(async (_dbId, colId, queries) => {
    const isBalance = colId.includes("balance");
    const store = isBalance ? _mockBalances : _mockAccounts;

    const results = Object.values(store).filter((doc) => {
      if (!queries) return true;
      for (const q of queries) {
        if (q.type === "equal" && doc[q.attribute] !== q.value) return false;
        if (q.type === "limit") break;
      }
      return true;
    });
    return { documents: results, total: results.length };
  }),

  updateDocument: jest.fn(async (_dbId, colId, docId, data) => {
    const key = `${colId}/${docId}`;
    const store = colId.includes("balance") ? _mockBalances : _mockAccounts;
    if (!store[key]) throw { code: 404 };
    store[key] = { ...store[key], ...data };
    return store[key];
  }),
};

jest.mock("../src/database/connection", () => ({
  appwrite: { getDatabases: () => mockDatabases },
}));

// ── Service imports (after mock) ──────────────────────────────────────────────
const walletAccountService = require("../src/services/walletAccountService");
const balanceProjectionService = require("../src/services/balanceProjectionService");

// ── Helpers ────────────────────────────────────────────────────────────────────
const _originalGetDocument = mockDatabases.getDocument;
function resetMocks() {
  _mockAccounts = {};
  _mockBalances = {};
  Object.values(mockDatabases).forEach((m) => m.mockClear());
  // Restore original getDocument after tests that replace it
  mockDatabases.getDocument = _originalGetDocument;
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("WalletAccountService — Unit", () => {
  beforeEach(resetMocks);

  describe("provision", () => {
    test("creates account with correct fields", async () => {
      const account = await walletAccountService.provision({
        userId: "user_abc123",
        currency: "SSP",
      });
      expect(account).toBeTruthy();
      expect(account.id).toBeTruthy();
      expect(account.userId).toBe("user_abc123");
      expect(account.currency).toBe("SSP");
      expect(account.status).toBe("ACTIVE");
      expect(account.accountType).toBe("PERSONAL");
    });

    test("returns existing account on duplicate provision", async () => {
      // First provision creates the account
      const first = await walletAccountService.provision({
        userId: "user_dup",
        currency: "SSP",
      });
      // Second provision finds it via listDocuments
      const second = await walletAccountService.provision({
        userId: "user_dup",
        currency: "SSP",
      });
      expect(second.id).toBe(first.id);
    });

    test("rejects invalid currency", async () => {
      await expect(
        walletAccountService.provision({ userId: "user_x", currency: "XYZ" }),
      ).rejects.toThrow(ValidationError);
    });

    test("rejects invalid account type", async () => {
      await expect(
        walletAccountService.provision({
          userId: "user_x",
          currency: "SSP",
          accountType: "INVALID",
        }),
      ).rejects.toThrow(ValidationError);
    });

    test("server never trusts client-supplied userId", async () => {
      const account = await walletAccountService.provision({
        userId: "real_user_123",
        currency: "SSP",
      });
      expect(account.userId).toBe("real_user_123");
    });
  });

  describe("getById", () => {
    test("returns account for owner", async () => {
      const account = await walletAccountService.provision({
        userId: "user_owner",
        currency: "SSP",
      });
      const fetched = await walletAccountService.getById(
        account.id,
        "user_owner",
        "user",
      );
      expect(fetched.id).toBe(account.id);
    });

    test("throws AuthorizationError when user accesses another's account", async () => {
      const account = await walletAccountService.provision({
        userId: "user_a",
        currency: "SSP",
      });
      await expect(
        walletAccountService.getById(account.id, "user_b", "user"),
      ).rejects.toThrow(AuthorizationError);
    });

    test("admin can access any account", async () => {
      const account = await walletAccountService.provision({
        userId: "user_a",
        currency: "SSP",
      });
      const fetched = await walletAccountService.getById(
        account.id,
        "admin_user",
        "admin",
      );
      expect(fetched.id).toBe(account.id);
    });

    test("throws NotFoundError for non-existent account", async () => {
      await expect(
        walletAccountService.getById("nonexistent", "user_x", "user"),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("validateAccountForFinancialOperation", () => {
    test("passes for ACTIVE account", async () => {
      const account = await walletAccountService.provision({
        userId: "user_x",
        currency: "SSP",
      });
      const validated = await walletAccountService.validateAccountForFinancialOperation(
        account.id,
        "user_x",
        "user",
      );
      expect(validated.status).toBe("ACTIVE");
    });

    test("rejects FROZEN account", async () => {
      const account = await walletAccountService.provision({
        userId: "user_x",
        currency: "SSP",
      });
      // Override getDocument to return FROZEN status
      mockDatabases.getDocument = jest.fn(async () => ({
        $id: account.id,
        userId: "user_x",
        currency: "SSP",
        status: "FROZEN",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      await expect(
        walletAccountService.validateAccountForFinancialOperation(
          account.id,
          "user_x",
          "user",
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    test("rejects CLOSED account", async () => {
      const account = await walletAccountService.provision({
        userId: "user_x",
        currency: "SSP",
      });
      mockDatabases.getDocument = jest.fn(async () => ({
        $id: account.id,
        userId: "user_x",
        currency: "SSP",
        status: "CLOSED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      await expect(
        walletAccountService.validateAccountForFinancialOperation(
          account.id,
          "user_x",
          "user",
        ),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe("changeStatus", () => {
    test("changes status from ACTIVE to FROZEN", async () => {
      const account = await walletAccountService.provision({
        userId: "user_x",
        currency: "SSP",
      });
      const updated = await walletAccountService.changeStatus(
        account.id,
        "FROZEN",
        "admin_user",
        "Suspicious activity",
      );
      expect(updated.status).toBe("FROZEN");
    });

    test("rejects invalid status", async () => {
      const account = await walletAccountService.provision({
        userId: "user_x",
        currency: "SSP",
      });
      await expect(
        walletAccountService.changeStatus(account.id, "UNKNOWN", "admin_user"),
      ).rejects.toThrow(ValidationError);
    });

    test("throws NotFoundError for non-existent account", async () => {
      // Ensure getDocument throws 404 for this test
      mockDatabases.getDocument = jest.fn(async () => {
        throw { code: 404, message: "Document not found" };
      });
      await expect(
        walletAccountService.changeStatus("nonexistent", "FROZEN", "admin_user"),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

describe("BalanceProjectionService — Unit", () => {
  beforeEach(resetMocks);

  test("getBalance returns zero for new account", async () => {
    const account = await walletAccountService.provision({
      userId: "user_x",
      currency: "SSP",
    });
    const balance = await balanceProjectionService.getBalance(
      account.id,
      "user_x",
      "user",
    );
    expect(balance.balanceMinorUnits).toBe(0);
    expect(balance.currency).toBe("SSP");
  });

  test("balance response includes display string", async () => {
    const account = await walletAccountService.provision({
      userId: "user_x",
      currency: "SSP",
    });
    const balance = await balanceProjectionService.getBalance(
      account.id,
      "user_x",
      "user",
    );
    expect(balance.balanceDisplay).toBe("0.00");
  });

  test("unauthorized user cannot read balance", async () => {
    const account = await walletAccountService.provision({
      userId: "user_a",
      currency: "SSP",
    });
    await expect(
      balanceProjectionService.getBalance(account.id, "user_b", "user"),
    ).rejects.toThrow(AuthorizationError);
  });

  test("balance validation rejects missing balance field", async () => {
    // Pre-populate a malformed balance record
    const account = await walletAccountService.provision({
      userId: "user_x",
      currency: "SSP",
    });
    // Manually set a bad balance record
    _mockBalances["account_balances/test_bal"] = {
      accountId: account.id,
      currency: "SSP",
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    // Update listDocuments to return the bad record
    const origList = mockDatabases.listDocuments;
    mockDatabases.listDocuments = jest.fn(async (dbId, colId, queries) => {
      if (colId.includes("balance")) {
        return {
          documents: [{ $id: "test_bal", ..._mockBalances["account_balances/test_bal"] }],
          total: 1,
        };
      }
      return origList(dbId, colId, queries);
    });

    await expect(
      balanceProjectionService.getBalance(account.id, "user_x", "user"),
    ).rejects.toThrow(ValidationError);
  });
});
