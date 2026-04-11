# Tech Scout — Source Research

> **Status:** Research complete. Used to plan the Tech Scout build (Layer 2, Scanner #1).
> **Last researched:** 2026-04-11.
> **🟡 items have volatile pricing/access** — verify before integration.

## Purpose

Tech Scout is Layer 2's first scanner. Its job is to find **factual signals** about:
- What just became technically possible (new APIs, new libraries, price drops)
- What's shipping at big vendors (AWS/GCP/Azure/OpenAI/Cloudflare etc.)
- What's trending in the developer community (HN, Reddit, Dev.to)
- What research is about to become production (arxiv, Papers with Code)
- What libraries are suddenly being adopted (GitHub, npm, PyPI, Hugging Face)

Tech Scout does NOT produce ideas — it produces evidence. The idea-generation step (Layer 4) reads that evidence and synthesizes.

---

## The 12 slices of tech signal

A "good" Tech Scout covers most of these. Any slice with zero coverage is a blind spot.

| # | Slice | Question it answers |
|---|---|---|
| 1 | Community buzz | What are technical people excited about this week? |
| 2 | Research frontier | What's coming in 6–12 months? |
| 3 | Code adoption | What library / project is suddenly gaining users? |
| 4 | Product launches | What just shipped that a small team made? |
| 5 | Big vendor shipping | What did AWS/Google/Cloudflare/OpenAI/Anthropic just release? |
| 6 | Model / AI capability | Which ML model just became state-of-the-art or cheap? |
| 7 | Standards evolution | What languages / protocols are evolving? (TC39, PEPs, W3C, IETF) |
| 8 | Developer pain-to-solution gap | What are developers asking how to do right now? |
| 9 | Benchmarks / leaderboards | What capability just crossed a threshold? |
| 10 | Long-term innovation signal | Patents, academic trends, conference CFPs |
| 11 | Curated editorial | What do trusted editors think matters this week? |
| 12 | Cross-stack detection | What's the tech stack of the web actually shifting toward? |

---

## Tier 1 — Must-have (the core 10)

Sources where **Tech Scout would have a serious blind spot if missing**. Each has: an official API or stable public endpoint, free access, meaningful coverage of a distinct slice, and proven reliability.

| # | Source | URL | API? | Auth | Pricing | Slice(s) | Strength |
|---|---|---|---|---|---|---|---|
| 1 | **Hacker News (Algolia)** | https://hn.algolia.com/api | REST | None | Free | 1, 4, 5 | Daily pulse of tech community; best search UX; ~10k req/hr |
| 2 | **arxiv** | https://info.arxiv.org/help/api | REST/Atom | None | Free | 2 | ~4M papers, category filters (`cs.AI`, `cs.DB`, etc.); 6–12 month lead |
| 3 | **GitHub API** | https://docs.github.com/en/rest | REST + GraphQL | PAT (free) | Free | 3, 5, 8 | Trending repos, releases, Issues search, language stats — 5k req/hr |
| 4 | **Hugging Face Hub API** | https://huggingface.co/docs/hub/api | REST | Optional token (free) | Free | 6, 9 | Trending models/datasets; downloads; leaderboard integration |
| 5 | **Product Hunt API (GraphQL v2)** | https://api.producthunt.com/v2/docs | GraphQL | OAuth token (free) | Free | 4 | Best curated product-launch feed |
| 6 | **npm registry + npm-stat** | https://registry.npmjs.org, https://api.npmjs.org/downloads | REST | None | Free | 3 | Actual download counts per package per day — adoption truth |
| 7 | **PyPI + pypistats.org** | https://pypi.org/pypi, https://pypistats.org/api | REST | None | Free | 3 | Same for Python. Adoption ≠ stars, matters for real use |
| 8 | **Cloudflare Radar + blog** | https://radar.cloudflare.com, https://cloudflare.com/blog | REST API + RSS | Free key for Radar | Free | 5, 12 | Observability over ~20% of web traffic; detects tech-stack shifts in real time |
| 9 | **AWS / GCP / Azure "What's New" feeds** | https://aws.amazon.com/new/, https://cloud.google.com/blog, https://azure.microsoft.com/en-us/updates | RSS | None | Free | 5 | Every cloud service release. Merge three feeds into one firehose. |
| 10 | **Reddit (curated technical subreddits)** | r/programming, r/MachineLearning, r/webdev, r/selfhosted, r/rust, r/golang | OAuth (recommended) | OAuth app (free) 🟡 | Free (indie) | 1, 8 | The only source that catches niche-community signal HN misses |

### Tier 1 trade-offs

**npm / PyPI download stats vs GitHub stars.** Use both. Stars measure hype; download counts measure real use. A repo with 30k stars and declining weekly downloads is losing. A package with 500 stars but 10M weekly downloads is quietly winning.

**Hugging Face vs Papers with Code.** HF tracks ADOPTION (downloads, popularity, spaces); Papers with Code tracks IMPLEMENTATION (which papers have reproducible code). HF wins for Tier 1 because adoption > intent.

**Cloudflare Radar is the sleeper pick.** Real-world deployment data, not opinion. Free API key. Tells you things like "HTTPv3 adoption crossed 50% in NA last week" — deployment truth.

**Three cloud changelogs vs one.** AWS/GCP/Azure have distinct culture and shipping cadence. AWS ships a thousand small things; GCP ships fewer big ones; Azure blends enterprise with AI. Merging all three via RSS is trivially cheap.

**Reddit = ~8 subs, not 1 source.** r/programming is noisy. r/rust is gold for Rust-specific shifts. r/selfhosted catches indie infra trends HN misses. Don't treat Reddit as one source — treat it as distinct subs with different weights.

**Tier 1 covers slices 1, 2, 3, 4, 5, 6, 8, 9, 12 (9 of 12).** Missing: Standards (7), Long-term innovation (10), Curated editorial (11) — all Tier 2 territory.

---

## Tier 2 — Nice-to-have (15 sources)

Meaningful additions that improve coverage or signal quality. Not required for v1 but should all be added eventually.

| # | Source | URL | API? | Pricing | Slice(s) | Why add it |
|---|---|---|---|---|---|---|
| 1 | **Lobsters** | https://lobste.rs/*.json | JSON on URLs | Free | 1 | Smaller, higher SNR than HN; catches quality HN misses |
| 2 | **Show HN subset** | same as HN Algolia with `tags=show_hn` | REST | Free | 4 | HN's curated launch feed — free when you already have HN |
| 3 | **Dev.to** | https://developers.forem.com/api | REST | API key (free) | 1, 11 | Developer community blog posts; different demographic than HN |
| 4 | **Papers with Code** | https://paperswithcode.com/api/v1/docs | REST | Free | 2, 9 | Papers with reproducible code — filter for implementability |
| 5 | **TC39 proposals** | https://github.com/tc39/proposals | GitHub API + repo watch | Free | 7 | JavaScript language evolution — pure signal, low volume |
| 6 | **PEPs (Python)** | https://peps.python.org, https://github.com/python/peps | GitHub API | Free | 7 | Same for Python — each PEP = a change proposal |
| 7 | **OpenAI / Anthropic / Google AI changelogs** | https://platform.openai.com/docs/changelog, https://docs.anthropic.com, https://ai.google.dev | RSS / HTML | Free | 5, 6 | Foundation-model vendor shipping. Very high signal per entry. |
| 8 | **Stripe / Vercel / GitHub changelogs** | https://stripe.com/changelog, https://vercel.com/changelog, https://github.blog/changelog | RSS | Free | 5 | The infrastructure small teams actually use |
| 9 | **LMSYS / Chatbot Arena + HF Open LLM Leaderboard** | https://chat.lmsys.org, https://huggingface.co/spaces/open-llm-leaderboard | Scrape or API | Free | 9 | Live capability leaderboards for LLMs — "which model is winning this month" |
| 10 | **Kaggle competitions** | https://www.kaggle.com/api | REST | API token (free) | 9, 10 | Which problems are hot + which techniques win |
| 11 | **libraries.io** | https://libraries.io/api | REST | Free key | 3 | Cross-language dependency graph. Catches packages going viral across ecosystems. |
| 12 | **deps.dev (Google's Open Source Insights)** | https://deps.dev, https://docs.deps.dev | REST | None | Free | 3 | Similar to libraries.io but Google-backed. 40M+ packages with dependency data. |
| 13 | **crates.io (Rust)** | https://crates.io/api/v1 | REST | None | Free | 3 | Rust package adoption. Small but explosive ecosystem. |
| 14 | **Changelog.com newsletter** | https://changelog.com | RSS | Free | 1, 11 | Weekly curated developer-news digest. Podcast + written. |
| 15 | **Tavily or Brave Search API (generic "new in X")** | https://tavily.com, https://brave.com/search/api | REST | Free tier; paid after 🟡 | 1, 5 | Escape hatch for topics the 10 must-haves don't cover |

### Tier 2 trade-offs

**Lobsters vs Dev.to — different audiences.** Lobsters ~10k readers, highly technical. Dev.to ~1M+ users, broader. Lobsters = higher signal-per-post; Dev.to = "what are people doing with X right now?"

**libraries.io vs deps.dev — very similar.**
- libraries.io: older, tracks 5M+ packages across 32 package managers.
- deps.dev: Google-backed, newer, includes security metadata, stable long-term.
- **Verdict: deps.dev for primary** (Google unlikely to EOL it); libraries.io as fallback.

**TC39 / PEPs are LOW volume, HIGH signal.** 5–20 new proposals per year per language. Each one = "language X is about to gain feature Y." Essentially free to watch.

**LMSYS vs Open LLM Leaderboard.** LMSYS uses human ratings; Open LLM uses benchmark scores. They often disagree — that disagreement IS signal. Use both.

**Kaggle is underrated.** Competition themes + prize pools reveal what big companies are paying to solve with ML today.

---

## Tier 3 — Sometimes helpful (use in specific scenarios)

Valuable when Tier 1+2 aren't enough, or when founder profile specifically calls for them. **Recommended pattern: route Tier 3 through a `TavilyFallbackSource`** (one fallback search when core sources return weak results) rather than building individual integrations.

| Source | When it shines | Why not Tier 2 |
|---|---|---|
| Google Patents (patents.google.com) | Deep tech / hardware / biotech founder | Low volume, 12-18 month lag |
| Semantic Scholar (api.semanticscholar.org) | Need citation-graph data for a paper | ~80% overlap with arxiv |
| YouTube conference talks (KubeCon, NeurIPS, JSConf, PyCon) | Ecosystem-specific founder | YouTube API expensive + transcription cost |
| W3C standards pipeline / IETF drafts | Web protocol / network / security work | Very slow signal |
| SEC EDGAR 8-K filings | Looking for big corporate tech M&A | 99% corporate noise |
| State of JS / State of DB / SO Developer Survey (annual) | Once/year check for big shifts | Annual cadence — not daily input |
| Wikipedia tech page edits (Wikimedia API) | Detecting emerging topics before HN | Very low signal-to-noise |
| Common Crawl tech-stack detection | Detecting actual deployment shifts in web tech | Enormous data; batch processing needed |
| arXiv Sanity / alphaxiv | ML-filtered arxiv | Unofficial, breaks occasionally |
| MIT Technology Review (free articles) | Editorial perspective on a trend | No API, scrape-only |
| BetaList | Early-early launches (pre-Product Hunt) | Overlaps heavily with Product Hunt one stage later |
| arxiv category RSS feeds | Laser-focused on one subfield | Duplicates arxiv main API |
| Google Research / DeepMind / Meta AI blogs | Big-lab publicity moves | Overlaps with arxiv for the research itself |
| NVIDIA GTC announcements | Hardware + AI capability shifts | Once a year, HN covers it |
| Apple / Android developer release notes | Founder building mobile | Skip unless profile says mobile |

---

## Tier 4 — Don't bother (and why)

Each of these was analyzed. Skip list documented so nothing gets re-evaluated later.

| Source | Why skip |
|---|---|
| **LinkedIn** | Walled garden. Scraping = TOS + legal risk. Official API is partner-only. |
| **Twitter / X API** | $100/month basic tier, $5000/month pro. Unusable for indie. |
| **Medium** | No meaningful API. Signal/noise is poor. Overlaps with Dev.to + HN. |
| **Gartner / Forrester / IDC paid reports** | Thousands per report. Excerpts leak via TechCrunch anyway. |
| **Crunchbase / Pitchbook / CB Insights (paid)** | $$$. Not core Tech Scout territory — belongs in Market Scanner. |
| **Stratechery / paid newsletters** | No API. Subscribe + scrape = legal gray. |
| **Discord / Slack communities** | Closed, requires invitation, no API for non-admins. |
| **Private Substacks (AI Explained, etc.)** | Same as paid newsletters. |
| **Chinese-only sources (Weibo, Zhihu, Baidu Tieba)** | Language + API access + geopolitics. Only if user target is China. |
| **Kagi Search** | Paid, no API for indie scale. |
| **Individual Mastodon instances** | Decentralized = need to federate with ~50 instances for useful coverage. |
| **Patents before grant** | 18-month filing-to-publication pipeline. Too slow. |
| **IEEE / ACM paywalls** | arxiv covers preprints that matter. |
| **RapidAPI "trending"** | Mostly clickbait/spam. Real quality signal is rare. |
| **ProgrammableWeb (archived)** | Was great, died 2023. Data stale. |
| **Physical conferences with no video** | No digital signal, not scannable. |
| **TechCrunch** | Mostly press releases + hype. News that matters hits HN within hours. Redundant. |

---

## Out-of-the-box picks (the ones most scanners miss)

1. **Cloudflare Radar (Tier 1).** Real-world network traffic stats. Deployment truth, not opinion.
2. **npm-stat.com / pypistats.org weekly download counts (Tier 1).** Stars are vanity; downloads are truth.
3. **deps.dev dependency graph (Tier 2).** Leading indicator before downloads explode.
4. **TC39 / PEP proposal repos (Tier 2).** Language-standards processes are just public GitHub repos. 1-2 year lead on features.
5. **Kaggle competition themes + prize pools (Tier 2).** Crowdsourced "what companies pay to solve with ML."
6. **LMSYS Chatbot Arena (Tier 2).** Live human-rated LLM leaderboard. First place changes matter.

---

## Coverage matrix

| Slice | Must-have | Nice-to-have | Coverage |
|---|---|---|---|
| 1. Community buzz | HN, Reddit | Lobsters, Dev.to, Changelog.com | ✅ Deep |
| 2. Research frontier | arxiv | Papers with Code | ✅ Deep |
| 3. Code adoption | GitHub, npm, PyPI | libraries.io/deps.dev, crates.io | ✅ Deep |
| 4. Product launches | Product Hunt, HN | Show HN | ✅ Deep |
| 5. Big vendor shipping | AWS/GCP/Azure, Cloudflare, HN | OpenAI/Anthropic, Stripe/Vercel/GH | ✅ Deep |
| 6. Model / AI capability | Hugging Face | LMSYS + Open LLM Leaderboard | ✅ Deep |
| 7. Standards evolution | — | TC39, PEPs | ⚠️ Nice-to-have only |
| 8. Developer pain-to-solution | GitHub, Reddit | — | ✅ Medium |
| 9. Benchmarks / leaderboards | Hugging Face | LMSYS, Open LLM, Kaggle, Papers with Code | ✅ Deep |
| 10. Long-term innovation | arxiv | Kaggle | ⚠️ Medium |
| 11. Curated editorial | — | Changelog.com, Dev.to | ⚠️ Nice-to-have only |
| 12. Cross-stack detection | Cloudflare Radar | deps.dev | ✅ Deep |

---

## Recommended v1 build order

| Phase | Source(s) | Rationale |
|---|---|---|
| **v1.0** | HN Algolia | Cleanest API. Zero friction. Perfect pattern setter. |
| **v1.1** | arxiv + GitHub API | Different shapes (Atom XML, REST+GraphQL) — exposes interface flexibility issues early |
| **v1.2** | Hugging Face + npm/PyPI download stats | Different domain — forces signal deduplication |
| **v1.3** | Product Hunt + Reddit (OAuth) | Exposes auth management |
| **v1.4** | AWS/GCP/Azure/Cloudflare RSS merge | Trivial after v1.3; big coverage bump |
| **v1.5** | All Tier 2 | Nearly free to add after infra is stable |

**v1.0 must ship and be evaluated end-to-end through the real pipeline before any other scanner source is touched.**

---

## Cost estimate

| Phase | Per-run cost | Monthly (30 runs/mo) |
|---|---|---|
| v1.0 (HN only) | ~$0.02 | ~$0.60 |
| v1.3 (6 sources) | ~$0.04 | ~$1.20 |
| v1.5 (all Tier 1+2) | ~$0.05–0.15 | ~$1.50–4.50 |
| + Tavily fallback | +$0.001/fallback | +~$0.50 |

Budget ceiling: **~$5/month for Tech Scout at full v1.5.**

---

## API keys checklist (all free, <5 min each)

| # | Service | Where to get it | Env var |
|---|---|---|---|
| 1 | GitHub Personal Access Token | https://github.com/settings/tokens | `GITHUB_TOKEN` |
| 2 | Hugging Face token (optional, raises rate limits) | https://huggingface.co/settings/tokens | `HUGGINGFACE_TOKEN` |
| 3 | Product Hunt developer token | https://www.producthunt.com/v2/oauth/applications | `PRODUCTHUNT_TOKEN` |
| 4 | Reddit OAuth app 🟡 verify 2026 policy | https://www.reddit.com/prefs/apps | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` |
| 5 | Cloudflare Radar API key | https://developers.cloudflare.com/radar | `CLOUDFLARE_RADAR_TOKEN` |
| 6 | Dev.to API key | https://dev.to/settings/extensions | `DEVTO_TOKEN` |
| 7 | Tavily API key | https://tavily.com | `TAVILY_API_KEY` |
| 8 | libraries.io / deps.dev (deps.dev needs no key) | https://libraries.io/account | `LIBRARIES_IO_KEY` |
| 9 | Kaggle API token | https://www.kaggle.com/settings (API section) | `KAGGLE_USERNAME`, `KAGGLE_KEY` |

HN Algolia, arxiv, npm registry, PyPI, pypistats, crates.io, Show HN, Lobsters, TC39/PEPs, most RSS feeds need **no key at all**.

---

## Volatile items to verify before committing 🟡

- **Reddit API 2026 free-tier policy** (high priority — biggest Pain Scanner + Tech Scout source)
- **Brave Search API pricing** (2000 free → $3/1k)
- **Tavily pricing + free tier** (1000/month free → $0.008/query)
- **Glimpse Google Trends wrapper pricing** (was $25/month)
