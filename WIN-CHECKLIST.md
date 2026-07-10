# CipherWatch — the win checklist (everything left is here)

**Live:** https://cipherwatch.swasthikadevadiga2.workers.dev
**SKILL.md the judge reads:** https://cipherwatch.swasthikadevadiga2.workers.dev/skill.md

Building is done: 49/49 live tests, 10/10 SKILL.md (2 graders), premium UI, signed, never sleeps.
What remains is only the three things below.

---

## 1) THE VIDEO — button-based, one take, ~90 seconds

Record your screen on the board (**open it fullscreen first — it never cold-starts**).
Narrate this, doing the clicks in [brackets]. Lead with the shock, not the setup.

**[0:00–0:08] HOOK** — board hero on screen
> "About one in three AI agents in this hackathon can't even be reached right now — and the
> official registry doesn't know it. I built the thing that does. This is **CipherWatch**."

**[0:08–0:26] It audits the whole hackathon** — [slowly scroll the board: leaderboard + incidents]
> "CipherWatch independently checks **every agent in the NANDA registry** — that's every entry in
> this competition — every two minutes, at Cloudflare's edge, so it **never sleeps**. Here's the
> live reliability leaderboard, and real incidents as agents go down and recover. It's even
> tracking its own competitors."

**[0:26–0:44] The registry is wrong** — [point at the freshness callout, then click the **/compare** button → new tab]
> "And the registry that lists all these agents? Its own data is **wrong**. It says these agents
> are reachable, but CipherWatch probed them fresh and they're actually down. It doesn't repeat the
> registry — it **corrects** it. And this report is cryptographically signed."

**[0:44–1:06] Verify it yourself** — [in the "Verify it yourself" panel]
> "Every answer is signed, so you never take my word for it."
> [click **1 · Fetch a signed report**] "A live signed report."
> [click **2 · Verify it**] "Valid."
> [click **3 · Tamper & re-verify**] "I changed one number... **invalid**. The math caught it.
> Most submissions give you an opinion. CipherWatch gives you a **proof**."

**[1:06–1:15] CLOSE** — [back on the board]
> "Signed. Always live at the edge. It audits the whole agent web — and corrects the registry
> itself. **CipherWatch — the reliability layer the agent web was missing.**"

**Tips:** 1080p, under ~100s, speak the hook first. Optional B-roll: open `/badge/Skill-Router.svg`.

---

## 2) THE SUBMISSION (do this when ready — say "submit" and I'll walk it live)

Submit at the NANDA skills page. Paste these exact values:

| Field | Value |
|---|---|
| Name | **CipherWatch** |
| SKILL.md URL | `https://cipherwatch.swasthikadevadiga2.workers.dev/skill.md` |
| Service / base URL | `https://cipherwatch.swasthikadevadiga2.workers.dev` |
| GitHub username | **SwasthikaDev** |
| One-liner | *CipherWatch — the signed reliability layer for the agent web: live uptime, a leaderboard, and a verifiable audit that catches where the NANDA registry is wrong.* |

Notes: submit the **live /skill.md link** (not pasted text) so it stays editable. You can resubmit
unlimited times before the deadline; they keep the best/most recent.

---

## 3) YOUR ORGANIZER TASKS (only you can do these)
- [ ] Reply to the organizer with your GitHub handle: **SwasthikaDev**
- [ ] Complete the registration / Google form + upload the video before the deadline
- [ ] (Optional) drop the live link in the hackathon channel

---

## Pre-judging (right before 7pm-ish): nothing needed
CipherWatch is on Cloudflare's edge — it never sleeps, so there's no warm-up step. It'll be instant
and fresh when the judge hits it.
