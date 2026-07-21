"use client";

import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

/// Everything behind this gate assumes an owner is signed in. The rules are the
/// real enforcement — this only decides what to render.
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth(), (u) => {
    setUser(u);
    setReady(true);
  }), []);

  if (!ready) {
    return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>;
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-xl font-bold text-white">Content Station</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-400">Owner sign-in</p>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await signInWithEmailAndPassword(auth(), email, password);
            } catch (err) {
              setError(err instanceof Error ? err.message : "sign-in failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white"
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-white px-3 py-2 font-semibold text-black disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <>
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-4 text-xs text-zinc-500">
        <span>{user.email}</span>
        <button onClick={() => signOut(auth())} className="hover:text-white">
          Sign out
        </button>
      </div>
      {children}
    </>
  );
}
