//Excludes 0/0 and 1/I/L, wayyy to difficult to read
//reads a code aloud or writes it on a physical whiteboard (usually)

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateClassCode(length = 6) {
    let code ="";
    for (let i =0; i < length; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
}

export function getOrCreateStudentId() {
    if (typeof window === "undefined") return null;
    let id = sessionStorage.getItem("classroom_student_id");
    if (!id) {
        id = typeof crypto.randomUUID !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        sessionStorage.setItem("classroom_student_id", id);
    }
    return id;
}
