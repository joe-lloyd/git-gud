import React from "react";
import { MONO, glow } from "@neon/fx-kit";
import { Stage, useClip } from "./primitives.tsx";
import { THEME } from "./theme.ts";

export const GitGudChapter: React.FC<{ number: number; title: string }> = ({ number, title }) => {
  const { enter, out } = useClip(0.4);
  const inT = enter(0, 0.5);
  return (
    <Stage background={false}>
      <div
        style={{
          position: "absolute",
          left: 56,
          bottom: 64,
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "16px 34px 16px 16px",
          borderRadius: 20,
          background: "rgba(19,24,31,0.94)",
          border: `2px solid ${THEME.border}`,
          boxShadow: "0 16px 50px rgba(0,0,0,0.5)",
          opacity: Math.min(inT, out),
          transform: `translateX(${(1 - inT) * -40}px)`,
        }}
      >
        <div style={{ width: 60, height: 60, borderRadius: 15, background: THEME.accent, color: THEME.onAccent, display: "grid", placeItems: "center", fontFamily: MONO, fontSize: 30, fontWeight: 800, boxShadow: glow(THEME.accent, 0.35) }}>
          {String(number).padStart(2, "0")}
        </div>
        <div style={{ fontSize: 38, fontWeight: 650 }}>{title}</div>
      </div>
    </Stage>
  );
};
