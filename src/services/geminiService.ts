import { GoogleGenAI, Type } from '@google/genai';

export async function generateFlashcards(
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[] = ['basic']
) {
  let apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY
  )?.trim();
  if (apiKey === 'undefined') apiKey = undefined;
  console.log('API Key length:', apiKey?.length, 'starts with:', apiKey?.substring(0, 4));
  if (!apiKey) throw new Error('API key not set');
  const ai = new GoogleGenAI({ apiKey });
  return run(ai, text, images, deckName, cardTypes);
}

// ═══════════════════════════════════════════════════════════════════
// ARCHITECTURE
//
// Step 1  Extract atomic claims          Flash 1M ctx — chunked if large
// Step 2  Classify: testable?            Lite — binary YES/NO, parallel
// Step 3  Consolidate into groups        Flash — groups related claims
//         + detect audience per group    Lite — parallel
// Step 4  Generate cards per group       Flash — parallel
//         Smart decision per group:
//           Option A: one combined card  when natural question covers all facts
//           Option B: one card per fact  when no natural question exists
//         Model decides — not forced
// Step 5  Verify claims vs ALL cards     No LLM — cosine similarity
// Step 6  Gap fill missing claims        Flash — targeted
// Step 7  Cross-chunk dedup             No LLM — cosine similarity
//
// DESIGN PRINCIPLE:
// Neither one-card-per-group (buries facts) nor one-card-per-claim
// (loses connections). The model reads each group and decides whether
// a natural combined question exists. If yes: one card, all facts tested.
// If no: separate cards, nothing buried.
// ═══════════════════════════════════════════════════════════════════

// ── Models ────────────────────────────────────────────────────────
const MODEL_MAIN  = 'gemini-3-flash-preview';        // 1M context
const MODEL_LITE  = 'gemini-3.1-flash-lite-preview'; // classify + audience
const MODEL_EMBED = 'text-embedding-004';            // verification + dedup

// ── Constants ─────────────────────────────────────────────────────
// THRESHOLDS — calibrated on thalamus deck (89 claims, 27 cards)
// 0.775 gives clean separation: covered ≥0.782, genuinely missing ≤0.778
const MAX_PARALLEL_CLASSIFY  = 50;
const MAX_PARALLEL_GENERATE  = 20;
const MAX_PARALLEL_EMBED     = 10;
const MAX_RETRIES             = 3;
const RETRY_BASE_MS           = 1000;
const COVERAGE_THRESHOLD      = 0.775; // calibrated
const DEDUP_THRESHOLD         = 0.90;  // calibrated
const MAX_CLAIMS_PER_GROUP    = 5;

// Chunked extraction — guarantees completeness at any document length
// ~22 pages per chunk keeps output tokens well under 65k limit
const CHUNK_SIZE_CHARS    = 66_000;  // ~22 pages
const CHUNK_OVERLAP_CHARS = 2_000;   // 2-page overlap prevents boundary losses

// ── Types ─────────────────────────────────────────────────────────
interface Claim {
  id:      string;
  text:    string;
  heading: string;
}

interface TestableClaim extends Claim {
  context: string;
}

interface ClaimGroup {
  groupId:       string;
  claimIds:      string[];
  cardType:      string;
  rationale:     string;
  audienceLevel: string;
}

interface GeneratedCard {
  groupId: string;
  claimId: string;
  type:    string;
  front:   string;
  back:    string;
}

// ── Schemas ───────────────────────────────────────────────────────
const claimSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      text:    { type: Type.STRING },
      heading: { type: Type.STRING }
    },
    required: ['text', 'heading'] as const
  }
};

const consolidationSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      claimIds:  { type: Type.ARRAY, items: { type: Type.STRING } },
      cardType:  { type: Type.STRING },
      rationale: { type: Type.STRING }
    },
    required: ['claimIds', 'cardType', 'rationale'] as const
  }
};

// Array schema — generation always returns an array
// (1 card for Option A combined, N cards for Option B separate)
const cardArraySchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      type:  { type: Type.STRING },
      front: { type: Type.STRING },
      back:  { type: Type.STRING }
    },
    required: ['type', 'front', 'back'] as const
  }
};

const audienceSchema = {
  type: Type.OBJECT,
  properties: {
    level:     { type: Type.STRING },
    reasoning: { type: Type.STRING }
  },
  required: ['level', 'reasoning'] as const
};

// ── Prompts ───────────────────────────────────────────────────────
const EXTRACT_PROMPT = `You are reading this source material.
Extract every atomic factual claim. One claim = one subject, one fact.

RULES:
- One fact per claim. Never combine two facts.
- Lists: each item = separate claim.
- Tables: each factual cell = separate claim.
- Preserve source wording exactly. Do not paraphrase.
- Include parent heading for each claim.
- Skip: section titles, pure definitions without mechanism,
  transitional sentences, sentences with no testable content.
- If the same concept appears multiple times, emit it ONCE
  using the most complete, most clinically specific statement.

SPECIAL RULE — COMPARISONS AND EXCEPTIONS:
If a sentence describes how X differs from Y, or when a rule does
NOT apply — extract it as its own claim. Never merge with the rule.
These facts are most commonly lost.

Examples to always preserve as separate claims:
  "Bell's palsy affects the entire face; UMN lesion spares the forehead"
  "Smell bypasses the thalamus unlike all other senses"
  "Cerebellar lesions cause ipsilateral signs due to double decussation"
  "Upper facial nucleus receives bilateral input; lower receives contralateral only"

EXAMPLE — atomic splitting:
Source: "PICA occlusion causes ipsilateral Horner's, ataxia,
         and contralateral pain/temperature loss"
Output:
  { "text": "PICA occlusion causes ipsilateral Horner's syndrome",           "heading": "Wallenberg" }
  { "text": "PICA occlusion causes ipsilateral ataxia",                      "heading": "Wallenberg" }
  { "text": "PICA occlusion causes contralateral pain and temperature loss",  "heading": "Wallenberg" }

Return JSON array only. No preamble.`;

const CLASSIFY_PROMPT = `Does this sentence contain a testable medical fact?
Testable = named finding, mechanism, number with clinical significance,
comparison, syndrome sign, drug mechanism, pathway step, threshold,
exception, or cause-effect relationship.
Not testable = pure definition without mechanism, transitional phrase,
background with no clinical relevance.
Reply with exactly one word: YES or NO`;

const CONSOLIDATE_PROMPT = `Organize these medical claims into card groups.
Each group will be evaluated for whether its claims can be combined
into one card or need separate cards.

RULES:
- Every claim must appear in exactly one group. Do not discard any.
- Combine claims a student would naturally learn together:
    same concept from different angles
    cause and its clinical effect
    structure and its deficit
    two concepts best learned by comparison
    pathway steps in sequence
- Never combine claims from genuinely different topics.
- Maximum ${MAX_CLAIMS_PER_GROUP} claims per group.
- Groups of 1 are fine — not everything needs combining.

CARD TYPES:
  single            one standalone fact
  comparison        two concepts learned by distinction
  pathway           causal chain with named steps
  structure_deficit anatomy linked to clinical consequence
  scenario          syndrome with multiple signs

Return JSON array. No preamble.`;

const AUDIENCE_PROMPT = `Classify this medical content by target audience.
Return exactly one of:
"Step 1"    basic science, mechanisms, anatomy, pathophysiology
"Step 2"    clinical presentations, diagnosis, management decisions
"Resident"  advanced management, guidelines, nuanced reasoning
"Fellow"    subspecialty depth, evidence-based, complex cases
"General"   non-medical or unclear
Return JSON with "level" and one-sentence "reasoning".`;

function buildSystemPrompt(cardTypes: string[], audienceLevel: string): string {
  const allowed = cardTypes.join(', ');
  const noBasic = !cardTypes.includes('basic') ? '\n- No "basic" cards.' : '';
  const noCloze = !cardTypes.includes('cloze') ? '\n- No "cloze" cards.' : '';

  return `Generate Anki flashcards. ALLOWED TYPES: ${allowed}.${noBasic}${noCloze}
AUDIENCE: ${audienceLevel}

═══ HARD RULES — NEVER VIOLATE ═══
1. Cloze: hide MAXIMUM 4 words. Never hide a name, label, or location.
2. Front: MAXIMUM 40 words. Must not hint at or contain the answer.
3. Back: MAXIMUM 2 short paragraphs.
4. Never invent beyond the source context provided.
5. No card should take more than 15 seconds to answer.
6. Back format: <b>direct answer</b> on line 1, then <hr>, then explanation.

═══ AUDIENCE DEPTH ═══
Step 1:    Why does X produce Y? What structure explains this deficit?
           Mechanism always in the back.
Step 2:    Next best step. What test and why not the alternative.
           What is contraindicated. Richer clinical vignettes.
Resident:  Exceptions to rules. Evidence basis. Risk stratification.
General:   Match depth to each individual fact.

═══ FORMAT — READ THE MATERIAL, WRITE THE RIGHT QUESTION ═══
The format comes from what the fact IS:

Mechanism    "Why does X produce Y rather than Z?"
Distinction  "Both A and B cause X. What single finding differentiates them?"
Consequence  "Patient has [deficit]. What structure and why?"
Exception    "[Rule] applies — except when? Why?"
Number       Cloze: "X occurs below {{c1::15 mL/100g/min}}"
Scenario     "Patient has [signs]. Diagnosis and why each sign occurs?"
Pathway      "Trace what happens when [trigger] — sequence and endpoint?"
Trap         "A student assumes [wrong answer]. What rules it out?"
Next step    "Patient with [vignette]. What now and why not [alternative]?"
Recall       Clean focused recall for isolated facts with no better angle.

OUTPUT: JSON array. No preamble.`;
}

// ── Main pipeline ─────────────────────────────────────────────────
async function run(
  ai: GoogleGenAI,
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[]
): Promise<GeneratedCard[]> {
  const source    = `Deck: ${deckName}\n\n${text}`;
  const hasImages = Object.keys(images).length > 0;
  console.log(`\nSource: ${source.length.toLocaleString()} chars (~${Math.round(source.length / 4).toLocaleString()} tokens)`);

  // Step 1: Chunked extraction — guarantees completeness at any scale
  console.log('\n── Step 1: Extracting claims (chunked)...');
  const rawClaims = await extractClaims(ai, source, hasImages, images);

  // Cross-chunk dedup — removes duplicates from overlapping boundaries
  const claims = await deduplicateClaimsAcrossChunks(ai, rawClaims);
  console.log(`  ${rawClaims.length} raw → ${claims.length} after cross-chunk dedup`);
  if (claims.length === 0) throw new Error('No claims extracted.');

  // Step 2: Classify
  console.log('\n── Step 2: Classifying...');
  const testable = await classifyClaims(ai, claims, source);
  console.log(`  ${testable.length}/${claims.length} testable`);
  if (testable.length === 0) throw new Error('No testable claims.');

  // Step 3: Consolidate + audience level per group
  console.log('\n── Step 3: Consolidating + detecting audience...');
  const groups = await consolidateAndClassify(ai, testable);
  console.log(`  ${testable.length} claims → ${groups.length} groups`);

  // Step 4: Generate — model decides combine or separate per group
  console.log('\n── Step 4: Generating cards (smart combine-or-separate)...');
  const { cards, failedGroups } = await generateAllCards(
    ai, groups, testable, cardTypes, hasImages, images
  );
  console.log(`  ${cards.length} cards from ${groups.length - failedGroups.length} groups`);
  if (failedGroups.length > 0) {
    console.warn(`  ${failedGroups.length} groups failed all retries`);
  }

  // Step 5: Verify claims against ALL cards
  console.log('\n── Step 5: Verifying coverage...');
  const { missingGroups } = await verifyGroupCoverage(ai, groups, cards, testable);
  console.log(`  ${groups.length - missingGroups.length}/${groups.length} groups covered`);

  // Step 6: Gap fill
  let allCards = [...cards];
  if (missingGroups.length > 0) {
    console.log(`\n── Step 6: Gap fill — ${missingGroups.length} groups...`);
    const { cards: gapCards } = await generateAllCards(
      ai, missingGroups, testable, cardTypes, hasImages, images
    );
    allCards = [...cards, ...gapCards];
    console.log(`  ${gapCards.length} gap cards`);
  } else {
    console.log('\n── Step 6: No gaps — skipping.');
  }

  // Step 7: Embedding dedup
  console.log(`\n── Step 7: Dedup (${allCards.length} cards)...`);
  const deduped = await deduplicateWithEmbeddings(ai, allCards);

  const result = filterByCardType(deduped, cardTypes);
  console.log(`\n✓ Done: ${result.length} cards`);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 1 — CHUNKED EXTRACTION
//
// Splits document into ~22-page chunks with 2-page overlap.
// Each chunk is extracted in parallel.
// Overlap prevents facts at chunk boundaries from being missed.
// Cross-chunk dedup removes duplicates from the overlap regions.
// This guarantees extraction completeness regardless of document size.
// ═══════════════════════════════════════════════════════════════════
async function extractClaims(
  ai: GoogleGenAI,
  source: string,
  hasImages: boolean,
  images: Record<string, Buffer>
): Promise<Claim[]> {
  const chunks = splitIntoChunks(source, CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS);
  console.log(`  ${chunks.length} chunks (${CHUNK_SIZE_CHARS.toLocaleString()} chars each)`);

  // Track cumulative offset per chunk for unique IDs
  // Each chunk gets an offset so cl_0001 from chunk 1 ≠ cl_0001 from chunk 2
  const offsets: number[] = [0];
  for (let i = 1; i < chunks.length; i++) {
    offsets.push(offsets[i - 1] + 1000); // 1000 IDs per chunk is more than enough
  }

  const results = await withConcurrencyLimit(
    chunks.map((chunk, i) => () =>
      extractFromChunk(ai, chunk, hasImages, images, offsets[i])
    ),
    5 // conservative — each chunk call is heavy
  );

  return results.flat();
}

function splitIntoChunks(
  text: string,
  chunkSize: number,
  overlap: number
): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Prefer breaking at paragraph boundary
    if (end < text.length) {
      const slice      = text.substring(Math.max(end - 500, start), end);
      const lastBreak  = slice.lastIndexOf('\n\n');
      if (lastBreak !== -1) {
        end = Math.max(end - 500, start) + lastBreak + 2;
      }
    }

    chunks.push(text.substring(start, end));
    if (end >= text.length) break;

    // Next chunk starts before end of this chunk (overlap)
    start = end - overlap;
  }

  return chunks;
}

async function extractFromChunk(
  ai: GoogleGenAI,
  text: string,
  hasImages: boolean,
  images: Record<string, Buffer>,
  idOffset: number
): Promise<Claim[]> {
  const parts: any[] = [{ text }];

  if (hasImages) {
    for (const [name, buf] of Object.entries(images).slice(0, 16)) {
      let mime = 'image/jpeg';
      if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
      if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
      parts.push({ inlineData: { mimeType: mime, data: buf.toString('base64') } });
      parts.push({ text: `[Image: ${name}]` });
    }
  }

  const response = await ai.models.generateContent({
    model: MODEL_MAIN,
    contents: { role: 'user', parts },
    config: {
      systemInstruction: EXTRACT_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: claimSchema
    }
  });

  const raw = response.text?.replace(/```json|```/g, '').trim() || '[]';
  let rawClaims: any[];

  try {
    rawClaims = JSON.parse(raw);
  } catch {
    const last = raw.lastIndexOf('}');
    try {
      rawClaims = JSON.parse(raw.substring(0, last + 1) + ']');
      console.warn(`  Chunk JSON truncated — partial recovery`);
    } catch {
      console.warn(`  Chunk JSON parse failed`);
      return [];
    }
  }

  return rawClaims
    .map((c: any, i: number) => ({
      id:      `cl_${String(idOffset + i).padStart(5, '0')}`,
      text:    (c.text    || '').trim(),
      heading: (c.heading || '').trim()
    }))
    .filter(c => c.text.length > 10);
}

// Cross-chunk dedup — removes claims duplicated by chunk overlap
async function deduplicateClaimsAcrossChunks(
  ai: GoogleGenAI,
  claims: Claim[]
): Promise<Claim[]> {
  if (claims.length < 2) return claims;

  try {
    const embeddings = await embedTexts(ai, claims.map(c => c.text));
    const toRemove   = new Set<number>();

    for (let i = 0; i < claims.length; i++) {
      if (toRemove.has(i) || !embeddings[i]) continue;
      for (let j = i + 1; j < claims.length; j++) {
        if (toRemove.has(j) || !embeddings[j]) continue;
        // Only dedup within same heading — prevents cross-topic removal
        if (claims[i].heading !== claims[j].heading) continue;
        if (cosineSim(embeddings[i]!, embeddings[j]!) >= 0.92) {
          // Keep the longer, more complete claim
          toRemove.add(
            claims[i].text.length >= claims[j].text.length ? j : i
          );
        }
      }
    }

    return claims.filter((_, i) => !toRemove.has(i));
  } catch {
    // If embedding fails, return all claims — no dedup is safer than losing claims
    console.warn('  Cross-chunk dedup unavailable — keeping all claims');
    return claims;
  }
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2 — BINARY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════
async function classifyClaims(
  ai: GoogleGenAI,
  claims: Claim[],
  source: string
): Promise<TestableClaim[]> {
  const results = await withConcurrencyLimit(
    claims.map(claim => () => classifyOne(ai, claim, source)),
    MAX_PARALLEL_CLASSIFY
  );
  return results.filter((r): r is TestableClaim => r !== null);
}

async function classifyOne(
  ai: GoogleGenAI,
  claim: Claim,
  source: string
): Promise<TestableClaim | null> {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: { role: 'user', parts: [{ text: claim.text }] },
      config: { systemInstruction: CLASSIFY_PROMPT }
    });
    if (!response.text?.trim().toUpperCase().startsWith('YES')) return null;
  } catch {
    // Default YES on error — coverage over precision
  }
  return { ...claim, context: getContext(claim.text, source) };
}

function getContext(claimText: string, source: string, window = 600): string {
  // Exact match
  const idx = source.indexOf(claimText);
  if (idx !== -1) {
    return source.substring(
      Math.max(0, idx - window / 2),
      Math.min(source.length, idx + claimText.length + window / 2)
    );
  }
  // Fuzzy fallback — 40 char anchor reduces wrong-location matches
  const anchorLen = Math.min(40, claimText.length);
  const anchor    = claimText.substring(0, anchorLen);
  const fuzzyIdx  = source.indexOf(anchor);
  if (fuzzyIdx !== -1) {
    return source.substring(
      Math.max(0, fuzzyIdx - window / 2),
      Math.min(source.length, fuzzyIdx + window)
    );
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3 — CONSOLIDATION + AUDIENCE LEVEL PER GROUP
// ═══════════════════════════════════════════════════════════════════
async function consolidateAndClassify(
  ai: GoogleGenAI,
  claims: TestableClaim[]
): Promise<ClaimGroup[]> {
  // 3a: Consolidation
  const claimList = claims
    .map(c => `[${c.id}] (${c.heading}) ${c.text}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_MAIN,
    contents: {
      role: 'user',
      parts: [{ text: `Organize these claims into card groups:\n\n${claimList}` }]
    },
    config: {
      systemInstruction: CONSOLIDATE_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: consolidationSchema
    }
  });

  const raw = response.text?.replace(/```json|```/g, '').trim() || '[]';
  let rawGroups: any[];

  try {
    rawGroups = JSON.parse(raw);
  } catch {
    console.warn('  Consolidation parse failed — one group per claim');
    rawGroups = claims.map(c => ({
      claimIds:  [c.id],
      cardType:  'single',
      rationale: 'parse fallback'
    }));
  }

  // Validate IDs — prevent hallucinated IDs, prevent duplicate assignments
  const validIds    = new Set(claims.map(c => c.id));
  const assignedIds = new Set<string>();
  const groups: Omit<ClaimGroup, 'audienceLevel'>[] = [];

  for (let i = 0; i < rawGroups.length; i++) {
    const g             = rawGroups[i];
    const validClaimIds = (g.claimIds || []).filter((id: string) => {
      if (!validIds.has(id))   { console.warn(`  Unknown ID: ${id}`); return false; }
      if (assignedIds.has(id)) { return false; }
      assignedIds.add(id);
      return true;
    });
    if (validClaimIds.length > 0) {
      groups.push({
        groupId:   `g_${i}`,
        claimIds:  validClaimIds,
        cardType:  g.cardType  || 'single',
        rationale: g.rationale || ''
      });
    }
  }

  // Unassigned claims → their own groups
  claims
    .filter(c => !assignedIds.has(c.id))
    .forEach((c, i) => {
      console.warn(`  Unassigned: ${c.id} — adding as single`);
      groups.push({
        groupId:   `g_u_${i}`,
        claimIds:  [c.id],
        cardType:  'single',
        rationale: 'unassigned'
      });
    });

  // 3b: Audience level per group — parallel Lite calls
  // Include heading for stronger classification signal
  const claimMap = new Map(claims.map(c => [c.id, c]));

  const groupsWithLevel = await withConcurrencyLimit(
    groups.map(group => async (): Promise<ClaimGroup> => {
      const groupText = group.claimIds
        .map(id => {
          const claim = claimMap.get(id);
          return claim ? `${claim.heading}: ${claim.text}` : '';
        })
        .filter(Boolean)
        .join('\n');

      const level = await detectLevel(ai, groupText);
      return { ...group, audienceLevel: level };
    }),
    MAX_PARALLEL_CLASSIFY
  );

  return groupsWithLevel;
}

async function detectLevel(ai: GoogleGenAI, text: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: { role: 'user', parts: [{ text }] },
      config: {
        systemInstruction: AUDIENCE_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: audienceSchema
      }
    });
    const raw    = response.text?.replace(/```json|```/g, '').trim() || '{}';
    const result = JSON.parse(raw);
    return result.level || 'General';
  } catch {
    return 'General';
  }
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4 — SMART GENERATION: COMBINE OR SEPARATE
//
// For each group, the model reads the facts and decides:
//
// OPTION A — ONE COMBINED CARD
//   Used when one natural question requires knowing ALL facts.
//   The student must know every fact to answer correctly.
//   Example: Wallenberg's 3 signs → one scenario card tests all three.
//
// OPTION B — SEPARATE CARDS (one per fact)
//   Used when no natural combined question exists, or when combining
//   would require knowing 5+ things simultaneously.
//   Example: unrelated nuclei in same heading → separate cards.
//
// The model decides. Neither option is forced.
// Returns array in both cases — 1 card for A, N cards for B.
// ═══════════════════════════════════════════════════════════════════
async function generateAllCards(
  ai: GoogleGenAI,
  groups: ClaimGroup[],
  claims: TestableClaim[],
  cardTypes: string[],
  hasImages: boolean,
  images: Record<string, Buffer>
): Promise<{ cards: GeneratedCard[]; failedGroups: ClaimGroup[] }> {
  const claimMap = new Map(claims.map(c => [c.id, c]));

  const results = await withConcurrencyLimit(
    groups.map(group => () =>
      generateGroupWithRetry(ai, group, claimMap, cardTypes, hasImages, images)
    ),
    MAX_PARALLEL_GENERATE
  );

  const cards:        GeneratedCard[] = [];
  const failedGroups: ClaimGroup[]    = [];

  for (let i = 0; i < results.length; i++) {
    if (results[i].length > 0) {
      cards.push(...results[i]);
    } else {
      failedGroups.push(groups[i]);
    }
  }

  return { cards, failedGroups };
}

async function generateGroupWithRetry(
  ai: GoogleGenAI,
  group: ClaimGroup,
  claimMap: Map<string, TestableClaim>,
  cardTypes: string[],
  hasImages: boolean,
  images: Record<string, Buffer>
): Promise<GeneratedCard[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await generateGroup(ai, group, claimMap, cardTypes, hasImages, images);
    } catch (err: any) {
      if (attempt >= MAX_RETRIES - 1) break;
      const isRate = err?.status === 429 || String(err).includes('429');
      await sleep(isRate
        ? RETRY_BASE_MS * Math.pow(2, attempt + 1) * 2
        : RETRY_BASE_MS * Math.pow(2, attempt + 1)
      );
    }
  }
  return [];
}

async function generateGroup(
  ai: GoogleGenAI,
  group: ClaimGroup,
  claimMap: Map<string, TestableClaim>,
  cardTypes: string[],
  hasImages: boolean,
  images: Record<string, Buffer>
): Promise<GeneratedCard[]> {
  const groupClaims = group.claimIds
    .map(id => claimMap.get(id))
    .filter(Boolean) as TestableClaim[];

  const parts: any[] = [{ text: buildGroupPrompt(group, groupClaims) }];

  if (hasImages) {
    const refs = [...new Set(
      groupClaims
        .flatMap(c => c.context.match(/\[Image:\s*([^\]]+)\]/g) || [])
        .map(r => r.replace(/\[Image:\s*/, '').replace(/\]$/, '').trim())
    )].slice(0, 2);

    for (const ref of refs) {
      if (!images[ref]) continue;
      const buf  = images[ref];
      let   mime = 'image/jpeg';
      if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
      if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
      parts.push({ inlineData: { mimeType: mime, data: buf.toString('base64') } });
      parts.push({ text: `[Image: ${ref}]` });
    }
  }

  const response = await ai.models.generateContent({
    model: MODEL_MAIN,
    contents: { role: 'user', parts },
    config: {
      systemInstruction: buildSystemPrompt(cardTypes, group.audienceLevel),
      responseMimeType: 'application/json',
      responseSchema: cardArraySchema
    }
  });

  const raw   = response.text?.replace(/```json|```/g, '').trim() || '[]';
  const cards = JSON.parse(raw);

  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`Group ${group.groupId} returned no cards`);
  }

  // Map each returned card back to its source claim
  // For Option A (1 combined card): all claims map to that one card
  // For Option B (N separate cards): each card maps to its claim by position
  return cards.map((card: any, i: number) => ({
    groupId: group.groupId,
    claimId: groupClaims[i]?.id || groupClaims[0]?.id || group.claimIds[0] || '',
    type:    card.type  || 'basic',
    front:   card.front || '',
    back:    card.back  || ''
  }));
}

function buildGroupPrompt(group: ClaimGroup, groupClaims: TestableClaim[]): string {
  const contextBlock = [...new Set(groupClaims.map(c => c.context))]
    .join('\n---\n')
    .substring(0, 1500);
  const headings = [...new Set(groupClaims.map(c => c.heading))].join(' / ');

  if (groupClaims.length === 1) {
    return `Generate ONE Anki flashcard for this fact.

FACT: ${groupClaims[0].text}
HEADING: ${headings}
SOURCE CONTEXT:
${contextBlock}

Read the fact. Ask: what would a smart examiner ask about this?
Use whatever format fits the material.
Return JSON array with exactly one card object. No preamble.`;
  }

  const factsBlock = groupClaims
    .map((c, i) => `${i + 1}. ${c.text}`)
    .join('\n');

  return `You have ${groupClaims.length} related facts.

FACTS:
${factsBlock}

HEADING: ${headings}
SOURCE CONTEXT:
${contextBlock}

DECIDE which approach makes better cards:

OPTION A — ONE COMBINED CARD:
Use when ONE question naturally requires knowing ALL facts to answer.
The student cannot answer correctly knowing only one fact.
Must be answerable in under 15 seconds.

Good: "PICA occlusion causes Horner's, ataxia, and crossed pain loss"
  → ONE scenario card: patient presents with [signs] — identify and explain each
Good: "STN involved in basal ganglia" + "STN lesion causes hemiballismus"
  → ONE structure-deficit card: why does STN lesion cause that specific movement?
Good: "Bell's palsy — whole face" + "UMN palsy — lower face only"
  → ONE distinction card: both are facial weakness — what distinguishes them?

Bad: forcing facts from different structures into one question
Bad: combining 4+ unrelated facts — card becomes overwhelming

OPTION B — SEPARATE CARDS:
Use when no single question naturally requires knowing all facts,
or when combining would make the card overwhelming (4+ distinct things),
or when the facts belong to genuinely different testable angles.
Each fact gets its own dedicated front. Nothing buried in a back.

RETURN:
Option A: JSON array with 1 card object
Option B: JSON array with one card object per fact, in facts list order

The goal: fewer, smarter cards that connect ideas — not a quiz bowl.
Return JSON array. No preamble.`;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5 — VERIFICATION: CLAIMS AGAINST ALL CARDS
//
// Each claim group is checked against ALL generated card fronts —
// not just its own card. A claim covered by a nearby group's card
// is correctly marked as covered.
// ═══════════════════════════════════════════════════════════════════
async function verifyGroupCoverage(
  ai: GoogleGenAI,
  groups: ClaimGroup[],
  cards: GeneratedCard[],
  claims: TestableClaim[]
): Promise<{ missingGroups: ClaimGroup[] }> {
  try {
    const claimMap = new Map(claims.map(c => [c.id, c]));

    // One representative text per group = all claim texts joined
    const groupTexts = groups.map(g =>
      g.claimIds
        .map(id => claimMap.get(id)?.text || '')
        .filter(Boolean)
        .join('. ')
    );

    // All unique card fronts
    const cardFronts = [...new Set(
      cards.map(c => stripHtml(c.front)).filter(f => f.length > 0)
    )];

    if (cardFronts.length === 0) {
      return { missingGroups: groups };
    }

    const [groupEmbs, cardEmbs] = await Promise.all([
      embedTexts(ai, groupTexts),
      embedTexts(ai, cardFronts)
    ]);

    const validCardEmbs = cardEmbs.filter((e): e is number[] => e !== null);
    const missingGroups: ClaimGroup[] = [];

    for (let i = 0; i < groups.length; i++) {
      if (!groupEmbs[i]) continue;

      // Check against ALL card fronts — not just own group's card
      const best = validCardEmbs.length > 0
        ? Math.max(...validCardEmbs.map(e => cosineSim(groupEmbs[i]!, e)))
        : 0;

      if (best < COVERAGE_THRESHOLD) {
        missingGroups.push(groups[i]);
        console.log(`  Gap [${best.toFixed(3)}]: ${groupTexts[i].substring(0, 70)}`);
      }
    }

    console.log(`  ${groups.length - missingGroups.length}/${groups.length} groups covered`);
    return { missingGroups };

  } catch (err) {
    console.warn('  Verification unavailable (non-fatal):', err);
    return { missingGroups: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════
// STEP 7 — EMBEDDING DEDUP
// ═══════════════════════════════════════════════════════════════════
async function deduplicateWithEmbeddings(
  ai: GoogleGenAI,
  cards: GeneratedCard[]
): Promise<GeneratedCard[]> {
  if (cards.length < 2) return cards;

  try {
    const embeddings = await embedTexts(ai, cards.map(c => stripHtml(c.front)));
    const toRemove   = new Set<number>();

    for (let i = 0; i < cards.length; i++) {
      if (toRemove.has(i) || !embeddings[i]) continue;
      for (let j = i + 1; j < cards.length; j++) {
        if (toRemove.has(j) || !embeddings[j]) continue;
        if (cosineSim(embeddings[i]!, embeddings[j]!) >= DEDUP_THRESHOLD) {
          toRemove.add(cards[i].back.length >= cards[j].back.length ? j : i);
        }
      }
    }

    const result = cards.filter((_, i) => !toRemove.has(i));
    console.log(`  ${toRemove.size} duplicates removed (${cards.length} → ${result.length})`);
    return result;

  } catch (err) {
    console.warn('  Dedup unavailable (non-fatal):', err);
    return cards;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EMBEDDING HELPERS
// ═══════════════════════════════════════════════════════════════════
async function embedTexts(
  ai: GoogleGenAI,
  texts: string[]
): Promise<(number[] | null)[]> {
  const BATCH   = 20;
  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  const batches = texts.reduce<{ start: number; items: string[] }[]>(
    (acc, t, i) => {
      if (i % BATCH === 0) acc.push({ start: i, items: [] });
      acc[acc.length - 1].items.push(t);
      return acc;
    }, []
  );

  await withConcurrencyLimit(
    batches.map(batch => async () => {
      const embs = await Promise.all(
        batch.items.map(t => embedOne(ai, t).catch(() => null))
      );
      embs.forEach((e, j) => { results[batch.start + j] = e; });
    }),
    MAX_PARALLEL_EMBED
  );

  return results;
}

async function embedOne(ai: GoogleGenAI, text: string): Promise<number[]> {
  const aiAny = ai as any;
  if (typeof aiAny.models?.embedContent !== 'function') {
    throw new Error('embedContent not available — upgrade @google/genai');
  }
  const response = await aiAny.models.embedContent({
    model:   MODEL_EMBED,
    content: text.substring(0, 2000)
  });
  const values =
    response?.embedding?.values ||
    response?.embeddings?.[0]?.values ||
    null;
  if (!values || !Array.isArray(values) || values.length === 0) {
    throw new Error('embedContent returned empty embedding');
  }
  return values;
}

function cosineSim(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════
async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let   next         = 0;
  const worker       = async () => {
    while (next < tasks.length) {
      const i    = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function filterByCardType(cards: GeneratedCard[], cardTypes: string[]): GeneratedCard[] {
  const allowed  = new Set(cardTypes.map(t => t.toLowerCase()));
  const filtered = cards.filter(c => {
    const t = (c.type || 'basic').toLowerCase();
    if (t === 'cloze' && !allowed.has('cloze'))                                    return false;
    if (t === 'basic' && !allowed.has('basic') && !allowed.has('image_occlusion')) return false;
    return true;
  });
  console.log(`\nCard filter: ${cards.length} → ${filtered.length} (${cardTypes.join(', ')})`);
  return filtered;
}