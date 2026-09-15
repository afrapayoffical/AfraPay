import React, { useState, useEffect } from "react";
import { Outlet, Link } from "react-router-dom";
import { Container } from "./Layout";
import LanguageSwitcher from "../common/LanguageSwitcher";
import { useLanguage } from "../../hooks/useLanguage";

/**
 * PublicLayout Component
 * Layout for public pages (landing, about, etc.)
 */
const PublicLayout = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { t } = useLanguage();

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setIsMobileMenuOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Close mobile menu on route navigation
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="min-h-screen">
      {/* Public header */}
      <header className="bg-gradient-to-r from-primary-900 via-primary-800 to-secondary-800 border-b-2 border-b-secondary-400 sticky top-0 z-40">
        <Container>
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center space-x-2">
              <Link to="/" aria-label="AfraPay – go to homepage">
                <span className="flex w-14 h-14 items-center justify-center rounded-xl bg-white p-1 shadow-md ring-1 ring-white/70">
                  <img
                    src="/logo.png"
                    alt="AfraPay logo"
                    className="w-full h-full object-contain"
                    width={56}
                    height={56}
                    loading="eager"
                  />
                </span>
              </Link>
              <Link
                to="/"
                className="font-bold text-xl text-white hover:text-primary-100 transition-colors"
              >
                AfraPay
              </Link>
            </div>

            {/* Desktop Navigation */}
            <nav
              className="hidden md:flex items-center space-x-8"
              aria-label="Main navigation"
            >
              <a
                href="#features"
                className="text-primary-100 hover:text-white transition-colors"
              >
                {t("navigation.features")}
              </a>
              <Link
                to="/pricing"
                className="text-primary-100 hover:text-white transition-colors"
              >
                {t("navigation.pricing")}
              </Link>
              <Link
                to="/about"
                className="text-primary-100 hover:text-white transition-colors"
              >
                {t("navigation.about")}
              </Link>
              <Link
                to="/contact"
                className="text-primary-100 hover:text-white transition-colors"
              >
                {t("navigation.contact")}
              </Link>
            </nav>

            {/* Desktop Auth buttons + Language Switcher */}
            <div className="hidden md:flex items-center space-x-3">
              <LanguageSwitcher variant="compact" />
              <Link
                to="/auth/login"
                className="text-primary-100 hover:text-white font-medium transition-colors"
              >
                {t("navigation.signIn")}
              </Link>
              <Link
                to="/auth/register"
                className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white px-4 py-2 rounded-lg hover:from-primary-700 hover:to-secondary-700 font-medium transition-all shadow-sm hover:shadow-md"
              >
                {t("navigation.getStarted")}
              </Link>
            </div>

            {/* Mobile right side — language picker + CTA + hamburger */}
            <div className="flex md:hidden items-center space-x-2">
              <LanguageSwitcher variant="compact" />
              <Link
                to="/auth/register"
                className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
              >
                {t("navigation.getStarted")}
              </Link>
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-menu"
              >
                {isMobileMenuOpen ? (
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </Container>

        {/* Mobile menu dropdown */}
        {isMobileMenuOpen && (
          <div
            id="mobile-menu"
            className="md:hidden bg-gradient-to-b from-primary-800 to-secondary-900 border-t border-primary-700/50 shadow-lg"
          >
            <Container>
              <nav className="py-4 space-y-1" aria-label="Mobile navigation">
                <a
                  href="#features"
                  onClick={closeMobileMenu}
                  className="flex items-center px-3 py-3 rounded-lg text-primary-100 hover:text-white hover:bg-white/10 font-medium transition-colors"
                >
                  {t("navigation.features")}
                </a>
                <Link
                  to="/pricing"
                  onClick={closeMobileMenu}
                  className="flex items-center px-3 py-3 rounded-lg text-primary-100 hover:text-white hover:bg-white/10 font-medium transition-colors"
                >
                  {t("navigation.pricing")}
                </Link>
                <Link
                  to="/about"
                  onClick={closeMobileMenu}
                  className="flex items-center px-3 py-3 rounded-lg text-primary-100 hover:text-white hover:bg-white/10 font-medium transition-colors"
                >
                  {t("navigation.about")}
                </Link>
                <Link
                  to="/contact"
                  onClick={closeMobileMenu}
                  className="flex items-center px-3 py-3 rounded-lg text-primary-100 hover:text-white hover:bg-white/10 font-medium transition-colors"
                >
                  {t("navigation.contact")}
                </Link>
                <div className="pt-2 border-t border-white/10">
                  <Link
                    to="/auth/login"
                    onClick={closeMobileMenu}
                    className="flex items-center px-3 py-3 rounded-lg text-primary-100 hover:text-white hover:bg-white/10 font-medium transition-colors"
                  >
                    {t("navigation.signIn")}
                  </Link>
                </div>
              </nav>
            </Container>
          </div>
        )}
      </header>

      {/* Content */}
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>

      {/* Footer */}
      <footer
        className="bg-gradient-to-r from-primary-950 to-secondary-950 text-white border-t-4 border-t-secondary-500"
        aria-label="Site footer"
      >
        <Container>
          <div className="py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {/* Company info */}
              <div className="col-span-1 md:col-span-2">
                <div className="flex items-center space-x-2 mb-4">
                  <span className="flex w-14 h-14 items-center justify-center rounded-xl bg-white p-1 shadow-md ring-1 ring-white/70">
                    <img
                      src="/logo.png"
                      alt="AfraPay logo"
                      className="w-full h-full object-contain"
                      width={56}
                      height={56}
                      loading="lazy"
                    />
                  </span>
                  <span className="font-bold text-xl">AfraPay</span>
                </div>
                <address className="not-italic">
                  <p className="text-neutral-400 max-w-md not-italic">
                    Empowering financial inclusion across Africa with secure,
                    fast, and affordable payment solutions.
                  </p>
                  <p className="text-neutral-500 text-sm mt-2">
                      Nairobi City , Kenya
                  </p>
                  <a
                    href="mailto:support@afrapayafrica.com"
                    className="text-neutral-400 hover:text-primary-400 transition-colors"
                  >
                    support@afrapayafrica.com
                  </a>
                </address>

                {/* Social Media Links */}
                <div className="mt-6">
                  <h4 className="text-sm font-semibold mb-3 text-white">
                    Follow Us
                  </h4>
                  <div className="flex items-center gap-4">
                    <a
                      href="https://x.com/afrapayoffical"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Follow AfraPay on Twitter"
                      className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-800 hover:bg-primary-600 transition-colors group"
                      title="Twitter"
                    >
                      <svg
                        className="w-5 h-5 text-neutral-300 group-hover:text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2s9 5 20 5a9.5 9.5 0 00-9-5.5c4.75 2.25 7-1 7-1" />
                      </svg>
                    </a>
                    <a
                      href="www.linkedin.com/in/afra-pay-undefined-795969420"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Follow AfraPay on LinkedIn"
                      className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-800 hover:bg-primary-600 transition-colors group"
                      title="LinkedIn"
                    >
                      <svg
                        className="w-5 h-5 text-neutral-300 group-hover:text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z" />
                        <circle cx="4" cy="4" r="2" />
                      </svg>
                    </a>
                    <a
                      href="https://www.facebook.com/people/Afra-Pay/pfbid02JvbyYYhLnr7vyNJG3L4eXxk77nP5JJeQYf6tR7d7JuESQmbzjiDZfTWZ4dMrQ9ftl/"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Follow AfraPay on Facebook"
                      className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-800 hover:bg-primary-600 transition-colors group"
                      title="Facebook"
                    >
                      <svg
                        className="w-5 h-5 text-neutral-300 group-hover:text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                    </a>
                    <a
                      href="https://www.instagram.com/afrapayoffical/"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Follow AfraPay on Instagram"
                      className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-800 hover:bg-primary-600 transition-colors group"
                      title="Instagram"
                    >
                      <svg
                        className="w-5 h-5 text-neutral-300 group-hover:text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <rect
                          x="2"
                          y="2"
                          width="20"
                          height="20"
                          rx="5"
                          ry="5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <circle
                          cx="17.5"
                          cy="6.5"
                          r="1.5"
                          fill="currentColor"
                        />
                      </svg>
                    </a>
                    <a
                      href="https://www.youtube.com/@AfraPay"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Follow AfraPay on YouTube"
                      className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-800 hover:bg-primary-600 transition-colors group"
                      title="YouTube"
                    >
                      <svg
                        className="w-5 h-5 text-neutral-300 group-hover:text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M23.498 6.186a2.994 2.994 0 00-2.11-2.11C19.635 3.5 12 3.5 12 3.5s-7.635 0-9.388.576a2.994 2.994 0 00-2.11 2.11C0 7.938 0 12 0 12s0 4.062.502 5.814a2.994 2.994 0 002.11 2.11C4.365 20.5 12 20.5 12 20.5s7.635 0 9.388-.576a2.994 2.994 0 002.11-2.11C24 16.062 24 12 24 12s0-4.062-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                    </a>
                    <a
                      href="https://www.tiktok.com/@afrapayoffical?is_from_webapp=1&sender_device=pc"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Follow AfraPay on TikTok"
                      className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-800 hover:bg-primary-600 transition-colors group"
                      title="TikTok"
                    >
                      <svg
                        className="w-5 h-5 text-neutral-300 group-hover:text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h3v-11h-3v11z" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>

              {/* Links */}
              <div>
                <h3 className="font-semibold mb-4">Product</h3>
                <ul
                  className="space-y-2 text-neutral-400"
                  aria-label="Product links"
                >
                  <li>
                    <Link to="/" className="hover:text-white">
                      Features
                    </Link>
                  </li>
                  <li>
                    <Link to="/pricing" className="hover:text-white">
                      Pricing
                    </Link>
                  </li>
                  <li>
                    <Link to="/" className="hover:text-white">
                      API
                    </Link>
                  </li>
                  <li>
                    <Link to="/security-info" className="hover:text-white">
                      Security
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold mb-4">Company</h3>
                <ul
                  className="space-y-2 text-neutral-400"
                  aria-label="Company links"
                >
                  <li>
                    <Link to="/about" className="hover:text-white">
                      About
                    </Link>
                  </li>
                  <li>
                    <Link to="/careers" className="hover:text-white">
                      Careers
                    </Link>
                  </li>
                  <li>
                    <Link to="/blog" className="hover:text-white">
                      Blog
                    </Link>
                  </li>
                  <li>
                    <Link to="/contact" className="hover:text-white">
                      Contact
                    </Link>
                  </li>
                </ul>
              </div>
            </div>

            <div className="border-t border-neutral-800 mt-8 pt-8 text-center text-neutral-400">
              <p>
                &copy; {new Date().getFullYear()} AfraPay Africa Limited. All
                rights reserved.
              </p>
              <nav
                aria-label="Legal"
                className="mt-2 flex justify-center gap-4 text-sm"
              >
                <Link
                  to="/privacy"
                  className="hover:text-white transition-colors"
                >
                  Privacy Policy
                </Link>
                <Link
                  to="/terms"
                  className="hover:text-white transition-colors"
                >
                  Terms of Service
                </Link>
                <Link
                  to="/security-info"
                  className="hover:text-white transition-colors"
                >
                  Security
                </Link>
              </nav>
            </div>
          </div>
        </Container>
      </footer>
    </div>
  );
};

export { PublicLayout };
