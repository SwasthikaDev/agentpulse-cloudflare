# AgentPulse — Cloudflare Worker

Signed, real-time liveness/uptime oracle for agents in the NANDA registry, running
at the edge on Cloudflare Workers. Zero dependencies: Web Crypto Ed25519 signing,
Workers KV cache, and a Cron Trigger that batch-probes every registered agent's real
endpoint (respecting the free-tier subrequest limit).

**Live:** https://agentpulse.swasthikadevadiga2.workers.dev
**Docs (agent-facing):** `/skill.md`

Endpoints: `/status` (signed summary), `/verify` (confirm a signature), `/live`,
`/agents`, `/agent/{id|name}`, `/pubkey`, `/refresh`, `/health`, `/` (status board).

Deploy: `wrangler kv namespace create PULSE_KV` → set id in `wrangler.toml` →
`wrangler secret put PULSE_SIGNING_SEED` → `wrangler deploy`.

Built by [@SwasthikaDev](https://github.com/SwasthikaDev).
