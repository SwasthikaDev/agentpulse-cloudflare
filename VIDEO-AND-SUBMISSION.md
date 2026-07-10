# CipherWatch — demo video script + submission kit

**Live URL:** https://cipherwatch.swasthikadevadiga2.workers.dev
**Board:** open it fullscreen · **Terminal:** have `bash demo-verify.sh` ready.

> Numbers are live and change; read whatever the screen shows. Recent values:
> ~121/137 reachable, registry wrong about ~47, incidents tracked.

---

## 90-SECOND VIDEO SCRIPT (3 beats)

### 0:00–0:10 — THE HOOK (screen: the live board)
> "A third of the agents submitted to this hackathon are **not reachable right now** —
> and the official NANDA registry doesn't even know it. I built the thing that does.
> It's called **CipherWatch**, it runs signed at Cloudflare's edge, and it never sleeps."

*(Let the board sit there: green/red agents, the leaderboard, live incidents.)*

### 0:10–0:35 — BEAT 1: "I'm auditing your hackathon" (screen: leaderboard + agent grid)
> "CipherWatch independently checks **every agent in the NANDA registry** — which is
> every entry in this competition. Here's the live **reliability leaderboard**: who's
> actually up, ranked by real uptime we've tracked over hundreds of checks. Scroll the
> grid — these red ones are dead right now. **You could literally use my tool to help
> judge everyone else's.**"

*(Scroll the leaderboard, then the red/down agents in the grid. Point at a known name.)*

### 0:35–0:55 — BEAT 2: "the official registry is wrong" (screen: /compare or /state)
> "And the registry that lists all these agents? Its own reachability data is **wrong
> about ~47 of them** — it calls dead agents reachable and misses live ones. CipherWatch
> probes them fresh and gives you the corrected truth — as **one signed report**."

*(Open `/state` in the browser — show the signed JSON headline. Or the freshness callout on the board.)*

### 0:55–1:20 — BEAT 3: "don't trust me, verify me" (screen: terminal)
> "Every answer is cryptographically signed, so you never take my word for it. Watch —
> I pull a signed report, verify it: **valid**. Now I change **one number** and verify
> again..."

*(Run `bash demo-verify.sh`. Let step 2 print `valid: True`, step 3 print `valid: False`.)*

> "...**invalid.** The math caught the tamper. Most submissions give you an opinion.
> CipherWatch gives you a proof."

### 1:20–1:30 — THE CLOSE (screen: board again, or the stack line)
> "Discover an agent, verify its identity, **check it's actually alive**, then route.
> CipherWatch is the reliability layer the agent web was missing — and it's live right now."

---

## RECORDING CHECKLIST
- [ ] Open the board fullscreen first (it warms instantly — Cloudflare never sleeps).
- [ ] Terminal ready in the `cipherwatch-cf` folder; test `bash demo-verify.sh` once before recording.
- [ ] Record in 1080p; keep it under ~100s.
- [ ] Speak the hook first, setup second. Lead with the shock.
- [ ] Optional B-roll: `/badge/Skill-Router.svg` (a live uptime badge), `/leaderboard` JSON.

---

## SUBMISSION BLURB

### One-liner (for the name/tagline field)
> **CipherWatch — the signed reliability layer for the agent web. Uptime, incidents, and a verifiable audit that catches where the NANDA registry is wrong.**

### Short description
> The NANDA registry lists many agents but can't tell you which actually work — and its
> own reachability data is wrong about ~1 in 3. CipherWatch independently probes every
> registered agent's real endpoint, tracks uptime over time, ranks reliability, records
> incidents, and returns every answer **Ed25519-signed** so any agent can verify it.
> Before you call an agent, confirm it's alive; get only the live ones; or pull one signed
> "state of the agent web" report. Runs on Cloudflare Workers at the edge — never sleeps.
> Read `/skill.md`; verify any answer with `/verify`.

### Why it's different (if there's a longer field)
> - **Verifiable, not opinion** — signed liveness + reliability certificates you can check.
> - **Corrects the source of truth** — `/compare` shows exactly where the registry is stale.
> - **A track record, not a ping** — historical uptime, p95 latency, a live leaderboard, an incident feed.
> - **Uncontested** — the only uptime/reliability oracle among the submissions.

---

## THE STACK STORY (say this if asked "how does it fit NANDA?")
Three services, one coherent layer for the agent web:
1. **Skill-Router** — *find* the right agent from a plain-language need.
2. **AiAgent-DNS** — *verify its identity* (it's really who it claims).
3. **CipherWatch** — *verify it's actually alive and reliable* before you spend a call.
→ Then route. CipherWatch closes the loop the registry left open.

---

## KEY ENDPOINTS TO SHOW
| What | URL |
|---|---|
| Live board | `/` |
| Signed one-call summary | `/state` |
| Reliability leaderboard | `/leaderboard` |
| Registry is wrong | `/compare` |
| Incident feed | `/incidents` |
| Verify anything | `POST /verify` |
| Uptime badge | `/badge/Skill-Router.svg` |
| Agent-facing docs | `/skill.md` |
