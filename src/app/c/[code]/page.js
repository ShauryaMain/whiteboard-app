"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import JoinCard from "@/components/JoinCard";
import { call, problemText } from "@/lib/teaching";
import { defaultPageSize } from "@/lib/notebook";
import { takeReturn } from "@/lib/returnTo";
import d from "@/components/Dialog.module.css";

// Joining a class with its code (a teacher's link: /c/7KQ2PX). The student
// signs in, joins, and gets a notebook for the class that the teacher can
// send work into.
export default function JoinClassPage() {
  const { code: raw } = useParams();
  const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const router = useRouter();
  const [info, setInfo] = useState(null); // class_peek() | "gone" | "error"
  const [status, setStatus] = useState("loading");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    // (back from signing in: the note to come here has done its job)
    takeReturn();
    call("class_peek", { p_code: code }).then((res) => {
      if (!live) return;
      if (res.data) {
        setInfo(res.data);
        setStatus("ready");
      } else if (res.error || res.missing) {
        setInfo("error");
        setStatus("problem");
        setProblem(problemText(res));
      } else {
        setInfo("gone");
        setStatus("gone");
      }
    });
    return () => {
      live = false;
    };
  }, [code]);

  async function join() {
    setStatus("working");
    const res = await call("class_join", { p_code: code, p_size: defaultPageSize() });
    const out = res.data;
    if (out && out.board) {
      router.replace(`/board/${out.board}`);
      return;
    }
    if (out && out.reason === "yours" && out.class) {
      router.replace(`/class/${out.class}`);
      return;
    }
    setStatus("problem");
    setProblem(
      out && out.reason === "full"
        ? "This class is full. Ask your teacher."
        : out && out.reason === "code"
          ? "That code doesn't work any more. Ask your teacher for the new one."
          : problemText(res, "Couldn't join just now. Check your connection and try again.")
    );
  }

  const c = info && typeof info === "object" ? info : null;
  if (status === "gone") {
    return (
      <JoinCard
        status="gone"
        title="That class code doesn't work"
        text="Check the code with your teacher: they may have made a new one. Joining a live lesson instead? Use Join with a class code."
        secondary={
          <a href={`/join?code=${code}`} className={`${d.btn} ${d.btnPrimary}`} style={{ marginTop: 6 }}>
            Join a live lesson
          </a>
        }
      />
    );
  }
  return (
    <JoinCard
      status={status}
      title={c ? (c.mine ? `This is your class, ${c.name}` : `Join ${c.name}`) : "Couldn't open the class"}
      text={
        c
          ? c.mine
            ? "Share this link with your students so they can join."
            : c.member
              ? "You're in this class. Open your notebook for it."
              : `${c.teacher ? `${c.teacher} can` : "Your teacher can"} send work into a notebook for this class, and mark it there. The notebook is yours to keep.`
          : ""
      }
      problem={problem}
      action={c && c.mine ? "Open the class" : c && c.member ? "Open my notebook" : "Join the class"}
      onGo={join}
      back={`/c/${code}`}
      sheet={{
        title: c ? `Join ${c.name}` : "Join the class",
        lead: "Sign in free to join. You get a notebook for this class that you can write in on any device.",
        keeps: ["A notebook for this class, yours to keep", "Homework from your teacher, with due dates", "Free, on your laptop, tablet and phone"],
      }}
    />
  );
}
