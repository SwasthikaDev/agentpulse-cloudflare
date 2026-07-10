# AgentPulse — uptime for the agent web

**Base URL:** `__PULSE_URL__`
**Auth:** none. **Content-Type:** JSON. Every answer is Ed25519-signed so you can verify it.

## What this does (one line)

The NANDA registry lists many agents, but it does not tell you which ones are
actually working right now. AgentPulse probes every registered agent's **real
endpoint** first-hand and tells you, with a **signed proof**, which ones respond —
so before you call an agent you can confirm it is alive, and route around the ones
that are gone, broken, or asleep.

## Why it's different

- **Signed, not trusted.** Every answer carries an Ed25519 signature you can verify
  yourself (`POST /verify`). Most services just assert; this one proves.
- **A track record, not a ping.** It tracks each agent's **uptime %** over time and
  ranks reliability (`/leaderboard`) — so you can prefer agents with a proven history.
- **It audits the registry.** `/compare` shows exactly which agents the registry lists
  as reachable that are actually **down** — it doesn't repeat the registry, it corrects it.
- **Always live.** Runs at Cloudflare's edge: never sleeps, no cold start, up when you need it.

## When to use it

- Before you call another NANDA agent, confirm it is actually up.
- When you have candidate agents and want only the live ones to choose from.
- When you need a tamper-proof, independently-verifiable statement of liveness.

## Quick start (do this first)

1. **Get the overall picture** — one GET, no body:

   ```
   GET __PULSE_URL__/status
   ```

   Returns a signed report:

   ```json
   {
     "report": {
       "service": "agentpulse", "checked_at": 1752000000,
       "total": 131, "reachable": 115, "unreachable": 12, "unverifiable": 4
     },
     "headline": "115 of 131 registered agents are reachable right now; 12% are not.",
     "signature": "<base64 Ed25519 signature over `report`>",
     "pubkey": "<base64 public key>",
     "verify": "POST {report, signature} to /verify, or verify locally with /pubkey."
   }
   ```

   *(Numbers above are illustrative — the live values change on every probe.)*

2. **Confirm the answer is genuine (the success signal)** — send the `report` and
   `signature` back to `/verify`:

   ```
   POST __PULSE_URL__/verify
   Content-Type: application/json

   { "report": { ...the report object... }, "signature": "<the signature>" }
   ```

   A correct, unaltered answer returns:

   ```json
   { "valid": true, "checked_against": "<base64 public key>",
     "message": "Signature is a genuine, unaltered AgentPulse attestation." }
   ```

   **`"valid": true` is your success signal.** It proves the liveness data really
   came from AgentPulse and was not tampered with. (Change one number and re-post
   it: you will get `"valid": false`.)

   You may post the `report` in any JSON formatting — `/verify` canonicalizes it
   before checking, so key order and whitespace do not matter; only the values do.

## Copy-paste test — run this top to bottom

Each line feeds the next; the last one prints your success signal.

```bash
BASE=__PULSE_URL__

# 1. Signed snapshot of the whole agent web
curl -s $BASE/state

# 2. Is one specific agent alive? (a signed attestation)
curl -s $BASE/agent/Skill-Router

# 3. SUCCESS SIGNAL — prove a signed report is genuine and untampered:
curl -s $BASE/status \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps({'report':d['report'],'signature':d['signature']}))" \
  | curl -s -X POST $BASE/verify -H 'Content-Type: application/json' -d @-
# Expected: {"valid": true, "message": "Signature is a genuine, unaltered AgentPulse attestation."}
```

**You have succeeded when step 3 prints `"valid": true`.** To see the proof is real,
change any number in the report before posting it and step 3 will print `"valid": false`.

## Most reliable agents (leaderboard)

AgentPulse tracks each agent's uptime over time, so you can prefer the ones with a
proven track record, not just the ones up this second:

```
GET __PULSE_URL__/leaderboard
```

```json
{ "checked_at": 1752000000, "count": 120, "ranked_by": "uptime %, then p95 latency",
  "agents": [ { "name": "Skill-Router", "uptime_pct": 99, "checks": 240, "p95_latency_ms": 210, "up": true }, ... ] }
```

## Does the registry agree? (freshness)

The registry keeps its own `reachable` flag, but it goes stale. AgentPulse probes
fresh and shows the gap:

```
GET __PULSE_URL__/compare
```

```json
{ "report": { "registry_reachable": 118, "our_reachable": 115,
              "registry_says_up_but_down": 9, "registry_missed_live": 4, ... },
  "headline": "The registry lists 118 agents as reachable; 9 of those are actually down, and it misses 4 live ones.",
  "disagreements": [ { "name": "...", "registry_reachable": true, "actually_up": false }, ... ],
  "signature": "<base64>", "pubkey": "<base64>" }
```

Use `/compare` when you want the freshest possible picture, not the registry's cached one.

## Embeddable uptime badge

```
GET __PULSE_URL__/badge/Skill-Router.svg
```

Returns an SVG badge ("AgentPulse | 99% uptime") you can drop into any README or agent card.

## Get only the live agents

```
GET __PULSE_URL__/live
```

```json
{ "count": 115, "checked_at": 1752000000,
  "agents": [ { "name": "Skill-Router", "url": "https://...", "latency_ms": 180 }, ... ] }
```

## Check one specific agent

Pass an agent's **name or id** (as in the registry):

```
GET __PULSE_URL__/agent/Skill-Router
```

```json
{
  "attestation": {
    "service": "agentpulse", "name": "Skill-Router", "url": "https://.../find",
    "reachable": true, "latency_ms": 180, "http_status": 405,
    "uptime_pct": 99, "checks": 240, "checked_at": 1752000000
  },
  "signature": "<base64>", "pubkey": "<base64>",
  "verify": "POST {report: attestation, signature} to /verify."
}
```

## Full endpoint reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/state` | One signed artifact: whole-web summary + top reliable agents + registry gap. |
| GET | `/status` | Signed summary: how much of the agent web is reachable. |
| POST | `/verify` | Confirm a signature is genuine. Body `{report, signature}` → `{valid}`. |
| GET | `/leaderboard` | Agents ranked by tracked uptime %, then p95 latency. |
| GET | `/compare` | Where our fresh probe disagrees with the registry's own `reachable` field. |
| GET | `/incidents` | Recent up→down / recovered state changes, newest first. |
| GET | `/badge/{name}.svg` | An embeddable uptime badge for an agent (SVG). |
| GET | `/live` | Only the agents reachable right now (for routing). |
| GET | `/agents` | Every registered agent with its current reachability. |
| GET | `/agent/{id or name}` | Signed liveness attestation for one agent. |
| GET | `/pubkey` | The Ed25519 public key + how to verify locally. |
| POST | `/refresh` | Probe the next batch of agents now. |
| GET | `/health` | Liveness of this service. |
| GET | `/` | Human-readable live status board. |

## How reachability is decided

AgentPulse makes one GET to each agent's declared endpoint and classifies it the
way a real uptime monitor would:

- **reachable** — `2xx`/`3xx`, or `401`/`403`/`405` (it is there; may need auth or a POST)
- **not reachable** — `404`, any `5xx`, or a timeout / connection error (gone, broken, or asleep)
- **unverifiable** — the registry entry declared no endpoint to probe

## How verification works (for full independence)

The `signature` is a base64 Ed25519 signature over the **canonical JSON** of the
signed object — `json.dumps(report, sort_keys=True, separators=(",", ":"))`.
Fetch the public key from `/pubkey` and check it yourself, or just use `/verify`.
Because the bytes are reproducible, you never have to trust our word for it.

## Errors are self-correcting

Every error is JSON that tells you exactly how to fix the call, so a near-miss becomes a pass:

- Unknown agent → `404 {"error":"agent_not_found","fix":"GET /agents to list names, or /live for reachable ones."}`
- Malformed `/verify` body → `400 {"valid":false,"message":"Body must be JSON: {report, signature}."}`
- Unknown route → `404 {"error":"route_not_found","fix":"Valid routes: GET /status, POST /verify, ..."}`

There is no auth and there are no rate limits, so those error classes never occur.

## Notes

- **No authentication, no rate limits, no keys to manage.**
- Runs on Cloudflare Workers at the edge; the liveness cache is refreshed on a schedule, so calls are fast.
