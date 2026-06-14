# LLM Auto-Reply Automation — Execution Plan (Gemini + RAG)

**Goal:** a fully-autonomous WhatsApp auto-reply assistant. Inbound message →
retrieve relevant business-document context → **Gemini drafts a grounded reply**
→ sent back over WhatsApp. All inside the existing Next.js + Supabase app.

**LLM:** Google **Gemini** via the `@google/genai` SDK (generation +
embeddings). **No Anthropic SDK.**
**Knowledge base:** business documents (PDF/Word, text/Markdown, scraped URLs),
chunked + embedded into **Supabase pgvector**, managed from an admin upload UI.

---

## The constraint that shapes everything: the 24-hour window

WhatsApp only allows **free-form (non-template) messages within 24 hours of the
user's last inbound message**. Outside that window you can send *only* approved
templates. An auto-reply bot lives inside this window: the user just messaged us,
so a reply is always allowed. The window only matters for delayed follow-ups.

## What exists vs. what's missing

| Capability | Today | Needed |
|---|---|---|
| Inbound message handling | ❌ webhook only reads `statuses` ([route.ts:34](src/app/api/webhooks/whatsapp/route.ts#L34)) | Parse `change.value.messages` |
| Free-form text send | ❌ `whatsapp.ts` only sends templates | `sendText(phone, body)` |
| Conversation memory | ❌ | `wa_conversations` + `wa_messages` tables |
| **Document knowledge base** | ❌ | `kb_documents` + `kb_chunks` (pgvector) + ingestion pipeline |
| **Embeddings + retrieval** | ❌ | Gemini embeddings → pgvector cosine search |
| LLM call | ❌ | `src/lib/llm.ts` (Gemini generate, grounded on retrieved chunks) |
| Fast webhook ack + async reply | ⚠️ cron exists, 1-min latency | inline fast-ack + fire-and-forget worker |
| Doc + bot admin UI | ❌ | upload/manage docs, inbox, bot toggle |

---

## Phase 0 — Prerequisites

1. **Gemini API key** (https://aistudio.google.com/apikey) → `.env.local`:
   ```
   GEMINI_API_KEY=...
   GEMINI_CHAT_MODEL=gemini-2.5-flash        # fast, cheap, grounded chat
   GEMINI_EMBED_MODEL=gemini-embedding-001   # for KB chunks + queries
   LLM_BOT_ENABLED=true
   ```
   (`gemini-2.5-pro` is the higher-quality option if reply quality needs it.)
2. Install SDKs:
   ```
   npm install @google/genai          # Gemini generation + embeddings
   npm install pdf-parse mammoth       # PDF + DOCX text extraction
   # URL scraping: built-in fetch + a lightweight HTML-to-text (e.g. cheerio)
   npm install cheerio
   ```
3. Confirm Supabase + Meta WhatsApp creds are real (SETUP.md).
4. **Pick embedding dimensions and lock them** — `gemini-embedding-001` supports
   configurable `outputDimensionality` (e.g. 768 / 1536 / 3072). Choose one (768
   is a good cost/quality default) and use it consistently for both the pgvector
   column and every embed call. Changing it later means re-embedding everything.

---

## Phase 1 — Data model

### 1a. Conversations (migration `0002_llm.sql`)

```sql
create table wa_conversations (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,
  contact_id      uuid references contacts(id) on delete set null,
  status          text not null default 'active'
                    check (status in ('active','paused','escalated')),
  bot_enabled     boolean not null default true,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at      timestamptz not null default now()
);

create table wa_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  body            text not null default '',
  meta_message_id text,
  created_at      timestamptz not null default now()
);
create index wa_messages_conv_idx on wa_messages (conversation_id, created_at);
create unique index wa_messages_metaid_idx on wa_messages (meta_message_id)
  where meta_message_id is not null;
```

### 1b. Knowledge base + pgvector (migration `0003_kb.sql`)

```sql
create extension if not exists vector;

-- One row per ingested document.
create table kb_documents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  source_type text not null check (source_type in ('pdf','docx','text','url')),
  source_ref  text,                              -- filename or URL
  status      text not null default 'processing' -- processing | ready | failed
                check (status in ('processing','ready','failed')),
  error       text,
  chunk_count int not null default 0,
  created_at  timestamptz not null default now()
);

-- Chunked, embedded text. Dimension MUST match GEMINI_EMBED_MODEL output.
create table kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb_documents(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  embedding   vector(768) not null,              -- 768 = chosen dim (Phase 0.4)
  created_at  timestamptz not null default now()
);
create index kb_chunks_doc_idx on kb_chunks (document_id);
create index kb_chunks_embedding_idx on kb_chunks
  using hnsw (embedding vector_cosine_ops);       -- approx-NN cosine search

-- Retrieval RPC: top-k chunks by cosine similarity.
create or replace function match_kb_chunks(query_embedding vector(768), match_count int)
returns table (content text, document_id uuid, similarity float)
language sql stable as $$
  select c.content, c.document_id, 1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
```

---

## Phase 2 — Document ingestion pipeline (`src/lib/kb.ts`)

The pipeline runs on upload/add and turns a source into embedded chunks.

```
ingest(source):
  1. EXTRACT text:
       pdf   → pdf-parse
       docx  → mammoth
       text/md → as-is
       url   → fetch + cheerio (strip nav/scripts → main text)
  2. CHUNK: ~500–1000 tokens per chunk, ~10–15% overlap, split on paragraphs.
  3. EMBED each chunk: ai.models.embedContent({ model: GEMINI_EMBED_MODEL,
       contents: chunk, config: { outputDimensionality: 768,
       taskType: "RETRIEVAL_DOCUMENT" } })   // batch to respect rate limits
  4. INSERT kb_chunks rows; update kb_documents.status='ready', chunk_count=N.
  on error → status='failed', store message.
```

Embedding can be slow for big docs — run ingestion **async** (same fast-ack +
worker pattern as replies, or a dedicated `/api/admin/kb/ingest` worker), and show
`processing → ready/failed` status in the UI. Re-ingest replaces a document's
chunks (delete-then-insert) so edits don't duplicate.

**`store.ts`/`kb.ts` functions:** `createDocument`, `replaceChunks(docId, chunks)`,
`setDocStatus`, `listDocuments`, `deleteDocument`, `searchChunks(queryEmbedding, k)`.

---

## Phase 3 — LLM reply engine (`src/lib/llm.ts`, Gemini + retrieval)

```ts
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateReply(history, latestUserMessage) {
  // 1. Embed the user's question (taskType: RETRIEVAL_QUERY).
  const qEmb = await ai.models.embedContent({
    model: process.env.GEMINI_EMBED_MODEL,
    contents: latestUserMessage,
    config: { outputDimensionality: 768, taskType: "RETRIEVAL_QUERY" },
  });
  // 2. Retrieve top-k business-doc chunks from pgvector.
  const chunks = await searchChunks(qEmb.embeddings[0].values, 6);
  const context = chunks.map(c => c.content).join("\n---\n");

  // 3. Generate a grounded reply.
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_CHAT_MODEL,
    contents: history.map(m => ({ role: m.role === "assistant" ? "model" : "user",
                                  parts: [{ text: m.body }] })),
    config: {
      systemInstruction: BOT_SYSTEM_PROMPT + "\n\nBusiness context:\n" + context,
    },
  });
  return res.text?.trim();
}
```

**System prompt = grounding contract:** "Answer **only** from the Business context
above. If the answer isn't in the context, say you'll connect a human — do not
guess." Plus identity, tone, short-reply instruction, escalation trigger. This is
what keeps a fully-autonomous bot from hallucinating business facts.

> Verify exact `@google/genai` field names (`embedContent` shape, `taskType`,
> `outputDimensionality`, `res.text`) against the SDK at build time — the above is
> the intended structure.

---

## Phase 4 — Free-form text sender

Add `sendText(phone, body)` to [whatsapp.ts](src/lib/whatsapp.ts) next to
`sendCampaign` — same Graph version + creds, `type:"text"` instead of template.
(Returns `{id}` on success / `{error}` on failure; logs like `sendCampaign`.)

---

## Phase 5 — Inbound webhook + async orchestration

Extend the `POST` in [webhooks/whatsapp/route.ts](src/app/api/webhooks/whatsapp/route.ts)
(keep the existing signature check + `statuses` branch). Add a `messages` branch:

```
for change.value.messages[]:
  - dedup on message.id (unique index)
  - OPT-OUT GUARD: body ~ /^(stop|unsubscribe|cancel)$/i → addOptout + confirm, no LLM
  - if phone in optoutSet() → ignore
  - upsert contact (source 'inbound'); conv = getOrCreateConversation(phone, name)
  - appendMessage(conv,'user',body,id); touchInbound(conv)
  - if LLM_BOT_ENABLED && conv.bot_enabled && status==='active':
        fire-and-forget POST /api/llm/respond (waitUntil), return 200 fast
```

`/api/llm/respond` worker (auth via `CRON_SECRET`): reload conversation + history,
re-check enabled/active/within-24h, `reply = generateReply(history, lastMsg)`,
`sendText`, on success `appendMessage(conv,'assistant',reply,id)` + daily-cap check.
Cron sweep = fallback for dropped fire-and-forget calls.

---

## Phase 6 — Guardrails (required: fully autonomous)

| Risk | Mitigation |
|---|---|
| Hallucinated business facts | **Grounding contract** — answer only from retrieved chunks; escalate if not found |
| Replies to opt-outs | STOP guard + `optoutSet()` check before every send |
| Loop / self-reply | Only inbound `role:"user"` triggers; never react to our own `statuses` |
| User wants a person | Escalation trigger → status `escalated`, stop auto-replies, flag in admin |
| LLM/API failure | try/catch → static fallback ("a team member will reply") + log |
| Empty/irrelevant retrieval | If no chunk clears a similarity threshold → escalate instead of guessing |
| Spend / abuse | Daily cap; per-conversation rate limit; `LLM_BOT_ENABLED` kill switch |
| Outside 24h window | Skip free-form; require template re-engagement |

---

## Phase 7 — Admin UI

- **Knowledge base** tab: upload PDF/DOCX, paste text/Markdown, add a URL to
  scrape; list documents with `processing/ready/failed` status + chunk count;
  delete / re-ingest. Backed by `POST/GET/DELETE /api/admin/kb`.
- **Conversations / inbox**: list conversations, read threads, per-chat **bot
  on/off**, escalation filter. `GET /api/admin/conversations(/[id])`.
- **Bot settings**: system-prompt editor + global enable.

---

## Phase 8 — Testing & rollout

1. **KB sanity:** ingest one doc → confirm chunks + embeddings land; run a query
   embedding → `match_kb_chunks` returns the right chunk.
2. **Reply unit test:** mock retrieval + `sendText`, assert grounded reply; assert
   escalation when retrieval is empty.
3. **Webhook replay:** POST a signed sample `messages` payload → reply row created.
4. **Tunnel test:** ngrok → register webhook in Meta → message the number → confirm
   a grounded LLM reply.
5. **Rollout:** `LLM_BOT_ENABLED=false`, enable on one test conversation, verify
   guardrails (STOP, escalation, fallback, grounding), then flip global on.

---

## Build order (dependency-sorted)

```
Phase 0 (Gemini key, SDKs, dims)
  → Phase 1 (migrations: conversations + KB/pgvector)
    → Phase 2 (ingestion pipeline)  ─┐
    → Phase 4 (sendText)            ─┤
      → Phase 3 (llm.ts: embed→retrieve→generate)
        → Phase 5 (webhook + worker) → Phase 6 (guardrails)
          → Phase 7 (admin: KB + inbox)
            → Phase 8 (test + rollout)
```

## Files touched / created

- **new** `supabase/migrations/0002_llm.sql` (conversations)
- **new** `supabase/migrations/0003_kb.sql` (pgvector KB + `match_kb_chunks`)
- **new** `src/lib/kb.ts` (extract → chunk → embed → store → search)
- **new** `src/lib/llm.ts` (Gemini: embed query, retrieve, generate)
- **new** `src/app/api/llm/respond/route.ts` (reply worker)
- **new** `src/app/api/admin/kb/route.ts` (+ ingest worker)
- **new** `src/app/api/admin/conversations/route.ts` (+ `[id]/route.ts`)
- **edit** `src/lib/whatsapp.ts` (`sendText`)
- **edit** `src/lib/store.ts` (conversation + message + doc/chunk functions)
- **edit** `src/app/api/webhooks/whatsapp/route.ts` (inbound `messages` branch)
- **edit** `src/app/api/cron/process-queue/route.ts` (fallback sweep)
- **edit** `src/app/admin/*` (KB + inbox UI)
- **edit** `.env.example` / `.env.local` (`GEMINI_API_KEY`, models, `LLM_BOT_ENABLED`)
```
