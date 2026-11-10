"use client";

import Link from "next/link";
import { dueBadge, dueState, dueText, scoreText } from "@/lib/teaching";
import t from "./Teaching.module.css";

// A student's homework on the home screen (student_homework()): what's to
// do (soonest first), what's handed in, and what came back marked.
export default function HomeworkPanel({ items }) {
  if (!items || !items.length) return null;
  const todo = items.filter((h) => h.status === "assigned");
  const handed = items.filter((h) => h.status === "handed_in");
  const back = items.filter((h) => h.status === "returned");
  return (
    <section className={t.section} aria-labelledby="homework-heading" data-homework-panel="true">
      <div className={t.headText}>
        <h2 id="homework-heading" className={t.heading}>Homework</h2>
        <p className={t.sub}>
          {todo.length
            ? `${todo.length} to do${todo.some((h) => dueState(h.due_at, h.status) === "overdue") ? ", some overdue" : ""}.`
            : "All handed in."}
        </p>
      </div>
      <div className={t.hwList}>
        {todo.length > 0 && <h3 className={t.hwGroup}>To do</h3>}
        {todo.map((h) => (
          <Row key={h.sub} h={h} />
        ))}
        {handed.length > 0 && <h3 className={t.hwGroup}>Handed in</h3>}
        {handed.map((h) => (
          <Row key={h.sub} h={h} />
        ))}
        {back.length > 0 && <h3 className={t.hwGroup}>Marked</h3>}
        {back.map((h) => (
          <Row key={h.sub} h={h} />
        ))}
      </div>
    </section>
  );
}

function Row({ h }) {
  const state = dueState(h.due_at, h.status);
  const href = `/board/${h.board}${h.page_id ? `?page=${encodeURIComponent(h.page_id)}` : ""}`;
  let pill = null;
  if (h.status === "returned") {
    const sc = scoreText(h.score, h.max_score);
    pill = <span className={`${t.pill} ${t.pillGreen}`}>{sc ? `Marked · ${sc}` : "Marked"}</span>;
  } else if (h.status === "handed_in") {
    pill = <span className={`${t.pill} ${t.pillBlue}`}>{h.late ? "Handed in late" : "Handed in"}</span>;
  } else if (h.due_at) {
    pill = (
      <span className={`${t.pill} ${state === "overdue" ? t.pillRed : state === "soon" ? t.pillAmber : ""}`}>{dueBadge(h.due_at)}</span>
    );
  }
  return (
    <Link href={href} className={t.hwRow} data-homework-row={h.sub}>
      <span className={t.hwMain}>
        <span className={t.hwTitle}>{h.title}</span>
        <span className={t.hwMeta}>
          {h.teacher ? `From ${h.teacher}` : "Homework"} · {h.board_name || "Notebook"}
          {h.due_at && h.status === "assigned" ? ` · due ${dueText(h.due_at)}` : ""}
        </span>
      </span>
      {pill}
    </Link>
  );
}

// The badge for a notebook's cover: its most urgent homework, or null.
// Returns { text, tone } (tone: "red" | "amber" | "green" | "").
export function badgeFor(items, boardId) {
  const mine = (items || []).filter((h) => h.board === boardId);
  if (!mine.length) return null;
  const todo = mine.filter((h) => h.status === "assigned" && h.due_at).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  if (todo.length) {
    const st = dueState(todo[0].due_at, "assigned");
    return { text: dueBadge(todo[0].due_at), tone: st === "overdue" ? "red" : st === "soon" ? "amber" : "" };
  }
  if (mine.some((h) => h.status === "assigned")) return { text: "Homework", tone: "" };
  const fresh = mine.find((h) => h.status === "returned" && h.returned_at && Date.now() - new Date(h.returned_at).getTime() < 7 * 86400000);
  if (fresh) return { text: "Marked", tone: "green" };
  return null;
}
