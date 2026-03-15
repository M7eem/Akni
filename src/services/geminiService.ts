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
// Step 1  Extract atomic claims       Flash 1M ctx — full document
// Step 2  Classify: testable?         Lite — binary YES/NO, parallel
// Step 3  Consolidate into groups     Flash — groups related claims
//         + detect audience per group Lite — parallel with consolidation
// Step 4  Generate ONE CARD PER CLAIM Flash — parallel
//         Groups share context but every claim gets its own front
// Step 5  Verify claims against       No LLM — cosine similarity
//         ALL cards (not just own)    checks every claim vs every card
// Step 6  Gap fill missing claims     Flash — targeted
// Step 7  Embedding dedup             No LLM — cosine similarity
//
// KEY CHANGE FROM PREVIOUS VERSION:
// Step 4 now generates one card per claim, not one card per group.
// This ensures every fact has a dedicated front — nothing is buried
// in the back of a combined card where verification cannot find it.
// Step 5 checks each claim against ALL cards, not just its group's card.
// ═══════════════════════════════════════════════════════════════════

// ── Models ────────────────────────────────────────────────────────
const MODEL_MAIN  = 'gemini-3-flash-preview';
const MODEL_LITE  = 'gemini-3.1-flash-lite-preview';
const MODEL_EMBED = 'text-embedding-004';

// ── Constants ─────────────────────────────────────────────────────
// THRESHOLDS — calibrated on thalamus deck (89 claims, 27 cards)
// COVERAGE_THRESHOLD 0.775: 85.4% coverage, clean separation between
//   covered (0.782+) and genuinely missing (0.778-)
// DEDUP_THRESHOLD 0.90: conservative — better to keep a near-duplicate
//   than remove a legitimate card. Lower if deck feels too redundant.
const MAX_PARALLEL_CLASSIFY  = 50;
const MAX_PARALLEL_GENERATE  = 20;
const MAX_PARALLEL_EMBED     = 10;
const MAX_RETRIES             = 3;
const RETRY_BASE_MS           = 1000;
const COVERAGE_THRESHOLD      = 0.775; // calibrated empirically
const DEDUP_THRESHOLD         = 0.90;  // calibrated empirically
const MAX_CLAIMS_PER_GROUP    = 5;

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

// Array schema — every group now returns multiple cards (one per claim)
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
const EXTRACT_PROMPT = `You are reading the ENTIRE source document.
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

SPECIAL RULE FOR COMPARISONS AND EXCEPTIONS:
If a sentence describes how X differs from Y, or when a rule does
NOT apply — extract it as its own claim. Never merge it with the
general rule. These facts are most commonly lost otherwise.

Examples to always preserve as separate claims:
  "Bell's palsy affects the entire face; UMN lesion spares the forehead"
  "Smell bypasses the thalamus unlike all other senses"
  "Cerebellar lesions cause ipsilateral signs due to double decussation"
  "The upper facial nucleus receives bilateral input; lower receives contralateral only"

EXAMPLE — atomic splitting:
Source: "PICA occlusion causes ipsilateral Horner's, ataxia,
         and contralateral pain/temperature loss"
Output:
  { "text": "PICA occlusion causes ipsilateral Horner's syndrome",          "heading": "Wallenberg" }
  { "text": "PICA occlusion causes ipsilateral ataxia",                     "heading": "Wallenberg" }
  { "text": "PICA occlusion causes contralateral pain and temperature loss", "heading": "Wallenberg" }

Return JSON array only. No preamble.`;

const CLASSIFY_PROMPT = `Does this sentence contain a testable medical fact?
Testable = named finding, mechanism, number with clinical significance,
comparison, syndrome sign, drug mechanism, pathway step, threshold,
exception, or cause-effect relationship.
Not testable = pure definition without mechanism, transitional phrase,
background with no clinical relevance.
Reply with exactly one word: YES or NO`;

const CONSOLIDATE_PROMPT = `Organize these medical claims into card groups.
Each group shares context for card generation.

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

NOTE: Even when claims are grouped, each claim will get its own
dedicated card front. Grouping only means they share source context.

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
           Failed first-line management.
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

COMBINING: you will receive one fact per card request.
Write the best possible question for THAT specific fact.
Use the shared context for terminology and mechanism detail.

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

  // Step 1: Extract atomic claims
  console.log('\n── Step 1: Extracting claims...');
  const claims = await extractClaims(ai, source, hasImages, images);
  console.log(`  ${claims.length} claims extracted`);
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

  // Step 4: Generate one card per claim (not one per group)
  console.log('\n── Step 4: Generating cards (one per claim)...');
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
  console.log(`  ${allCards.length - deduped.length} duplicates removed`);

  const result = filterByCardType(deduped, cardTypes);
  console.log(`\n✓ Done: ${result.length} cards`);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 1 — EXTRACTION
// ═══════════════════════════════════════════════════════════════════
async function extractClaims(
  ai: GoogleGenAI,
  source: string,
  hasImages: boolean,
  images: Record<string, Buffer>
): Promise<Claim[]> {
  const estimatedOutputTokens = Math.round(source.length / 4 / 8);

  if (estimatedOutputTokens > 50_000) {
    console.log('  Large doc — two halves...');
    const mid   = source.lastIndexOf('\n\n', Math.floor(source.length / 2));
    const split = mid > 0 ? mid : Math.floor(source.length / 2);
    // Sequential — second half offset uses first half count to prevent ID collision
    const a = await extractFromChunk(ai, source.substring(0, split), hasImages, images, 0);
    const b = await extractFromChunk(ai, source.substring(split), hasImages, images, a.length);
    return [...a, ...b];
  }

  return extractFromChunk(ai, source, hasImages, images, 0);
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
      console.warn('  JSON truncated — partial recovery');
    } catch {
      console.warn('  JSON parse failed');
      return [];
    }
  }

  return rawClaims
    .map((c: any, i: number) => ({
      id:      `cl_${String(idOffset + i).padStart(4, '0')}`,
      text:    (c.text    || '').trim(),
      heading: (c.heading || '').trim()
    }))
    .filter(c => c.text.length > 10);
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
  const unassignedCount = claims.filter(c => !assignedIds.has(c.id)).length;
  if (unassignedCount > 0) {
    console.warn(`  ${unassignedCount} unassigned claims — adding as singles`);
  }
  claims
    .filter(c => !assignedIds.has(c.id))
    .forEach((c, i) => {
      groups.push({
        groupId:   `g_u_${i}`,
        claimIds:  [c.id],
        cardType:  'single',
        rationale: 'unassigned'
      });
    });

  // 3b: Audience level per group — parallel Lite calls
  // Include heading in the text for better classification signal
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
// STEP 4 — GENERATION: ONE CARD PER CLAIM
//
// KEY CHANGE: returns GeneratedCard[] (array) not a single card.
// Every claim in a group gets its own dedicated front.
// Groups share source context — that is the only benefit of grouping.
// Nothing is buried in the back of a combined card anymore.
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
      cards.push(...results[i]); // flatten — each group returns multiple cards
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
  return []; // empty array = this group failed all retries
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
    // Dedup first, then slice — Set runs before slice
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
      responseSchema: cardArraySchema // expects array — one card per claim
    }
  });

  const raw   = response.text?.replace(/```json|```/g, '').trim() || '[]';
  const cards = JSON.parse(raw);

  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`Group ${group.groupId} returned no cards`);
  }

  // Map each returned card back to its claim by position
  // Generator is instructed to return cards in same order as facts
  return cards.map((card: any, i: number) => ({
    groupId: group.groupId,
    claimId: groupClaims[i]?.id || groupClaims[0]?.id || group.claimIds[0] || '',
    type:    card.type  || 'basic',
    front:   card.front || '',
    back:    card.back  || ''
  }));
}

function buildGroupPrompt(group: ClaimGroup, groupClaims: TestableClaim[]): string {
  const isSingle     = groupClaims.length === 1;
  const contextBlock = [...new Set(groupClaims.map(c => c.context))]
    .join('\n---\n')
    .substring(0, 1500);
  const headings     = [...new Set(groupClaims.map(c => c.heading))].join(' / ');

  if (isSingle) {
    return `Generate ONE Anki flashcard for this fact.

FACT: ${groupClaims[0].text}
HEADING: ${headings}
SOURCE CONTEXT:
${contextBlock}

Read the fact. Ask: what would a smart examiner ask about this?
Use whatever format fits the material.
Return JSON array with exactly one card object. No preamble.`;
  }

  // Multiple claims — one card per claim, shared context
  const factsBlock = groupClaims
    .map((c, i) => `${i + 1}. ${c.text}`)
    .join('\n');

  return `Generate one Anki flashcard for EACH fact below.
These facts share context — use the context for all cards.

IMPORTANT:
- Do NOT combine facts into one card.
- Do NOT write one card and mention the others in the back.
- Every fact gets its own dedicated front.
- Return cards in the SAME ORDER as the facts list.

FACTS (one card per fact, in this order):
${factsBlock}

HEADING: ${headings}
SHARED SOURCE CONTEXT:
${contextBlock}

Return JSON array — one object per fact, same order.
No preamble.`;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5 — VERIFICATION: CLAIMS AGAINST ALL CARDS
//
// KEY CHANGE: each group's claims are checked against ALL cards,
// not just the card generated by that group. A claim covered by
// a nearby group's card is correctly marked as covered.
// ═══════════════════════════════════════════════════════════════════
async function verifyGroupCoverage(
  ai: GoogleGenAI,
  groups: ClaimGroup[],
  cards: GeneratedCard[],
  claims: TestableClaim[]
): Promise<{ missingGroups: ClaimGroup[] }> {
  try {
    const claimMap = new Map(claims.map(c => [c.id, c]));

    // One text per group = all its claim texts joined
    const groupTexts = groups.map(g =>
      g.claimIds
        .map(id => claimMap.get(id)?.text || '')
        .filter(Boolean)
        .join('. ')
    );

    // All card fronts — deduplicated and filtered
    const cardFronts = [...new Set(
      cards.map(c => stripHtml(c.front)).filter(Boolean)
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

    console.log(`  ${groups.length - missingGroups.length}/${groups.length} groups verified`);
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
          // Keep the card with the longer, more detailed back
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
    throw new Error('embedContent not available on this SDK version — upgrade @google/genai');
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