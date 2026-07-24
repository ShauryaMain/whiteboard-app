"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

export default function ShareModal({ onClose, onShare }) {
  const [email, setEmail] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = email.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("email")
        .ilike("email", `%${query}%`)
        .limit(5);
      if (!error && data) {
        setSuggestions(
          data.map((d) => d.email).filter((e) => e.toLowerCase() !== query.toLowerCase())
        );
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [email]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    onShare(trimmed);
  }

  function handleSelectSuggestion(suggestedEmail) {
    setSuggestions([]);
    setShowSuggestions(false);
    onShare(suggestedEmail);
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={headerStyle}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: "#1a1a1a" }}>Share board</h2>
          <button onClick={onClose} style={closeBtnStyle}>
            <X size={18} color="#666" />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ position: "relative" }}>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="student@gmail.com"
            autoComplete="off"
            style={inputStyle}
          />

          {showSuggestions && suggestions.length > 0 && (
            <div style={dropdownStyle}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSelectSuggestion(s)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F6FC")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  style={suggestionStyle}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <button type="submit" style={submitBtnStyle}>
            Share
          </button>
        </form>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};

const modalStyle = {
  background: "#fff", borderRadius: 14, padding: 24, width: 340,
  boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
};

const headerStyle = {
  display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16,
};

const closeBtnStyle = { border: "none", background: "none", cursor: "pointer", padding: 4 };

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd",
  fontSize: 14, color: "#1a1a1a", background: "#ffffff", boxSizing: "border-box", marginBottom: 8,
};

const dropdownStyle = {
  position: "absolute", top: 46, left: 0, right: 0, background: "#fff",
  border: "1px solid #eee", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  zIndex: 5, maxHeight: 160, overflowY: "auto",
};

const suggestionStyle = {
  display: "block", width: "100%", textAlign: "left", padding: "9px 12px",
  border: "none", background: "transparent", cursor: "pointer", fontSize: 13.5, color: "#1a1a1a",
};

const submitBtnStyle = {
  width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
  background: "#1E88E5", color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer", marginTop: 8,
};