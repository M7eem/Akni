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

// ─────────────────────────────────────────────────────────────────
// MODELS
// ─────────────────────────────────────────────────────────────────
const MODEL_MAIN  = 'gemini-3-flash-preview';
const MODEL_LITE  = 'gemini-3.1-flash-lite-preview';
const MODEL_EMBED = 'text-embedding-004';

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
//
// THRESHOLDS — must be calibrated empirically before production:
// Run pipeline on 5 known decks with ground-truth coverage data.
// Measure false positives (covered flagged as missing) and false
// negatives (missing not flagged) at different threshold values.
// COVERAGE_THRESHOLD: too low = excessive gap fills and extra cards
//                     too high = real gaps slip through undetected
// DEDUP_THRESHOLD:    too low = legitimate distinct cards removed
//                     too high = true duplicates survive dedup
// ─────────────────────────────────────────────────────────────────
const MAX_PARALLEL_CLASSIFY  = 50;
const MAX_PARALLEL_GENERATE  = 20;
const MAX_PARALLEL_EMBED     = 10;
const MAX_RETRIES             = 3;
const RETRY_BASE_MS           = 1000;
const COVERAGE_THRESHOLD      = 0.82; // TODO: calibrate empirically
const DEDUP_THRESHOLD         = 0.90; // TODO: calibrate empirically
const MAX_CLAIMS_PER_GROUP    = 5;

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────
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
  audienceLevel: string; // FIX 3: per-group, not per-deck
}

interface GeneratedCard {
  groupId: string;  // FIX 1: links to group for group-level verification
  claimId: string;
  type:    string;
  front:   string;
  back:    string;
}

// ─────────────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────────────
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

const cardSchema = {
  type: Type.OBJECT,
  properties: {
    type:  { type: Type.STRING },
    front: { type: Type.STRING },
    back:  { type: Type.STRING }
  },
  required: ['type', 'front', 'back'] as const
};

const audienceSchema = {
  type: Type.OBJECT,
  properties: {
    level:     { type: Type.STRING },
    reasoning: { type: Type.STRING }
  },
  required: ['level', 'reasoning'] as const
};

// ─────────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────────
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

EXAMPLE:
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
Each group becomes ONE Anki flashcard.

RULES:
- Every claim must appear in exactly one group. Do not discard any claim.
- Combine claims a student would naturally learn together:
    same concept from different angles
    cause and its clinical effect
    structure and its deficit
    two concepts best learned by comparison
    pathway steps in sequence
- Never combine claims from genuinely different topics.
- Maximum ${MAX_CLAIMS_PER_GROUP} claims per group.
- Groups of 1 are fine.

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

// ─────────────────────────────────────────────────────────────────
// FIX 4: SHORT SYSTEM PROMPT — hard rules at the top, ~350 words
// ─────────────────────────────────────────────────────────────────
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
           What is contraindicated. Management pivot when X changes.
           Richer clinical vignettes with vitals and timeline.
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

COMBINING: if multiple related facts can be answered by ONE question
in under 15 seconds — write that one card.
If it requires knowing 5+ things simultaneously — split it.

OUTPUT: Single JSON object. No preamble.`;
}

// ─────────────────────────────────────────────────────────────────
// MAIN PIPELINE
// ─────────────────────────────────────────────────────────────────
async function run(
  ai: GoogleGenAI,
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[]
): Promise<any[]> {
  const source    = `Deck: ${deckName}\n\n${text}`;
  const hasImages = Object.keys(images).length > 0;
  console.log(`\nSource: ${source.length.toLocaleString()} chars`);

  // Step 1: Extract atomic claims
  console.log('\n── Step 1: Extracting claims...');
  const claims = await extractClaims(ai, source, hasImages, images);
  console.log(`  ${claims.length} claims`);
  if (claims.length === 0) throw new Error('No claims extracted.');

  // Step 2: Classify
  console.log('\n── Step 2: Classifying...');
  const testable = await classifyClaims(ai, claims, source);
  console.log(`  ${testable.length}/${claims.length} testable`);
  if (testable.length === 0) throw new Error('No testable claims.');

  // Step 3: Consolidate + FIX 3: audience level per group
  console.log('\n── Step 3: Consolidating + detecting audience per group...');
  const groups = await consolidateAndClassify(ai, testable);
  console.log(`  ${testable.length} claims → ${groups.length} groups`);

  // Step 4: Generate one card per group
  console.log('\n── Step 4: Generating cards...');
  const { cards, failedGroups } = await generateAllCards(
    ai, groups, testable, cardTypes, hasImages, images
  );
  console.log(`  ${cards.length} cards, ${failedGroups.length} failed`);

  // FIX 1: Group-level verification
  console.log('\n── Step 5: Group-level verification...');
  const { missingGroups } = await verifyGroupCoverage(ai, groups, cards, testable);
  console.log(`  ${missingGroups.length} groups need gap fill`);

  let allCards = [...cards];

  if (missingGroups.length > 0) {
    console.log(`\n── Step 5b: Gap fill — ${missingGroups.length} groups...`);
    const { cards: gapCards } = await generateAllCards(
      ai, missingGroups, testable, cardTypes, hasImages, images
    );
    allCards = [...cards, ...gapCards];
    console.log(`  ${gapCards.length} gap cards`);
  }

  // Step 6: Embedding dedup
  console.log(`\n── Step 6: Dedup (${allCards.length} cards)...`);
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
    // Extract first half first to get its count — use that as offset for second half
    // Prevents ID collision regardless of how many claims the first half produces
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
  // Exact match first
  const idx = source.indexOf(claimText);
  if (idx !== -1) {
    return source.substring(
      Math.max(0, idx - window / 2),
      Math.min(source.length, idx + claimText.length + window / 2)
    );
  }

  // Fuzzy fallback: use a longer anchor (40 chars) to reduce false matches.
  // Short anchors like "the brain receives" match many locations incorrectly.
  const anchorLen  = Math.min(40, claimText.length);
  const anchor     = claimText.substring(0, anchorLen);
  const fuzzyIdx   = source.indexOf(anchor);

  if (fuzzyIdx !== -1) {
    return source.substring(
      Math.max(0, fuzzyIdx - window / 2),
      Math.min(source.length, fuzzyIdx + window)
    );
  }

  // No match — return empty. Generator still has claim text + heading.
  return '';
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3 — CONSOLIDATION + AUDIENCE LEVEL PER GROUP (FIX 3)
//
// Consolidation and audience detection are merged into one step.
// Consolidation produces groups. Audience detection runs on each
// group in parallel immediately after — one Lite call per group.
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

  // Validate IDs — prevent hallucinated IDs and duplicate assignments
  const validIds    = new Set(claims.map(c => c.id));
  const assignedIds = new Set<string>();
  const groups: Omit<ClaimGroup, 'audienceLevel'>[] = [];

  for (let i = 0; i < rawGroups.length; i++) {
    const g             = rawGroups[i];
    const validClaimIds = (g.claimIds || []).filter((id: string) => {
      if (!validIds.has(id))      { console.warn(`  Unknown ID: ${id}`); return false; }
      if (assignedIds.has(id))    { return false; } // already assigned
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

  // Unassigned claims → single groups
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

  // 3b: Detect audience level per group — parallel Lite calls
  const claimMap = new Map(claims.map(c => [c.id, c]));

  const groupsWithLevel = await withConcurrencyLimit(
    groups.map(group => async (): Promise<ClaimGroup> => {
      const groupText = group.claimIds
        .map(id => {
          const claim = claimMap.get(id);
          // Include heading — it often carries the strongest level signal
          // e.g. "Clinical Management of..." vs "Anatomy of..."
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
// STEP 4 — GENERATION
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
    results[i] ? cards.push(results[i]!) : failedGroups.push(groups[i]);
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
): Promise<GeneratedCard | null> {
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
  return null;
}

async function generateGroup(
  ai: GoogleGenAI,
  group: ClaimGroup,
  claimMap: Map<string, TestableClaim>,
  cardTypes: string[],
  hasImages: boolean,
  images: Record<string, Buffer>
): Promise<GeneratedCard> {
  const groupClaims = group.claimIds
    .map(id => claimMap.get(id))
    .filter(Boolean) as TestableClaim[];

  const parts: any[] = [{ text: buildGroupPrompt(group, groupClaims) }];

  if (hasImages) {
    // Dedup first, then slice — otherwise duplicate refs consume the cap
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
      responseSchema: cardSchema
    }
  });

  const raw  = response.text?.replace(/```json|```/g, '').trim() || '{}';
  const card = JSON.parse(raw);

  return {
    groupId: group.groupId,
    claimId: groupClaims[0]?.id || group.claimIds[0] || '',
    type:    card.type  || 'basic',
    front:   card.front || '',
    back:    card.back  || ''
  };
}

function buildGroupPrompt(group: ClaimGroup, groupClaims: TestableClaim[]): string {
  const isSingle     = groupClaims.length === 1;
  const factsBlock   = groupClaims.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
  const contextBlock = [...new Set(groupClaims.map(c => c.context))]
    .join('\n---\n')
    .substring(0, 1500);
  const headings     = [...new Set(groupClaims.map(c => c.heading))].join(' / ');

  const combineNote = isSingle ? '' : `
These facts belong together (${group.cardType}: ${group.rationale}).
Write ONE card testing all of them if one natural question covers all.
If not — focus on the most important fact; address others in the back.
Must be answerable in under 15 seconds.`;

  return `Generate ONE Anki flashcard.
${combineNote}

${isSingle ? `FACT: ${groupClaims[0].text}` : `FACTS:\n${factsBlock}`}
HEADING: ${headings}
SOURCE CONTEXT:
${contextBlock}

Read the fact(s). Ask: what would a smart examiner ask about this?
Use whatever format fits. Return single JSON object. No preamble.`;
}

// ═══════════════════════════════════════════════════════════════════
// FIX 1: GROUP-LEVEL VERIFICATION
//
// Previous system verified individual claims against cards.
// A group card covering 3 claims scored low for 2 of them because
// the front only emphasized one — triggering false gap fills.
//
// This system verifies groups against cards:
// Each group's representative text (all its claim texts joined)
// is compared against the card generated for that group.
// A group is covered if its card front is semantically close to
// the combined meaning of all its claims.
// ═══════════════════════════════════════════════════════════════════
async function verifyGroupCoverage(
  ai: GoogleGenAI,
  groups: ClaimGroup[],
  cards: GeneratedCard[],
  claims: TestableClaim[]
): Promise<{ missingGroups: ClaimGroup[] }> {
  try {
    const claimMap       = new Map(claims.map(c => [c.id, c]));
    const cardByGroupId  = new Map(cards.map(c => [c.groupId, c]));

    // Build representative text per group = all claim texts joined
    const groupRepTexts  = groups.map(g =>
      g.claimIds
        .map(id => claimMap.get(id)?.text || '')
        .filter(Boolean)
        .join('. ')
    );

    // Card fronts aligned to groups (empty string if no card)
    const cardFronts = groups.map(g => {
      const card = cardByGroupId.get(g.groupId);
      return card ? stripHtml(card.front) : '';
    });

    // Groups with no card at all are immediately missing
    const missingGroups: ClaimGroup[] = groups.filter(
      g => !cardByGroupId.has(g.groupId) || !cardByGroupId.get(g.groupId)?.front
    );
    const groupsToVerify = groups.filter(
      g => cardByGroupId.has(g.groupId) && cardByGroupId.get(g.groupId)?.front
    );

    if (groupsToVerify.length === 0) {
      return { missingGroups };
    }

    const verifyTexts  = groupsToVerify.map(g =>
      g.claimIds.map(id => claimMap.get(id)?.text || '').join('. ')
    );
    const verifyFronts = groupsToVerify.map(g =>
      stripHtml(cardByGroupId.get(g.groupId)!.front)
    );

    const [groupEmbs, cardEmbs] = await Promise.all([
      embedTexts(ai, verifyTexts),
      embedTexts(ai, verifyFronts)
    ]);

    for (let i = 0; i < groupsToVerify.length; i++) {
      if (!groupEmbs[i] || !cardEmbs[i]) continue;
      const sim = cosineSim(groupEmbs[i]!, cardEmbs[i]!);
      if (sim < COVERAGE_THRESHOLD) {
        missingGroups.push(groupsToVerify[i]);
      }
    }

    console.log(`  ${groups.length - missingGroups.length}/${groups.length} groups verified`);
    return { missingGroups };

  } catch (err) {
    console.warn('  Group verification unavailable (non-fatal):', err);
    return { missingGroups: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════
// STEP 6 — EMBEDDING DEDUP
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
          toRemove.add(
            cards[i].back.length >= cards[j].back.length ? j : i
          );
        }
      }
    }

    return cards.filter((_, i) => !toRemove.has(i));
  } catch (err) {
    console.warn('  Dedup unavailable:', err);
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
  // embedContent is not in the official GoogleGenAI type definitions at all SDK versions.
  // Cast is required. If this throws, embedTexts catches per-item and returns null —
  // pipeline continues without embeddings rather than crashing.
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