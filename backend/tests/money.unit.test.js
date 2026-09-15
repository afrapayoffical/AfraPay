/**
 * Money Utility Unit Tests — Phase 2
 */

"use strict";

const {
  toMinorUnits,
  toBigUnits,
  addMinorUnits,
  subtractMinorUnits,
  compareMinorUnits,
  isSufficientBalance,
  validateCurrency,
} = require("../src/utils/money");
const { ValidationError } = require("../src/middleware/monitoring/errorHandler");

describe("Money Utility — Integer Minor Units", () => {
  describe("toMinorUnits", () => {
    test("converts SSP decimal to minor units", () => {
      expect(toMinorUnits(10.5, "SSP")).toBe(1050);
      expect(toMinorUnits(100, "SSP")).toBe(10000);
      expect(toMinorUnits(0.01, "SSP")).toBe(1);
      expect(toMinorUnits(1, "SSP")).toBe(100);
    });

    test("converts USD correctly", () => {
      expect(toMinorUnits(9.99, "USD")).toBe(999);
      expect(toMinorUnits(1.0, "USD")).toBe(100);
    });

    test("rejects negative amounts", () => {
      expect(() => toMinorUnits(-5, "SSP")).toThrow(ValidationError);
    });

    test("rejects NaN", () => {
      expect(() => toMinorUnits(NaN, "SSP")).toThrow(ValidationError);
    });

    test("rejects infinite values", () => {
      expect(() => toMinorUnits(Infinity, "SSP")).toThrow(ValidationError);
    });

    test("rejects missing currency", () => {
      expect(() => toMinorUnits(10, "")).toThrow(ValidationError);
    });

    test("rejects unsupported currency", () => {
      expect(() => toMinorUnits(10, "BTC")).toThrow(ValidationError);
    });

    test("handles string input", () => {
      expect(toMinorUnits("10.50", "SSP")).toBe(1050);
    });
  });

  describe("toBigUnits", () => {
    test("converts minor units back to decimal string", () => {
      expect(toBigUnits(1050, "SSP")).toBe("10.50");
      expect(toBigUnits(10000, "SSP")).toBe("100.00");
      expect(toBigUnits(1, "SSP")).toBe("0.01");
    });

    test("handles zero", () => {
      expect(toBigUnits(0, "SSP")).toBe("0.00");
    });

    test("rejects negative values", () => {
      expect(() => toBigUnits(-100, "SSP")).toThrow(ValidationError);
    });
  });

  describe("arithmetic helpers", () => {
    test("addMinorUnits sums correctly", () => {
      expect(addMinorUnits(100, 200)).toBe(300);
    });

    test("subtractMinorUnits can return negative", () => {
      expect(subtractMinorUnits(100, 200)).toBe(-100);
    });

    test("compareMinorUnits returns correct sign", () => {
      expect(compareMinorUnits(100, 200)).toBe(-1);
      expect(compareMinorUnits(200, 100)).toBe(1);
      expect(compareMinorUnits(100, 100)).toBe(0);
    });

    test("isSufficientBalance checks correctly", () => {
      expect(isSufficientBalance(500, 300)).toBe(true);
      expect(isSufficientBalance(300, 500)).toBe(false);
      expect(isSufficientBalance(300, 300)).toBe(true);
    });
  });

  describe("validateCurrency", () => {
    test("accepts valid currencies", () => {
      expect(validateCurrency("SSP")).toBe("SSP");
      expect(validateCurrency("usd")).toBe("USD");
    });

    test("rejects empty currency", () => {
      expect(() => validateCurrency("")).toThrow(ValidationError);
    });
  });

  describe("floating-point safety", () => {
    test("avoids floating-point rounding errors", () => {
      expect(toMinorUnits(0.1 + 0.2, "SSP")).toBe(30);
    });

    test("precise round-trip for common amounts", () => {
      const amounts = [0.01, 0.1, 0.5, 1, 10, 100, 1000];
      for (const amt of amounts) {
        const minor = toMinorUnits(amt, "SSP");
        const back = toBigUnits(minor, "SSP");
        expect(parseFloat(back)).toBeCloseTo(amt, 4);
      }
    });
  });
});
