"use client";

import { Check, Eye, RotateCcw, X } from "lucide-react";
import n from "./Notebook.module.css";

// The bar along the bottom of a notebook while "Quiz me" is going (the
// steps are in src/lib/quiz.js). Used on a notebook, and on a notebook
// opened from its link.
//
//   quiz       the go so far (startQuiz / showAnswer / markAnswer)
//   tally      how this page went on the go before, on this device ({ last })
//   onShow     show the piece of tape being asked
//   onMark     (knew) "I knew it" / "I didn't"
//   onAgain    (onlyMissed) another go, at every piece or the missed ones
//   onClose    stop
export function QuizBar({ quiz, tally, onShow, onMark, onAgain, onClose }) {
  if (!quiz) return null;
  const total = quiz.ids.length;

  if (quiz.done) {
    const right = quiz.right.length;
    const missed = quiz.missed.length;
    // (how the page went on the go before this one)
    const before = tally && tally.last ? tally.last : null;
    return (
      <div className={n.quizBar} role="status" aria-live="polite" data-quiz="done">
        <div className={n.quizText}>
          <strong>
            {total === 0 ? "No tape on this page" : right === total ? `All ${total} right!` : `You knew ${right} of ${total}.`}
          </strong>
          {before && total > 0 && <span className={n.quizSub}>Last time: {before.right} of {before.total}</span>}
        </div>
        <div className={n.quizBtns}>
          {missed > 0 && (
            <button type="button" className={`${n.btn} ${n.btnPrimary}`} onClick={() => onAgain(true)} data-quiz-missed="true">
              <RotateCcw size={15} aria-hidden="true" /> {missed === 1 ? "Try the one I missed" : `Try the ${missed} I missed`}
            </button>
          )}
          {total > 0 && (
            <button type="button" className={n.btn} onClick={() => onAgain(false)}>
              Start again
            </button>
          )}
          <button type="button" className={n.btn} onClick={onClose} data-quiz-close="true">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={n.quizBar} role="status" aria-live="polite" data-quiz={quiz.shown ? "shown" : "asking"}>
      <div className={n.quizText}>
        <strong>
          {quiz.at + 1} of {total}
        </strong>
        <span className={n.quizSub}>
          {quiz.shown ? "Did you know it?" : "What's under the flashing tape? Say it, then check."}
        </span>
      </div>
      <div className={n.quizBtns}>
        {quiz.shown ? (
          <>
            <button type="button" className={`${n.btn} ${n.quizYes}`} onClick={() => onMark(true)} data-quiz-yes="true">
              <Check size={15} strokeWidth={2.6} aria-hidden="true" /> I knew it
            </button>
            <button type="button" className={`${n.btn} ${n.quizNo}`} onClick={() => onMark(false)} data-quiz-no="true">
              <X size={15} strokeWidth={2.6} aria-hidden="true" /> I didn&apos;t
            </button>
          </>
        ) : (
          <button type="button" className={`${n.btn} ${n.btnPrimary}`} onClick={onShow} data-quiz-show="true">
            <Eye size={15} aria-hidden="true" /> Show it
          </button>
        )}
        <button type="button" className={`${n.btn} ${n.btnIcon}`} onClick={onClose} aria-label="Stop the quiz" title="Stop">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
