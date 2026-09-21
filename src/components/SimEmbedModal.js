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
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, width: "min(420px, 100%)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", flex: 1 }}>Embed a Simulation</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "#f0f0f0", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
            Paste a link to an interactive simulation — for example a{" "}
            <a href="https://phet.colorado.edu/en/simulations/browse" target="_blank" rel="noreferrer" style={{ color: "#1E88E5" }}>
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
              width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, fontSize: 14,
              border: touched && !valid ? "1px solid #E53935" : "1px solid #ddd",
            }}
          />
          {touched && !valid && (
            <div style={{ fontSize: 12, color: "#E53935", marginTop: 6 }}>
              That does not look like a valid link — make sure it starts with http:// or https://
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid #eee" }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          <button onClick={handleAdd} style={primaryBtnStyle}>Add to Board</button>
        </div>
      </div>
    </div>
  );
}

const primaryBtnStyle = {
  border: "none", background: "#1E88E5", color: "#fff", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};

const secondaryBtnStyle = {
  border: "none", background: "#f0f0f0", color: "#333", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
