/**
 * PostgreSQL Connection — Stubs
 *
 * PostgreSQL has been removed from AfraPay.  This file exists only as a
 * compatibility shim so connection.js can be required without crashing.
 * All functions throw if called — no real DB connection is exposed.
 */

"use strict";

const createError = (msg) => {
  const e = new Error(msg);
  e.code = "PG_NOT_AVAILABLE";
  return e;
};

module.exports = {
  query: () => Promise.reject(createError("PostgreSQL not configured for AfraPay")),
  pool: { query: () => Promise.reject(createError("PostgreSQL not configured for AfraPay")) },
  Client: class {
    connect() {
      return Promise.reject(createError("PostgreSQL not configured for AfraPay"));
    }
    query() {
      return Promise.reject(createError("PostgreSQL not configured for AfraPay"));
    }
    end() {
      return Promise.resolve();
    }
  },
};
