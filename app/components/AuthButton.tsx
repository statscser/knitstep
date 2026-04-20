"use client";

import { useState, useRef, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import type { Lang } from "../lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const C_GREEN  = "#8FAF96";
const C_MUTED  = "#9C8C7C";
const C_TEXT   = "#3D3530";
const C_BORDER = "#E0D4CA";

// ─── Props ────────────────────────────────────────────────────────────────────

interface AuthButtonProps {
  user:        User | null;
  authLoading: boolean;
  isSyncing:   boolean;
  lang?:       Lang;
  onOpenModal: () => void;
  onLogout:    () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthButton({
  user,
  authLoading,
  isSyncing,
  lang = "zh",
  onOpenModal,
  onLogout,
}: AuthButtonProps) {
  const zh = lang === "zh";
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popoverOpen]);

  if (authLoading) {
    // Subtle placeholder while auth resolves (usually < 200 ms)
    return <div style={{ width: 32, height: 32 }} />;
  }

  if (!user) {
    // ── Not logged in: "Sign In" pill ────────────────────────────────────────
    return (
      <button
        onClick={onOpenModal}
        style={{
          padding:      "5px 14px",
          borderRadius: 999,
          border:       `1.5px solid ${C_BORDER}`,
          background:   "var(--bg-card)",
          color:        C_TEXT,
          fontSize:     12,
          fontWeight:   600,
          cursor:       "pointer",
          fontFamily:   "var(--font-body)",
          whiteSpace:   "nowrap",
        }}
      >
        {zh ? "登录" : "Sign in"}
      </button>
    );
  }

  // ── Logged in: avatar circle with email initials ──────────────────────────
  const initials = (user.email ?? "?").slice(0, 1).toUpperCase();
  const email    = user.email ?? "";

  return (
    <div ref={popoverRef} style={{ position: "relative" }}>
      <button
        onClick={() => setPopoverOpen((v) => !v)}
        title={email}
        style={{
          width:          32,
          height:         32,
          borderRadius:   "50%",
          background:     isSyncing ? "rgba(143,175,150,0.5)" : C_GREEN,
          border:         "none",
          color:          "#fff",
          fontSize:       13,
          fontWeight:     700,
          cursor:         "pointer",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          position:       "relative",
          transition:     "background 0.2s",
          fontFamily:     "var(--font-body)",
        }}
      >
        {isSyncing ? (
          // Spinner while syncing
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#fff" strokeWidth="2.5" strokeLinecap="round"
            style={{ animation: "spin 0.8s linear infinite" }}
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
            <path d="M12 2 a10 10 0 0 1 10 10" />
          </svg>
        ) : initials}
      </button>

      {/* Popover */}
      {popoverOpen && (
        <div
          style={{
            position:     "absolute",
            top:          "calc(100% + 8px)",
            right:        0,
            minWidth:     180,
            background:   "var(--bg-card)",
            border:       `1.5px solid ${C_BORDER}`,
            borderRadius: 16,
            boxShadow:    "0 8px 24px -4px rgba(0,0,0,0.12)",
            padding:      "12px 14px",
            zIndex:       50,
            display:      "flex",
            flexDirection: "column",
            gap:          10,
          }}
        >
          {/* Email display */}
          <p style={{ fontSize: 11, color: C_MUTED, wordBreak: "break-all", margin: 0 }}>
            {email}
          </p>

          {/* Syncing indicator */}
          {isSyncing && (
            <p style={{ fontSize: 12, color: C_GREEN, fontWeight: 600, margin: 0 }}>
              {zh ? "⟳ 正在同步..." : "⟳ Syncing..."}
            </p>
          )}

          {/* Sign out button */}
          <button
            onClick={() => { setPopoverOpen(false); onLogout(); }}
            style={{
              padding:      "7px 0",
              borderRadius: 10,
              border:       `1.5px solid ${C_BORDER}`,
              background:   "transparent",
              color:        C_TEXT,
              fontSize:     13,
              fontWeight:   600,
              cursor:       "pointer",
              fontFamily:   "var(--font-body)",
            }}
          >
            {zh ? "退出登录" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
