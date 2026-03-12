import { GoogleGenAI, Type } from '@google/genai';

export async function generateFlashcards(
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[] = ['basic']
) {
  let apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY)?.trim();
  if (apiKey === 'undefined') apiKey = undefined;
  console.log("GeminiService API Key length:", apiKey?.length, "starts with:", apiKey?.substring(0, 4));
  if (!apiKey) throw new Error("API key not set in environment variables");
  const ai = new GoogleGenAI({ apiKey });
  return generateWithClient(ai, text, images, deckName, cardTypes);
}

// ── Models ────────────────────────────────────────────────────────
const MODEL_MAIN   = 'gemini-3-flash-preview';
const MODEL_LITE   = 'gemini-3.1-flash-lite-preview';

// ── Chunking constants ────────────────────────────────────────────
const CHUNK_CHAR_LIMIT = 100_000;
const CHUNK_OVERLAP = 3_000;
const SINGLE_CALL_LIMIT = 200_000;
const CHUNK_BATCH_SIZE = 3;

// ── Card JSON schema (reused everywhere) ──────────────────────────
const cardSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING },
      front: { type: Type.STRING },
      back: { type: Type.STRING }
    },
    required: ['type', 'front', 'back'] as const
  }
};

// ── Pre-detect schema ────────────────────────────────────────────
const preDetectSchema = {
  type: Type.OBJECT,
  properties: {
    audienceLevel: { type: Type.STRING },
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          topic:      { type: Type.STRING },
          discipline: { type: Type.STRING },
          startCue:   { type: Type.STRING },
          strategies: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['topic', 'discipline', 'startCue', 'strategies'] as const
      }
    }
  },
  required: ['audienceLevel', 'segments'] as const
};

// ── Pre-detect prompt ─────────────────────────────────────────────
const preDetectPrompt = `You are analyzing source material to plan Anki flashcard generation.

TASK 1 — AUDIENCE:
Identify the target audience level. Return exactly one of:
"Medical student (Year 1-2)", "Medical student (Year 3-4)", "Resident", "Fellow", "General", "Undergraduate", "Graduate", "Professional"

TASK 2 — SEGMENT THE MATERIAL:
Divide the source into segments. A segment = a distinct conceptual shift (new organ system, new drug class, new process, new topic area).
Do NOT create a segment for every heading or subsection.
A typical lecture has 2–5 segments. Never more than 8 per document.

For each segment return:
- topic: one sentence describing what this segment covers
- discipline: the discipline (Anatomy, Physiology, Pharmacology, Biochemistry, Pathology, Microbiology, Immunology, Clinical Medicine, Radiology, Surgery, Epidemiology, or the best-fit discipline)
- startCue: the first distinctive phrase or sentence where this segment begins in the source
- strategies: a list of question templates specific to THIS segment's content

TASK 3 — STRATEGIES:
For each segment, generate one strategy per DISTINCT TESTABLE ANGLE.
A testable angle is: a mechanism, a clinical consequence, a comparison between two things,
a pathway with steps, a number with clinical context, or an exam trap / common confusion.

RULES FOR STRATEGIES:
- Write strategies as question templates, not topics.
  BAD:  "Broca's area"
  GOOD: "A patient speaks in broken fragments and is frustrated — where is the lesion and why does this specific area produce non-fluent speech?"
- Each strategy must be specific to THIS segment's content — not generic.
- Do NOT pad with extra strategies if the material doesn't warrant them.
- Do NOT truncate — if the segment has 8 distinct testable angles, write 8 strategies.
- The number of strategies is determined entirely by the material.

Return JSON matching the schema. No preamble.`;

// ── Compress source for audit pass ────────────────────────────────
function compressSource(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let prevWasEmpty = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { prevWasEmpty = true; continue; }

    if (
      trimmed.startsWith('#') ||                 // headings
      trimmed.match(/^\*\*|^<b>/) ||             // bold lines
      trimmed.match(/^[A-Z][^a-z]{2,}/) ||       // ALL CAPS lines
      prevWasEmpty                                // first line of each paragraph
    ) {
      result.push(trimmed);
    }
    prevWasEmpty = false;
  }

  return result.join('\n').substring(0, 8000);
}

// ── Build segment strategies block ────────────────────────────────
interface Segment {
  topic: string;
  discipline: string;
  startCue: string;
  strategies: string[];
}

function buildSegmentStrategiesBlock(segments: Segment[]): string {
  return segments.map((seg, i) => `
SEGMENT ${i + 1}: ${seg.topic} [${seg.discipline}]
Begins at: "${seg.startCue}"
Apply these strategies to this segment's content:
${seg.strategies.map((s, j) => `  ${j + 1}. ${s}`).join('\n')}
`).join('\n---\n');
}

// ── Chunking ──────────────────────────────────────────────────────
function splitTextIntoChunks(text: string): string[] {
  if (text.length <= SINGLE_CALL_LIMIT) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHAR_LIMIT, text.length);

    // Try to break at a paragraph boundary
    if (end < text.length) {
      const searchStart = Math.max(end - 500, start);
      const slice = text.substring(searchStart, end);
      const lastBreak = slice.lastIndexOf('\n\n');
      if (lastBreak !== -1) end = searchStart + lastBreak + 2;
    }

    chunks.push(text.substring(start, end));

    if (end >= text.length) break;
    const nextStart = end - CHUNK_OVERLAP;
    start = nextStart > start ? nextStart : end;
  }

  console.log(`Text split into ${chunks.length} chunks (total ${text.length} chars)`);
  return chunks;
}

// ── Build the system prompt ───────────────────────────────────────
function buildSystemPrompt(
  cardTypes: string[],
  segments: Segment[],
  chunkContext?: { chunkIndex: number; totalChunks: number; coveredTopics: string[] }
): string {
  const allowedTypesText = cardTypes.join(', ');
  const noBasicRule = !cardTypes.includes('basic') ? '- Do NOT generate any "basic" type cards. Zero. None.\n' : '';
  const noClozeRule = !cardTypes.includes('cloze') ? '- Do NOT generate any "cloze" type cards. Zero. None.\n' : '';
  const cardTypeRestriction = `ALLOWED CARD TYPES: ${allowedTypesText}. STRICTLY FORBIDDEN to generate any other type.\n${noBasicRule}${noClozeRule}`;

  const chunkNote = chunkContext
    ? `\nYou are processing chunk ${chunkContext.chunkIndex + 1} of ${chunkContext.totalChunks} of a large document.
${chunkContext.coveredTopics.length > 0 ? `Topics already covered by previous chunks (DO NOT re-cover these):\n${chunkContext.coveredTopics.map(t => `- ${t}`).join('\n')}\n` : ''}`
    : '';

  const segmentBlock = buildSegmentStrategiesBlock(segments);

  return `You are an expert educator creating high-yield Anki flashcards. Your #1 priority is COMPLETE COVERAGE — every testable concept in the source must have a card. Target: 38–80 cards for a dense lecture.

STEP 1 — CARD STRATEGIES BY SEGMENT:
Apply each segment's strategies ONLY to the content belonging to that segment. Use the startCue to locate where each segment begins.

${segmentBlock}

For content not clearly belonging to any segment, use scenario-based framing and mechanism questions.

STEP 2 — TOPIC INVENTORY (DO THIS FIRST):
Scan the ENTIRE source beginning to end. Mentally list every named concept: structures, terms, processes, syndromes, pathways, comparisons, numbers, examples. Every item MUST get a card.

${cardTypeRestriction}
${chunkNote}

STEP 3 — GENERATE CARDS:

DENSITY: Every named concept, process, pathway, and comparison in the source gets at least one card. Major concepts get multiple cards from different angles. Aim for 38–80 cards for a dense lecture.

EXAM-RELEVANCE TEST:
Before including any card, ask: "Could an examiner write a question using this fact?" If not, CUT it. Remove:
- Pure definitions without mechanism or consequence
- Labels without clinical/practical significance
- Trivial facts that would never appear on an exam

═══ BASIC CARDS (type: "basic") ═══

FRONT RULES:
- Describe a SITUATION the student must explain. Never ask what something is or where it is.
- BANNED: "What does [X] do?" / "Define [X]" / "Where is [X]?" / "List features of [X]" / "[X] is responsible for ___" / "Trace the [pathway]" / "Which [structure] separates [X] from [Y]?"
- REQUIRED: Scenario-based questions, mechanism questions, "why" questions, distinguishing questions. Frame as situations a student must reason through.
- GOOD FRONTS:
  ✓ "A patient presents with [symptoms]. What is the underlying mechanism and what structure/process is affected?"
  ✓ "Why does [process/lesion] produce [effect] but spare [other function]?"
  ✓ "How do you distinguish [concept A] from [concept B] when they present similarly?"
- BAD FRONTS:
  × "What does [X] do?" — pure recall
  × "A patient presents with [list of diagnostic criteria] — what is this?" — answer is in the question
  × "Which [structure] does [X]?" — too direct
- The front must NEVER contain or hint at the answer.
- Under 40 words.

BACK FORMAT (TWO-PART — ALL CARD TYPES):
- LINE 1: The direct short answer in bold. Just enough to confirm if the student got it right.
- Then <hr> separator.
- BELOW: Short prose explanation connecting the concept → mechanism → significance → distinction from similar concepts. Use the source's exact examples and terminology. Only needed if the student got it wrong.
- Example:
  "<b>Short answer here</b><hr>Explanation connecting the concept to its mechanism, significance, and how it differs from similar concepts. Uses the source's own terminology and examples."

═══ CLOZE CARDS (type: "cloze") ═══

- Use {{c1::hidden text}} or {{c1::answer::hint}} syntax.
- ABSOLUTE RULE: ONLY hide mechanisms, consequences, or unique features. NEVER hide a name, location, or label.
- SELF-TEST: Cover the hidden text. Can someone guess it from the remaining sentence without studying? If yes → rewrite.
- BAD CLOZE (forbidden — these hide labels or are guessable):
  × "The [X] is located in the {{c1::Y}}" — hiding a name
  × "The {{c1::X}} is responsible for Y" — hiding a label
  × "[X] is characterized as being {{c1::A, B, and C}}" — pattern-matchable
- GOOD CLOZE (required — these hide mechanisms):
  ✓ "[Process X] occurs because {{c1::mechanism explanation::hint}}"
  ✓ "Unlike [similar process], [this process] {{c1::distinguishing mechanism::what makes it unique}}"
  ✓ "[Quantitative fact]: {{c1::number}} [units] {{c2::consequence of that number}}"
- CLOZE BACK FORMAT: Also two-layer. Line 1: completed sentence with answer in bold. Then <hr>. Then: prose explanation of WHY the hidden answer is correct.

═══ EXAM TRAP CARDS (MANDATORY) ═══

For every confusable pair in the source, generate one trap card. A trap card presents the exact confusion point — not a side-by-side comparison.
- Example: "Two situations/conditions both share [feature]. One is [A], one is [B]. What single test/finding distinguishes them?"
- Generate at least one trap card per confusable pair found in the source.

═══ SOURCE LANGUAGE ═══

Use the source's EXACT examples and terminology. Never rephrase into generic terms. The original examples are the memory anchors students already have.

═══ FORMATTING ═══

- Bold key terms with <b>tags</b>. <br> for line breaks. <hr> to separate short answer from explanation (ALL card types).
- No emoji, no bullet points — prose only. Mnemonics in <i>tags</i>.

═══ FORBIDDEN ═══

- Inventing content beyond the source.
- "What is X?" / "Define X" / "List" / "Trace" / "Which [X]" fronts.
- Fronts that contain or hint at the answer.
- Cloze that hides ANY name, location, or label.
- Pure definition cards without mechanism or consequence.
- Cards that fail the exam-relevance test.
- Skipping ANY concept from the source.

STEP 4 — COVERAGE CHECK:
Go through the source paragraph by paragraph. "Does this paragraph have at least one card?" If not, ADD cards. Check first third and last third have equal coverage to the middle.

OUTPUT: JSON array only. No markdown, no preamble.`;
}

// ── Pass 2 Audit prompt builder ───────────────────────────────────
function buildAuditPrompt(compressedSource: string, cardFronts: string, segmentContext: string): string {
  return `You are auditing an Anki deck for coverage gaps.

Below is a compressed version of the source material (headings and key terms only),
followed by a list of card fronts already generated.

The source covers these segments:
${segmentContext}

Your job:
1. Identify every named concept, structure, process, term, pathway, syndrome, statistic,
   comparison, and key point present in the source.
2. Check each one against the existing card fronts.
3. Return ONLY a JSON array of missing topic strings — concepts that have no corresponding card.
   Be specific: not "visual pathway" but "nasal vs temporal fiber crossing at optic chiasm."

If nothing is missing, return [].
Return JSON array of strings only. No preamble.

COMPRESSED SOURCE:
${compressedSource}

EXISTING CARD FRONTS:
${cardFronts}`;
}

// ── Pass 2 Generate prompt builder ────────────────────────────────
function buildGapGeneratePrompt(sourceText: string, missingTopics: string[]): string {
  return `You are generating Anki flashcards for specific missing topics only.

SOURCE MATERIAL:
${sourceText}

MISSING TOPICS — generate exactly one card per topic,
more if the topic has multiple distinct testable angles:
${missingTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Apply these rules:
- Scenario-based fronts, never "What is X?" or "Define X"
- Back: short bold answer + <hr> + prose explanation
- Use source's own examples and terminology
- Bold key terms with <b>tags</b>
- Cloze cards: only hide mechanisms/consequences, never names or labels
- CLOZE BACK FORMAT: Line 1 completed sentence in bold, then <hr>, then explanation

OUTPUT: JSON array only.`;
}

// ── Main generation logic ─────────────────────────────────────────
async function generateWithClient(
  ai: GoogleGenAI,
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[]
) {
  const sourceText = `Deck name: ${deckName}\n\nSource material:\n\n${text}`;

  // ─── Step 1: Pre-detect segments ───
  console.log('Pre-detect: analyzing source structure...');
  let segments: Segment[] = [];
  try {
    const third = Math.floor(text.length / 3);
    const preDetectInput = [
      text.substring(0, 5000),
      text.substring(third, third + 5000),
      text.substring(text.length - 5000)
    ].join('\n...[excerpt]...\n').substring(0, 15000);

    const preDetectResponse = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: { role: 'user', parts: [{ text: preDetectInput }] },
      config: {
        systemInstruction: preDetectPrompt,
        responseMimeType: 'application/json',
        responseSchema: preDetectSchema
      }
    });

    const preDetectText = preDetectResponse.text;
    if (preDetectText) {
      const clean = preDetectText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      segments = parsed.segments || [];
      console.log(`Pre-detect: ${segments.length} segments found, audience: ${parsed.audienceLevel}`);
      for (const seg of segments) {
        console.log(`  - ${seg.topic} [${seg.discipline}] (${seg.strategies.length} strategies)`);
      }
    }
  } catch (err) {
    console.warn('Pre-detect failed (non-fatal), using generic strategies:', err);
  }

  // Fallback: if pre-detect failed or returned no segments
  if (segments.length === 0) {
    segments = [{
      topic: 'General content',
      discipline: 'General',
      startCue: '',
      strategies: [
        'Why does [process/concept] work this way?',
        'How does [concept A] differ from [concept B]?',
        'What is the practical significance of [concept]?'
      ]
    }];
  }

  // ─── Step 2: Pass 1 — Generate main deck ───
  const chunks = splitTextIntoChunks(sourceText);
  const isChunked = chunks.length > 1;

  console.log(`Pass 1 mode: ${isChunked ? `chunked (${chunks.length} chunks)` : 'single-call'}`);

  let allCards: any[] = [];
  const coveredTopics: string[] = [];

  if (!isChunked) {
    console.log('Pass 1: Generating cards (single call)...');
    const systemPrompt = buildSystemPrompt(cardTypes, segments);

    const response = await ai.models.generateContent({
      model: MODEL_MAIN,
      contents: { role: 'user', parts: [{ text: chunks[0] }] },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: cardSchema
      }
    });

    const responseText = response.text;
    if (!responseText) throw new Error("Empty response from Gemini");
    const clean = responseText.replace(/```json|```/g, '').trim();
    allCards = JSON.parse(clean);
    console.log(`Pass 1 complete: ${allCards.length} cards generated`);

  } else {
    for (let batchStart = 0; batchStart < chunks.length; batchStart += CHUNK_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + CHUNK_BATCH_SIZE, chunks.length);
      const batch = chunks.slice(batchStart, batchEnd);

      console.log(`Pass 1 batch ${Math.floor(batchStart / CHUNK_BATCH_SIZE) + 1}/${Math.ceil(chunks.length / CHUNK_BATCH_SIZE)} (chunks ${batchStart + 1}–${batchEnd})...`);

      const batchPromises = batch.map((chunk, i) => {
        const chunkIndex = batchStart + i;
        const systemPrompt = buildSystemPrompt(cardTypes, segments, {
          chunkIndex,
          totalChunks: chunks.length,
          coveredTopics: [...coveredTopics]
        });

        return ai.models.generateContent({
          model: MODEL_MAIN,
          contents: { role: 'user', parts: [{ text: chunk }] },
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseSchema: cardSchema
          }
        }).then(response => {
          const responseText = response.text;
          if (!responseText) return [];
          const clean = responseText.replace(/```json|```/g, '').trim();
          const cards = JSON.parse(clean);
          console.log(`  Chunk ${chunkIndex + 1}: ${cards.length} cards`);
          return cards;
        }).catch(err => {
          console.error(`  Chunk ${chunkIndex + 1} failed:`, err);
          return [];
        });
      });

      const batchResults = await Promise.all(batchPromises);

      for (const cards of batchResults) {
        allCards.push(...cards);
        for (const card of cards) {
          if (card.front) {
            coveredTopics.push(card.front.substring(0, 80).replace(/<[^>]+>/g, ''));
          }
        }
      }
    }

    console.log(`Pass 1 complete: ${allCards.length} total cards`);
  }

  // ─── Step 3: Pass 2 Audit — find coverage gaps ───
  console.log('Pass 2 Audit: checking for coverage gaps...');
  let missingTopics: string[] = [];

  try {
    const compressed = compressSource(text);
    const cardFronts = allCards
      .map((c, i) => `[${i}] ${(c.front || '').replace(/<[^>]+>/g, '').substring(0, 100)}`)
      .join('\n');
    const segmentContext = segments
      .map(s => `- ${s.topic} (${s.discipline})`)
      .join('\n');

    const auditPrompt = buildAuditPrompt(compressed, cardFronts, segmentContext);

    const auditResponse = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: { role: 'user', parts: [{ text: auditPrompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
      }
    });

    const auditText = auditResponse.text;
    if (auditText) {
      const clean = auditText.replace(/```json|```/g, '').trim();
      missingTopics = JSON.parse(clean);
      console.log(`Pass 2 Audit: found ${missingTopics.length} missing topics`);
      for (const topic of missingTopics) {
        console.log(`  - ${topic}`);
      }
    }
  } catch (err) {
    console.warn('Pass 2 Audit failed (non-fatal):', err);
  }

  // ─── Step 4: Pass 2 Generate — fill gaps ───
  if (missingTopics.length > 0) {
    console.log(`Pass 2 Generate: creating cards for ${missingTopics.length} missing topics...`);

    try {
      // Send source text (capped to avoid token overflow) + missing topics
      const cappedSource = text.substring(0, 100000);
      const gapPrompt = buildGapGeneratePrompt(cappedSource, missingTopics);

      const gapResponse = await ai.models.generateContent({
        model: MODEL_MAIN,
        contents: { role: 'user', parts: [{ text: gapPrompt }] },
        config: {
          systemInstruction: buildSystemPrompt(cardTypes, segments),
          responseMimeType: 'application/json',
          responseSchema: cardSchema
        }
      });

      const gapText = gapResponse.text;
      if (gapText) {
        const clean = gapText.replace(/```json|```/g, '').trim();
        const gapCards = JSON.parse(clean);
        console.log(`Pass 2 Generate: ${gapCards.length} gap cards created`);
        allCards.push(...gapCards);
      }
    } catch (err) {
      console.warn('Pass 2 Generate failed (non-fatal):', err);
    }
  } else {
    console.log('Pass 2: no gaps found, skipping generation');
  }

  // ─── Step 5: Deduplication ───
  if (allCards.length > 5) {
    allCards = await deduplicateCards(ai, allCards);
  }

  return filterByCardType(allCards, cardTypes);
}

// ── Lightweight deduplication ─────────────────────────────────────
async function deduplicateCards(ai: GoogleGenAI, cards: any[]): Promise<any[]> {
  console.log('Running deduplication pass...');

  const frontList = cards.map((c, i) => `[${i}] ${c.front?.replace(/<[^>]+>/g, '').substring(0, 100)}`).join('\n');

  const dedupPrompt = `You are deduplicating Anki flashcards. Below is a numbered list of card fronts.
Identify cards that are near-duplicates (testing the same concept with very similar wording).
For each group of duplicates, keep only the BEST one (most specific, best worded).

Return a JSON array of the INDEX NUMBERS to REMOVE (the worse duplicates). If no duplicates, return [].

Card fronts:
${frontList}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: { role: 'user', parts: [{ text: dedupPrompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.INTEGER }
        }
      }
    });

    const responseText = response.text;
    if (!responseText) return cards;

    const clean = responseText.replace(/```json|```/g, '').trim();
    const indicesToRemove = new Set<number>(JSON.parse(clean));

    if (indicesToRemove.size === 0) {
      console.log('Dedup: no duplicates found');
      return cards;
    }

    const deduped = cards.filter((_, i) => !indicesToRemove.has(i));
    console.log(`Dedup: removed ${indicesToRemove.size} duplicates (${cards.length} → ${deduped.length})`);
    return deduped;

  } catch (err) {
    console.warn('Dedup pass failed (non-fatal), returning all cards:', err);
    return cards;
  }
}

// ── Post-processing filter ────────────────────────────────────────
function filterByCardType(cards: any[], cardTypes: string[]): any[] {
  const allowed = new Set(cardTypes.map(t => t.toLowerCase()));
  const filtered = cards.filter(card => {
    const t = (card.type || 'basic').toLowerCase();
    if (t === 'cloze' && !allowed.has('cloze')) return false;
    if (t === 'basic' && !allowed.has('basic') && !allowed.has('image_occlusion')) return false;
    return true;
  });
  console.log(`Card type filter: ${cards.length} → ${filtered.length} cards (allowed: ${cardTypes.join(', ')})`);
  return filtered;
}