import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "@neon/motion";
import { MONO, SANS, glow, useUiScale } from "@neon/fx-kit";
import { Icon } from "./icons.tsx";
import { THEME } from "./theme.ts";

export { Icon } from "./icons.tsx";

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export type P = { x: number; y: number };
/** How an element sits in a stepped diagram: just added, added in an earlier step, or neither. */
export type Em = "new" | "old" | "same";

/** Frame-derived timing for one clip. `enter` eases 0 → 1 after `delay` seconds; `out` fades at the clip's end. */
export function useClip(outSeconds = 0.35) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = (delay: number, length = 0.6) =>
    interpolate(frame, [fps * delay, fps * (delay + length)], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const out = interpolate(frame, [durationInFrames - fps * outSeconds, durationInFrames], [1, 0], CLAMP);
  return { frame, fps, sec: frame / fps, seconds: durationInFrames / fps, enter, out };
}

/**
 * A 1920x1080 design canvas scaled by useUiScale() and centered in the frame, so every child
 * is written in 1080p pixels.
 */
export function Stage({ children, background = true, opacity = 1 }: { children: React.ReactNode; background?: boolean; opacity?: number }) {
  const s = useUiScale();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        opacity,
        fontFamily: SANS,
        background: background
          ? `radial-gradient(1200px 760px at 50% 30%, rgba(255,45,149,0.07), transparent 70%), radial-gradient(900px 600px at 85% 100%, rgba(79,209,197,0.04), transparent 70%), ${THEME.deepest}`
          : undefined,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: (width - 1920 * s) / 2,
          top: (height - 1080 * s) / 2,
          width: 1920,
          height: 1080,
          transform: `scale(${s})`,
          transformOrigin: "0 0",
          color: THEME.text,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}

/** Top-left heading with a pink lane bar. */
export function Heading({ text, show, kicker }: { text: string; show: number; kicker?: string }) {
  if (!text && !kicker) return null;
  return (
    <div style={{ position: "absolute", left: 110, top: 64, right: 110, opacity: show, transform: `translateX(${(1 - show) * -24}px)` }}>
      {kicker ? (
        <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: THEME.accent, marginBottom: 10 }}>{kicker}</div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ width: 8, height: 52, borderRadius: 4, background: THEME.accent, boxShadow: glow(THEME.accent, 0.35), flex: "none" }} />
        <div style={{ fontSize: 54, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1 }}>{text}</div>
      </div>
    </div>
  );
}

/** Opacity and border treatment for an emphasis state. `pulse` is 0..1. */
export function emStyle(em: Em, pulse: number, color: string = THEME.accent): React.CSSProperties {
  if (em === "new") return { borderColor: color, boxShadow: `${glow(color, 0.35 + 0.25 * pulse)}, 0 18px 50px rgba(0,0,0,0.45)` };
  // Brightness, not opacity, so a dimmed panel still hides the lines behind it.
  if (em === "old") return { filter: "brightness(0.6) saturate(0.75)" };
  return {};
}

export function IconTile({ name, size = 64, color = THEME.accent, bg = THEME.panel }: { name: string; size?: number; color?: string; bg?: string }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.24, background: bg, border: `1.5px solid ${THEME.border}`, display: "grid", placeItems: "center", flex: "none" }}>
      <Icon name={name} size={size * 0.56} color={color} />
    </div>
  );
}

/** A panel centered on (x, y): icon tile, title, and secondary lines. */
export function Box({
  x,
  y,
  w,
  h,
  icon,
  title,
  lines = [],
  mono,
  show = 1,
  em = "same",
  pulse = 1,
  color = THEME.accent,
  children,
}: {
  x: number;
  y: number;
  w: number;
  /** Minimum height, so a row of boxes lines up. */
  h?: number;
  icon?: string;
  title: string;
  lines?: string[];
  mono?: boolean;
  show?: number;
  em?: Em;
  pulse?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const e = emStyle(em, pulse, color);
  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y,
        width: w,
        minHeight: h,
        padding: "24px 28px",
        borderRadius: 22,
        background: THEME.elevated,
        border: `2px solid ${THEME.border}`,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        ...e,
        opacity: show,
        transform: `translateY(-50%) translateY(${(1 - show) * 26}px) scale(${0.94 + 0.06 * show})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {icon ? <IconTile name={icon} color={color} /> : null}
        <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
      </div>
      {lines.map((line, i) => (
        <div key={i} style={{ marginTop: i === 0 ? 14 : 6, fontSize: 26, lineHeight: 1.3, color: THEME.secondary, fontFamily: mono ? MONO : undefined }}>
          {line}
        </div>
      ))}
      {children}
    </div>
  );
}

/** Pill label centered on a point. */
export function Label({ at, children, color = THEME.secondary, show = 1, mono, size = 26, strong }: { at: P; children: React.ReactNode; color?: string; show?: number; mono?: boolean; size?: number; strong?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        transform: `translate(-50%, -50%) translateY(${(1 - show) * 12}px)`,
        padding: "7px 18px",
        borderRadius: 999,
        background: THEME.deepest,
        border: `2px solid ${color}`,
        color: strong ? THEME.text : color,
        fontSize: size,
        fontWeight: strong ? 600 : 500,
        fontFamily: mono ? MONO : undefined,
        whiteSpace: "nowrap",
        opacity: show,
      }}
    >
      {children}
    </div>
  );
}

/** Rounded chip with an optional icon. `crossed` strikes it out in red. */
export function Chip({
  at,
  children,
  color = THEME.secondary,
  show = 1,
  mono,
  icon,
  crossed,
  em = "same",
  pulse = 1,
  fill,
}: {
  at: P;
  children: React.ReactNode;
  color?: string;
  show?: number;
  mono?: boolean;
  icon?: string;
  crossed?: boolean;
  em?: Em;
  pulse?: number;
  fill?: boolean;
}) {
  const e = emStyle(em, pulse, color);
  return (
    <div
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        transform: `translate(-50%, -50%) scale(${0.9 + 0.1 * show})`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 20px",
        borderRadius: 14,
        background: fill ? `${color}26` : THEME.base,
        border: `2px solid ${color}`,
        color: THEME.text,
        fontSize: 26,
        fontWeight: 500,
        fontFamily: mono ? MONO : undefined,
        whiteSpace: "nowrap",
        ...e,
        opacity: show,
      }}
    >
      {icon ? <Icon name={icon} size={28} color={color} /> : null}
      <span style={{ textDecoration: crossed ? "line-through" : undefined, textDecorationColor: THEME.danger, textDecorationThickness: 4, opacity: crossed ? 0.7 : 1 }}>{children}</span>
      {crossed ? <Icon name="Ban" size={28} color={THEME.danger} /> : null}
    </div>
  );
}

/** Padlock in a glowing circle with an optional caption to the right. */
export function LockBadge({ at, label, show = 1, color = THEME.accent, size = 64 }: { at: P; label?: string; show?: number; color?: string; size?: number }) {
  return (
    <div style={{ position: "absolute", left: at.x, top: at.y, transform: `translate(-${size / 2}px, -50%) scale(${0.7 + 0.3 * show})`, transformOrigin: `${size / 2}px 50%`, display: "flex", alignItems: "center", gap: 14, opacity: show }}>
      <div style={{ width: size, height: size, borderRadius: "50%", background: THEME.deepest, border: `3px solid ${color}`, display: "grid", placeItems: "center", boxShadow: glow(color, 0.4), flex: "none" }}>
        <Icon name="Lock" size={size * 0.5} color={color} />
      </div>
      {label ? <div style={{ fontSize: 26, fontWeight: 600, color, whiteSpace: "nowrap", padding: "4px 14px", borderRadius: 10, background: THEME.deepest }}>{label}</div> : null}
    </div>
  );
}

/** A commit node: dark core inside a lane-colored ring. */
export function NodeDot({ at, color = THEME.accent, r = 16, show = 1, hot }: { at: P; color?: string; r?: number; show?: number; hot?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: at.x - r,
        top: at.y - r,
        width: 2 * r,
        height: 2 * r,
        borderRadius: "50%",
        background: hot ? color : THEME.deepest,
        border: `${Math.max(3, r * 0.3)}px solid ${color}`,
        boxShadow: hot ? glow(color, 0.5) : undefined,
        transform: `scale(${show})`,
        opacity: show,
      }}
    />
  );
}

const quad = (a: P, c: P, b: P, t: number): P => ({
  x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
});

/**
 * A straight or bent connection that draws itself in. Optional arrowhead at `to`, dots travelling
 * along it (`pulses`, from the frame), marching dashes, and a pill label off its middle.
 */
export function Arrow({
  from,
  to,
  bend = 0,
  via,
  color = THEME.borderStrong,
  draw = 1,
  width = 4,
  head = true,
  dashed,
  pulses = 0,
  speed = 0.7,
  label,
  labelAt = 0.5,
  labelOffset = -40,
  labelColor,
  hot,
  opacity = 1,
}: {
  from: P;
  to: P;
  bend?: number;
  /** Explicit control point of the curve; overrides `bend`. */
  via?: P;
  color?: string;
  draw?: number;
  width?: number;
  head?: boolean;
  dashed?: boolean;
  pulses?: number;
  speed?: number;
  label?: React.ReactNode;
  labelAt?: number;
  labelOffset?: number;
  labelColor?: string;
  hot?: boolean;
  opacity?: number;
}) {
  const { sec, frame } = useClip();
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const n = { x: -(to.y - from.y) / len, y: (to.x - from.x) / len };
  const ctrl = via ?? { x: (from.x + to.x) / 2 + n.x * bend, y: (from.y + to.y) / 2 + n.y * bend };
  const d = `M${from.x} ${from.y}Q${ctrl.x} ${ctrl.y} ${to.x} ${to.y}`;
  const tip = quad(from, ctrl, to, draw);
  const back = quad(from, ctrl, to, Math.max(0, draw - 0.02));
  const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
  const hs = 10 + width * 2;
  const headPts = [
    [tip.x, tip.y],
    [tip.x - hs * Math.cos(ang - 0.45), tip.y - hs * Math.sin(ang - 0.45)],
    [tip.x - hs * Math.cos(ang + 0.45), tip.y - hs * Math.sin(ang + 0.45)],
  ]
    .map((p) => p.join(","))
    .join(" ");
  const mid = quad(from, ctrl, to, labelAt);
  const labelPos = { x: mid.x + n.x * labelOffset, y: mid.y + n.y * labelOffset };
  return (
    <>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity, filter: hot ? `drop-shadow(0 0 8px ${color})` : undefined }}>
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          {...(dashed ? { strokeDasharray: "14 12", strokeDashoffset: -frame * 1.2, opacity: draw } : { pathLength: 1, strokeDasharray: "1 1", strokeDashoffset: 1 - draw })}
        />
        {head && draw > 0.04 ? <polygon points={headPts} fill={color} opacity={dashed ? draw : 1} /> : null}
        {Array.from({ length: pulses }, (_, i) => {
          const t = (((sec * speed + i / pulses) % 1) + 1) % 1;
          if (t > draw) return null;
          const p = quad(from, ctrl, to, t);
          return <circle key={i} cx={p.x} cy={p.y} r={width + 5} fill={color} opacity={Math.sin(Math.PI * t)} />;
        })}
      </svg>
      {label ? (
        <Label at={labelPos} color={labelColor ?? color} show={draw}>
          {label}
        </Label>
      ) : null}
    </>
  );
}

const MAIN = [866, 646, 426, 206];
const BRANCH = [426, 206];

/** One bonfire node of the logo, in the icon's unit scale (ring r = 8.5). */
function Fire({ x, y, color, core, show, flick }: { x: number; y: number; color: string; core: string; show: number; flick: [number, number] }) {
  return (
    <g transform={`translate(${x},${y}) scale(${7 * show})`} opacity={show}>
      <circle r={8.5} fill={THEME.deepest} stroke={color} strokeOpacity={0.6} strokeWidth={1.7} />
      <g transform={`translate(0,4) scale(${flick[0]},${flick[1]}) translate(0,-4)`}>
        <path d="M0 -16 C4.5 -10.5 7 -7 7 -3 A7 7 0 1 1 -7 -3 C-7 -7 -4.5 -10.5 0 -16 Z" fill={color} opacity={0.45} filter="url(#ggfx-fireGlow)" />
        <path d="M0 -9 C3 -5.5 4.2 -3.5 4.2 -0.5 A4.2 4.2 0 1 1 -4.2 -0.5 C-4.2 -3.5 -3 -5.5 0 -9 Z" fill={`url(#${core})`} />
      </g>
    </g>
  );
}

/**
 * Git Gud's "burning branch" mark: the pink main rail with four bonfire commits and the orange
 * branch with two. `build` (0..1) draws the rails and lights the fires; flames flicker from `sec`.
 */
export function BurningBranch({ size, build, sec }: { size: number; build: number; sec: number }) {
  const part = (start: number, length: number) => Math.min(1, Math.max(0, (build - start) / length));
  const flick = (i: number): [number, number] => [
    1 - 0.05 * Math.sin(sec * 11 + i * 2.3),
    1 + 0.1 * Math.sin(sec * 8.5 + i * 1.9) + 0.06 * Math.sin(sec * 21.7 + i * 4.1),
  ];
  const main = part(0, 0.45);
  const branch = part(0.3, 0.4);
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id="ggfx-plate" cx="50%" cy="46%" r="70%">
          <stop offset="0%" stopColor={THEME.bright} stopOpacity={0.12} />
          <stop offset="100%" stopColor={THEME.bright} stopOpacity={0} />
        </radialGradient>
        <radialGradient id="ggfx-coreP" cx="50%" cy="65%" r="60%">
          <stop offset="0%" stopColor="#ffd7ef" />
          <stop offset="45%" stopColor={THEME.bright} />
          <stop offset="100%" stopColor={THEME.accent} />
        </radialGradient>
        <radialGradient id="ggfx-coreO" cx="50%" cy="65%" r="60%">
          <stop offset="0%" stopColor="#ffe3c1" />
          <stop offset="45%" stopColor="#ff9d2e" />
          <stop offset="100%" stopColor={THEME.orange} />
        </radialGradient>
        <filter id="ggfx-fireGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={1024} height={1024} rx={220} fill={THEME.deepest} stroke={THEME.accentBorder} strokeWidth={6} />
      <rect width={1024} height={1024} rx={220} fill="url(#ggfx-plate)" />
      <line x1={340} y1={866} x2={340} y2={196} stroke={THEME.accent} strokeWidth={34} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - main} />
      <path d="M340 646 C340 512 700 570 700 426 L700 196" fill="none" stroke={THEME.orange} strokeWidth={34} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - branch} />
      {MAIN.map((y, i) => (
        <Fire key={`m${i}`} x={340} y={y} color={THEME.accent} core="ggfx-coreP" show={part(0.08 + i * 0.1, 0.18)} flick={flick(i)} />
      ))}
      {BRANCH.map((y, i) => (
        <Fire key={`b${i}`} x={700} y={y} color={THEME.orange} core="ggfx-coreO" show={part(0.5 + i * 0.12, 0.18)} flick={flick(i + 4)} />
      ))}
    </svg>
  );
}

/** A tall titled container by its top-left corner; callers place its contents in stage coordinates. */
export function Panel({
  left,
  top,
  w,
  h,
  icon,
  title,
  subtitle,
  show = 1,
  em = "same",
  pulse = 1,
  color = THEME.accent,
}: {
  left: number;
  top: number;
  w: number;
  h: number;
  icon: string;
  title: string;
  subtitle?: string;
  show?: number;
  em?: Em;
  pulse?: number;
  color?: string;
}) {
  const e = emStyle(em, pulse, color);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        height: h,
        padding: "24px 28px",
        borderRadius: 26,
        background: `linear-gradient(180deg, ${THEME.elevated}, ${THEME.base})`,
        border: `2px solid ${THEME.border}`,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        ...e,
        opacity: show,
        transform: `translateY(${(1 - show) * 26}px)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <IconTile name={icon} color={color} />
        <div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 24, color: THEME.muted, fontFamily: MONO, marginTop: 4 }}>{subtitle}</div> : null}
        </div>
      </div>
    </div>
  );
}
