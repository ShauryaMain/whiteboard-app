"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import JoinCard from "@/components/JoinCard";
import { call, problemText } from "@/lib/teaching";
import { takeReturn } from "@/lib/returnTo";

// A notebook a teacher made for one student (/s/<token>): opening it and
// signing in makes it the student's own; the teacher stays linked to it.
export default function StudentNotebookInvite() {
  const { token: raw } = useParams();
  const token = String(raw || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
  const router = useRouter();
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState("loading");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    takeReturn();
    call("student_notebook_peek", { p_token: token }).then((res) => {
      if (!live) return;
      if (res.data) {
        setInfo(res.data);
        setStatus(res.data.claimed && !res.data.mine ? "gone" : "ready");
      } else if (res.error || res.missing) {
        setStatus("problem");
        setProblem(problemText(res));
      } else {
        setStatus("gone");
      }
    });
    return () => {
      live = false;
    };
  }, [token]);

  async function claim() {
    setStatus("working");
    const res = await call("student_notebook_claim", { p_token: token });
    const out = res.data;
    if (out && out.board) {
      router.replace(`/board/${out.board}`);
      return;
    }
    setStatus("problem");
    setProblem(
      out && out.reason === "yours"
        ? "You made this notebook: send this link to your student. (Open it from your Teaching page.)"
        : out && out.reason === "taken"
          ? "Someone else has already opened this notebook."
          : problemText(res, "Couldn't open it just now. Check your connection and try again.")
    );
  }

  if (status === "gone") {
    return (
      <JoinCard
        status="gone"
        title="This invite doesn't work"
        text={info && info.claimed ? "Someone has already opened it. Ask your teacher for a new one." : "Your teacher may have made a new link. Ask them for it."}
      />
    );
  }
  const teacher = (info && info.teacher) || "Your teacher";
  return (
    <JoinCard
      status={status}
      title={info ? (info.mine ? `Your notebook: ${info.name}` : `${teacher} made you a notebook`) : "A notebook for you"}
      text={
        info
          ? info.yours
            ? "This is the invite you made. Send it to your student."
            : info.mine
              ? "It's yours. Open it."
              : `“${info.name}”. Open it and it's yours to keep: ${teacher} can send work into it and mark it.`
          : ""
      }
      problem={problem}
      action={info && info.yours ? "Back to Teaching" : "Open my notebook"}
      onGo={info && info.yours ? () => router.push("/") : claim}
      back={`/s/${token}`}
      sheet={{
        title: "Open your notebook",
        lead: `Sign in free and this notebook is yours. ${teacher} can send you work in it.`,
        keeps: ["Your notebook, kept for good", "Homework from your teacher, with due dates", "Free, on your laptop, tablet and phone"],
      }}
    />
  );
}
