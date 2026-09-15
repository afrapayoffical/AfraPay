/* eslint-disable no-console */
import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { GoogleLogin } from "@react-oauth/google";
/* import FacebookLogin from "@greatsumini/react-facebook-login"; */
import { authAPI } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import SEOHead from "../../components/seo/SEOHead";
import { useTranslation } from "../../utils/accessibility";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, setAuthFromBackend } = useAuth();
  const { t } = useTranslation();
  // Where to send the user after login (supports "from" redirect state)
  const from = location.state?.from?.pathname || "/dashboard";
  const [formData, setFormData] = useState(() => {
    // Restore remembered email + checkbox on page load
    const rememberedEmail =
      localStorage.getItem("afrapay_remembered_email") || "";
    return {
      email: rememberedEmail,
      password: "",
      rememberMe: !!rememberedEmail,
    };
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  // successMessage: shown when coming back from registration
  const [successMessage, setSuccessMessage] = useState("");
  const [mfaState, setMfaState] = useState({
    required: false,
    token: "",
    challengeType: "",
    code: "",
    loading: false,
  });

  // Navigate after isAuthenticated state is committed — avoids the race condition
  // where navigate() fires before setIsAuthenticated(true) is flushed to the DOM.
  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  // Pick up the success message passed by the Register page
  useEffect(() => {
    if (location.state?.message) {
      setSuccessMessage(location.state.message);
      // Clear so it doesn’t reappear on back-navigation
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);

    try {
      // Make API call to backend
      const response = await authAPI.login({
        email: formData.email,
        password: formData.password,
        rememberMe: formData.rememberMe,
      });

      if (response.success) {
        // Persist or clear remembered email based on checkbox
        if (formData.rememberMe) {
          localStorage.setItem("afrapay_remembered_email", formData.email);
        } else {
          localStorage.removeItem("afrapay_remembered_email");
        }

        // MFA challenge — backend returns 200 but the login is not yet complete.
        // The MFA check was only in the catch block before, which missed 200 responses.
        if (response.data?.mfaRequired) {
          const { mfaToken, challengeType } = response.data;
          toast.success(
            challengeType === "totp"
              ? "Please enter the code from your authenticator app."
              : `Verification code sent via ${challengeType}. Please enter it below.`,
          );
          setMfaState((s) => ({
            ...s,
            required: true,
            token: mfaToken,
            challengeType,
          }));
          return;
        }

        // Hydrate AuthContext — the isAuthenticated useEffect above will
        // navigate once the state update is committed (no race condition).
        if (response.data?.user) {
          setAuthFromBackend(response.data.user);
        }
        toast.success("Login successful!");
      } else {
        toast.error(response.error?.message || "Login failed");
      }
    } catch (error) {
      console.error("Login error:", error);

      // EMAIL_NOT_VERIFIED — show inline banner instead of a generic toast
      if (error.response?.data?.error?.code === "EMAIL_NOT_VERIFIED") {
        setEmailNotVerified(true);
        setLoading(false);
        return;
      }

      // Check if MFA is required
      if (error.response?.data?.data?.mfaRequired) {
        const { mfaToken, challengeType } = error.response.data.data;
        toast.success(
          `Verification code sent via ${challengeType}. Please enter it below.`,
        );
        setMfaState((s) => ({
          ...s,
          required: true,
          token: mfaToken,
          challengeType,
        }));
        setLoading(false);
        return;
      }

      // Always show an error toast — interceptor no longer does this for auth endpoints
      const message =
        error.response?.data?.error?.message ||
        (error.response
          ? "Invalid credentials"
          : "Unable to connect to server. Please check your connection.");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const handleResendVerification = async () => {
    if (!formData.email) {
      toast.error("Please enter your email address first");
      return;
    }
    setResendLoading(true);
    try {
      await authAPI.resendVerificationEmail(formData.email);
      toast.success("Verification email sent! Please check your inbox.");
      setEmailNotVerified(false);
    } catch {
      toast.error("Failed to resend. Please try again.");
    } finally {
      setResendLoading(false);
    }
  };

  // Google Sign-In — GoogleLogin component (from @react-oauth/google) calls this
  // with a credential (signed JWT/ID token from Google). We forward it to our
  // backend which verifies it cryptographically via google-auth-library.
  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const response = await authAPI.googleLogin(credentialResponse.credential);
      if (response.success) {
        if (response.data?.mfaRequired) {
          // TOTP required — store credential so we can re-submit after verification
          setMfaState((s) => ({
            ...s,
            required: true,
            token: null,
            challengeType: "totp",
            oauthType: "google",
            oauthCredential: credentialResponse.credential,
          }));
          toast.success("Please enter the code from your authenticator app.");
          return;
        }
        if (response.data?.user) {
          setAuthFromBackend(response.data.user);
        }
        toast.success(
          response.data?.user?.isNewUser
            ? "Account created! Welcome to AfraPay."
            : "Login successful!",
        );
        // Navigation handled by isAuthenticated useEffect
      }
    } catch (error) {
      console.error("Google login error:", error);
      const message =
        error.response?.data?.error?.message ||
        "Google sign-in failed. Please try again.";
      toast.error(message);
    }
  };

  const handleGoogleError = () => {
    toast.error("Google sign-in was cancelled or failed.");
  };



  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    if (!mfaState.code.trim()) {
      toast.error("Please enter the verification code");
      return;
    }
    setMfaState((s) => ({ ...s, loading: true }));
    try {
      let mfaResponse;

      if (mfaState.oauthType === "google") {
        // Re-submit Google credential with TOTP code
        mfaResponse = await authAPI.googleLogin(
          mfaState.oauthCredential,
          mfaState.code.trim(),
        );
      } else if (mfaState.oauthType === "facebook") {
        // Re-submit Facebook credential with TOTP code
        const { accessToken, userID } = mfaState.oauthCredential;
        mfaResponse = await authAPI.facebookLogin(
          accessToken,
          userID,
          mfaState.code.trim(),
        );
      } else {
        // The backend verifies TOTP as part of the login request — re-submit
        // the original credentials together with the mfaCode. The login
        // controller reads mfaCode from req.body and completes auth.
        mfaResponse = await authAPI.login({
          email: formData.email,
          password: formData.password,
          rememberMe: formData.rememberMe,
          mfaCode: mfaState.code.trim(),
        });
      }

      if (mfaResponse.success && mfaResponse.data?.user) {
        setAuthFromBackend(mfaResponse.data.user);
        toast.success("Login successful!");
        // Navigation handled by isAuthenticated useEffect
      } else {
        toast.error("Verification failed. Please try again.");
      }
    } catch (mfaError) {
      const message =
        mfaError.response?.data?.error?.message || "Invalid verification code";
      toast.error(message);
    } finally {
      setMfaState((s) => ({ ...s, loading: false }));
    }
  };

  // Inline MFA verification form — avoids window.prompt() which is blocked
  // on iOS WKWebView, Android WebView, and PWA standalone mode
  if (mfaState.required) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">
            Verify Your Identity
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            {mfaState.challengeType === "totp"
              ? "Open your authenticator app and enter the 6-digit code."
              : `A verification code was sent via ${mfaState.challengeType}. Please enter it below.`}
          </p>
        </div>
        <form onSubmit={handleMfaSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="mfaCode"
              className="block text-sm font-semibold text-primary-800"
            >
              Verification Code *
            </label>
            <input
              type="text"
              id="mfaCode"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              value={mfaState.code}
              onChange={(e) =>
                setMfaState((s) => ({
                  ...s,
                  code: e.target.value.replace(/\D/g, ""),
                }))
              }
              placeholder="Enter 6-digit code"
              disabled={mfaState.loading}
              required
              className="w-full px-4 py-3 border rounded-lg shadow-sm text-base text-center tracking-widest transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 border-primary-200 bg-white text-neutral-900 min-h-[44px] font-medium"
            />
          </div>
          <button
            type="submit"
            disabled={mfaState.loading}
            className="w-full inline-flex items-center justify-center px-6 py-3 text-base font-semibold text-white bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 focus:ring-primary-500 focus:ring-2 focus:ring-offset-2 rounded-lg transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            {mfaState.loading ? "Verifying..." : "Verify Code"}
          </button>
          <button
            type="button"
            onClick={() =>
              setMfaState({
                required: false,
                token: "",
                challengeType: "",
                code: "",
                loading: false,
              })
            }
            className="w-full text-sm text-neutral-600 hover:text-neutral-900 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
          >
            ← Back to login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SEOHead
        title="Sign In"
        description="Sign in to your AfraPay account."
        noIndex={true}
      />
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">
          {t("auth.welcomeBack")}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          {t("auth.signInSubtitle")}
        </p>
      </div>

      {/* Registration success banner */}
      {successMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          <svg
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Email-not-verified banner */}
      {emailNotVerified && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-semibold mb-1">Email not verified</p>
          <p className="mb-2">
            You must verify your email address before signing in. Check your
            inbox for the verification link we sent when you registered.
          </p>
          <button
            type="button"
            onClick={handleResendVerification}
            disabled={resendLoading}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:opacity-50"
          >
            {resendLoading ? "Sending…" : "Resend verification email"}
          </button>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email Field */}
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-primary-800"
          >
            {t("auth.emailAddress")} *
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder={t("auth.email")}
            disabled={loading}
            required
            className="w-full px-4 py-3 border rounded-lg shadow-sm text-base sm:text-sm transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 hover:border-primary-300 hover:shadow-md border-primary-200 bg-white text-neutral-900 min-h-[44px] font-medium"
          />
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <label
            htmlFor="password"
            className="block text-sm font-semibold text-primary-800"
          >
            {t("auth.password")} *
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter your password"
              disabled={loading}
              required
              className="w-full px-4 py-3 border rounded-lg shadow-sm text-base sm:text-sm transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 hover:border-primary-300 hover:shadow-md border-primary-200 bg-white text-neutral-900 min-h-[44px] font-medium pr-12"
            />
            <button
              type="button"
              onClick={togglePasswordVisibility}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg
                  className="w-5 h-5 text-neutral-400 hover:text-neutral-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5 text-neutral-400 hover:text-neutral-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Remember me and Forgot password */}
        <div className="flex items-center justify-between">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              name="rememberMe"
              checked={formData.rememberMe}
              onChange={handleChange}
              disabled={loading}
              className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="ml-2 text-sm text-neutral-600">
              {t("auth.rememberMe")}
            </span>
          </label>

          <Link
            to="/auth/reset-password"
            className="text-sm text-primary-600 hover:text-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded"
          >
            {t("auth.forgotPassword")}
          </Link>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center px-6 py-3 text-base font-semibold text-white bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 active:from-primary-800 active:to-secondary-800 focus:ring-primary-500 focus:ring-2 focus:ring-offset-2 hover:shadow-lg active:shadow-md transform hover:-translate-y-0.5 active:translate-y-0 rounded-lg transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none min-h-[48px]"
        >
          {loading ? (
            <>
              <svg
                className="w-4 h-4 mr-2 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              {t("auth.signingIn")}
            </>
          ) : (
            t("auth.signIn")
          )}
        </button>
      </form>

      {/* Social login divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-neutral-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-neutral-500">
            {t("auth.orContinueWith")}
          </span>
        </div>
      </div>

      {/* Social login buttons */}
      <div className="grid grid-cols-2 gap-3">
        {/* Google — GoogleLogin renders Google's button, calls handleGoogleSuccess with a signed ID token */}
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={handleGoogleError}
          useOneTap={false}
          shape="rectangular"
          size="large"
          theme="outline"
          text="signin_with"
          logo_alignment="left"
          width="160"
        />

        {/* Facebook — opens FB OAuth popup, returns accessToken + userID */}
        {/* <FacebookLogin
          appId={process.env.REACT_APP_FACEBOOK_APP_ID || ""}
          onSuccess={handleFacebookSuccess}
          onFail={handleFacebookError}
          usePopup
          render={({ onClick }) => (
            <button
              type="button"
              onClick={onClick}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-primary-700 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 active:bg-primary-100 focus:ring-primary-500 focus:ring-2 focus:ring-offset-2 transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              Facebook
            </button>
          )}
        /> */}
      </div>

      {/* Sign up link */}
      <div className="text-center">
        <p className="text-sm text-neutral-600">
          {t("auth.dontHaveAccount")}{" "}
          <Link
            to="/auth/register"
            className="font-medium text-primary-600 hover:text-primary-500"
          >
            {t("auth.signUpFree")}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
