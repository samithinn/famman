"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [consented, setConsented] = useState(false);

  const handleGoogleLogin = async () => {
    if (!consented) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "#fafafa" }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center gap-6">
        <div className="text-center">
          <div className="text-5xl mb-3">💰</div>
          <h1 className="text-2xl font-black" style={{ color: "#1f2937" }}>
            Family Expenses
          </h1>
          <p className="text-sm font-semibold mt-1" style={{ color: "#9ca3af" }}>
            Track your family finances together
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer w-full">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 accent-pink-500 w-4 h-4 flex-shrink-0"
          />
          <span className="text-xs font-semibold leading-relaxed" style={{ color: "#6b7280" }}>
            I understand that the app administrator can view all expense data entered by any user on this platform.
          </span>
        </label>

        <button
          onClick={handleGoogleLogin}
          disabled={!consented}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all"
          style={{
            borderColor: consented ? "#f3e8ff" : "#f3f4f6",
            color: consented ? "#374151" : "#d1d5db",
            cursor: consented ? "pointer" : "not-allowed",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.583 9 3.583z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <p className="text-xs font-semibold text-center" style={{ color: "#d1d5db" }}>
          Open to anyone with a Google account
        </p>
      </div>
    </div>
  );
}
