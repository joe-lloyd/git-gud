import React from "react";
import { MONO, glow } from "@neon/fx-kit";
import { BurningBranch, Stage, useClip } from "./primitives.tsx";
import { THEME } from "./theme.ts";

export const GitGudTitle: React.FC<{ title: string; subtitle: string; footer: string }> = ({ title, subtitle, footer }) => {
  const { sec, enter, out } = useClip(0.4);
  const rise = (t: number, by: number) => ({ opacity: t, transform: `translateY(${(1 - t) * by}px)` });
  const mark = enter(0.1, 0.4);
  const heading = enter(0.9);
  return (
    <Stage opacity={out}>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: 40 }}>
        <div style={{ borderRadius: 66, boxShadow: glow(THEME.bright, 0.5 * mark), opacity: mark, transform: `scale(${0.85 + 0.15 * mark})` }}>
          <BurningBranch size={300} build={enter(0.1, 1.4)} sec={sec} />
        </div>
        <div style={{ marginTop: 56, fontSize: 120, fontWeight: 800, letterSpacing: -3, lineHeight: 1, ...rise(heading, 30) }}>{title}</div>
        {subtitle ? <div style={{ marginTop: 24, fontSize: 42, color: THEME.secondary, ...rise(enter(1.2), 24) }}>{subtitle}</div> : null}
      </div>
      {footer ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 84, textAlign: "center", fontFamily: MONO, fontSize: 28, letterSpacing: 2, color: THEME.accent, opacity: enter(1.6) }}>{footer}</div>
      ) : null}
    </Stage>
  );
};
