"use client";

import { useState } from "react";
import { X } from "lucide-react";

function isLikelyValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (err) {
    return false;
  }
}

function guessTitle(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (err) {
    return url;
  }
}

// Small dialog for the "load a simulation onto the board" tool: paste a
// link (PhET simulations and similar interactive HTML5 sims embed via
// iframe just fine) and it's placed on the board as a movable/resizable
// box — see SimEmbed.js for the box itself.
export default function SimEmbedModal({ onAdd, onClose }) {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);

  const valid = isLikelyValidUrl(url.trim());

  function handleAdd() {
    if (!valid) {
      setTouched(true);
      return;
    }
    onAdd({ url: url.trim(), title: guessTitle(url.trim()) });
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(27,29,36,0.32)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 18, width: "min(440px, 100%)", border: "2px solid var(--ink-line)",
          boxShadow: "6px 6px 0 var(--ink-line)", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "2px solid var(--ink-line)", ...paperStyle }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--ink)", flex: 1 }}>Embed a simulation</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "1.5px solid var(--ink-line)", background: "#fff", borderRadius: 11, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--ink)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 14, lineHeight: 1.55 }}>
            Paste a link to an interactive simulation — for example a{" "}
            <a href="https://phet.colorado.edu/en/simulations/browse" target="_blank" rel="noreferrer" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
              PhET simulation
            </a>
            — it will be added to the board as a resizable window you and your students can interact with.
          </div>
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="https://phet.colorado.edu/sims/html/..."
            style={{
              width: "100%", boxSizing: "border-box", padding: "0 13px", height: 46, borderRadius: 12, fontSize: 15,
              border: touched && !valid ? "2px solid var(--danger)" : "2px solid var(--ink-line)",
            }}
          />
          {touched && !valid && (
            <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 8, fontWeight: 500 }}>
              That does not look like a valid link — make sure it starts with http:// or https://
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 18px", borderTop: "2px solid var(--ink-line)", background: "var(--paper)" }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          <button onClick={handleAdd} style={primaryBtnStyle}>Add to board</button>
        </div>
      </div>
    </div>
  );
}

const primaryBtnStyle = {
  border: "2px solid var(--ink-line)", background: "var(--accent)", color: "#fff", borderRadius: 12, padding: "0 18px", height: 44,
  fontSize: 14.5, fontWeight: 600, cursor: "pointer", boxShadow: "var(--shadow-hard)",
};

const secondaryBtnStyle = {
  border: "2px solid var(--ink-line)", background: "#fff", color: "var(--ink)", borderRadius: 12, padding: "0 18px", height: 44,
  fontSize: 14.5, fontWeight: 600, cursor: "pointer",
};

const paperStyle = {
  backgroundColor: "var(--paper)",
  backgroundImage: "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
  backgroundSize: "20px 20px",
};
