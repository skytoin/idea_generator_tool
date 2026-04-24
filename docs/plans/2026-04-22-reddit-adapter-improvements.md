# Reddit Adapter Improvements — Brainstorm + Plan

**Status:** brainstorm, not yet implemented
**Date:** 2026-04-22
**Triggered by:** 2026-04-22 production run where all 6 Reddit queries came back `sparse` (1-4 results each), Reddit took 65s of the 5m37s scan, and only ~5 of 30 final signals came from Reddit despite the source being the project's primary pain-detection lever.

---

## Diagnosis (the four root causes)

| Symptom | Root cause |
|---|---|
| All 6 queries came back "sparse" (1-4 results each) | Search is the wrong endpoint for recall. Reddit's `/search` endpoint has patchy indexing + ~3-5 QPM specifically for search (vs. 10 QPM for listing). Its full-text index misses many recent posts. |
| 65s elapsed (over the 60s timeout) | Sequential pacing: 6 queries × 6.1s sleep = 30s sleep + 6 × ~4s response = 55-65s. No parallelism, no cross-sub batching. |
| Quoted pain phrases like `"I would pay"` returned nothing | Exact-phrase quoting forces a verbatim match. Users write "I'd pay", "would pay for", "would gladly pay" — all invisible to `"I would pay"`. |
| `DEFAULT_LIMIT = 25` | Reddit's listings return up to **100** per request. We're getting a quarter of what each request is allowed to deliver. |

---

## Reddit's toolbox we're underusing

**Field operators** (work inside `q=`):
- `subreddit:foo` — restrict to one sub (or OR multiple: `(subreddit:foo OR subreddit:bar)`)
- `self:yes` / `self:no` — self-post vs. link-post (pain → `self:yes`)
- `nsfw:no` — filter NSFW at query time
- `flair:"Question"` — target posts with specific flair
- `author:`, `title:`, `selftext:`, `url:`, `site:`
- `timestamp:1700000000..1710000000` — unix range (mostly undocumented but works)

**Boolean operators:**
- Uppercase `AND`, `OR`, `NOT`
- Parentheses for grouping
- `"exact phrase"` for phrases
- Default is AND between bare tokens

**Endpoints we're not using:**
- `/r/{sub}/top.json?t=month&limit=100` — 100 items, no search needed, client-side filter
- `/r/a+b+c/top.json?t=month&limit=100` — multi-sub listing in ONE request (plus-separated subs)
- `/r/{sub}/comments.json?limit=100` — top comments (pain often lives IN comments, not OP)
- `/r/{sub}/hot.json`, `/new.json`, `/rising.json` — different freshness profiles
- `/subreddits/search.json?q=<domain>&limit=10` — discover relevant subs per founder

**Rate limits (verified 2026-04-22):**
- Unauthenticated: ~10 QPM overall, ~3-5 QPM for `/search`
- OAuth (free script app): 100 QPM → ~10× more room
- Listings hit the 10 QPM bucket, not the search bucket

---

## Brainstorm — ranked by impact/effort

### 🟢 Tier 1 — high impact, small code change

**1. Bump `DEFAULT_LIMIT` from 25 → 100.**
One-line change. 4× more raw signals per request at zero extra cost. Reddit caps at 100 anyway.

**2. Replace N per-sub queries with ONE cross-sub query using `subreddit:` OR.**

```
BEFORE (3 pain queries × 1 sub each = 3 requests):
  /r/datascience/search.json?q="I would pay"
  /r/dataengineering/search.json?q="wish there was"
  /r/ecommerce/search.json?q="frustrated with"

AFTER (1 request, same recall, 3x broader):
  /search.json?q=(subreddit:datascience OR subreddit:dataengineering OR subreddit:ecommerce)
              AND ("I would pay" OR "would pay for" OR "would gladly pay"
                   OR "wish there was" OR "why is there no" OR "frustrated with")
              AND self:yes
              AND nsfw:no
              &sort=top&t=month&limit=100
```

Cuts 6 requests to ~2, kills 30s of sleep, quadruples result set via `limit=100`.

**3. Stop quoting short pain phrases; OR variants instead.**
`"I would pay"` → `("I would pay" OR "would pay for" OR "I'd pay" OR "would gladly pay")`. Captures 3-5× more real posts.

**4. Add `self:yes` to every pain query.**
Pain lives in self-posts. Link-posts are usually announcements/news. Single operator, huge precision lift.

**5. Exponential back-off on 429 instead of dropping the query (PROMOTED FROM TIER 4).**
Current behavior in `reddit.ts:351`: any 429/403/401 throws `RedditDeniedError` and the scanner abandons remaining queries. That loses every request after the first 429 — exactly the failure mode that hurts a 10 QPM source the most. Replace with:
- On 429 only (NOT 403/401 — those mean genuinely blocked): read the `Retry-After` response header if present, otherwise sleep 30s × 2^attempt.
- Retry the SAME request up to 3 times.
- After exhausting retries, mark only THAT query as denied and continue with the next one.
- 401/403 still abandon immediately (auth/IP problems — retrying just makes them worse).
~20 lines of code, prevents losing 4-5 queries when one hits the burst-limit cliff. Critical for the new packed-query world where each lost request loses 100 signals instead of 25.

### 🟡 Tier 2 — medium impact, medium change

**6. Switch the primary strategy from `/search` to `/top.json` listings + client-side keyword filter.**
For each sub, fetch `/r/{sub}/top.json?t=month&limit=100` → get 100 high-quality posts with zero search-indexing problems → filter titles+selftext client-side for keywords. Listings live in the fatter 10 QPM bucket, and Reddit's search indexing misses many recent posts anyway.

**7. Multi-sub listing URL.**
`/r/startups+microsaas+smallbusiness+indiehackers+SaaS+entrepreneur/top.json?t=month&limit=100` — six subs, one HTTP call, 100 items. This single request gives better recall than the entire current 6-query plan.

**8. Parallelize requests (bounded).**
Currently paying 6.1s × 5 = 30s of pure sleep. With OAuth + 100 QPM, can run 6 requests concurrently in ~1s. Even unauthenticated, 2-concurrent with proper sleep spacing halves wall clock.

**9. Sub-aware MIN_SCORE (ratio, not flat).**
Score ≥ 5 on r/startups (1.4M subs) is noise. Score ≥ 5 on r/microsaas (50K subs) is meaningful. Use `score / log(subscribers)` as a normalized engagement score, or keep a per-sub override table.

**10. Tune the existing filters:**
- Comment-to-score ratio > 0.3 → discussion quality (filters out linkshares).
- `upvote_ratio < 0.85` → controversial → often the best arguments.
- `link_flair_text` in {Question, Help, Rant, Discussion} → pain signals; exclude {AMA, Announcement, News}.

### 🔵 Tier 3 — bigger changes, large payoff

**11. ~~OAuth script app.~~ DROPPED — see status update below.**
Reddit closed self-service OAuth registration in November 2025. This Tier 3 lever is no longer available without going through manual approval (rarely granted for personal scripts).

**12. Sub discovery per founder.**
Call `/subreddits/search.json?q=<domain_tag>&limit=5` once per `domain_tag` from the expansion plan. For the 2026-04-22 run, "internet marketing" + "data science" would've surfaced r/ppcmarketing, r/MachineLearning, r/bigseo, r/rstats — none of which were in the plan. One extra request per domain tag, massive sub-quality lift.

**13. Fetch comments for high-engagement posts.**
When a post has >50 score AND >20 comments, fetch `/r/sub/comments/{id}.json?depth=1&limit=30&sort=top` and treat top comments as additional signals. Pain is often articulated in responses, not OP.

**14. Two-strategy fan-out per sub:**
- Strategy A (search): one cross-sub OR'd pain query — surgical.
- Strategy B (listing): `/top.json?t=month&limit=100` per sub cluster — serendipitous.
Dedupe by permalink at the end. Complementary recall, not redundant.

**15. Keyword expansion just for Reddit.**
Reddit is colloquial — `"customer enrichment"` (arxiv-style) never matches real posts. Expand to Reddit-speak: `"how do I find customers"`, `"getting leads"`, `"warm outbound"`. Could live in `reddit-vocabulary.ts` alongside `reddit-pain-phrases.ts`.

**16. Per-pass tactic switching (integrates with two-pass orchestrator):**
- Pass 1: broad listings + cross-sub pain search → maximize raw recall.
- Pass 2: once `summarizeFirstPass` identifies sparse directions, do targeted `/search` queries on those specific gaps using Reddit search operators.

### ⚫ Tier 4 — nice-to-have

17. **Cache.** 5-15 min TTL on Reddit responses (Reddit's own advice for rate-limit relief).
18. **Response-size fallback.** If a query returns 0 results, auto-retry with `t=year` before giving up.
19. **Adaptive sort.** Rotate `sort={top,comments,new}` across queries — comments-sorted surfaces discussions; new-sorted surfaces emerging pain that top misses.
20. **~~Multi-pass back-off.~~** PROMOTED to Tier 1 (#5) — see above. The 10 QPM budget makes losing queries to 429s too costly to leave as nice-to-have.

---

## Recommended sequencing

Three PRs:

**PR 1 — "free wins" (~45 min):**
- `DEFAULT_LIMIT` 25 → 100
- `self:yes` on pain queries
- OR-expansion for pain phrases (quoted OR unquoted variants)
- Switch to multi-sub listing URL (`r/a+b+c`) for baseline harvest
- **Exponential back-off + retry on 429** (read `Retry-After` header, fall back to 30s × 2^attempt, max 3 retries per query, never abandon other queries). Replaces the immediate-throw behavior in `reddit.ts:351`.
- Expected: 3-5× more Reddit signals, no lost queries when rate-limited, same code complexity, zero new deps.

**PR 2 — "endpoint shift" (~1-2 hours):**
- Primary strategy = `/top.json?t=month` listings over multi-sub URLs with client-side keyword filter
- Search reserved for pass-2 targeted gap-filling
- Sub-size-normalized MIN_SCORE
- Flair / ratio filters
- Expected: sparse-directions problem largely solved, wall-clock time halved.

**PR 3 — "discovery + parallelism" (~half day) — REVISED, no OAuth:**
- Sub-discovery endpoint per domain tag (still works unauthenticated, just costs requests against the 10 QPM bucket)
- Bounded parallelism — even at 10 QPM, 2-concurrent with proper sleep spacing halves wall clock
- Optional: comment-fetch on high-engagement posts (each comment fetch = 1 more request, budget carefully)
- Expected: 65s → ~30s (not the ~5s OAuth would've enabled), richer sub coverage, founder-adaptive subs
- **OAuth dropped** — see "OAuth registration — STATUS UPDATE" section below.

---

## OAuth registration — STATUS UPDATE 2026-04-22

**Self-service OAuth registration is dead as of November 2025.** Reddit introduced the Responsible Builder Policy and disabled the old "fill the form at /prefs/apps, get keys instantly" flow. The form is still visually present but submissions silently fail (recaptcha resets, no app gets created).

### What replaced it

All new OAuth tokens require pre-approval through Reddit's Developer Support form. You submit a written application describing:
- Use case
- Data needed
- Specific subreddits accessed
- Expected request volume
- Compliance with the Responsible Builder Policy

Reported approval rates (as of early 2026):
- **Personal scripts: rarely approved** — generic rejection: "Submission is not in compliance with RBP and/or lacks necessary details"
- **Small commercial tools: almost always rejected** unless paying $10K+/month for Enterprise
- **Academic researchers with ethics documentation: moderate** approval chances
- **Subreddit moderators building modtools: highest** approval rates (this is what Devvit was built for)

Target response time: 7 days. Often longer or no response.

### What this means for this project

**OAuth is effectively unavailable for our use case.** Drop Tier 3 item #10 from the plan above — it cannot be implemented as a "5 minute" task. Two realistic options:

1. **Stay on unauthenticated `.json` endpoints** (current adapter behavior). 10 QPM cap, but Tier 1 + Tier 2 improvements compound to extract 5-10× more useful signal within that budget without ever needing a token. This is the recommended path.
2. **Apply through the new Developer Support form anyway** — low cost (just a written form), but expect rejection for "personal script" framing. Worth trying once if you frame it carefully (e.g., open-source research tool, specify exact subs, show RBP compliance), but do NOT block project work on it.

### If you do want to try the application anyway

Submit at: https://support.reddithelp.com/hc/en-us/requests/new (Developer Support category). Read the [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) first. Frame as research/open-source, list specific subreddits (don't say "all"), specify expected volume in QPM not vague "low usage" wording, link to a public repo if possible. Plan for rejection.

### Grandfathered credentials

Pre-November 2025 keys still function. If you ever obtain a set legitimately (e.g., a friend's old script app that's no longer used), they continue to work under their original terms.

### Alternative data providers

If pain-signal recall ever becomes business-critical, evaluate licensed providers (data365, ScrapingBee, Pushshift's successor projects). Paid, but bypasses the policy/approval blocker. Out of scope for current R&D.

### Auth flow at runtime (what the adapter will need)

```
1. POST https://www.reddit.com/api/v1/access_token
   Authorization: Basic base64(client_id:client_secret)
   Body: grant_type=password&username=...&password=...
   Header: User-Agent: <descriptive UA>
   → returns { access_token, expires_in: 3600, token_type: "bearer" }

2. Cache the token in memory; refresh when expires_in - 60s elapses.

3. All API requests go to https://oauth.reddit.com (NOT www.reddit.com)
   with header: Authorization: Bearer <access_token>
```

Implementation lives in a new `src/pipeline/scanners/tech-scout/adapters/reddit-auth.ts` module that exports `getRedditToken(): Promise<string>` with caching. The existing `reddit.ts` adapter swaps `REDDIT_BASE_URL` from `www.reddit.com` to `oauth.reddit.com` and adds the `Authorization` header to every request.

---

## Sources used

- [Reddit Data API Wiki – Reddit Help](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [Developer Platform & Accessing Reddit Data – Reddit Help](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data)
- [How to Create a Reddit API App in 2026 (Complete Developer Guide)](https://redaccs.com/reddit-api-guide/)
- [Reddit API Rate Limits 2026: Complete Guide for Developers](https://painonsocial.com/blog/reddit-api-rate-limits-guide)
- [Reddit API Pricing: Compare Reddit API Costs and Data365 Options](https://data365.co/blog/reddit-api-pricing)
- [Reddit API Rate Limits Workaround: 7 Proven Strategies for 2026](https://painonsocial.com/blog/reddit-api-rate-limits-workaround)
- [Reddit API Limitations: Complete Guide for Developers (2026)](https://painonsocial.com/blog/reddit-api-limitations)
