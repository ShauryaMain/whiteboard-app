// A board that is kept in this browser tab's memory instead of the
// database.
//
// Used for a student's own board in a live class. Students never sign in,
// so they have no access to the database (by design); their board is a
// scratch pad for the lesson. The teacher sees it over the live connection,
// not from the database.
//
// The board component (Whiteboard.js) loads and saves through whatever
// "store" it is given. This file makes a store that answers those same
// calls from memory, so a student gets exactly the same board, with the
// same tools, as a signed-in teacher. It reuses the query stand-in the demo
// board already runs on (see demoBackend.js).

import { DemoQuery } from "./demoBackend";
import { getOrCreateStudentId } from "./classroomCode";

// The name a student's board goes by. The live channel for it is
// "board-" + this, the same pattern every other board uses.
export function studentBoardId(code, studentId) {
  return `student-${String(code).toUpperCase()}-${studentId}`;
}

function later(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

export function createLocalBoard(boardId, name = "My board") {
  const tables = {
    boards: [
      {
        id: boardId,
        // Not the student: the board's "owner only" controls (sharing the
        // link, starting a class, reference documents) stay switched off.
        owner_id: "class-teacher",
        name,
        grid_config: null,
        background: null,
        sim_embeds: [],
        thumbnail: null,
        created_at: new Date().toISOString(),
      },
    ],
    strokes: [],
    texts: [],
    images: [],
  };
  const unavailable = () => later({ data: null, error: new Error("Files can't be added to a class board.") });
  return {
    __local: true,
    from: (table) => new DemoQuery(tables, table),
    rpc: () => later({ data: null, error: null }),
    // Pictures and documents are switched off on a student's board, so
    // nothing should ever ask for these. They refuse politely if it does.
    storage: {
      from() {
        return {
          upload: unavailable,
          remove: () => later({ data: [], error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
        };
      },
    },
  };
}

// This student's own board for a class: who they are, the board's name and
// where it is kept. Made the first time it is asked for and then handed
// back as-is, so the class page always gets the very same board (and a
// student who leaves the class page and comes straight back, without
// reloading, finds their work still there). Null outside the browser.
const myBoards = new Map(); // class code -> { boardId, backend, student }

export function myClassBoard(code) {
  if (typeof window === "undefined" || !code) return null;
  const classCode = String(code).toUpperCase();
  if (!myBoards.has(classCode)) {
    const studentId = getOrCreateStudentId();
    let name = "Student";
    try {
      name = window.sessionStorage.getItem("classroom_student_name") || "Student";
    } catch (err) {
      // storage switched off: the name just stays "Student"
    }
    const boardId = studentBoardId(classCode, studentId);
    myBoards.set(classCode, {
      boardId,
      backend: createLocalBoard(boardId),
      student: { code: classCode, studentId, name },
    });
  }
  return myBoards.get(classCode);
}
