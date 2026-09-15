/**
 * Secure Transaction Routes  v2
 * Wires validation, authorization, audit logging, and the secure controller
 * together for every transaction endpoint.
 *
 * Route map:
 *   POST   /                               – create transaction
 *   POST   /transfer                       – peer-to-peer transfer
 *   GET    /                               – list transactions (with filters)
 *   GET    /search                         – search transactions
 *   GET    /export                         – export transactions
 *   GET    /analytics/summary              – summary analytics
 *   GET    /analytics/trends               – trend analytics
 *   GET    /analytics/categories           – category breakdown
 *   GET    /:transactionId                 – get single transaction
 *   GET    /:transactionId/receipt         – download receipt
 *   POST   /:transactionId/cancel         – cancel transaction
 *   POST   /:transactionId/dispute        – file a dispute
 *   GET    /disputes                       – list user disputes
 *   GET    /disputes/:disputeId            – get dispute details
 *   GET    /admin/all                      – (admin) all transactions
 */

const express = require("express");
const router = express.Router();
const { param, query, body } = require("express-validator");

// ── Core middleware ────────────────────────────────────────────────────────
const { authenticate } = require("../../middleware/auth/authenticate");
const { authorize } = require("../../middleware/auth/authorize");
const validateRequest = require("../../middleware/validation/validateRequest");
const { asyncHandler } = require("../../middleware/monitoring/errorHandler");
const {
  createRateLimiter,
  paymentLimiter,
} = require("../../middleware/security/rateLimiter");

// ── Transaction-specific middleware ───────────────────────────────────────
const {
  validateCreateTransaction,
  validateTransactionId,
  validateTransactionListQuery,
  validateAnalyticsQuery,
  validateExportQuery,
  validateDisputeTransaction,
  validateCancelTransaction,
} = require("../../middleware/validation/transactionValidation");

const {
  authorizeTransactionWrite,
} = require("../../middleware/auth/transactionAuthorization");

const {
  auditTransactionRequest,
} = require("../../middleware/monitoring/transactionAudit");

// ── Controllers ───────────────────────────────────────────────────────────
const txController = require("../../controllers/secureTransactionController");
const transactionController = require("../../controllers/transactionController");

// ── Rate limiters ─────────────────────────────────────────────────────────
const writeLimiter = paymentLimiter; // reuse payment limiter (5 min / 10 req)
const exportLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: {
    success: false,
    error: {
      code: "EXPORT_RATE_LIMIT_EXCEEDED",
      message: "Export rate limit exceeded. Try again in 1 hour.",
    },
  },
  keyGenerator: (req) => `export:${req.user?.id || req.ip}`,
});

// ─────────────────────────────────────────────────────────────────────────
// WRITE ROUTES
// ─────────────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/v1/transactions
 * @desc   Create a new transaction (deposit, payment, etc.)
 * @access Private – authenticated, active account, KYC + amount limits enforced
 */
router.post(
  "/",
  authenticate,
  writeLimiter,
  auditTransactionRequest(),
  ...authorizeTransactionWrite(),
  validateCreateTransaction,
  asyncHandler(txController.createTransaction.bind(txController)),
);

/**
 * @route  POST /api/v1/transactions/transfer
 * @desc   Peer-to-peer wallet transfer
 * @access Private – KYC level ≥ 1, MFA verified
 */
router.post(
  "/transfer",
  authenticate,
  writeLimiter,
  auditTransactionRequest(),
  ...authorizeTransactionWrite(),
  body("amount")
    .isFloat({ min: 0.01 })
    .withMessage("Amount must be a positive number"),
  body("currency")
    .isIn(["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR"])
    .withMessage("Invalid currency code"),
  body("recipientId")
    .optional({ nullable: true })
    .trim()
    .isLength({ min: 1, max: 36 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Invalid recipient ID"),
  body("recipientEmail")
    .optional({ nullable: true })
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage("Invalid recipient email"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .escape()
    .withMessage("Description must not exceed 500 characters"),
  body("pin")
    .optional()
    .isLength({ min: 4, max: 6 })
    .isNumeric()
    .withMessage("PIN must be 4-6 digits"),
  body("idempotencyKey")
    .optional()
    .trim()
    .isLength({ min: 8, max: 64 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Invalid idempotency key"),
  validateRequest,
  asyncHandler(txController.processTransfer.bind(txController)),
);

/**
 * @route  POST /api/v1/transactions/:transactionId/cancel
 * @desc   Cancel a pending/processing transaction
 * @access Private – owner only
 */
router.post(
  "/:transactionId/cancel",
  authenticate,
  validateCancelTransaction,
  asyncHandler(txController.cancelTransaction.bind(txController)),
);

/**
 * @route  POST /api/v1/transactions/:transactionId/dispute
 * @desc   File a dispute against a completed transaction
 * @access Private – owner only
 */
router.post(
  "/:transactionId/dispute",
  authenticate,
  validateDisputeTransaction,
  asyncHandler(txController.createDispute.bind(txController)),
);

// ─────────────────────────────────────────────────────────────────────────
// READ ROUTES  (static paths before /:transactionId to avoid param clash)
// ─────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/transactions/analytics/summary
 * @desc   Aggregated totals, counts, averages
 * @access Private
 */
router.get(
  "/analytics/summary",
  authenticate,
  validateAnalyticsQuery,
  asyncHandler(txController.getTransactionSummary.bind(txController)),
);

/**
 * @route  GET /api/v1/transactions/analytics/trends
 * @desc   Time-series trend data
 * @access Private
 */
router.get(
  "/analytics/trends",
  authenticate,
  validateAnalyticsQuery,
  asyncHandler(txController.getTransactionTrends.bind(txController)),
);

/**
 * @route  GET /api/v1/transactions/analytics/categories
 * @desc   Spending breakdown by category
 * @access Private
 */
router.get(
  "/analytics/categories",
  authenticate,
  validateAnalyticsQuery,
  asyncHandler(txController.getSpendingByCategory.bind(txController)),
);

/**
 * @route  GET /api/v1/transactions/export
 * @desc   Export transactions as CSV / PDF / XLSX
 * @access Private
 */
router.get(
  "/export",
  authenticate,
  exportLimiter,
  validateExportQuery,
  asyncHandler(txController.exportTransactions.bind(txController)),
);

/**
 * @route  GET /api/v1/transactions/search
 * @desc   Full-text search across transaction descriptions
 * @access Private
 */
router.get(
  "/search",
  authenticate,
  query("q")
    .trim()
    .isLength({ min: 1, max: 100 })
    .matches(/^[a-zA-Z0-9\s@._-]+$/)
    .withMessage("Search query must be 1-100 characters"),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be 1-100"),
  validateRequest,
  asyncHandler(txController.searchTransactions.bind(txController)),
);

/**
 * @route  GET /api/v1/transactions/disputes
 * @desc   List the authenticated user's disputes
 * @access Private
 */
router.get(
  "/disputes",
  authenticate,
  query("status")
    .optional()
    .isIn(["pending", "under_review", "resolved", "rejected"])
    .withMessage("Invalid dispute status"),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be 1-100"),
  validateRequest,
  asyncHandler((req, res) =>
    transactionController.getDisputes
      ? transactionController.getDisputes(req, res)
      : res.success([], "No disputes found"),
  ),
);

/**
 * @route  GET /api/v1/transactions/disputes/:disputeId
 * @desc   Get dispute details
 * @access Private
 */
router.get(
  "/disputes/:disputeId",
  authenticate,
  param("disputeId")
    .trim()
    .isLength({ min: 1, max: 36 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Invalid dispute ID"),
  validateRequest,
  asyncHandler((req, res) =>
    transactionController.getDispute
      ? transactionController.getDispute(req, res)
      : res.success(null, "Dispute not found"),
  ),
);

/**
 * @route  GET /api/v1/transactions
 * @desc   List user's transactions with optional filters
 * @access Private
 */
router.get(
  "/",
  authenticate,
  validateTransactionListQuery,
  asyncHandler(txController.getTransactions.bind(txController)),
);

/**
 * @route  GET /api/v1/transactions/:transactionId
 * @desc   Get a single transaction (owner or admin)
 * @access Private
 */
router.get(
  "/:transactionId",
  authenticate,
  validateTransactionId,
  asyncHandler(txController.getTransaction.bind(txController)),
);

/**
 * @route  GET /api/v1/transactions/:transactionId/receipt
 * @desc   Download a transaction receipt
 * @access Private – owner only
 */
router.get(
  "/:transactionId/receipt",
  authenticate,
  validateTransactionId,
  asyncHandler(txController.getTransactionReceipt.bind(txController)),
);

// ─────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/transactions/admin/all
 * @desc   Retrieve all transactions (admin view)
 * @access Private – admin role required
 */
router.get(
  "/admin/all",
  authenticate,
  authorize(["admin", "super_admin"]),
  validateTransactionListQuery,
  asyncHandler((req, res) =>
    transactionController.getAllTransactions
      ? transactionController.getAllTransactions(req, res)
      : res.success([], "No transactions found"),
  ),
);

module.exports = router;
