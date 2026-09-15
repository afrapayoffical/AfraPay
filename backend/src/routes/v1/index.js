/**
 * API v1 Routes
 * Main routing module for API version 1
 */

const express = require("express");
const router = express.Router();

// Import route modules
const authRoutes = require("./auth");
const userRoutes = require("./users");
const paymentRoutes = require("./payments");
const transactionRoutes = require("./transactions");
const adminRoutes = require("./admin");
const webhookRoutes = require("./webhooks");
const profileRoutes = require("./profile");
const educationRoutes = require("./education");
const supportRoutes = require("./support");
const notificationRoutes = require("./notifications");
const careersRoutes = require("./careers");
const applicationsRoutes = require("./applications");
const blogRoutes = require("./blog");
const newsletterRoutes = require("./newsletter");
const chatRoutes = require("./chat");
const analyticsRoutes = require("./analytics");
const cardRoutes = require("./cards");
const merchantRoutes = require("./merchants");
const subscriptionRoutes = require("./subscriptions");
const walletRoutes = require("./wallets");

// Route configuration with middleware
router.use("/auth", authRoutes);

// Simple test route to bypass middleware
router.post("/test-register", (req, res) => {
  console.log("Test register route hit:", req.body);
  res.json({
    success: true,
    message: "Test route working",
    body: req.body,
  });
});

router.use("/users", userRoutes);
router.use("/payments", paymentRoutes);
router.use("/transactions", transactionRoutes);
router.use("/admin", adminRoutes);
router.use("/webhooks", webhookRoutes);
router.use("/profile", profileRoutes);
router.use("/education", educationRoutes);
router.use("/support", supportRoutes);
router.use("/notifications", notificationRoutes);
router.use("/careers", careersRoutes);
router.use("/applications", applicationsRoutes);
router.use("/blog", blogRoutes);
router.use("/newsletter", newsletterRoutes);
router.use("/chat", chatRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/cards", cardRoutes);
router.use("/merchants", merchantRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/wallets", walletRoutes);

// API v1 status
router.get("/", (_req, res) => {
  res.success(
    {
      version: "v1",
      endpoints: {
        auth: "/api/v1/auth",
        users: "/api/v1/users",
        payments: "/api/v1/payments",
        transactions: "/api/v1/transactions",
        profile: "/api/v1/profile",
        admin: "/api/v1/admin",
        webhooks: "/api/v1/webhooks",
        education: "/api/v1/education",
        support: "/api/v1/support",
        notifications: "/api/v1/notifications",
        careers: "/api/v1/careers",
        applications: "/api/v1/applications",
        blog: "/api/v1/blog",
        analytics: "/api/v1/analytics",
        merchants: "/api/v1/merchants",
      },
    },
    "API v1 is operational",
  );
});

module.exports = router;
