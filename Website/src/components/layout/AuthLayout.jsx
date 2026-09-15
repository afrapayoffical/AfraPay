import React from "react";
import { Outlet } from "react-router-dom";

/**
 * AuthLayout Component
 * Layout for authentication pages (login, register, etc.)
 */
const AuthLayout = () => {
  return (
    <div className="min-h-screen [min-height:100svh] bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-700 flex items-center justify-center py-6 px-3 sm:py-12 sm:px-6 lg:px-8 overflow-x-hidden">
      <div className="w-full max-w-md min-w-0 space-y-6 sm:space-y-8">
        {/* Logo */}
        <div className="text-center">
          <span className="mx-auto flex w-24 h-24 sm:w-36 sm:h-36 items-center justify-center rounded-2xl bg-white p-1.5 sm:p-2 shadow-xl ring-1 ring-white/80">
            <img
              src="/logo.png"
              alt="AfraPay"
              className="w-full h-full object-contain"
            />
          </span>
          <h1 className="mt-3 sm:mt-4 text-2xl sm:text-3xl font-bold text-white">
            AfraPay
          </h1>
          <p className="mt-2 text-sm text-primary-200">
            Secure and fast payments for Africa
          </p>
        </div>

        {/* Content */}
        <div className="w-full min-w-0 bg-white rounded-2xl shadow-2xl border-0 p-4 sm:p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary-600 to-secondary-500"></div>
          <Outlet />
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-primary-200">
          <p>&copy; 2026 AfraPay. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export { AuthLayout };
