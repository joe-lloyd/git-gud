import React from "react";
import { MONO } from "@neon/fx-kit";
import { Arrow, Box, Chip, Heading, Icon, Label, LockBadge, NodeDot, Panel, Stage, useClip } from "./primitives.tsx";
import type { Em, P } from "./primitives.tsx";
import { LANES, THEME } from "./theme.ts";

const FOCUSES = ["family", "trees", "remote", "autofix", "peers", "pairing", "reach", "daemon", "relay"] as const;
type Focus = (typeof FOCUSES)[number];
const asFocus = (value: string): Focus => FOCUSES.find((f) => f === value) ?? "family";
/** Last step each focus builds; a higher step shows that one. */
const LAST_STEP: Record<Focus, number> = { family: 4, trees: 3, remote: 2, autofix: 4, peers: 3, pairing: 4, reach: 3, daemon: 1, relay: 4 };

const TEAL = LANES[1] ?? THEME.accent;
const AMBER = LANES[2] ?? THEME.accent;
const INDIGO = LANES[3] ?? THEME.accent;

type Ctx = {
  step: number;
  sec: number;
  pulse: number;
  enter: (delay: number, length?: number) => number;
  /** Visibility and emphasis of a part that step `n` adds: built before, animating now, or not yet. */
  at: (n: number, delay?: number) => { show: number; em: Em };
};

/** Left-aligned row with an icon, for lists inside panels. */
function Row({ x, y, icon, color, children, show = 1, mono, size = 26, dim }: { x: number; y: number; icon: string; color: string; children: React.ReactNode; show?: number; mono?: boolean; size?: number; dim?: boolean }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `translateY(-50%) translateX(${(1 - show) * -20}px)`, display: "flex", alignItems: "center", gap: 14, fontSize: size, fontFamily: mono ? MONO : undefined, color: THEME.text, whiteSpace: "nowrap", opacity: show, filter: dim ? "brightness(0.6)" : undefined }}>
      <Icon name={icon} size={size + 4} color={color} />
      {children}
    </div>
  );
}

function family({ step, at, pulse }: Ctx) {
  const hub = { x: 960, y: 610 };
  const all = step >= 4;
  const cards = [
    { n: 1, p: { x: 420, y: 350 }, icon: "Laptop", title: "Desktop app", line: "Electron · Mac, Windows, Linux" },
    { n: 2, p: { x: 1500, y: 350 }, icon: "Server", title: "gitgud-headless", line: "Daemon for a box with no screen" },
    { n: 2, p: { x: 420, y: 870 }, icon: "Cloud", title: "gitgud-relay", line: "Reach home from anywhere" },
    { n: 3, p: { x: 1500, y: 870 }, icon: "Smartphone", title: "Companion", line: "Android phone app" },
  ];
  return (
    <>
      {cards.map((c, i) => {
        const a = at(c.n, 0.2 + (i % 2) * 0.15);
        const hot = all || a.em === "new";
        return <Arrow key={`l${i}`} from={c.p} to={hub} head={false} draw={a.show} color={hot ? THEME.accent : THEME.borderStrong} width={hot ? 5 : 4} pulses={hot ? 2 : 0} hot={hot} opacity={!all && a.em === "old" ? 0.6 : 1} />;
      })}
      <Box x={hub.x} y={hub.y} w={480} icon="Link" title="Peer protocol" lines={["HTTPS + SSE", "port 47831"]} mono show={at(1, 0).show} em={all ? "new" : "same"} pulse={pulse} />
      {cards.map((c, i) => {
        const a = at(c.n, 0.2 + (i % 2) * 0.15);
        return <Box key={i} x={c.p.x} y={c.p.y} w={480} icon={c.icon} title={c.title} lines={[c.line]} show={a.show} em={all ? "same" : a.em} pulse={pulse} />;
      })}
    </>
  );
}

function trees({ step, at, enter, pulse }: Ctx) {
  const cols = [360, 960, 1560];
  const wt = at(1, 0);
  const stage = at(2, 0);
  const hist = at(3, 0);
  // The hunk sits under app.ts, moves to staging in step 2, then into history in step 3.
  const wtSpot = { x: cols[0] ?? 0, y: 650 };
  const stSpot = { x: cols[1] ?? 0, y: 400 };
  const newNode = { x: 1440, y: 390 };
  const toStage = step >= 3 ? 1 : step === 2 ? enter(0.7, 1.1) : 0;
  const toHist = step >= 3 ? enter(0.7, 1.1) : 0;
  const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const hunk = toHist > 0 ? lerp(stSpot, newNode, toHist) : lerp(wtSpot, stSpot, toStage);
  const files: [string, string, string][] = [
    ["app.ts", "M", AMBER],
    ["README.md", "M", AMBER],
    ["styles.css", "+", THEME.success],
  ];
  const history = ["add login form", "wire up router", "first commit"];
  return (
    <>
      <Panel left={130} top={240} w={460} h={640} icon="Folder" title="Working tree" subtitle="files on disk" show={wt.show} em={wt.em} pulse={pulse} />
      <Panel left={730} top={240} w={460} h={640} icon="Layers" title="Staging area" subtitle="next commit" show={step >= 1 ? enter(0.15) : 0} em={stage.em === "new" && step === 2 ? "new" : step > 2 ? "old" : "same"} pulse={pulse} />
      <Panel left={1330} top={240} w={460} h={640} icon="History" title="History" subtitle="commits" show={enter(0.3)} em={step === 3 ? "new" : "same"} pulse={pulse} />
      {files.map(([name, mark, color], i) => (
        <Row key={name} x={170} y={400 + i * 76} icon="FileText" color={THEME.secondary} mono show={enter(0.4 + i * 0.12)} dim={step > 1}>
          <span style={{ width: 300, display: "inline-block" }}>{name}</span>
          <span style={{ color, fontWeight: 700 }}>{mark}</span>
        </Row>
      ))}
      <div style={{ position: "absolute", left: 760, width: 400, top: 540, textAlign: "center", fontSize: 26, color: THEME.muted, opacity: enter(0.5) * (step === 2 ? 1 - toStage : 1) }}>nothing staged</div>
      <Arrow from={{ x: 605, y: 560 }} to={{ x: 715, y: 560 }} draw={stage.show} color={step === 2 ? THEME.accent : THEME.borderStrong} label="stage" labelOffset={-44} labelColor={step === 2 ? THEME.accent : THEME.secondary} />
      <Arrow from={{ x: 1205, y: 560 }} to={{ x: 1315, y: 560 }} draw={hist.show} color={step === 3 ? THEME.accent : THEME.borderStrong} label="commit" labelOffset={-44} labelColor={step === 3 ? THEME.accent : THEME.secondary} />
      <Arrow from={{ x: 1440, y: newNode.y }} to={{ x: 1440, y: 830 }} head={false} draw={enter(0.4)} color={THEME.accent} width={6} />
      {history.map((msg, i) => (
        <React.Fragment key={msg}>
          <NodeDot at={{ x: 1440, y: 500 + i * 110 }} r={17} show={enter(0.5 + i * 0.1)} />
          <Row x={1480} y={500 + i * 110} icon="GitCommit" color={THEME.muted} show={enter(0.55 + i * 0.1)}>
            <span style={{ color: THEME.secondary }}>{msg}</span>
          </Row>
        </React.Fragment>
      ))}
      <NodeDot at={newNode} r={21} show={step >= 3 ? enter(1.6, 0.4) : 0} hot />
      <Row x={1480} y={newNode.y} icon="GitCommit" color={THEME.accent} show={step >= 3 ? enter(1.8) : 0}>
        <span style={{ fontWeight: 700 }}>guard null user</span>
      </Row>
      <Chip at={hunk} mono color={THEME.success} show={enter(0.7) * (1 - Math.max(0, toHist - 0.75) * 4)} em={step === 2 || (step === 1 && wt.em === "new") ? "new" : "same"} pulse={pulse}>
        + if (!user) return
      </Chip>
    </>
  );
}

/** A horizontal lane with commit nodes; `fresh` nodes are the ones this step adds. */
function Lane({ y, x0, x1, color, label, nodes, fresh, freshShow, show }: { y: number; x0: number; x1: number; color: string; label: string; nodes: number[]; fresh: number[]; freshShow: number; show: number }) {
  return (
    <>
      <div style={{ position: "absolute", left: x0, top: y - 66, fontFamily: MONO, fontSize: 26, color, opacity: show }}>{label}</div>
      <Arrow from={{ x: x0, y }} to={{ x: x1, y }} head={false} draw={show} color={color} width={6} opacity={0.75} />
      {nodes.map((x) => (
        <NodeDot key={x} at={{ x, y }} color={color} show={show} />
      ))}
      {fresh.map((x) => (
        <NodeDot key={x} at={{ x, y }} color={color} show={freshShow} hot={freshShow > 0.99} />
      ))}
    </>
  );
}

function remote({ at, enter }: Ctx) {
  const fetch = at(1, 0.6);
  const pull = at(2, 0.4);
  const push = at(2, 0.9);
  return (
    <>
      <Panel left={110} top={260} w={640} h={700} icon="Laptop" title="Local repo" subtitle="your machine" show={enter(0)} />
      <Panel left={1290} top={260} w={520} h={700} icon="Server" title="origin" subtitle="on a server" show={enter(0.2)} color={TEAL} />
      <Lane y={500} x0={170} x1={690} color={TEAL} label="origin/main" nodes={[220, 320, 420]} fresh={[520, 620]} freshShow={fetch.show} show={enter(0.3)} />
      <Lane y={740} x0={170} x1={690} color={THEME.accent} label="main" nodes={[220, 320, 420]} fresh={[520, 620]} freshShow={pull.show} show={enter(0.35)} />
      <Lane y={620} x0={1350} x1={1750} color={TEAL} label="main" nodes={[1400, 1480, 1560, 1640, 1720]} fresh={[]} freshShow={0} show={enter(0.4)} />
      <Arrow from={{ x: 1275, y: 500 }} to={{ x: 765, y: 500 }} draw={fetch.show} color={fetch.em === "new" ? TEAL : THEME.borderStrong} width={5} pulses={fetch.em === "new" ? 3 : 0} hot={fetch.em === "new"} label="Fetch: download, change nothing" labelOffset={44} opacity={fetch.em === "old" ? 0.6 : 1} />
      <Arrow from={{ x: 1275, y: 740 }} to={{ x: 765, y: 740 }} draw={pull.show} color={THEME.accent} width={5} pulses={3} hot label="Pull: fetch + merge into main" labelOffset={44} />
      <Arrow from={{ x: 765, y: 880 }} to={{ x: 1275, y: 880 }} draw={push.show} color={AMBER} width={5} pulses={3} hot label="Push: send your commits" labelOffset={-44} />
      <Label at={{ x: 430, y: 880 }} show={fetch.show * (pull.show > 0 ? 1 - pull.show : 1)} color={THEME.muted}>
        main is untouched
      </Label>
    </>
  );
}

function autofix({ step, at, enter, pulse }: Ctx) {
  const steps = [
    { icon: "AlertTriangle", title: "Blocked", line: "Local changes would be overwritten", cmd: "git pull  ✗", color: THEME.danger },
    { icon: "Archive", title: "Stash", line: "Set your changes aside", cmd: "git stash push", color: THEME.accent },
    { icon: "RefreshCw", title: "Retry", line: "Run the pull again", cmd: "git pull", color: THEME.accent },
    { icon: "Undo2", title: "Put back", line: "Re-apply them, or keep the stash", cmd: "git stash pop", color: THEME.accent },
  ];
  const x = (i: number) => 315 + i * 430;
  const y = 520;
  const h = 220;
  const done = step >= 4 ? enter(1.2, 0.5) : 0;
  return (
    <>
      {steps.map((s, i) => {
        const a = at(i + 1, 0.15);
        const arrow = at(i + 1, 0);
        const em: Em = step >= 4 ? (i === 3 ? "new" : "same") : a.em;
        return (
          <React.Fragment key={s.title}>
            {i > 0 ? <Arrow from={{ x: x(i - 1) + 188, y }} to={{ x: x(i) - 188, y }} draw={arrow.show} color={arrow.em === "new" && step < 4 ? THEME.accent : THEME.borderStrong} width={5} /> : null}
            <Box x={x(i)} y={y} w={360} h={h} icon={s.icon} color={s.color} title={s.title} lines={[s.line]} show={a.show} em={em} pulse={pulse}>
              <div style={{ position: "absolute", right: 22, bottom: 16, fontFamily: MONO, fontSize: 24, color: THEME.muted }}>{i + 1}</div>
            </Box>
            <Chip at={{ x: x(i), y: y + h / 2 + 70 }} mono color={i === 0 ? THEME.danger : THEME.borderStrong} show={a.show} em={em === "old" ? "old" : "same"}>
              {s.cmd}
            </Chip>
            {i > 0 ? (
              <div style={{ position: "absolute", left: x(i) - 28, top: y - h / 2 - 28, width: 56, height: 56, borderRadius: "50%", background: THEME.success, display: "grid", placeItems: "center", transform: `scale(${done})`, opacity: done }}>
                <Icon name="Check" size={34} color={THEME.deepest} stroke={3} />
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
      <Chip at={{ x: 960, y: 880 }} icon="Check" color={THEME.success} fill show={done}>
        Pull done. Your changes are back.
      </Chip>
    </>
  );
}

function peers({ step, at, enter, pulse }: Ctx) {
  const machines = at(1, 0);
  const rpc = at(2, 0.3);
  const sse = at(2, 0.8);
  const none = at(3, 0.3);
  return (
    <>
      <Panel left={130} top={290} w={540} h={520} icon="Laptop" title="Your Git Gud" subtitle="the app you use" show={machines.show} em={machines.em} pulse={pulse} />
      <Panel left={1250} top={290} w={540} h={520} icon="Server" title="Host" subtitle="where the repo lives" show={at(1, 0.2).show} em={machines.em} pulse={pulse} color={TEAL} />
      <Row x={180} y={470} icon="GitBranch" color={THEME.accent} show={enter(0.4)}>graph, diffs, staging</Row>
      <Row x={180} y={540} icon="Eye" color={THEME.accent} show={enter(0.5)}>what you see and click</Row>
      <Row x={1300} y={470} icon="Folder" color={TEAL} mono show={enter(0.5)}>~/code/my-repo</Row>
      <Row x={1300} y={540} icon="Terminal" color={TEAL} mono show={enter(0.6)}>$ git status</Row>
      <Arrow from={{ x: 690, y: 640 }} to={{ x: 1230, y: 640 }} draw={rpc.show} color={THEME.accent} width={5} pulses={step >= 2 ? 3 : 0} hot={rpc.em === "new"} label="RPC requests" labelOffset={-44} />
      <Arrow from={{ x: 1230, y: 740 }} to={{ x: 690, y: 740 }} draw={sse.show} color={TEAL} width={5} pulses={step >= 2 ? 3 : 0} hot={sse.em === "new"} label="SSE: working tree, live" labelOffset={-44} />
      <Chip at={{ x: 1520, y: 700 }} icon="Terminal" color={TEAL} fill show={rpc.show} em={rpc.em === "new" ? "new" : "same"} pulse={pulse}>
        git runs here
      </Chip>
      <Chip at={{ x: 960, y: 900 }} icon="Ban" color={THEME.accent} fill show={none.show} em={none.em} pulse={pulse}>
        nothing copied
      </Chip>
    </>
  );
}

function pairing({ step, at, pulse }: Ctx) {
  const cx = 420;
  const hx = 1500;
  const s1 = at(1, 0.3);
  const s2 = at(2, 0.3);
  const s3 = at(3, 0.3);
  const s4 = at(4, 0.3);
  const msg = (y: number, right: boolean, a: { show: number; em: Em }, label: string, color: string = THEME.accent) => (
    <Arrow from={{ x: right ? cx + 12 : hx - 12, y }} to={{ x: right ? hx - 12 : cx + 12, y }} draw={a.show} color={a.em === "new" ? color : THEME.borderStrong} width={4} hot={a.em === "new"} pulses={a.em === "new" ? 1 : 0} speed={0.5} label={label} labelOffset={right ? -32 : 32} labelColor={a.em === "new" ? color : THEME.secondary} />
  );
  return (
    <>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        {[cx, hx].map((x) => (
          <line key={x} x1={x} y1={300} x2={x} y2={1040} stroke={THEME.borderStrong} strokeWidth={3} strokeDasharray="10 12" />
        ))}
      </svg>
      <Box x={cx} y={235} w={360} icon="Laptop" title="Client" show={1} />
      <Box x={hx} y={235} w={360} icon="Server" title="Host" color={TEAL} show={1} />
      {msg(360, true, s1, "probe")}
      {msg(430, false, at(1, 0.8), "certificate", TEAL)}
      <Chip at={{ x: cx, y: 500 }} icon="Key" mono color={THEME.accent} show={at(1, 1.3).show} em={s1.em} pulse={pulse}>SHA-256 fingerprint</Chip>
      <Chip at={{ x: cx, y: 575 }} icon="Keyboard" mono color={AMBER} show={s2.show} em={s2.em} pulse={pulse}>you type 482 913</Chip>
      {msg(645, true, at(2, 0.8), "proof = HMAC(code, fingerprint)")}
      <Chip at={{ x: 880, y: 702 }} mono color={THEME.danger} crossed show={at(2, 1.4).show} em={s2.em === "new" ? "same" : s2.em}>482 913</Chip>
      <div style={{ position: "absolute", left: 1010, top: 702, transform: "translateY(-50%)", fontSize: 26, color: THEME.danger, opacity: at(2, 1.5).show * (s2.em === "old" ? 0.6 : 1) }}>never travels</div>
      <Chip at={{ x: hx, y: 765 }} icon="ShieldCheck" color={TEAL} show={s3.show} em={s3.em} pulse={pulse}>verify proof</Chip>
      {msg(830, false, at(3, 0.7), "token", TEAL)}
      <Arrow from={{ x: cx + 12, y: 905 }} to={{ x: hx - 12, y: 905 }} head={false} draw={at(3, 1.2).show} color={THEME.accent} width={8} hot={s3.em === "new"} opacity={s3.em === "old" ? 0.6 : 1} />
      <LockBadge at={{ x: 900, y: 905 }} label="pinned TLS" show={at(3, 1.5).show} />
      <Chip at={{ x: cx + 60, y: 990 }} icon="AlertTriangle" color={AMBER} show={s4.show} em={step >= 4 ? "new" : "same"} pulse={pulse}>certificate changed? → warning</Chip>
      <Chip at={{ x: hx - 60, y: 990 }} icon="Lock" color={THEME.danger} show={at(4, 0.6).show} em={step >= 4 ? "new" : "same"} pulse={pulse}>5 wrong codes → lockout</Chip>
    </>
  );
}

function reach({ at, enter, pulse }: Ctx) {
  const routes = [
    { n: 1, y: 380, color: TEAL, label: "LAN" },
    { n: 2, y: 620, color: INDIGO, label: "Tailscale / any address" },
    { n: 3, y: 860, color: AMBER, label: "Relay through a cloud box" },
  ];
  const lan = at(1, 0.6);
  const ts = at(2, 0.6);
  const relay = at(3, 0.3);
  const dim = (em: Em) => (em === "old" ? 0.6 : 1);
  return (
    <>
      <Panel left={110} top={250} w={360} h={740} icon="Laptop" title="You" subtitle="laptop or phone" show={enter(0)} />
      <Panel left={1450} top={250} w={360} h={740} icon="Server" title="Home server" subtitle="gitgud-headless" show={enter(0.15)} color={TEAL} />
      <div style={{ position: "absolute", left: 110, width: 360, top: 520, display: "flex", justifyContent: "center", gap: 40, opacity: enter(0.3) }}>
        <Icon name="Laptop" size={110} color={THEME.secondary} stroke={1.4} />
        <Icon name="Smartphone" size={110} color={THEME.secondary} stroke={1.4} />
      </div>
      <div style={{ position: "absolute", left: 1450, width: 360, top: 520, display: "flex", justifyContent: "center", opacity: enter(0.4) }}>
        <Icon name="Server" size={120} color={TEAL} stroke={1.4} />
      </div>
      {routes.map((r) => {
        const a = at(r.n, 0.3);
        const hot = a.em === "new";
        const color = hot ? THEME.accent : r.color;
        const props = { draw: a.show, color, width: 5, hot, pulses: hot ? 3 : 0, opacity: dim(a.em) };
        return r.n === 3 ? (
          <React.Fragment key={r.n}>
            <Arrow from={{ x: 485, y: r.y }} to={{ x: 755, y: r.y }} {...props} />
            <Arrow from={{ x: 1165, y: r.y }} to={{ x: 1435, y: r.y }} {...props} />
          </React.Fragment>
        ) : (
          <Arrow key={r.n} from={{ x: 485, y: r.y }} to={{ x: 1435, y: r.y }} {...props} />
        );
      })}
      {routes.map((r) => {
        const a = at(r.n, 0.3);
        return (
          <Label key={r.n} at={{ x: 960, y: r.y - (r.n === 3 ? 100 : 44) }} color={a.em === "new" ? THEME.accent : r.color} strong show={a.show * dim(a.em)}>
            {r.label}
          </Label>
        );
      })}
      <Chip at={{ x: 780, y: 445 }} icon="Radio" mono color={TEAL} show={lan.show} em={lan.em === "old" ? "old" : "same"}>UDP beacon :47832</Chip>
      <Chip at={{ x: 1150, y: 445 }} icon="Lock" mono color={TEAL} show={lan.show} em={lan.em === "old" ? "old" : "same"}>HTTPS :47831</Chip>
      <Chip at={{ x: 960, y: 685 }} icon="Globe" mono color={INDIGO} show={ts.show} em={ts.em === "old" ? "old" : "same"}>100.64.0.7 · any hostname</Chip>
      <Box x={960} y={860} w={390} icon="Cloud" title="gitgud-relay" show={relay.show} em={relay.em} pulse={pulse} color={AMBER} />
    </>
  );
}

function daemon({ enter, pulse }: Ctx) {
  const repos = ["~/repos/git-gud", "~/repos/homelab", "~/repos/dotfiles"];
  const facts: [string, string, string][] = [
    ["Settings", "systemd service", THEME.secondary],
    ["ShieldCheck", "read-only by default", THEME.success],
    ["Timer", "pairing window: 10 min", AMBER],
  ];
  const clients = enter(2.2);
  return (
    <>
      <Arrow from={{ x: 470, y: 600 }} to={{ x: 625, y: 600 }} head={false} draw={enter(2.5)} color={THEME.accent} width={5} pulses={2} hot />
      <Arrow from={{ x: 1295, y: 600 }} to={{ x: 1450, y: 600 }} head={false} draw={enter(2.6)} color={THEME.accent} width={5} pulses={2} hot />
      <Panel left={640} top={230} w={640} h={760} icon="Server" title="gitgud-headless" subtitle="Linux box, no screen" show={enter(0.2)} em="new" pulse={pulse} />
      <div style={{ position: "absolute", left: 690, top: 375, fontSize: 24, fontWeight: 600, letterSpacing: 2, color: THEME.muted, opacity: enter(0.5) }}>REPOS</div>
      {repos.map((r, i) => (
        <Row key={r} x={690} y={445 + i * 62} icon="Folder" color={TEAL} mono show={enter(0.6 + i * 0.15)}>
          {r}
        </Row>
      ))}
      <div style={{ position: "absolute", left: 690, right: 690, top: 660, height: 2, background: THEME.border, opacity: enter(1.1) }} />
      {facts.map(([icon, text, color], i) => (
        <Row key={text} x={690} y={730 + i * 76} icon={icon} color={color} size={30} show={enter(1.3 + i * 0.2)}>
          {text}
        </Row>
      ))}
      <Box x={290} y={600} w={340} icon="Laptop" title="Desktop" lines={["paired"]} show={clients} />
      <Box x={1630} y={600} w={340} icon="Smartphone" title="Companion" lines={["paired"]} show={enter(2.35)} />
    </>
  );
}

function relay({ step, at, pulse }: Ctx) {
  const reg = at(1, 0.4);
  const conn = at(2, 0.4);
  const tun = at(3, 0.3);
  const limits = at(4, 0.3);
  const faded = (em: Em) => (em === "old" ? 0.45 : 1);
  // The pinned-TLS tunnel arcs from the client into the relay box and out to the host.
  const tube = (from: P, via: P, to: P, key: string) => (
    <React.Fragment key={key}>
      <Arrow from={from} via={via} to={to} head={false} draw={tun.show} color={THEME.accent} width={24} opacity={0.2} />
      <Arrow from={from} via={via} to={to} head={false} draw={tun.show} color={THEME.accent} width={5} hot={tun.em === "new"} pulses={step >= 3 ? 2 : 0} speed={0.45} />
    </React.Fragment>
  );
  return (
    <>
      <Arrow from={{ x: 1400, y: 735 }} to={{ x: 1160, y: 420 }} draw={reg.show} color={reg.em === "new" ? THEME.accent : AMBER} width={5} hot={reg.em === "new"} pulses={reg.em === "new" ? 3 : 0} label="outbound: register" labelOffset={-60} opacity={faded(reg.em)} />
      <Arrow from={{ x: 520, y: 735 }} to={{ x: 760, y: 420 }} draw={conn.show} color={conn.em === "new" ? THEME.accent : TEAL} width={5} hot={conn.em === "new"} pulses={conn.em === "new" ? 3 : 0} label="connect" labelOffset={50} opacity={faded(conn.em)} />
      {tube({ x: 330, y: 720 }, { x: 330, y: 300 }, { x: 700, y: 300 }, "l")}
      {tube({ x: 1220, y: 300 }, { x: 1590, y: 300 }, { x: 1590, y: 720 }, "r")}
      <Box x={330} y={800} w={400} icon="Smartphone" title="Phone / laptop" lines={["away from home"]} />
      <Box x={1590} y={800} w={400} icon="Server" title="Home server" lines={["gitgud-headless"]} mono color={TEAL} />
      <Box x={960} y={300} w={520} icon="Cloud" title="gitgud-relay" lines={step < 3 ? ["a small cloud box"] : []} color={AMBER} em={limits.em === "new" ? "new" : "same"} pulse={pulse}>
        {step >= 3 ? (
          <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 25, lineHeight: 1.35, color: AMBER, opacity: tun.show }}>
            sees: ciphertext
            <br />+ server id (SNI)
          </div>
        ) : null}
      </Box>
      <LockBadge at={{ x: 422, y: 404 }} show={tun.show} />
      <LockBadge at={{ x: 1498, y: 404 }} show={tun.show} />
      <Chip at={{ x: 960, y: 560 }} icon="Link" color={TEAL} show={conn.show * (1 - tun.show)} em={conn.em} pulse={pulse}>relay splices the two</Chip>
      <Label at={{ x: 960, y: 560 }} color={THEME.accent} strong show={tun.show}>
        pinned TLS, end to end
      </Label>
      <div style={{ position: "absolute", left: 560, width: 800, top: 660, textAlign: "center", opacity: limits.show, transform: `translateY(${(1 - limits.show) * 20}px)` }}>
        <div style={{ fontSize: 40, fontWeight: 700, color: THEME.text }}>can't read · can't pair</div>
        <div style={{ marginTop: 10, fontSize: 32, color: AMBER }}>can only stop forwarding</div>
      </div>
    </>
  );
}

const SCENES: Record<Focus, (ctx: Ctx) => React.ReactNode> = { family, trees, remote, autofix, peers, pairing, reach, daemon, relay };

export const GitGudDiagram: React.FC<{ focus: string; step: number; caption: string }> = ({ focus: rawFocus, step: rawStep, caption }) => {
  const { sec, enter, out } = useClip();
  const focus = asFocus(rawFocus);
  const step = Math.max(1, Math.min(LAST_STEP[focus], Math.round(rawStep || 1)));
  const at = (n: number, delay = 0.2) => ({ show: step > n ? 1 : step === n ? enter(delay) : 0, em: (step === n ? "new" : "old") as Em });
  const pulse = 0.5 + 0.5 * Math.sin(sec * Math.PI * 1.4);
  return (
    <Stage opacity={out}>
      {SCENES[focus]({ step, sec, pulse, enter, at })}
      <Heading text={caption} show={enter(0.05)} />
    </Stage>
  );
};
