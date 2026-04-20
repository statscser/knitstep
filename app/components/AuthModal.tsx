"use client";

import { useState } from "react";
import type { Lang } from "../lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const C_GREEN  = "#8FAF96";
const C_MUTED  = "#9C8C7C";
const C_TEXT   = "#3D3530";
const C_BORDER = "#E0D4CA";
const C_ERROR  = "#C0705A";

// ─── Props ────────────────────────────────────────────────────────────────────

interface AuthModalProps {
  lang?: Lang;
  onLogin:       (email: string, password: string) => Promise<void>;
  onSignup:      (email: string, password: string) => Promise<void>;
  onLoginGoogle: () => Promise<void>;
  onClose:       () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthModal({
  lang = "zh",
  onLogin,
  onSignup,
  onLoginGoogle,
  onClose,
}: AuthModalProps) {
  const zh = lang === "zh";

  const [mode, setMode]       = useState<"signin" | "signup">("signin");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        await onLogin(email, password);
        onClose();
      } else {
        await onSignup(email, password);
        setSuccess(
          zh
            ? "注册成功！请检查邮箱完成验证。"
            : "Account created! Check your email to confirm.",
        );
      }
    } catch (err: any) {
      setError(err?.message ?? (zh ? "操作失败，请重试。" : "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      await onLoginGoogle();
      // Redirect will happen; no need to close modal
    } catch (err: any) {
      setError(err?.message ?? (zh ? "Google 登录失败，请重试。" : "Google sign-in failed. Please try again."));
      setLoading(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(61,53,48,0.38)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Card */}
      <div
        className="w-full max-w-sm rounded-3xl flex flex-col gap-5 p-6"
        style={{
          background: "var(--bg-card)",
          border: `1.5px solid ${C_BORDER}`,
          boxShadow: "0 20px 60px -10px rgba(0,0,0,0.15)",
          fontFamily: "var(--font-body)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-base font-bold" style={{ color: C_TEXT }}>
            {mode === "signin"
              ? (zh ? "登录 KnitStep" : "Sign in to KnitStep")
              : (zh ? "创建账号" : "Create account")}
          </p>
          <button
            onClick={onClose}
            style={{ color: C_MUTED, fontSize: 20, lineHeight: 1, background: "none", border: "none", cursor: "pointer" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: "10px 0", borderRadius: 14,
            border: `1.5px solid ${C_BORDER}`,
            background: "var(--bg)",
            color: C_TEXT, fontSize: 14, fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
            fontFamily: "var(--font-body)",
          }}
        >
          {/* Google "G" icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {zh ? "使用 Google 登录" : "Continue with Google"}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div style={{ flex: 1, height: 1, background: C_BORDER }} />
          <span style={{ fontSize: 12, color: C_MUTED }}>{zh ? "或" : "or"}</span>
          <div style={{ flex: 1, height: 1, background: C_BORDER }} />
        </div>

        {/* Email / Password form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={zh ? "邮箱地址" : "Email address"}
            required
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={zh ? "密码" : "Password"}
            required
            minLength={6}
            style={inputStyle}
          />

          {error   && <p style={{ fontSize: 12, color: C_ERROR }}>{error}</p>}
          {success && <p style={{ fontSize: 12, color: C_GREEN }}>{success}</p>}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 0", borderRadius: 14,
              background: loading ? "rgba(143,175,150,0.45)" : C_GREEN,
              border: "none", color: "#fff",
              fontSize: 14, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "var(--font-body)",
              transition: "background 0.18s",
            }}
          >
            {loading
              ? (zh ? "请稍候..." : "Please wait...")
              : mode === "signin"
                ? (zh ? "登录" : "Sign in")
                : (zh ? "创建账号" : "Create account")}
          </button>
        </form>

        {/* Mode toggle */}
        <p style={{ textAlign: "center", fontSize: 12, color: C_MUTED }}>
          {mode === "signin"
            ? (zh ? "还没有账号？" : "Don't have an account?")
            : (zh ? "已有账号？" : "Already have an account?")}
          {" "}
          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setSuccess(null); }}
            style={{ color: C_GREEN, fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "var(--font-body)" }}
          >
            {mode === "signin"
              ? (zh ? "立即注册" : "Sign up")
              : (zh ? "去登录" : "Sign in")}
          </button>
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: `1.5px solid ${C_BORDER}`,
  background: "var(--bg)",
  color: C_TEXT,
  fontSize: 14,
  fontFamily: "var(--font-body)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
