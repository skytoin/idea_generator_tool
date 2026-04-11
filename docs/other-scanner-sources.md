# Other Scanner Sources (Pain, Market, Change, Job)

> **Status:** First-pass research only. Each scanner still needs its own deep research round (like the one Tech Scout got) before implementation. This document captures the initial shortlist from the Layer 2 planning brainstorm.
> **Tech Scout** has its own doc: `docs/tech-scout-sources.md`
> **Last researched:** 2026-04-11.
> 🟡 = volatile pricing/access, verify before integration.

---

## Why separate docs

Each scanner is a specialized research agent looking at a completely different slice of the world. Their source lists barely overlap. A "one big source list" would be too long to be useful. Each scanner will be built one at a time (starting with Tech Scout), and when we reach each scanner, we do the deep source research for it first.

## Scanner build order (confirmed)

| Order | Scanner | Primary question | Status |
|---|---|---|---|
| 1 | **Tech Scout** | "What just became technically possible?" | 🔜 Build first |
| 2 | **Pain Scanner** | "What are people mad about?" | Deep research pending |
| 3 | **Market Scanner** | "Who's already tried this?" | Deep research pending |
| 4 | **Change Scanner** | "What just changed in the world?" | Deep research pending |
| 5 | **Job Scanner** | "What are companies hiring for?" | Deep research pending |

---

## Pain Scanner — first-pass shortlist

### Must-have candidates

| Source | URL | API? | Auth | Pricing | Strength |
|---|---|---|---|---|---|
| **Reddit (curated subs)** | https://www.reddit.com/dev/api | OAuth | OAuth app (free) 🟡 | Free (indie) | Richest pain source; requires OAuth after 2023 changes |
| **Stack Exchange / Stack Overflow** | https://api.stackexchange.com | REST | Optional key | Free (300/day; 10k/day with key) | Developer pain, exceptional for tech-focused founders |
| **Tavily or Brave Search API** | https://tavily.com / https://brave.com/search/api | REST | API key | Free tier → paid 🟡 | Escape hatch for "why is X so broken" queries |
| **GitHub Issues Search** | https://docs.github.com/en/rest/search | REST | PAT (free) | Free | Product-specific pain from open source users |

### Nice-to-have candidates

| Source | URL | Notes |
|---|---|---|
| Apple App Store Reviews RSS | https://rss.applemarketingtools.com | Free RSS, one country per request |
| IndieHackers RSS | https://www.indiehackers.com | Small but high-quality bootstrapper pain |
| Reddit `.json` URL trick (fallback) | `/r/X/top.json` | Works without OAuth but increasingly gray |

### Don't bother

| Source | Why skip |
|---|---|
| G2 / Capterra / TrustRadius | APIs are partner-only; scraping is TOS-ambiguous |
| Trustpilot | Paid API only (business-monitoring focus) |
| Quora | No public API; JS-rendered; scraping-hostile |
| Google Play reviews | Requires you to own the app on the store |
| Twitter / X | $100+/month, unusable for indie |
| Amazon reviews | Scraping = TOS violation |

**Estimated Pain Scanner v1 cost: $0–5/month**

---

## Market Scanner — first-pass shortlist

### Must-have candidates

| Source | URL | API? | Auth | Pricing | Strength |
|---|---|---|---|---|---|
| **idea-reality-mcp** | Your installed MCP | Yes | Built-in | Free | Already wired; multi-source idea-existence check |
| **Y Combinator directory** | https://www.ycombinator.com/companies | Indirect (JSON in HTML) | None | Free | THE canonical startup directory — filter by batch |
| **Product Hunt history** | https://api.producthunt.com/v2/docs | GraphQL | OAuth (free) | Free | Current launches + historical data |
| **Hacker News Show HN** | https://hn.algolia.com/api (with `tags=show_hn`) | REST | None | Free | Self-promotion by founders = real competitor intel |
| **Wayback Machine** | https://archive.org/help/wayback_api.php | REST | None | Free | "Did this domain used to exist?" — dead-company detection |

### Nice-to-have candidates

| Source | URL | Notes |
|---|---|---|
| BetaList | https://betalist.com | Pre-launch startups (earlier-stage than Product Hunt) |
| Failory / Startup Graveyard | https://www.failory.com, https://startupgraveyard.io | Curated post-mortems of dead startups |
| TechCrunch RSS (funding only) | https://techcrunch.com/feed | Funding announcements |
| Wellfound (AngelList) | https://wellfound.com | Partial public data |

### Don't bother

| Source | Why skip |
|---|---|
| Crunchbase | $529+/month for API access. Out of budget. |
| Pitchbook / CB Insights / OpenVC | Same issue — too expensive |
| SEC EDGAR | Public companies only, too late-stage for startup scanning |

**Estimated Market Scanner v1 cost: $0/month**

---

## Change Scanner — first-pass shortlist

### Must-have candidates

| Source | URL | API? | Auth | Pricing | Strength |
|---|---|---|---|---|---|
| **Federal Register (US regulations)** | https://www.federalregister.gov/developers | REST | None | Free | Finalized US regulations; best free change signal |
| **The Guardian Open Platform** | https://open-platform.theguardian.com | REST | Free key | Free (5000/day) | Actually usable free tier, high-quality news |
| **Wikipedia Pageviews API** | https://wikimedia.org/api/rest_v1/ | REST | None | Free | Pageview spikes as leading indicator for cultural shifts |
| **google-trends-api (unofficial)** | npm package | Library | None | Free but fragile 🟡 | Google Trends keyword interest; breaks periodically |

### Nice-to-have candidates

| Source | URL | Notes |
|---|---|---|
| Regulations.gov | https://api.regulations.gov | Proposed rules (earlier signal than Federal Register) |
| GovTrack | https://www.govtrack.us/developers | US bills in Congress |
| EUR-Lex | https://eur-lex.europa.eu | EU regulations (use only if EU matters) |
| NewsAPI / GNews | https://newsapi.org, https://gnews.io | Broader news coverage; free tiers are tight 🟡 |
| World Bank Open Data | https://data.worldbank.org/developers | Demographic/economic shifts |
| OECD Data | https://data.oecd.org | Same, OECD countries |

### Backup for google-trends-api instability

| Option | Pricing | Notes |
|---|---|---|
| Glimpse | ~$25/month 🟡 | Paid but stable wrapper for Google Trends |
| SerpAPI Google Trends endpoint | Part of SerpAPI pricing | Same Trends data, paid |

### Don't bother

| Source | Why skip |
|---|---|
| Twitter/X trends | API unaffordable |
| GDELT Project | Enormous scale; overkill for our use |
| Pew Research (no API) | Scrapable but low-volume and slow |

**Estimated Change Scanner v1 cost: $0/month** (unless Glimpse needed, then $25/month)

---

## Job Scanner — first-pass shortlist (new)

> **Why a Job Scanner?** Hiring patterns lead markets by 3–6 months. When 50 companies post "senior prompt engineer" roles, there's real money behind prompt engineering. Job postings reveal what companies are willing to pay humans to solve — an economic signal that prefigures products.

### Must-have candidates

| Source | URL | API? | Auth | Pricing | Strength |
|---|---|---|---|---|---|
| **Hacker News "Who is hiring?" monthly threads** | https://hn.algolia.com/api (filter by thread ID) | REST | None | Free | Monthly thread with hundreds of YC-company job posts; best free source |
| **YC Work at a Startup** | https://www.workatastartup.com | Public HTML / semi-public API | None | Free | YC-backed companies only; high-quality, small volume |
| **RemoteOK** | https://remoteok.com/api | REST | None | Free | Remote jobs only; JSON API |
| **We Work Remotely** | https://weworkremotely.com | RSS | None | Free | Remote jobs; RSS feed |
| **Greenhouse-powered company boards** | `https://boards.greenhouse.io/[company]` | REST | None | Free | Many companies use Greenhouse ATS; public job boards |

### Nice-to-have candidates

| Source | URL | Notes |
|---|---|---|
| Lever-powered company boards | `https://api.lever.co/v0/postings/[company]` | Similar to Greenhouse |
| Workable ATS | Similar pattern | Some companies |
| Adzuna | https://developer.adzuna.com | Free tier: ~250 calls/month, aggregated jobs across major boards |
| Wellfound (AngelList) jobs | https://wellfound.com | Startup jobs; limited public access |
| Indie Hackers job board | https://www.indiehackers.com | Small but bootstrapper-focused |

### Don't bother

| Source | Why skip |
|---|---|
| **LinkedIn Jobs** | Walled garden; scraping = legal trouble |
| **Indeed API** | Deprecated Publisher API; current options are expensive or require partnership |
| **Glassdoor** | API is partner-only; scraping = TOS |
| **ZipRecruiter API** | Partner-only |
| **Stack Overflow Jobs** | Shut down in 2022 |

**Estimated Job Scanner v1 cost: $0/month**

**Job Scanner still needs a full deep research round before building.** This shortlist is a first pass only — probably the smallest scanner by source count.

---

## Common patterns across all scanners

### Shared infrastructure from Layer 2 Phase A

All scanners use the same base infrastructure, built once:
- **`Scanner` interface**: `(directive, profile, deps) => Promise<ScannerReport>`
- **`ScannerReport` type**: structured output with signals, errors, warnings, cost, elapsed time
- **`Signal` type**: uniform shape across all scanners (source, title, url, date, snippet, score, category)
- **Scanner registry**: single array the orchestrator iterates
- **Structured logger**: Pino-style JSON logs for admin visibility
- **KVStore caching**: signals cached by `(scanner_name, directive_hash)` for N hours
- **Rate limiter**: per-source limiter (like the one at `src/lib/utils/rate-limit.ts`)
- **Promise.all orchestrator**: all scanners run in parallel; per-scanner timeout; graceful partial success

### API keys summary across all scanners

| Key | Needed by | Free? |
|---|---|---|
| GitHub PAT | Tech Scout, Pain Scanner (Issues) | Free |
| Hugging Face token | Tech Scout | Free |
| Product Hunt OAuth | Tech Scout, Market Scanner | Free |
| Reddit OAuth app 🟡 | Pain Scanner, (optional Tech Scout) | Free indie |
| Cloudflare Radar token | Tech Scout | Free |
| Dev.to API key | Tech Scout | Free |
| Tavily API key | Pain Scanner, (fallback Tech Scout) | Free tier 🟡 |
| libraries.io key | Tech Scout | Free |
| Kaggle API token | Tech Scout | Free |
| Stack Exchange app key | Pain Scanner | Free (optional) |
| The Guardian API key | Change Scanner | Free |
| NewsAPI key | Change Scanner (optional) | Free tier 🟡 |

All free, all <5 minutes each. None blocking.

### How new scanners get added later

1. Create `src/pipeline/scanners/<name>-scanner.ts`
2. Implement the `Scanner` interface
3. Register in `SCANNERS` array (one line)
4. Add a new directive field in `ScannerDirectives` schema (if needed)
5. Add a new `Consumer` entry in `FIELD_COVERAGE` + update coverage map for relevant fields
6. Write tests following existing pattern

No changes to the orchestrator. This is the extensibility pattern Layer 2 must preserve.

---

## Deep research gate for each scanner

Before building Pain / Market / Change / Job, run the same research round Tech Scout got:
1. List all candidate sources (broad, creative, out-of-box)
2. Classify each source into must-have / nice-to-have / sometimes / don't-bother
3. Compare similar sources with pros/cons
4. Build coverage matrix across scanner slices
5. Recommend v1 build order
6. Estimate cost
7. List required API keys
