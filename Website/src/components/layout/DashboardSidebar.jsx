import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  GraduationCap,
  Settings,
  Shield,
  HelpCircle,
  User,
  ChevronLeft,
  ChevronRight,
  X,
  Bell,
  TrendingUp,
  CreditCard,
  Send,
  Store,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../utils";
import { Badge, Avatar } from "../ui";
import { useTranslation } from "../../utils/accessibility";
import { useMerchant } from "../../contexts/MerchantContext";

const DashboardSidebar = ({ isOpen, onClose, className, user, ...props }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  const { t } = useTranslation();
  const { merchantStatus } = useMerchant();

  // Derive merchant nav item label and badge based on application status
  const merchantNavItem = {
    name:
      merchantStatus === "approved"
        ? "Merchant Hub"
        : merchantStatus === "pending"
          ? "Application Pending"
          : "Become a Merchant",
    href: "/merchant",
    icon: <Store className="w-5 h-5" />,
    badge:
      merchantStatus === "approved"
        ? { text: "Active", variant: "success" }
        : merchantStatus === "pending"
          ? { text: "Review", variant: "warning" }
          : { text: "New", variant: "primary" },
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const navigationItems = [
    {
      section: t("navigation.overview"),
      items: [
        {
          name: t("navigation.dashboard"),
          href: "/dashboard",
          icon: <LayoutDashboard className="w-5 h-5" />,
          badge: null,
        },
      ],
    },
    {
      section: t("navigation.accounts"),
      items: [
        {
          name: t("navigation.wallets"),
          href: "/wallets",
          icon: <Wallet className="w-5 h-5" />,
          badge: { text: "2", variant: "primary" },
        },
        {
          name: t("navigation.transactions"),
          href: "/transactions",
          icon: <ArrowLeftRight className="w-5 h-5" />,
          badge: null,
        },
        {
          name: t("navigation.cards"),
          href: "/cards",
          icon: <CreditCard className="w-5 h-5" />,
          badge: null,
        },
        {
          name: t("navigation.sendMoney"),
          href: "/send",
          icon: <Send className="w-5 h-5" />,
          badge: null,
        },
        {
          name: "Subscriptions",
          href: "/subscriptions",
          icon: <RefreshCw className="w-5 h-5" />,
          badge: null,
        },
      ],
    },
    {
      section: t("navigation.learning"),
      items: [
        {
          name: t("navigation.educationHub"),
          href: "/education",
          icon: <GraduationCap className="w-5 h-5" />,
          badge: { text: "New", variant: "success" },
        },
        {
          name: t("navigation.analytics"),
          href: "/analytics",
          icon: <TrendingUp className="w-5 h-5" />,
          badge: null,
        },
      ],
    },
    {
      section: "Business",
      items: [merchantNavItem],
    },
    {
      section: t("navigation.accountSection"),
      items: [
        {
          name: t("navigation.profile"),
          href: "/profile",
          icon: <User className="w-5 h-5" />,
          badge: null,
        },
        {
          name: t("navigation.security"),
          href: "/security",
          icon: <Shield className="w-5 h-5" />,
          badge: null,
        },
        {
          name: t("navigation.notifications"),
          href: "/notifications",
          icon: <Bell className="w-5 h-5" />,
          badge: null,
        },
        {
          name: t("navigation.settings"),
          href: "/settings",
          icon: <Settings className="w-5 h-5" />,
          badge: null,
        },
        {
          name: t("navigation.help"),
          href: "/help",
          icon: <HelpCircle className="w-5 h-5" />,
          badge: null,
        },
      ],
    },
  ];

  const isActive = (href) => location.pathname === href;

  const handleLinkClick = (href) => {
    navigate(href);
    if (onClose && isMobile) {
      onClose();
    }
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={
          isMobile
            ? { x: isOpen ? 0 : -280 }
            : { x: 0, width: isCollapsed ? 64 : 256 }
        }
        transition={{ type: "spring", stiffness: 350, damping: 35 }}
        className={cn(
          "fixed top-0 left-0 h-full z-50 flex flex-col",
          /* Premium glass sidebar */
          "bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950",
          "border-r border-white/[0.06]",
          /* Layered shadow for depth */
          "shadow-[4px_0_24px_rgba(0,0,0,0.18),2px_0_8px_rgba(0,0,0,0.12)]",
          "lg:static lg:translate-x-0",
          "w-64",
          className,
        )}
        {...props}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06]">
          <Link
            to="/dashboard"
            className={cn(
              "flex items-center gap-3 font-bold text-xl text-white",
              "hover:opacity-90 transition-opacity",
              isCollapsed && "lg:justify-center",
            )}
            onClick={() => handleLinkClick("/dashboard")}
          >
            <img
              src="/logo.png"
              alt="AfraPay"
              className="w-12 h-12 object-contain shrink-0"
            />
            {(!isCollapsed || isMobile) && (
              <span className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent font-bold tracking-tight">
                AfraPay
              </span>
            )}
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={toggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>

          {/* Mobile close */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User profile */}
        {user && (
          <div
            className={cn(
              "px-4 py-3 border-b border-white/[0.06]",
              isCollapsed && "lg:px-2",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-3",
                isCollapsed && "lg:justify-center",
              )}
            >
              <Avatar
                src={user.avatar}
                alt={user.name}
                size={isCollapsed ? "sm" : "md"}
                fallback={user.name?.charAt(0).toUpperCase()}
                className="shrink-0 ring-2 ring-white/10"
              />
              {(!isCollapsed || isMobile) && (
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate leading-none mb-0.5">
                    {user.name}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {user.email}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 scroll-premium">
          {navigationItems.map((section, sectionIndex) => (
            <div key={sectionIndex} className="mb-5 px-3">
              {(!isCollapsed || isMobile) && (
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2 px-2">
                  {section.section}
                </p>
              )}

              <div className="space-y-0.5">
                {section.items.map((item, itemIndex) => {
                  const active = isActive(item.href);
                  return (
                    <motion.button
                      key={itemIndex}
                      onClick={() => handleLinkClick(item.href)}
                      whileHover={{ x: 2 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 30,
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl",
                        "text-sm font-medium transition-all duration-150",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50",
                        active
                          ? [
                              "bg-gradient-to-r from-blue-600/20 to-teal-600/10",
                              "text-white border border-blue-500/20",
                              "shadow-[0_2px_8px_rgba(37,99,235,0.15)]",
                            ].join(" ")
                          : "text-slate-400 hover:text-white hover:bg-white/[0.06]",
                        isCollapsed && "lg:justify-center lg:px-2",
                      )}
                      title={isCollapsed ? item.name : undefined}
                    >
                      {/* Active indicator dot */}
                      <span
                        className={cn(
                          "shrink-0 transition-colors duration-150",
                          active ? "text-blue-400" : "",
                        )}
                      >
                        {item.icon}
                      </span>

                      {(!isCollapsed || isMobile) && (
                        <>
                          <span className="flex-1 text-left truncate">
                            {item.name}
                          </span>
                          {item.badge && (
                            <Badge
                              variant={item.badge.variant}
                              size="sm"
                              className="ml-auto shrink-0"
                            >
                              {item.badge.text}
                            </Badge>
                          )}
                          {active && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                          )}
                        </>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div
          className={cn(
            "px-4 py-3 border-t border-white/[0.06]",
            isCollapsed && "lg:px-2",
          )}
        >
          {(!isCollapsed || isMobile) && (
            <div className="text-[10px] text-slate-500 text-center space-y-0.5">
              <p className="font-semibold">© 2026 AfraPay</p>
              <p>Licensed · Secure · Trusted</p>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
};

export { DashboardSidebar };
