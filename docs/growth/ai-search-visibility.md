# AI search visibility

How RestaurantOS can show up, and be described correctly, in AI answers: Google AI Overviews and AI Mode, ChatGPT search, Perplexity, Claude and Copilot. It separates what the code now does from what depends on indexing, reputation and other sites, which no code change can buy. Technical SEO is in [seo-strategy.md](seo-strategy.md).

**Short version:** nothing special is needed for Google's AI features beyond normal indexing [1]. The other assistants rely on their own crawlers or on Bing, and all of them favour content they can fetch without JavaScript, that answers questions directly and that other sources confirm. The code now covers the first two. The third is up to the business.

## How the main AI search systems find content

| System                       | What it reads                                                                                                                                                                                                                                      | Control                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Google AI Overviews, AI Mode | The Google Search index. "No additional requirements… nor other special optimizations necessary" and "You don't need to create new machine readable files, AI text files, or markup" [1]. The page must be indexed and eligible to show a snippet. | `Googlebot` in robots.txt; `nosnippet`, `max-snippet` and `noindex` limit what is shown [1]                                         |
| Gemini training / grounding  | Content Google crawls                                                                                                                                                                                                                              | `Google-Extended` robots.txt token. It "does not impact a site's inclusion in Google Search nor is it used as a ranking signal" [2] |
| ChatGPT search               | `OAI-SearchBot` (search). `GPTBot` is training only. `ChatGPT-User` makes user-triggered fetches, for which robots.txt "may not apply" [3]                                                                                                         | Separate robots.txt groups. Changes take about 24 hours [3]                                                                         |
| Perplexity                   | `PerplexityBot` (search index, not training). `Perplexity-User` makes user-triggered fetches and "generally ignores robots.txt" [4]                                                                                                                | robots.txt [4]                                                                                                                      |
| Claude                       | `Claude-SearchBot` (search), `Claude-User` (user-triggered), `ClaudeBot` (training). All honour robots.txt [5]                                                                                                                                     | robots.txt [5]                                                                                                                      |
| Microsoft Copilot            | The Bing index                                                                                                                                                                                                                                     | Bing Webmaster Tools                                                                                                                |

## What is implemented

| Item                              | What it does                                                                                                                                                                                                                                                                                                                                                                                   | Where                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| One name, one description         | The product is always "RestaurantOS". The one-sentence description in `BRAND.description` is reused verbatim in the meta description, the JSON-LD (`Organization`, `WebSite`, `WebApplication`) and llms.txt, so every source says the same thing.                                                                                                                                             | `packages/web-core/src/features/site/brand.ts` |
| Content without JavaScript        | Every public page is server-rendered. Prices used to load only in the browser and are now in the HTML. Search and AI crawlers (`Googlebot`, `OAI-SearchBot`, `GPTBot`, `ChatGPT-User`, `PerplexityBot`, `Perplexity-User`, `ClaudeBot`, `Claude-SearchBot`, `Claude-User`, `CCBot`, …) get the title, description and canonical in `<head>`. This was checked with a GPTBot user agent in E2E. | `seo/crawlers.ts`, `pricing/server-plans.ts`   |
| Direct answers                    | Each feature page opens with a one-paragraph answer and a "What is …?" section phrased the way owners ask (see the table below). FAQ answers are complete paragraphs in the HTML (`<details>` content is in the DOM).                                                                                                                                                                          | `feature-details.ts`, `faq-data.ts`            |
| Explicit limits                   | "What it doesn't do yet" on every feature page, plus the `NOT_YET` list. AI answers that quote the site will repeat accurate limits (no online payment, dine-in only, no POS hardware, not a local-server POS), which builds trust and stops mismatched leads.                                                                                                                                 | `not-yet.ts`, `feature-details.ts`             |
| Structured data                   | Organization, WebSite, WebApplication (category, features, live INR prices) and BreadcrumbList. These are facts, not a ranking trick: Google says no special schema is needed for AI features [1].                                                                                                                                                                                             | `seo/structured-data.ts`                       |
| Crawler access, public pages only | robots.txt allows all crawlers, AI crawlers included, on public pages, and disallows `/app`, `/t/`, `/print`, `/api/`, … for everyone. Ops, admin and API disallow everything. Guest QR pages and dashboards are never exposed.                                                                                                                                                                | `seo/robots-policy.ts`                         |
| Training crawlers                 | **Allowed by default** (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`). These are public marketing pages, and being in training data helps assistants describe the product when they answer without searching. Opting out of training does not affect search inclusion [2][3]. To opt out, add groups to `consoleRobots()` (see below).                                                    | `seo/robots-policy.ts`                         |
| llms.txt                          | Shipped. See below.                                                                                                                                                                                                                                                                                                                                                                            | `/llms.txt`                                    |

### llms.txt

**Decision: ship it, with no expectations.** `/llms.txt` follows the llmstxt.org proposal: an H1 name, a blockquote summary, then link lists [6]. It is generated from the same page list, FAQ and limitations as the site, so it costs nothing to maintain and cannot drift.

**It is not an established ranking or visibility factor:**

- Google's AI-features guide says you don't need "AI text files" [1].
- Google's John Mueller said in January 2026 that Google hosting llms.txt files on some properties is not an endorsement [7].
- An Ahrefs study of 137K sites found that 97% of llms.txt files were never requested [8].
- The proposal itself calls the format a proposal, not a standard [6].

The only concrete uses today are developer tools and agents that look for it. Expect no traffic from it. It is served with `noindex` like every non-page URL.

### Opting out of AI training (if the business decides to)

Add groups to `consoleRobots()` in `seo/robots-policy.ts`. A crawler that matches a named group ignores the `*` group, so repeat the disallows for it as well. For example:

```text
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: CCBot
Disallow: /
```

Keep `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot` and `Googlebot` allowed, or the site disappears from those assistants' search results [3][4][5].

## Owner questions answered on the site

These pages are written to be quoted. When the product changes, update the answer in the listed file.

| Question an owner might ask an assistant                   | Answered on                                      | Source file          |
| ---------------------------------------------------------- | ------------------------------------------------ | -------------------- |
| Do customers need an app to order by QR code?              | `/faq#no-app`, `/features/qr-code-ordering`      | `faq-data.ts`        |
| What is a QR code ordering system?                         | `/features/qr-code-ordering`                     | `feature-details.ts` |
| Can a stranger send fake orders with a copied QR code?     | `/faq#qr-security`, `/features/qr-code-ordering` | `faq-data.ts`        |
| What is a kitchen display system, and do I need hardware?  | `/features/kitchen-display-system`               | `feature-details.ts` |
| Can bills include CGST/SGST, service charge and discounts? | `/features/restaurant-billing`, `/faq#bills`     | both                 |
| Can guests pay online?                                     | `/faq#online-payments` (no, not yet)             | `faq-data.ts`        |
| Does it work without internet?                             | `/features/offline-mode`, `/faq#offline`         | both                 |
| Does it print KOTs or connect to a cash drawer?            | `/faq#hardware` (no), KDS and billing limits     | both                 |
| How much does it cost? Is there a free trial?              | `/pricing` (live prices in HTML), `/faq#trial`   | API plans data       |
| Can I run several branches from one account?               | `/faq#multi-branch`, `/features#multi-branch`    | `faq-data.ts`        |
| What happens to my data if I stop paying?                  | `/faq#after-expiry`                              | `faq-data.ts`        |

## What depends on things outside the code

None of this can be done in the repository. In practice it matters more than everything above.

1. **Being indexed at all.** Until a production domain exists and `SITE_INDEXABLE=true` is set ([indexing requirements](seo-strategy.md#indexing-requirements)), every page is `noindex` and no search-based assistant can cite it. After launch, crawling and indexing take days to weeks, and "indexing and serving isn't guaranteed" [1].
2. **Third-party confirmation.** For "best restaurant software in India" style questions, assistants summarise the pages that rank: directories and listicles (Capterra India, SoftwareSuggest, Techjockey, G2) and big vendors (see [keyword research](seo-strategy.md#keyword-research-and-intent)). A brand that no independent source mentions is rarely recommended. Get listed on those directories with the same name and description, and collect **genuine** reviews from customers.
3. **Mentions and links.** Restaurant-industry publications, partner pages (for example a QR stand printer or an accountant who recommends the product) and community answers. Paid link schemes violate Google's spam policies; don't.
4. **Consistency elsewhere.** Use the same name ("RestaurantOS"), the same one-line description and the same domain on every profile (LinkedIn, directories, GitHub org). Mismatched names split the entity.
5. **Time.** A new domain earns trust slowly. Expect months before head terms move. Feature-level questions ("QR ordering with waiter approval") can be cited sooner.

## How to measure (free)

| Signal                             | How                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google impressions and AI features | Search Console → Performance. AI Overviews and AI Mode are "reported on in the Performance report, within the 'Web' search type" [1]; they are not broken out separately.                                                                                                                                 |
| Crawler activity                   | Cloud Run request logs filtered on user agent: `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `Googlebot`, `bingbot`. This tells you whether they fetch the public pages, and whether anything requests `/llms.txt`.                                                                               |
| Referrals from assistants          | Analytics (W5's GA4 work): sessions with referrer `chatgpt.com`, `perplexity.ai`, `copilot.microsoft.com`, `gemini.google.com`, or with `utm_source=chatgpt.com`                                                                                                                                          |
| Answer quality                     | Once a month, ask ChatGPT (search on), Perplexity, Gemini and Copilot the same ten questions from the table above plus "restaurant software with QR ordering and waiter approval in India". Record whether RestaurantOS is mentioned and whether the facts are right. Wrong facts point to a page to fix. |

## Sources

1. Google Search Central, _AI features and your website_. <https://developers.google.com/search/docs/appearance/ai-features>
2. Google, _Google's common crawlers: Google-Extended_. <https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers>
3. OpenAI, _Overview of OpenAI crawlers_. <https://developers.openai.com/api/docs/bots>
4. Perplexity, _Perplexity crawlers_. <https://docs.perplexity.ai/guides/bots>
5. Anthropic, _Does Anthropic crawl data from the web, and how can site owners block the crawler?_ <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>
6. llmstxt.org, _The /llms.txt file_ (proposal by Jeremy Howard, 2024; v2 August 2026). <https://llmstxt.org/>
7. Search Engine Roundtable, _Google Search Team Does Not Endorse LLMs.txt Files_ (January 2026). <https://www.seroundtable.com/google-does-not-endorse-llms-txt-40789.html>
8. Ahrefs, _We Analyzed 137K Sites: 97% of llms.txt Files Never Get Read_. <https://ahrefs.com/blog/llmstxt-study/>
9. Search Engine Journal, _Google's llms.txt guidance depends on which product you ask_ (2026; Lighthouse audits llms.txt for agentic browsing while Search does not use it). <https://www.searchenginejournal.com/googles-llms-txt-guidance-depends-on-which-product-you-ask>
