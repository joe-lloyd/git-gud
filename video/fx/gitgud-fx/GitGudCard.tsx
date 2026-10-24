import React from "react";
import { MONO, glow } from "@neon/fx-kit";
import { Heading, Icon, IconTile, Stage, useClip } from "./primitives.tsx";
import { LANES, THEME } from "./theme.ts";

type Item = { icon: string; label: string; detail: string };
type Layout = "list" | "grid" | "steps";

const asLayout = (value: string): Layout => (value === "grid" || value === "steps" ? value : "list");

/** Rows of "IconName | Label | detail"; blank rows are skipped. */
function parseItems(text: string): Item[] {
  return text
    .split(/\r?\n/)
    .map((row) => row.split("|").map((part) => part.trim()))
    .filter((parts) => parts.some(Boolean))
    .map((parts) => (parts.length === 1 ? { icon: "", label: parts[0] ?? "", detail: "" } : { icon: parts[0] ?? "", label: parts[1] ?? "", detail: parts.slice(2).join(" | ") }));
}

const LEFT = 120;
const WIDTH = 1680;
const TOP = 290;
const BOTTOM = 1000;

export const GitGudCard: React.FC<{ kicker: string; title: string; items: string; layout: string; highlight: number }> = ({ kicker, title, items: raw, layout: rawLayout, highlight }) => {
  const { sec, seconds, enter, out } = useClip(0.4);
  const items = parseItems(raw);
  const layout = asLayout(rawLayout);
  const n = Math.max(1, items.length);
  // Entries spread over the first ~40% of the clip, at most 0.35 s apart.
  const first = 0.45;
  const gap = Math.min(0.35, Math.max(0.05, (seconds * 0.4 - first) / n));
  const show = (i: number) => enter(first + i * gap, 0.55);
  const hl = Math.round(highlight);
  const focus = hl >= 1 && hl <= items.length ? enter(first + n * gap + 0.2, 0.5) : 0;
  const pulse = 0.7 + 0.3 * Math.sin(sec * Math.PI * 1.4);
  // The highlighted item glows; the others step back once the highlight lands.
  const emphasis = (i: number): { opacity: number; glowing: boolean } =>
    hl < 1 || hl > items.length ? { opacity: 1, glowing: false } : i === hl - 1 ? { opacity: 1, glowing: focus > 0 } : { opacity: 1 - 0.45 * focus, glowing: false };
  const ring = (i: number): React.CSSProperties =>
    emphasis(i).glowing ? { borderColor: THEME.accent, background: "#24203a", boxShadow: `${glow(THEME.accent, (0.3 + 0.2 * pulse) * focus)}, 0 14px 40px rgba(0,0,0,0.4)` } : {};

  let body: React.ReactNode;
  if (layout === "list") {
    const rowGap = 16;
    const rowH = Math.min(118, (BOTTOM - TOP - rowGap * (n - 1)) / n);
    const tile = Math.min(72, rowH - 26);
    body = items.map((item, i) => {
      const t = show(i);
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: LEFT,
            width: WIDTH,
            top: TOP + i * (rowH + rowGap),
            height: rowH,
            display: "flex",
            alignItems: "center",
            gap: 30,
            padding: "0 32px 0 22px",
            borderRadius: 20,
            background: THEME.elevated,
            border: `2px solid ${THEME.border}`,
            ...ring(i),
            opacity: t * emphasis(i).opacity,
            transform: `translateX(${(1 - t) * -50}px)`,
          }}
        >
          <IconTile name={item.icon} size={tile} color={LANES[i % LANES.length]} />
          <div style={{ width: 560, flex: "none", fontSize: 38, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
          <div style={{ flex: 1, fontSize: 30, color: THEME.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.detail}</div>
        </div>
      );
    });
  } else if (layout === "grid") {
    const shown = items.slice(0, 12);
    const cols = shown.length <= 4 ? shown.length : shown.length <= 6 || shown.length === 9 ? 3 : 4;
    const rows = Math.ceil(shown.length / cols);
    const g = 24;
    const w = (WIDTH - g * (cols - 1)) / cols;
    const h = Math.min(300, (BOTTOM - TOP - g * (rows - 1)) / rows);
    const top = TOP + (BOTTOM - TOP - (rows * h + (rows - 1) * g)) / 2;
    body = shown.map((item, i) => {
      const t = show(i);
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: LEFT + (i % cols) * (w + g),
            top: top + Math.floor(i / cols) * (h + g),
            width: w,
            height: h,
            padding: "24px 26px",
            borderRadius: 22,
            background: THEME.elevated,
            border: `2px solid ${THEME.border}`,
            overflow: "hidden",
            ...ring(i),
            opacity: t * emphasis(i).opacity,
            transform: `translateY(${(1 - t) * 30}px) scale(${0.94 + 0.06 * t})`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <IconTile name={item.icon} size={60} color={LANES[i % LANES.length]} />
            <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.15 }}>{item.label}</div>
          </div>
          {item.detail ? <div style={{ marginTop: 14, fontSize: 25, lineHeight: 1.3, color: THEME.secondary }}>{item.detail}</div> : null}
        </div>
      );
    });
  } else {
    const col = WIDTH / n;
    const railY = 500;
    const cx = (i: number) => LEFT + col * (i + 0.5);
    body = (
      <>
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
          {items.slice(0, -1).map((_, i) => {
            const draw = Math.min(show(i + 1), 1);
            const x1 = cx(i);
            const x2 = cx(i) + (cx(i + 1) - cx(i)) * draw;
            return <line key={i} x1={x1} y1={railY} x2={x2} y2={railY} stroke={LANES[i % LANES.length]} strokeWidth={8} strokeLinecap="round" opacity={draw > 0 ? 1 : 0} />;
          })}
        </svg>
        {items.map((item, i) => {
          const t = show(i);
          const color = LANES[i % LANES.length] ?? THEME.accent;
          const e = emphasis(i);
          return (
            <div key={i} style={{ position: "absolute", left: cx(i) - col / 2, width: col, top: railY - 44, display: "flex", flexDirection: "column", alignItems: "center", opacity: t }}>
              <div
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: "50%",
                  background: e.glowing ? color : THEME.deepest,
                  border: `7px solid ${color}`,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: MONO,
                  fontSize: 36,
                  fontWeight: 800,
                  color: e.glowing ? THEME.onAccent : color,
                  boxShadow: e.glowing ? glow(color, 0.5 * focus * pulse) : undefined,
                  transform: `scale(${0.5 + 0.5 * t})`,
                  filter: e.opacity < 1 ? `brightness(${e.opacity})` : undefined,
                }}
              >
                {i + 1}
              </div>
              <div style={{ marginTop: 34, opacity: e.opacity, transform: `translateY(${(1 - t) * 24}px)`, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 16px" }}>
                <div style={{ width: 84, height: 84, borderRadius: 20, background: THEME.elevated, border: `2px solid ${e.glowing ? THEME.accent : THEME.border}`, display: "grid", placeItems: "center" }}>
                  <Icon name={item.icon} size={46} color={color} />
                </div>
                <div style={{ marginTop: 22, fontSize: n > 5 ? 30 : 36, fontWeight: 700, lineHeight: 1.15 }}>{item.label}</div>
                {item.detail ? <div style={{ marginTop: 12, fontSize: n > 5 ? 24 : 27, lineHeight: 1.3, color: THEME.secondary }}>{item.detail}</div> : null}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <Stage opacity={out}>
      <Heading kicker={kicker} text={title} show={enter(0.1)} />
      {body}
    </Stage>
  );
};
