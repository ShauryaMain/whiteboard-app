"use client";

import { useState } from "react";
import { sendEmailCode, verifyEmailCode } from "@/lib/emailCode";
import { noteSignInStarted } from "@/lib/signInNote";
import { track } from "@/lib/track";
import d from "./Dialog.module.css";
import o from "./Onboarding.module.css";

// "Email me a code": type an email address, get a 6-digit code, type it
// in, and you're signed in (a new account is made the first time). For
// anyone who'd rather not use Google, or whose school blocks it.
//
//   client      the Supabase client to sign in with (the real one, even
//               on the demo page: see getRealClient)
//   from        where this form is, for the sign-in counts ("signin_page",
//               "demo_sheet")
//   onSignedIn  called once signed in
//   onBefore    called just before the code is checked (the demo keeps the
//               board then)
export default function EmailCodeSignIn({ client, from = "signin_page", onSignedIn, onBefore, primary = false }) {
  const [step, setStep] = useState("email"); // email | code
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");

  async function send(e) {
    if (e) e.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!address) {
      setProblem("Type your email address first.");
      return;
    }
    setBusy(true);
    setProblem("");
    track("signin_started", { method: "email", trigger: from });
    const result = await sendEmailCode(address);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setStep("code");
    setCode("");
    setNote(`We sent a code to ${address}. It can take a minute to arrive, so check Spam or Promotions too.`);
  }

  async function check(e) {
    if (e) e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem("");
    if (onBefore) onBefore();
    noteSignInStarted("email", from);
    const result = await verifyEmailCode(client, email.trim(), code);
    if (!result.ok) {
      setBusy(false);
      setProblem(result.message);
      return;
    }
    if (onSignedIn) onSignedIn(result.user);
  }

  if (step === "code") {
    return (
      <form className={o.emailForm} onSubmit={check} noValidate>
        <p className={o.emailNote} role="status">{note}</p>
        <label className={d.label}>
          Code from the email
          <input
            className={`${d.input} ${o.codeInput}`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 12))}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Code from the email"
            placeholder="123 456"
            autoFocus
          />
        </label>
        {problem && <p className={o.problem} role="alert">{problem}</p>}
        <button type="submit" className={`${d.btn} ${d.btnPrimary} ${o.wide}`} disabled={busy || code.replace(/\D/g, "").length < 6}>
          {busy ? "Signing you in…" : "Sign in"}
        </button>
        <div className={o.linkRow}>
          <button type="button" className={o.textBtn} onClick={() => { setStep("email"); setProblem(""); }}>
            Use a different email
          </button>
          <button type="button" className={o.textBtn} onClick={send} disabled={busy}>
            Send a new code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className={o.emailForm} onSubmit={send} noValidate>
      <label className={d.label}>
        Email
        <input
          className={d.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          placeholder="you@school.edu"
          aria-label="Email"
        />
      </label>
      {problem && <p className={o.problem} role="alert">{problem}</p>}
      <button type="submit" className={`${d.btn} ${primary ? d.btnPrimary : ""} ${o.wide}`} disabled={busy}>
        {busy ? "Sending…" : "Email me a code"}
      </button>
    </form>
  );
}
