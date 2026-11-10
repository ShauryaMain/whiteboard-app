"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import JoinCard from "@/components/JoinCard";
import { call, problemText } from "@/lib/teaching";
import { takeReturn } from "@/lib/returnTo";

// A board's own link (/b/<token>): the owner turned on "anyone with the
// link can edit" and sent it. Signing in adds you to the board, which then
// shows on your boards page too.
export default function BoardLink() {
  const { token: raw } = useParams();
  const token = String(raw || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
  const router = useRouter();
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState("loading");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    takeReturn();
    call("board_link_peek", { p_token: token }).then((res) => {
      if (!live) return;
      if (res.data) {
        setInfo(res.data);
        setStatus("ready");
      } else if (res.error || res.missing) {
        setStatus("problem");
        setProblem(res.missing ? "Board links need a database update first (supabase/2026-11-security.sql)." : problemText(res));
      } else {
        setStatus("gone");
      }
    });
    return () => {
      live = false;
    };
  }, [token]);

  async function open() {
    setStatus("working");
    const res = await call("join_board_link", { p_token: token });
    const out = res.data;
    if (out && out.board) {
      router.replace(`/board/${out.board}`);
      return;
    }
    if (out && out.reason === "off") {
      setStatus("gone");
      return;
    }
    setStatus("problem");
    setProblem(problemText(res, "Couldn't open it just now. Check your connection and try again."));
  }

  if (status === "gone") {
    return (
      <JoinCard
        status="gone"
        title="This link doesn't work any more"
        text="Whoever shared it has turned the link off, or made a new one. Ask them to send it again."
      />
    );
  }
  const name = (info && info.name) || "a board";
  return (
    <JoinCard
      status={status}
      title={info ? `“${name}”` : "A board for you"}
      text={info ? (info.member ? "You're on this board already. Open it." : "You've been sent a board to write on together. Open it and it's on your boards page too.") : ""}
      problem={problem}
      action="Open the board"
      onGo={open}
      back={`/b/${token}`}
      sheet={{
        title: "Open the board",
        lead: "Sign in free to write on it. It stays on your boards page.",
        keeps: ["Write on it together, live", "It's on your boards page, for good", "Free, on your laptop, tablet and phone"],
      }}
    />
  );
}
