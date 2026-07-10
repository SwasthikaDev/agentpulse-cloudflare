# AgentPulse

![AgentPulse status](https://agentpulse.swasthikadevadiga2.workers.dev/badge/agentpulse.svg)
&nbsp;**[Live status board →](https://agentpulse.swasthikadevadiga2.workers.dev)** &nbsp;·&nbsp; **[Agent docs →](https://agentpulse.swasthikadevadiga2.workers.dev/skill.md)**

> **The signed reliability layer for the agent web.**
> The NANDA registry lists many agents but can't tell you which actually work — and its
> own reachability data is wrong about ~1 in 3. AgentPulse probes every registered agent
> first-hand, tracks uptime over time, and returns every answer **Ed25519-signed** so any
> agent can verify it.

## Why it exists

An AI agent that wants to hire another agent has no way to know if it's alive before
calling it. A third of registered agents are unreachable at any moment, and the registry's
cached `reachable` flag is stale. AgentPulse is the missing **liveness + reliability oracle**:
check before you call, route around the dead ones, and prove the answer.

## What it does

- **Signed liveness** — `GET /status` and per-agent `GET /agent/{name}` return an
  Ed25519-signed report; `POST /verify` confirms it. Tamper with one value → verification fails.
- **Reliability, not just a ping** — historical **uptime %**, p95 latency, a live
  **leaderboard** (`/leaderboard`), and an **incident feed** (`/incidents`).
- **Audits the registry** — `GET /compare` shows exactly where the registry's own data is
  wrong (calls dead agents reachable, misses live ones).
- **One-call summary** — `GET /state` returns a single signed "state of the agent web".
- **Embeddable badges** — `GET /badge/{name}.svg` for any agent's uptime.
- **Zero auth**, discovery via `/.well-known/agent-facts.json` and `/openapi.json`.

## Architecture

Single-file **Cloudflare Worker**, zero npm dependencies:

- **Web Crypto Ed25519** for signing/verification (no external crypto library).
- **Workers KV** caches the probe snapshot; the HTTP handler only reads it, so responses are instant.
- A **Cron Trigger** batch-probes agents (45 per run) to respect the free-tier subrequest
  limit, sweeping the whole registry every few minutes.
- Runs at Cloudflare's edge — **never sleeps**, no cold starts.

## The stack it completes

AgentPulse is one layer of a three-service pipeline for the agent web:

1. **Skill-Router** — find the right agent from a plain-language need.
2. **AiAgent-DNS** — verify its identity.
3. **AgentPulse** — verify it's actually alive and reliable → then route.

Skill-Router calls AgentPulse directly: `POST /find {"need":"...","reliability":true}` returns
each match annotated with `{ "agentpulse": { "live": true, "uptime_pct": 98 } }`, routing
proven-live agents first.

## Verify it yourself (30 seconds)

```bash
curl -s https://agentpulse.swasthikadevadiga2.workers.dev/state          # signed report
# take the report + signature and POST them back:
curl -s -X POST https://agentpulse.swasthikadevadiga2.workers.dev/verify \
  -H 'Content-Type: application/json' \
  -d '{"report": <the report>, "signature": <the signature>}'            # -> {"valid": true}
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/state` | Signed whole-web summary + top reliable agents + registry gap |
| GET | `/status` | Signed reachability summary |
| POST | `/verify` | Confirm a signature `{report, signature}` → `{valid}` |
| GET | `/leaderboard` | Agents ranked by tracked uptime, then p95 latency |
| GET | `/compare` | Where our fresh probe disagrees with the registry |
| GET | `/incidents` | Recent up→down / recovered changes |
| GET | `/live` · `/agents` | Reachable agents · every agent |
| GET | `/agent/{id\|name}` | Signed per-agent liveness attestation |
| GET | `/badge/{name}.svg` | Embeddable uptime badge |
| GET | `/pubkey` · `/health` | Public key · service health |
| GET | `/.well-known/agent-facts.json` · `/openapi.json` | Discovery |

## Deploy

```bash
wrangler kv namespace create PULSE_KV        # put the id in wrangler.toml
wrangler secret put PULSE_SIGNING_SEED        # base64 of 32 random bytes
wrangler deploy
```

---

Built by **Swasthika Devadiga** ([@SwasthikaDev](https://github.com/SwasthikaDev)) for the NANDA agent web.
