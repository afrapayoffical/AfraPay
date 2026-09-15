/**
 * schemas.js — centralized JSON-LD structured data for every AfraPay page.
 *
 * Uses schema.org vocabulary.  Each exported constant is ready to be passed
 * as the `structuredData` prop of <SEOHead />.
 *
 * Google's structured data guidelines:
 *  https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
 */

import { SITE_BASE_URL, SITE_NAME } from "./SEOHead";

// ── Shared building blocks ──────────────────────────────────────────────────

export const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE_BASE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_BASE_URL,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_BASE_URL}/logo.png`,
    width: 192,
    height: 192,
  },
  description:
    "AfraPay is a secure digital payment platform enabling fast transfers, business tills, and financial services across Africa.",
  foundingDate: "2024",
  areaServed: "Africa",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Juba",
    addressCountry: "SS",
  },
  contactPoint: {
    "@type": "ContactPoint",
    telephone: "+211-92-000-0000",
    email: "support@afrapayafrica.com",
    contactType: "customer service",
    availableLanguage: ["English"],
  },
  sameAs: [
    "https://twitter.com/AfraPay",
    "https://www.linkedin.com/company/afrapay",
    "https://www.facebook.com/AfraPay",
  ],
};

export const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE_BASE_URL}/#website`,
  url: SITE_BASE_URL,
  name: SITE_NAME,
  publisher: { "@id": `${SITE_BASE_URL}/#organization` },
  inLanguage: "en-US",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_BASE_URL}/blog?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

// ── Per-page schemas ────────────────────────────────────────────────────────

/** Home / Landing page */
export const SCHEMA_HOME = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    WEBSITE,
    {
      "@type": "WebPage",
      "@id": `${SITE_BASE_URL}/#webpage`,
      url: SITE_BASE_URL,
      name: `${SITE_NAME} – Secure Payments Across Africa`,
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      about: { "@id": `${SITE_BASE_URL}/#organization` },
      description:
        "AfraPay enables secure global payments, business tills, and fast mobile transfers across Africa.",
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
        ],
      },
    },
    {
      "@type": "FinancialService",
      "@id": `${SITE_BASE_URL}/#service`,
      name: SITE_NAME,
      url: SITE_BASE_URL,
      description:
        "Digital payment platform enabling secure transfers and financial inclusion across Africa.",
      provider: { "@id": `${SITE_BASE_URL}/#organization` },
      areaServed: "Africa",
      serviceType: "Digital Payments",
    },
  ],
};

/** Pricing page */
export const SCHEMA_PRICING = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "WebPage",
      "@id": `${SITE_BASE_URL}/pricing#webpage`,
      url: `${SITE_BASE_URL}/pricing`,
      name: "Pricing Plans | AfraPay",
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Pricing",
            item: `${SITE_BASE_URL}/pricing`,
          },
        ],
      },
    },
    {
      "@type": "ItemList",
      name: "AfraPay Pricing Plans",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Starter",
          description:
            "Free plan for individuals — transfers up to $500/month.",
          url: `${SITE_BASE_URL}/pricing#starter`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Professional",
          description:
            "Unlimited transfers, advanced analytics, multi-currency support.",
          url: `${SITE_BASE_URL}/pricing#professional`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Enterprise",
          description:
            "White-label solutions, dedicated account management, SLA guarantees.",
          url: `${SITE_BASE_URL}/pricing#enterprise`,
        },
      ],
    },
  ],
};

/** About page */
export const SCHEMA_ABOUT = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "AboutPage",
      "@id": `${SITE_BASE_URL}/about#webpage`,
      url: `${SITE_BASE_URL}/about`,
      name: "About AfraPay | Our Mission & Team",
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      about: { "@id": `${SITE_BASE_URL}/#organization` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "About",
            item: `${SITE_BASE_URL}/about`,
          },
        ],
      },
    },
  ],
};

/** Blog listing page */
export const SCHEMA_BLOG = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "Blog",
      "@id": `${SITE_BASE_URL}/blog#blog`,
      url: `${SITE_BASE_URL}/blog`,
      name: "AfraPay Blog – Fintech Insights & News",
      publisher: { "@id": `${SITE_BASE_URL}/#organization` },
      inLanguage: "en-US",
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: `${SITE_BASE_URL}/blog`,
          },
        ],
      },
    },
  ],
};

/** Contact page */
export const SCHEMA_CONTACT = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "ContactPage",
      "@id": `${SITE_BASE_URL}/contact#webpage`,
      url: `${SITE_BASE_URL}/contact`,
      name: "Contact AfraPay | Get in Touch",
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Contact",
            item: `${SITE_BASE_URL}/contact`,
          },
        ],
      },
    },
  ],
};

/** Careers page */
export const SCHEMA_CAREERS = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "WebPage",
      "@id": `${SITE_BASE_URL}/careers#webpage`,
      url: `${SITE_BASE_URL}/careers`,
      name: "Careers at AfraPay | Join Our Team",
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Careers",
            item: `${SITE_BASE_URL}/careers`,
          },
        ],
      },
    },
    {
      "@type": "JobPosting",
      title: "Senior Backend Engineer",
      description:
        "Build and scale the payment infrastructure that serves millions of African users.",
      hiringOrganization: { "@id": `${SITE_BASE_URL}/#organization` },
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Juba",
          addressCountry: "SS",
        },
      },
      employmentType: "FULL_TIME",
      datePosted: "2026-03-01",
    },
  ],
};

/** Security info page */
export const SCHEMA_SECURITY = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "WebPage",
      "@id": `${SITE_BASE_URL}/security-info#webpage`,
      url: `${SITE_BASE_URL}/security-info`,
      name: "Security at AfraPay | How We Protect You",
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Security",
            item: `${SITE_BASE_URL}/security-info`,
          },
        ],
      },
    },
  ],
};

/** Terms of Service page */
export const SCHEMA_TERMS = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "WebPage",
      "@id": `${SITE_BASE_URL}/terms#webpage`,
      url: `${SITE_BASE_URL}/terms`,
      name: "Terms of Service | AfraPay",
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Terms of Service",
            item: `${SITE_BASE_URL}/terms`,
          },
        ],
      },
    },
  ],
};

/** Privacy Policy page */
export const SCHEMA_PRIVACY = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "WebPage",
      "@id": `${SITE_BASE_URL}/privacy#webpage`,
      url: `${SITE_BASE_URL}/privacy`,
      name: "Privacy Policy | AfraPay",
      isPartOf: { "@id": `${SITE_BASE_URL}/#website` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Privacy Policy",
            item: `${SITE_BASE_URL}/privacy`,
          },
        ],
      },
    },
  ],
};

/** Help & Support page (public) */
export const SCHEMA_HELP = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "FAQPage",
      "@id": `${SITE_BASE_URL}/help#webpage`,
      name: "Help & Support | AfraPay",
      url: `${SITE_BASE_URL}/help`,
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Help",
            item: `${SITE_BASE_URL}/help`,
          },
        ],
      },
    },
  ],
};
