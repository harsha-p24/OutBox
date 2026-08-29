"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function Home() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
        const data = await res.json();
        if (data.user) {
          window.location.href = "/dashboard";
          return;
        }
      } catch {
        // no session, fall through to login screen
      } finally {
        setChecking(false);
      }
    }
    checkAuth();
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        Checking session...
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-950 text-white">
      <div className="text-center">
        <h1 className="text-3xl font-bold">OutBox</h1>
        <p className="mt-2 text-gray-400">Email campaign scheduler</p>
      </div>
      <a href={`${API_URL}/auth/google`} className="rounded bg-blue-600 px-5 py-3 font-medium hover:bg-blue-500">
        Sign in with Google
      </a>
    </main>
  );
}
