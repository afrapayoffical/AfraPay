/**
 * Wallet Account Routes
 *
 * GET    /                   – list my wallet accounts
 * POST   /provision          – provision (or return existing) wallet account
 * GET    /:accountId         – get a specific wallet account
 * GET    /:accountId/balance – get balance for a wallet account
 */

"use strict";

const express = require("express");
const router = express.Router();

const { authenticate } = require("../../middleware/auth/authenticate");
const { asyncHandler } = require("../../middleware/monitoring/errorHandler");
const walletAccountController = require("../../controllers/walletAccountController");
const { body, param } = require("express-validator");
const validateRequest = require("../../middleware/validation/validateRequest");

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/wallet
 * List all wallet accounts for the authenticated user.
 */
router.get(
  "/",
  authenticate,
  asyncHandler(walletAccountController.getMyWallet.bind(walletAccountController)),
);

/**
 * POST /api/v1/wallet/provision
 * Create or return existing wallet account for authenticated user.
 */
router.post(
  "/provision",
  authenticate,
  body("currency")
    .isIn(["SSP", "USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR"])
    .withMessage("Invalid currency code"),
  body("accountType")
    .optional()
    .isIn(["PERSONAL", "MERCHANT"])
    .withMessage("Invalid account type"),
  validateRequest,
  asyncHandler(walletAccountController.provision.bind(walletAccountController)),
);

/**
 * GET /api/v1/wallet/:accountId
 * Get a specific wallet account (ownership enforced).
 */
router.get(
  "/:accountId",
  authenticate,
  param("accountId")
    .isLength({ min: 1, max: 36 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Invalid account ID format"),
  validateRequest,
  asyncHandler(walletAccountController.getWallet.bind(walletAccountController)),
);

/**
 * GET /api/v1/wallet/:accountId/balance
 * Get balance for a wallet account (ownership enforced).
 */
router.get(
  "/:accountId/balance",
  authenticate,
  param("accountId")
    .isLength({ min: 1, max: 36 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Invalid account ID format"),
  validateRequest,
  asyncHandler(walletAccountController.getBalance.bind(walletAccountController)),
);

module.exports = router;
