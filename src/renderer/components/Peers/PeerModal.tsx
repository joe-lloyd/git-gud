import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { PeerRepoSummary, PeerState, PeerStatus } from '../../../preload/index'
import type { UsePeers } from '../../hooks/usePeers'
import { Icon } from '../Icons/Icon'
import './Peers.css'

// Peer connections UI — three surfaces:
//   • PeerModal   — "Connect to a Peer…": nearby / paired / manual, pairing,
//                   browsing a peer's repositories and opening one as a tab.
//   (Where a remote repo lives is shown on the sidebar repo header — App's
//    repo-location menu — not in a banner.)
//   • PeersSection — host-side sharing controls inside Settings.
// All state comes from usePeers (a mirror of main's snapshot); nothing here
// ever sees a token.

// ── Shared bits ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<PeerStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  offline: 'Offline',
  revoked: 'Access revoked',
}

const StatusDot: React.FC<{ status: PeerStatus; title?: string }> = ({ status, title }) => (
  <span className={`peer-dot peer-dot-${status}`} title={title ?? STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]} />
)

// Six-digit code entry — digits only, auto-trimmed.
const CodeInput: React.FC<{ value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean; autoFocus?: boolean }> =
  ({ value, onChange, onSubmit, disabled, autoFocus }) => (
    <input
      className="peer-code-input mono"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="000000"
      maxLength={6}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={(e) => { if (e.key === 'Enter' && value.length === 6) onSubmit() }}
    />
  )

// ── Modal ────────────────────────────────────────────────────────────────────

type Selection =
  | { kind: 'none' }
  | { kind: 'peer'; peerId: string }          // a paired peer
  | { kind: 'discovered'; peerId: string }    // nearby, not paired yet
  | { kind: 'manual' }

interface PeerModalProps {
  peers: UsePeers
  onClose: () => void
  onOpenRepo: (peerId: string, remotePath: string) => Promise<void>
  /** Tabs orphaned by "Forget" — the app closes them. */
  onForgotten: (paths: string[]) => void
}

export function PeerModal({ peers, onClose, onOpenRepo, onForgotten }: PeerModalProps) {
  const state = peers.state
  const [sel, setSel] = useState<Selection>(() =>
    state?.peers.length ? { kind: 'peer', peerId: state.peers[0].peerId } : { kind: 'none' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A discovered peer that gets paired jumps to the paired list.
  useEffect(() => {
    if (sel.kind === 'discovered' && state?.peers.some((p) => p.peerId === sel.peerId)) {
      setSel({ kind: 'peer', peerId: sel.peerId })
    }
  }, [sel, state])

  const nearbyUnpaired = useMemo(() => (state?.discovered ?? []).filter((d) => !d.known), [state])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="peer-modal fade-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Connect to a peer">
        <div className="peer-header">
          <h2><Icon name="peer" size={16} /> Peers</h2>
          <button className="close-btn" onClick={onClose} title="Close">×</button>
        </div>

        <div className="peer-body">
          <div className="peer-rail">
            <div className="peer-rail-label">Paired</div>
            {(state?.peers ?? []).length === 0 && <div className="peer-rail-empty">No peers yet</div>}
            {(state?.peers ?? []).map((p) => (
              <button
                key={p.peerId}
                className={`peer-rail-item ${sel.kind === 'peer' && sel.peerId === p.peerId ? 'active' : ''}`}
                onClick={() => setSel({ kind: 'peer', peerId: p.peerId })}
                title={`${p.host}:${p.port}`}
              >
                <StatusDot status={p.status} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}

            <div className="peer-rail-label" style={{ marginTop: 10 }}>Nearby</div>
            {nearbyUnpaired.length === 0 && <div className="peer-rail-empty">Nothing found on this network</div>}
            {nearbyUnpaired.map((d) => (
              <button
                key={d.peerId}
                className={`peer-rail-item ${sel.kind === 'discovered' && sel.peerId === d.peerId ? 'active' : ''}`}
                onClick={() => setSel({ kind: 'discovered', peerId: d.peerId })}
                title={`${d.address}:${d.port}`}
              >
                <Icon name="peer" size={12} />
                <span className="truncate">{d.name}</span>
              </button>
            ))}

            <div className="peer-rail-spacer" />
            <button className={`peer-rail-item ${sel.kind === 'manual' ? 'active' : ''}`} onClick={() => setSel({ kind: 'manual' })}>
              <Icon name="plus" size={12} />
              <span>Connect by address…</span>
            </button>
          </div>

          <div className="peer-content">
            {sel.kind === 'none' && <EmptyHint sharing={state?.server.enabled ?? false} />}
            {sel.kind === 'manual' && <ManualConnect peers={peers} />}
            {sel.kind === 'discovered' && (() => {
              const d = state?.discovered.find((x) => x.peerId === sel.peerId)
              return d ? <PairForm peers={peers} host={d.address} port={d.port} name={d.name} version={d.version} /> : <EmptyHint sharing={false} />
            })()}
            {sel.kind === 'peer' && (() => {
              const p = state?.peers.find((x) => x.peerId === sel.peerId)
              return p ? (
                <PeerDetail
                  peer={p}
                  peers={peers}
                  onOpenRepo={onOpenRepo}
                  onForget={async () => {
                    const dropped = await peers.actions.forget(p.peerId)
                    onForgotten(dropped)
                    setSel({ kind: 'none' })
                  }}
                />
              ) : <EmptyHint sharing={false} />
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

const EmptyHint: React.FC<{ sharing: boolean }> = ({ sharing }) => (
  <div className="peer-empty">
    <Icon name="peer" size={36} />
    <h3>Work with repositories on your other machines</h3>
    <p>
      On the other computer, open Git Gud → Settings → <strong>Share with other Git Gud instances</strong>.
      It will show up under <em>Nearby</em> here with a 6-digit pairing code. Once paired you can browse
      its repositories, see their trees, and run fetch / pull / push over there from here.
    </p>
    <p className="peer-empty-note">
      {sharing
        ? 'This machine is sharing too — other instances can find it under Nearby.'
        : 'Want this machine to be reachable as well? Turn on sharing in Settings.'}
    </p>
  </div>
)

// ── Pairing ──────────────────────────────────────────────────────────────────

// First 8 bytes of a SHA-256 fingerprint as "AB12 CD34 EF56 7890" — enough to
// compare by eye against the host's Settings.
const shortFp = (fp: string) => fp.replace(/:/g, '').slice(0, 16).match(/.{4}/g)?.join(' ') ?? ''

const PairForm: React.FC<{ peers: UsePeers; host: string; port: number; name: string; version?: string; fingerprint?: string }> =
  ({ peers, host, port, name, version, fingerprint }) => {
    const [code, setCode] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    // Learn the host's certificate fingerprint (trust-on-first-use) so the
    // user can compare it with the one shown on the host before pairing.
    const [fp, setFp] = useState(fingerprint ?? '')
    useEffect(() => {
      if (fingerprint) { setFp(fingerprint); return }
      let live = true
      peers.actions.probe(host, port).then((r) => { if (live && r.success && r.info) setFp(r.info.fingerprint) })
      return () => { live = false }
    }, [host, port, fingerprint, peers.actions])

    const submit = useCallback(async () => {
      if (code.length !== 6) return
      setBusy(true); setError('')
      const r = await peers.actions.pair(host, port, code)
      setBusy(false)
      if (!r.success) setError(r.error ?? 'Pairing failed')
      // Success: the peer becomes "paired" and the modal switches to its detail.
    }, [code, host, port, peers.actions])

    return (
      <div className="peer-pane">
        <h3>Pair with {name}</h3>
        <div className="peer-meta mono">{host}:{port}{version ? ` · Git Gud v${version}` : ''}</div>
        <p className="peer-hint">
          Enter the 6-digit code shown on <strong>{name}</strong> under Settings → Share with other Git Gud instances.
          The code changes after every pairing.
        </p>
        <div className="peer-fp">
          <span className="peer-fp-label">Certificate</span>
          <span className="mono">{fp ? shortFp(fp) : 'reading…'}</span>
          <span className="peer-fp-hint">should match the fingerprint shown next to the code on {name}. Connections are encrypted (TLS) and pinned to this certificate.</span>
        </div>
        <div className="peer-pair-row">
          <CodeInput value={code} onChange={setCode} onSubmit={submit} disabled={busy} autoFocus />
          <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={submit}>
            {busy ? 'Pairing…' : 'Pair'}
          </button>
        </div>
        {error && <div className="peer-error">{error}</div>}
      </div>
    )
  }

const ManualConnect: React.FC<{ peers: UsePeers }> = ({ peers }) => {
  const [addr, setAddr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<{ host: string; port: number; name: string; version: string; fingerprint: string } | null>(null)

  const lookup = useCallback(async () => {
    const parsed = parseHostPort(addr)
    if (!parsed) { setError('Enter an address like 192.168.1.20, my-pc.local:47831 or studio-pc.tail1234.ts.net'); return }
    setBusy(true); setError(''); setFound(null)
    const r = await peers.actions.probe(parsed.host, parsed.port)
    setBusy(false)
    if (!r.success || !r.info) { setError(r.error ?? 'No Git Gud peer answered at that address'); return }
    setFound({ host: parsed.host, port: parsed.port, name: r.info.name, version: r.info.version, fingerprint: r.info.fingerprint })
  }, [addr, peers.actions])

  return (
    <div className="peer-pane">
      <h3>Connect by address</h3>
      <p className="peer-hint">
        For machines discovery can't see — another subnet, or <b>another building over the internet</b>. The other
        side must have sharing enabled; the default port is 47831. A name you enter here is kept as this
        peer's address even when it later shows up on the local network.
      </p>
      <details className="peer-hint peer-recipe">
        <summary>Over the internet with Tailscale (recommended, nothing to forward)</summary>
        <ol>
          <li>Install Tailscale on both machines and sign in to the same tailnet (<span className="mono">tailscale.com/download</span>).</li>
          <li>On the other machine: Git Gud → Settings → <i>Share with other Git Gud instances</i> on.</li>
          <li>Here: enter its MagicDNS name, e.g. <span className="mono">studio-pc.tail1234.ts.net</span> (or its 100.x.y.z IP), then Look up.</li>
          <li>Compare the certificate fingerprint with the one on its Settings screen, enter the pairing code — done.</li>
        </ol>
        Traffic stays end-to-end encrypted (pinned TLS inside the WireGuard tunnel). An SSH tunnel works too:
        <span className="mono">ssh -L 47831:127.0.0.1:47831 user@host</span> then connect to <span className="mono">127.0.0.1</span>.
      </details>
      <div className="peer-pair-row">
        <input
          className="peer-input mono"
          placeholder="ip, my-pc.local or name.tailnet.ts.net[:port]"
          value={addr}
          autoFocus
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') lookup() }}
          disabled={busy}
        />
        <button className="btn btn-ghost" disabled={busy || !addr.trim()} onClick={lookup}>{busy ? 'Looking…' : 'Look up'}</button>
      </div>
      {error && <div className="peer-error">{error}</div>}
      {found && <PairForm peers={peers} host={found.host} port={found.port} name={found.name} version={found.version} fingerprint={found.fingerprint} />}
    </div>
  )
}

function parseHostPort(input: string): { host: string; port: number } | null {
  const s = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  if (!s) return null
  const v6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : 47831 }
  const parts = s.split(':')
  if (parts.length === 1) return { host: parts[0], port: 47831 }
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return { host: parts[0], port: Number(parts[1]) }
  return null
}

// ── Paired peer detail: status + repo browser ────────────────────────────────

const PeerDetail: React.FC<{
  peer: PeerState['peers'][number]
  peers: UsePeers
  onOpenRepo: (peerId: string, remotePath: string) => Promise<void>
  onForget: () => Promise<void>
}> = ({ peer, peers, onOpenRepo, onForget }) => {
  const [repos, setRepos] = useState<PeerRepoSummary[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [confirmForget, setConfirmForget] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const r = await peers.actions.listRepos(peer.peerId)
    setLoading(false)
    if (r.success && r.repos) setRepos(r.repos)
    else { setRepos(null); setError(r.error ?? 'Could not list repositories') }
  }, [peer.peerId, peers.actions])

  // Load when the peer is selected and again whenever it (re)connects.
  useEffect(() => { if (peer.status === 'connected') load() }, [peer.peerId, peer.status, load])

  const open = async (path: string) => {
    setOpening(path)
    try { await onOpenRepo(peer.peerId, path) } finally { setOpening(null) }
  }

  return (
    <div className="peer-pane">
      <div className="peer-detail-head">
        <div>
          <h3><StatusDot status={peer.status} /> {peer.name}</h3>
          <div className="peer-meta mono">{peer.host}:{peer.port} · {STATUS_LABEL[peer.status]}</div>
        </div>
        <div className="peer-detail-actions">
          {peer.status === 'connected' || peer.status === 'connecting'
            ? <button className="btn btn-ghost" onClick={() => peers.actions.disconnect(peer.peerId)}>Disconnect</button>
            : peer.status !== 'revoked' && <button className="btn btn-ghost" onClick={() => peers.actions.connect(peer.peerId)}>Connect</button>}
          {confirmForget
            ? <>
                <button className="btn btn-danger" onClick={onForget}>Forget & close its tabs</button>
                <button className="btn btn-ghost" onClick={() => setConfirmForget(false)}>Cancel</button>
              </>
            : <button className="btn btn-ghost" title="Remove this peer and its credentials" onClick={() => setConfirmForget(true)}>Forget</button>}
        </div>
      </div>

      {peer.status === 'revoked' && (
        <div className="peer-error">
          {peer.name} revoked this machine's access. Pair again with a fresh code from its Settings.
        </div>
      )}
      {peer.status === 'offline' && peer.error && <div className="peer-warn">{peer.error} — retrying automatically.</div>}

      <div className="peer-repos-head">
        <span>Repositories on {peer.name}</span>
        <button className="btn btn-ghost peer-refresh" onClick={load} disabled={loading || peer.status !== 'connected'} title="Refresh list">
          <Icon name="refresh" size={12} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="peer-error">{error}</div>}
      <div className="peer-repo-list">
        {repos && repos.length === 0 && <div className="peer-rail-empty">No repositories yet — open some in Git Gud on {peer.name}.</div>}
        {(repos ?? []).map((r) => (
          <button key={r.path} className="peer-repo" onClick={() => open(r.path)} disabled={opening !== null} title={r.path}>
            <span className="peer-repo-icon"><Icon name="branch" size={13} /></span>
            <span className="peer-repo-name">{r.name}</span>
            <span className="peer-repo-path truncate mono">{r.path}</span>
            {r.open && <span className="peer-repo-badge">open there</span>}
            <span className="peer-repo-open">{opening === r.path ? 'Opening…' : 'Open'}</span>
          </button>
        ))}
        {!repos && !error && peer.status !== 'connected' && (
          <div className="peer-rail-empty">Connect to browse repositories.</div>
        )}
      </div>
    </div>
  )
}

// ── Settings section (host side) ─────────────────────────────────────────────

export const PeersSection: React.FC<{
  peers: UsePeers
  row: React.CSSProperties
  labelWrap: React.CSSProperties
  labelText: React.CSSProperties
  hintText: React.CSSProperties
}> = ({ peers, row, labelWrap, labelText, hintText }) => {
  const s = peers.state
  const [name, setName] = useState(s?.self.name ?? '')
  const [port, setPort] = useState(String(s?.server.port ?? 47831))
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  useEffect(() => { if (s) { setName(s.self.name); setPort(String(s.server.port)) } }, [s?.self.name, s?.server.port])
  if (!s) return null

  const input: React.CSSProperties = {
    boxSizing: 'border-box', padding: '6px 10px', border: '1px solid var(--border)',
    borderRadius: 6, background: 'var(--bg-deepest)', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
  }

  return (
    <>
      <div style={row}>
        <div style={labelWrap}>
          <span style={labelText}>Share with other Git Gud instances</span>
          <span style={hintText}>Lets paired machines on your network view this machine's repositories and run fetch / pull / push here.</span>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={s.server.enabled} onChange={(e) => peers.actions.setServer({ enabled: e.target.checked })} />
        </label>
      </div>

      {s.server.enabled && (
        <div style={{ ...row, display: 'block' }}>
          {s.server.error && <div className="peer-error" style={{ marginBottom: 10 }}>{s.server.error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10, marginBottom: 12 }}>
            <label>
              <span style={{ ...hintText, display: 'block', fontWeight: 600, marginBottom: 3 }}>This machine's name</span>
              <input style={{ ...input, width: '100%' }} value={name} maxLength={64}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { if (name.trim() && name.trim() !== s.self.name) peers.actions.setServer({ name: name.trim() }) }} />
            </label>
            <label>
              <span style={{ ...hintText, display: 'block', fontWeight: 600, marginBottom: 3 }}>Port</span>
              <input style={{ ...input, width: '100%' }} className="mono" value={port} inputMode="numeric"
                onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onBlur={() => { const p = Number(port); if (p >= 1024 && p <= 65535 && p !== s.server.port) peers.actions.setServer({ port: p }); else setPort(String(s.server.port)) }} />
            </label>
          </div>

          <div className="peer-code-card">
            <div>
              <div style={{ ...hintText, fontWeight: 600 }}>Pairing code</div>
              <div className="peer-code mono">{s.server.running ? s.server.pairingCode.replace(/(\d{3})(\d{3})/, '$1 $2') : '— — —'}</div>
              <div style={hintText}>
                {s.server.running
                  ? `Enter this on the other machine. Listening on port ${s.server.port} (TLS); the code rotates after each pairing.`
                  : 'Starting…'}
              </div>
              {s.server.running && s.server.fingerprint && (
                <div style={{ ...hintText, marginTop: 4 }}>
                  Certificate <span className="mono" style={{ color: 'var(--text-primary)' }}>{shortFp(s.server.fingerprint)}</span> — the other machine shows the same before pairing.
                </div>
              )}
            </div>
            <button className="btn btn-ghost" disabled={!s.server.running} onClick={() => peers.actions.regenerateCode()} title="Generate a new code">
              <Icon name="refresh" size={12} /> New code
            </button>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, cursor: 'pointer' }}>
            <span style={labelWrap}>
              <span style={{ ...labelText, fontSize: 12 }}>Read-only</span>
              <span style={hintText}>Peers can view repositories but not fetch, pull, push or switch branches here.</span>
            </span>
            <input type="checkbox" checked={s.server.readOnly} onChange={(e) => peers.actions.setServer({ readOnly: e.target.checked })} />
          </label>

          <div style={{ marginTop: 14 }}>
            <div style={{ ...hintText, fontWeight: 600, marginBottom: 6 }}>Paired devices ({s.server.paired.length})</div>
            {s.server.paired.length === 0 && <div style={hintText}>None yet — pair from the other machine's Peers window.</div>}
            {s.server.paired.map((d) => (
              <div key={d.peerId} className="peer-paired-row">
                <StatusDot status={d.connected ? 'connected' : 'offline'} title={d.connected ? 'Connected now' : 'Not connected'} />
                <span className="truncate" style={{ flex: 1, fontSize: 12 }}>{d.name}</span>
                <span style={{ ...hintText, whiteSpace: 'nowrap' }}>paired {new Date(d.createdAt).toLocaleDateString()}</span>
                {confirmRevoke === d.peerId
                  ? <>
                      <button className="btn btn-danger" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { peers.actions.revokeDevice(d.peerId); setConfirmRevoke(null) }}>Revoke</button>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setConfirmRevoke(null)}>Cancel</button>
                    </>
                  : <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setConfirmRevoke(d.peerId)}>Revoke…</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
