import React from "react";
import { MONO, glow } from "@neon/fx-kit";
import { BurningBranch, Stage } from "./primitives.tsx";
import { LANES, THEME } from "./theme.ts";

/**
 * YouTube thumbnail for one episode, laid over a frame of the episode: a dark panel on the left
 * with the mark, the episode number and the title, and the app showing through on the right.
 * Static on purpose, so every frame of the clip is the same picture.
 */
export const GitGudThumbnail: React.FC<{ number: number; title: string; kicker: string }> = ({ number, title, kicker }) => {
  const words = title.split(" ");
  const long = title.length > 18;
  return (
    <Stage background={false}>
      {/* The episode's footage stays visible on the right; the left reads as solid. */}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, ${THEME.deepest} 0%, ${THEME.deepest} 46%, rgba(13,17,23,0.82) 60%, rgba(13,17,23,0.15) 82%, rgba(13,17,23,0) 100%)` }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(900px 700px at 18% 50%, rgba(255,45,149,0.16), transparent 70%)" }} />

      {/* A lane of the commit graph down the left edge. */}
      <div style={{ position: "absolute", left: 78, top: -20, bottom: -20, width: 10, borderRadius: 5, background: LANES[0], boxShadow: glow(THEME.bright, 0.6) }} />
      {[190, 540, 890].map((y) => (
        <div key={y} style={{ position: "absolute", left: 83 - 26, top: y - 26, width: 52, height: 52, borderRadius: 26, background: THEME.deepest, border: `8px solid ${LANES[0]}`, boxSizing: "border-box", boxShadow: glow(THEME.bright, 0.5) }} />
      ))}

      <div style={{ position: "absolute", left: 170, top: 110, display: "flex", alignItems: "center", gap: 26 }}>
        <BurningBranch size={120} build={1} sec={0.4} />
        <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -1 }}>Git Gud</div>
      </div>

      <div style={{ position: "absolute", left: 170, top: 330, display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ padding: "10px 26px", borderRadius: 18, background: THEME.accent, color: THEME.onAccent, fontFamily: MONO, fontSize: 52, fontWeight: 800, boxShadow: glow(THEME.bright, 0.7) }}>
          EP {String(number).padStart(2, "0")}
        </div>
        <div style={{ fontSize: 40, fontWeight: 600, color: THEME.secondary, letterSpacing: 1 }}>{kicker}</div>
      </div>

      <div style={{ position: "absolute", left: 170, top: 450, width: 1080, fontSize: long ? 128 : 150, fontWeight: 900, lineHeight: 1.0, letterSpacing: -4, textShadow: "0 6px 30px rgba(0,0,0,0.6)" }}>
        {words.map((w) => (
          <span key={i} style={{ color: i === words.length - 1 ? THEME.accent : THEME.text }}>{w}{i < words.length - 1 ? " " : ""}</span>
        ))}
      </div>
    </Stage>
  );
};
