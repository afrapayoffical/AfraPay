/**
 * Money Utility — Integer Minor Units
 *
 * All monetary values in AfraPay are represented as integers in the
 * smallest currency unit (e.g. cents for USD, cents for SSP).
 *
 * This module provides safe conversion between "big" (decimal) and
 * "minor" (integer) units with strict validation.
 *
 * NEVER use parseFloat() or toFixed() on financial values outside this
 * module — those are the source of all floating-point money bugs.
 */

"use strict";

const { ValidationError } = require("../middleware/monitoring/errorHandler");

// ── Currency precision map ─────────────────────────────────────────────────────
// Most world currencies use 2 decimal places. A few use 0 (e.g. JPY).
// SSP is added here explicitly.
const CURRENCY_PRECISION = {
  SSP: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  NGN: 2,
  GHS: 2,
  KES: 2,
  ZAR: 2,
  // Extend this map as new currencies are supported.
};

const DEFAULT_PRECISION = 2;

// ── Validation helpers ─────────────────────────────────────────────────────────

/**
 * Validate that a currency code is recognised.
 * Throws a ValidationError if the code is unknown.
 */
function validateCurrency(currency) {
  const code = String(currency).toUpperCase();
  if (!code) {
    throw new ValidationError("Currency code is required", [
      { field: "currency", message: "Currency code is required" },
    ]);
  }
  if (!CURRENCY_PRECISION.hasOwnProperty(code)) {
    throw new ValidationError(`Unsupported currency: ${code}`, [
      { field: "currency", message: `Currency "${code}" is not supported` },
    ]);
  }
  return code;
}

/**
 * Validate that a value is a safe integer (not a float, not NaN, not Infinity).
 */
function assertInteger(value, fieldName = "amount") {
  if (!Number.isInteger(value)) {
    throw new ValidationError(
      `${fieldName} must be an integer (use minor units). Received: ${value}`,
      [{ field: fieldName, message: `Must be an integer, got ${value}` }],
    );
  }
  return value;
}

/**
 * Validate that an integer amount is non-negative.
 */
function assertNonNegative(value, fieldName = "amount") {
  if (value < 0) {
    throw new ValidationError(
      `${fieldName} must be non-negative. Received: ${value}`,
      [{ field: fieldName, message: `Must be ≥ 0, got ${value}` }],
    );
  }
  return value;
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Convert a decimal amount to minor units (integer).
 *
 * @param {number|string} bigAmount  e.g. 10.50
 * @param {string} currency          ISO-4217 code, e.g. "SSP"
 * @returns {number} minor units as integer, e.g. 1050
 */
function toMinorUnits(bigAmount, currency) {
  const code = validateCurrency(currency);
  const precision = CURRENCY_PRECISION[code] ?? DEFAULT_PRECISION;

  // Convert string input to number
  const num = Number(bigAmount);
  if (isNaN(num) || !isFinite(num)) {
    throw new ValidationError(`Invalid amount: ${bigAmount}`, [
      { field: "amount", message: `Amount must be a finite number` },
    ]);
  }

  // Round to the correct precision first, then multiply
  const rounded = Number(num.toFixed(precision));
  const minor = Math.round(rounded * Math.pow(10, precision));

  assertInteger(minor, "amount");
  assertNonNegative(minor, "amount");

  return minor;
}

/**
 * Convert minor units back to a human-readable decimal string.
 *
 * @param {number} minorUnits  e.g. 1050
 * @param {string} currency    ISO-4217 code
 * @returns {string}           e.g. "10.50"
 */
function toBigUnits(minorUnits, currency) {
  const code = validateCurrency(currency);
  const precision = CURRENCY_PRECISION[code] ?? DEFAULT_PRECISION;

  assertInteger(minorUnits, "amount");
  assertNonNegative(minorUnits, "amount");

  // Use integer division to avoid floating point
  const divisor = Math.pow(10, precision);
  const whole = Math.floor(minorUnits / divisor);
  const frac = minorUnits % divisor;

  return `${whole}.${String(frac).padStart(precision, "0")}`;
}

/**
 * Safely add two minor-unit amounts.
 */
function addMinorUnits(a, b) {
  assertInteger(a, "a");
  assertInteger(b, "b");
  return a + b;
}

/**
 * Safely subtract two minor-unit amounts.
 * Returns the signed result (negative means b > a).
 */
function subtractMinorUnits(a, b) {
  assertInteger(a, "a");
  assertInteger(b, "b");
  return a - b;
}

/**
 * Compare two minor-unit amounts.
 * Returns -1, 0, or 1.
 */
function compareMinorUnits(a, b) {
  assertInteger(a, "a");
  assertInteger(b, "b");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Check whether a minor-unit balance is sufficient for a charge.
 */
function isSufficientBalance(balance, amount) {
  assertInteger(balance, "balance");
  assertInteger(amount, "amount");
  return balance >= amount;
}

module.exports = {
  CURRENCY_PRECISION,
  validateCurrency,
  assertInteger,
  assertNonNegative,
  toMinorUnits,
  toBigUnits,
  addMinorUnits,
  subtractMinorUnits,
  compareMinorUnits,
  isSufficientBalance,
};
