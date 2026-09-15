// Excludes 0/O and 1/I/L — characters easily confused when a teacher
// reads a code aloud or writes it on a physical whiteboard.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateClassCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function getOrCreateStudentId() {
  if (typeof window === "undefined") return null;
  let id = sessionStorage.getItem("classroom_student_id");
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    sessionStorage.setItem("classroom_student_id", id);
  }
  return id;
}

// A class code persists for the life of this browser tab's session, tied
// to the board it belongs to — reopening Live Class for the same board
// reuses the same code instead of generating a new one, so students who
// already have the code (or drop out and rejoin) can still get in. Only
// an explicit "End Live Class" clears it.
export function getStoredClassCode(boardId) {
  if (typeof window === "undefined" || !boardId) return null;
  try {
    return sessionStorage.getItem(`classroom_code_${boardId}`);
  } catch (err) {
    return null;
  }
}

export function storeClassCode(boardId, code) {
  if (typeof window === "undefined" || !boardId) return;
  try {
    sessionStorage.setItem(`classroom_code_${boardId}`, code);
  } catch (err) {}
}

export function clearClassCode(boardId) {
  if (typeof window === "undefined" || !boardId) return;
  try {
    sessionStorage.removeItem(`classroom_code_${boardId}`);
  } catch (err) {}
}