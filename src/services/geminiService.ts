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

// ── Audit / gap-fill / dedup constants ────────────────────────────
const AUDIT_CHUNK_SIZE = 30_000;
const MAX_IMAGES_PER_CHUNK = 8;
const DEDUP_WINDOW_SIZE = 50;
const DEDUP_WINDOW_OVERLAP = 10;
const MAX_MERGED_SEGMENTS = 12;

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

// ── Collect images referenced in a text chunk ─────────────────────
function collectChunkImages(
  chunkText: string,
  images: Record<string, Buffer>,
  maxImages: number = MAX_IMAGES_PER_CHUNK
): { name: string; buffer: Buffer; mimeType: string }[] {
  const refs = chunkText.match(/\[IMAGE:\s*([^\]]+)\]/g) || [];
  const result: { name: string; buffer: Buffer; mimeType: string }[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    if (result.length >= maxImages) break;
    const name = ref.replace(/\[IMAGE:\s*/, '').replace(/\]$/, '').trim();
    if (seen.has(name) || !images[name]) continue;
    seen.add(name);

    const buf = images[name];
    let mimeType = 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) mimeType = 'image/png';
    else if (buf[0] === 0x47 && buf[1] === 0x49) mimeType = 'image/gif';

    result.push({ name, buffer: buf, mimeType });
  }
  return result;
}

// ── Build multimodal content parts ────────────────────────────────
function buildMultimodalParts(
  text: string,
  chunkImages: { name: string; buffer: Buffer; mimeType: string }[]
): any[] {
  const parts: any[] = [{ text }];
  for (const img of chunkImages) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.buffer.toString('base64')
      }
    });
    parts.push({ text: `[The above image is: ${img.name}]` });
  }
  return parts;
}

// ── Split text into audit-sized chunks ────────────────────────────
function splitIntoAuditChunks(text: string): string[] {
  if (text.length <= AUDIT_CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + AUDIT_CHUNK_SIZE, text.length);
    if (end < text.length) {
      const searchStart = Math.max(end - 500, start);
      const slice = text.substring(searchStart, end);
      const lastBreak = slice.lastIndexOf('\n\n');
      if (lastBreak !== -1) end = searchStart + lastBreak + 2;
    }
    chunks.push(text.substring(start, end));
    start = end;
  }
  return chunks;
}

// ── Merge and deduplicate segments from hierarchical pre-detect ───
function mergeSegments(segments: Segment[]): Segment[] {
  if (segments.length <= MAX_MERGED_SEGMENTS) return segments;
  const merged: Segment[] = [];
  const used = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    const current = { ...segments[i], strategies: [...segments[i].strategies] };
    used.add(i);

    const currentWords = new Set(current.topic.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;
      const otherWords = segments[j].topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = otherWords.filter(w => currentWords.has(w)).length;
      const similarity = overlap / Math.max(currentWords.size, otherWords.length, 1);
      if (similarity > 0.4) {
        current.strategies.push(...segments[j].strategies);
        used.add(j);
      }
    }
    current.strategies = [...new Set(current.strategies)];
    merged.push(current);
    if (merged.length >= MAX_MERGED_SEGMENTS) break;
  }
  return merged;
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
  chunkContext?: { chunkIndex: number; totalChunks: number; coveredTopics: string[] },
  hasImages?: boolean
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

  return `You are an expert educator creating high-yield Anki flashcards. Your #1 priority is COMPLETE COVERAGE — every testable concept in the source must have a card. The number of cards is determined entirely by the material, not by any target.

STEP 1 — CARD STRATEGIES BY SEGMENT:
Apply each segment's strategies ONLY to the content belonging to that segment. Use the startCue to locate where each segment begins.

${segmentBlock}

For content not clearly belonging to any segment, use scenario-based framing and mechanism questions.

STEP 2 — TOPIC INVENTORY (DO THIS FIRST):
Scan the ENTIRE source beginning to end. Mentally list every named concept: structures, terms, processes, syndromes, pathways, comparisons, numbers, examples. Every item MUST get a card.

${cardTypeRestriction}
${chunkNote}
${hasImages ? `═══ IMAGES & DIAGRAMS ═══

Images from the source material are provided alongside the text. Examine them carefully and create cards about:
- Labeled structures visible in diagrams and anatomical illustrations
- Relationships shown in flowcharts, pathways, or concept maps
- Data or comparisons presented in tables, graphs, or charts
- Key visual features that are clinically or academically testable
Reference the visual content in your card text (describe what is shown) but do NOT include image file names or URLs in the card output.

` : ''}

STEP 3 — GENERATE CARDS:

COMPLETE COVERAGE: Every named concept, process, pathway, and comparison in the source gets at least one card. Major concepts get multiple cards from different angles. Generate as many cards as the material requires — no more, no less.

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
- BELOW: Short prose explanation connecting the concept → mechanism → significance → distinction from similar concepts. Use the source's own terminology, examples, and mnemonics exactly as written. If the source provides specific examples or analogies, preserve them — these are the student's memory anchors. Never replace source terminology with generic paraphrases.
- Example:
  "<b>Short answer here</b><hr>Explanation connecting the concept to its mechanism, significance, and how it differs from similar concepts. Uses the source's own terminology and examples."

═══ CLOZE CARDS (type: "cloze") ═══

- Use {{c1::hidden text}} or {{c1::answer::hint}} syntax.

MECHANICAL RULE — MAXIMUM 4 WORDS HIDDEN:
Hide only the single keyword or short phrase (1–4 words) that is the testable answer.
Everything else stays visible as context.
If your hidden text is longer than 4 words — STOP. Rewrite the sentence.
Find the one word or short phrase that IS the answer and hide only that.

WHAT TO HIDE (1–4 words only):
- A number with clinical significance: {{c1::90%}}
- A direction or laterality: {{c1::contralateral}}
- A one-word consequence: {{c1::non-fluent}}
- A 2–4 word mechanism label: {{c1::decussates at the pyramids}}

NEVER HIDE:
- More than 4 words — ever
- A full sentence or clause
- A name or label (postcentral gyrus, Broca's area)
- A location (in the frontal lobe, anterior to the central sulcus)

GOOD CLOZE:
  ✓ "{{c1::90%}} of CST fibers decussate at the medullary pyramids"
  ✓ "MCA stroke affects the {{c1::face and upper limb}} because the lateral cortex houses those motor maps"
  ✓ "Wernicke's aphasia produces {{c1::fluent}} but nonsensical speech"
  ✓ "Damage to the optic chiasm causes {{c1::bitemporal}} hemianopia"
  ✓ "The FEF drives eyes {{c1::contralaterally}}, so a destructive lesion causes gaze deviation {{c2::ipsilaterally}}"

BAD CLOZE:
  × "The CST crosses because {{c1::the majority of fibers decussate at the medullary pyramids to enable contralateral motor control}}" — full sentence hidden
  × "Damage causes {{c1::non-fluent speech with intact comprehension and patient frustration}}" — full sentence hidden
  × "The {{c1::postcentral gyrus}} processes somatosensory input" — hides a name
  × "The {{c1::primary motor cortex}} is responsible for voluntary movement" — hides a label

CLOZE BACK FORMAT:
Line 1: full sentence with the answer filled in, in bold.
Then <hr>.
Then: one sentence explaining WHY that specific answer is correct.

═══ EXAM TRAP CARDS ═══

// FIX 2: Changed from MANDATORY to conditional.
// Weakness: forcing trap cards on material with no genuine confusable pairs
// (embryology, biostatistics, anatomy atlases) caused the model to invent
// artificial traps or ignore the rule. Now only generated when pairs exist.
For every confusable pair that genuinely exists in the source, generate one trap card.
A trap card presents the exact confusion point — not a side-by-side comparison.
- Example: "Both A and B share [feature]. What single finding distinguishes them?"
- If the material has no confusable pairs, skip this section entirely.
- Never force a trap card where no genuine confusion exists in the source.

═══ SOURCE LANGUAGE ═══

// FIX 3: Softened source language rule.
// Weakness: "EXACT examples" was misleading for textbooks, review books,
// and research papers where formal terminology IS the correct language.
// The rule now applies correctly to all material types.
Use the source's own terminology, examples, and mnemonics exactly as written.
If the source provides specific examples or analogies, preserve them — these are the student's memory anchors.
Never replace source terminology with generic paraphrases.
For formal sources (textbooks, review books) where no personal examples exist,
use the technical terminology precisely as written — do not simplify or rephrase.

═══ FORMATTING ═══

- Bold key terms with <b>tags</b>. <br> for line breaks. <hr> to separate short answer from explanation (ALL card types).
- No emoji, no bullet points — prose only. Mnemonics in <i>tags</i>.

═══ FORBIDDEN ═══

- Inventing content beyond the source.
- "What is X?" / "Define X" / "List" / "Trace" / "Which [X]" fronts.
- Fronts that contain or hint at the answer.
- Cloze hiding more than 4 words, or hiding any name, location, or label.
- Pure definition cards without mechanism or consequence.
- Cards that fail the exam-relevance test.
- Skipping ANY concept from the source.

STEP 4 — COVERAGE CHECK:
Go through the source paragraph by paragraph. "Does this paragraph have at least one card?" If not, ADD cards. Check first third and last third have equal coverage to the middle.

OUTPUT: JSON array only. No markdown, no preamble.`;
}

// ── Pass 2 Audit prompt builder ───────────────────────────────────
function buildAuditPrompt(sourceChunk: string, cardFronts: string, segmentContext: string): string {
  return `You are auditing an Anki deck for coverage gaps.

Below is a section of the source material,
followed by a list of card fronts already generated.

The source covers these segments:
${segmentContext}

Your job:
1. Identify every named concept, structure, process, term, pathway, syndrome, statistic,
   comparison, and key point present in THIS SECTION of the source.
2. Check each one against the existing card fronts.
3. Return ONLY a JSON array of missing topic strings — concepts that have no corresponding card.
   Be specific: not "visual pathway" but "nasal vs temporal fiber crossing at optic chiasm."

If nothing is missing, return [].
Return JSON array of strings only. No preamble.

SOURCE SECTION:
${sourceChunk}

EXISTING CARD FRONTS:
${cardFronts}`;
}

// ── FIX 4: Gap generate prompt simplified ────────────────────────
// Weakness: buildGapGeneratePrompt had its own redundant and incomplete
// rules list. Gap cards were being generated to a weaker standard than
// Pass 1 cards — missing cloze 4-word rule, updated source language rule,
// and conditional trap card rule. Since buildSystemPrompt is already
// passed as systemInstruction to the gap generate call, the user-facing
// prompt just needs to state the task and defer to the system instruction.
function buildGapGeneratePrompt(sourceText: string, missingTopics: string[]): string {
  return `You are generating Anki flashcards for specific missing topics only.
Apply ALL the same rules from your system instructions — card format, cloze rules, source language, everything.

SOURCE MATERIAL:
${sourceText}

MISSING TOPICS — generate exactly one card per topic,
more if the topic has multiple distinct testable angles:
${missingTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

OUTPUT: JSON array only. No markdown, no preamble.`;
}

// ── Hierarchical pre-detect ───────────────────────────────────────
async function runHierarchicalPreDetect(
  ai: GoogleGenAI,
  text: string,
  chunks: string[]
): Promise<{ segments: Segment[]; audienceLevel: string }> {
  if (chunks.length <= 1) {
    // Short doc: use original approach (sample first/middle/last)
    return runSinglePreDetect(ai, text);
  }

  // Long doc: run pre-detect on each chunk, merge results
  console.log(`Hierarchical pre-detect: analyzing ${chunks.length} chunks...`);
  const allSegments: Segment[] = [];
  let audienceLevel = 'General';

  const preDetectPromises = chunks.map((chunk, i) => {
    const sampleSize = 5000;
    let sample: string;
    if (chunk.length <= sampleSize) {
      sample = chunk;
    } else {
      const half = Math.floor(sampleSize / 2);
      sample = chunk.substring(0, half) + '\n...[excerpt]...\n' + chunk.substring(chunk.length - half);
    }

    return ai.models.generateContent({
      model: MODEL_LITE,
      contents: { role: 'user', parts: [{ text: sample }] },
      config: {
        systemInstruction: preDetectPrompt,
        responseMimeType: 'application/json',
        responseSchema: preDetectSchema
      }
    }).then(response => {
      const respText = response.text;
      if (respText) {
        const clean = respText.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        console.log(`  Pre-detect chunk ${i + 1}: ${parsed.segments?.length || 0} segments, audience: ${parsed.audienceLevel}`);
        return parsed;
      }
      return { segments: [], audienceLevel: 'General' };
    }).catch(err => {
      console.warn(`  Pre-detect chunk ${i + 1} failed:`, err);
      return { segments: [], audienceLevel: 'General' };
    });
  });

  const results = await Promise.all(preDetectPromises);
  for (const result of results) {
    if (result.audienceLevel && result.audienceLevel !== 'General') {
      audienceLevel = result.audienceLevel;
    }
    if (result.segments) {
      allSegments.push(...result.segments);
    }
  }

  const merged = mergeSegments(allSegments);
  console.log(`Hierarchical pre-detect: ${allSegments.length} raw segments → ${merged.length} merged segments`);
  return { segments: merged, audienceLevel };
}

async function runSinglePreDetect(
  ai: GoogleGenAI,
  text: string
): Promise<{ segments: Segment[]; audienceLevel: string }> {
  const third = Math.floor(text.length / 3);
  const preDetectInput = [
    text.substring(0, 5000),
    text.substring(third, third + 5000),
    text.substring(text.length - 5000)
  ].join('\n...[excerpt]...\n').substring(0, 15000);

  const response = await ai.models.generateContent({
    model: MODEL_LITE,
    contents: { role: 'user', parts: [{ text: preDetectInput }] },
    config: {
      systemInstruction: preDetectPrompt,
      responseMimeType: 'application/json',
      responseSchema: preDetectSchema
    }
  });

  const respText = response.text;
  if (respText) {
    const clean = respText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return { segments: parsed.segments || [], audienceLevel: parsed.audienceLevel || 'General' };
  }
  return { segments: [], audienceLevel: 'General' };
}

// ── Chunked audit ─────────────────────────────────────────────────
async function runChunkedAudit(
  ai: GoogleGenAI,
  sourceText: string,
  allCards: any[],
  segments: Segment[]
): Promise<string[]> {
  const auditChunks = splitIntoAuditChunks(sourceText);
  console.log(`Chunked audit: ${auditChunks.length} audit chunks`);

  const cardFronts = allCards
    .map((c, i) => `[${i}] ${(c.front || '').replace(/<[^>]+>/g, '').substring(0, 100)}`)
    .join('\n');
  const segmentContext = segments
    .map(s => `- ${s.topic} (${s.discipline})`)
    .join('\n');

  const allMissing: string[] = [];

  for (let i = 0; i < auditChunks.length; i += 3) {
    const batch = auditChunks.slice(i, i + 3);
    const promises = batch.map((chunk, j) => {
      const auditPrompt = buildAuditPrompt(chunk, cardFronts, segmentContext);
      return ai.models.generateContent({
        model: MODEL_LITE,
        contents: { role: 'user', parts: [{ text: auditPrompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      }).then(response => {
        const respText = response.text;
        if (respText) {
          const clean = respText.replace(/```json|```/g, '').trim();
          const missing: string[] = JSON.parse(clean);
          console.log(`  Audit chunk ${i + j + 1}/${auditChunks.length}: ${missing.length} missing topics`);
          return missing;
        }
        return [] as string[];
      }).catch(err => {
        console.warn(`  Audit chunk ${i + j + 1} failed:`, err);
        return [] as string[];
      });
    });

    const results = await Promise.all(promises);
    for (const missing of results) {
      allMissing.push(...missing);
    }
  }

  const unique = [...new Set(allMissing)];
  console.log(`Chunked audit total: ${allMissing.length} raw → ${unique.length} unique missing topics`);
  return unique;
}

// ── Chunked gap-fill ──────────────────────────────────────────────
async function runChunkedGapFill(
  ai: GoogleGenAI,
  sourceText: string,
  missingTopics: string[],
  cardTypes: string[],
  segments: Segment[]
): Promise<any[]> {
  const sourceChunks = splitIntoAuditChunks(sourceText);
  const topicsByChunk = new Map<number, string[]>();

  for (const topic of missingTopics) {
    const keywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let bestChunk = 0;
    let bestScore = 0;

    for (let i = 0; i < sourceChunks.length; i++) {
      const chunkLower = sourceChunks[i].toLowerCase();
      const score = keywords.filter(kw => chunkLower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestChunk = i;
      }
    }

    if (!topicsByChunk.has(bestChunk)) topicsByChunk.set(bestChunk, []);
    topicsByChunk.get(bestChunk)!.push(topic);
  }

  console.log(`Chunked gap-fill: ${missingTopics.length} topics across ${topicsByChunk.size} chunks`);
  const allGapCards: any[] = [];

  for (const [chunkIndex, topics] of topicsByChunk) {
    try {
      const gapPrompt = buildGapGeneratePrompt(sourceChunks[chunkIndex], topics);
      const response = await ai.models.generateContent({
        model: MODEL_MAIN,
        contents: { role: 'user', parts: [{ text: gapPrompt }] },
        config: {
          systemInstruction: buildSystemPrompt(cardTypes, segments),
          responseMimeType: 'application/json',
          responseSchema: cardSchema
        }
      });

      const respText = response.text;
      if (respText) {
        const clean = respText.replace(/```json|```/g, '').trim();
        const cards = JSON.parse(clean);
        console.log(`  Gap-fill chunk ${chunkIndex + 1}: ${cards.length} cards for ${topics.length} topics`);
        allGapCards.push(...cards);
      }
    } catch (err) {
      console.warn(`  Gap-fill chunk ${chunkIndex + 1} failed:`, err);
    }
  }

  console.log(`Chunked gap-fill complete: ${allGapCards.length} gap cards`);
  return allGapCards;
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
  const hasImages = Object.keys(images).length > 0;

  // ─── Step 1: Pre-detect segments (hierarchical for large docs) ───
  console.log('Pre-detect: analyzing source structure...');
  const chunks = splitTextIntoChunks(sourceText);
  let segments: Segment[] = [];
  try {
    const preDetect = await runHierarchicalPreDetect(ai, text, chunks);
    segments = preDetect.segments;
    console.log(`Pre-detect: ${segments.length} segments found, audience: ${preDetect.audienceLevel}`);
    for (const seg of segments) {
      console.log(`  - ${seg.topic} [${seg.discipline}] (${seg.strategies.length} strategies)`);
    }
  } catch (err) {
    console.warn('Pre-detect failed (non-fatal), using generic strategies:', err);
  }

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

  // ─── Step 2: Pass 1 — Generate main deck (with multimodal) ───
  const isChunked = chunks.length > 1;
  console.log(`Pass 1 mode: ${isChunked ? `chunked (${chunks.length} chunks)` : 'single-call'}${hasImages ? ' [multimodal]' : ''}`);

  let allCards: any[] = [];
  const coveredTopics: string[] = [];

  if (!isChunked) {
    console.log('Pass 1: Generating cards (single call)...');
    const systemPrompt = buildSystemPrompt(cardTypes, segments, undefined, hasImages);

    // Collect images for multimodal input
    const chunkImages = hasImages ? collectChunkImages(chunks[0], images) : [];
    const parts = chunkImages.length > 0
      ? buildMultimodalParts(chunks[0], chunkImages)
      : [{ text: chunks[0] }];

    if (chunkImages.length > 0) {
      console.log(`  Attaching ${chunkImages.length} images as multimodal input`);
    }

    const response = await ai.models.generateContent({
      model: MODEL_MAIN,
      contents: { role: 'user', parts },
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
        }, hasImages);

        // Collect images for this chunk
        const chunkImages = hasImages ? collectChunkImages(chunk, images) : [];
        const parts = chunkImages.length > 0
          ? buildMultimodalParts(chunk, chunkImages)
          : [{ text: chunk }];

        if (chunkImages.length > 0) {
          console.log(`  Chunk ${chunkIndex + 1}: attaching ${chunkImages.length} images`);
        }

        return ai.models.generateContent({
          model: MODEL_MAIN,
          contents: { role: 'user', parts },
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

  // ─── Step 3: Pass 2 Chunked Audit — find coverage gaps ───
  console.log('Pass 2 Chunked Audit: checking for coverage gaps...');
  let missingTopics: string[] = [];

  try {
    missingTopics = await runChunkedAudit(ai, text, allCards, segments);
    for (const topic of missingTopics) {
      console.log(`  - ${topic}`);
    }
  } catch (err) {
    console.warn('Pass 2 Audit failed (non-fatal):', err);
  }

  // ─── Step 4: Pass 2 Chunked Gap-Fill ───
  if (missingTopics.length > 0) {
    console.log(`Pass 2 Gap-Fill: creating cards for ${missingTopics.length} missing topics...`);

    try {
      const gapCards = await runChunkedGapFill(ai, text, missingTopics, cardTypes, segments);
      allCards.push(...gapCards);
    } catch (err) {
      console.warn('Pass 2 Gap-Fill failed (non-fatal):', err);
    }
  } else {
    console.log('Pass 2: no gaps found, skipping generation');
  }

  // ─── Step 5: Sliding-window Deduplication ───
  if (allCards.length > 5) {
    allCards = await deduplicateCards(ai, allCards);
  }

  return filterByCardType(allCards, cardTypes);
}

// ── Sliding-window deduplication ──────────────────────────────────
async function deduplicateCards(ai: GoogleGenAI, cards: any[]): Promise<any[]> {
  console.log(`Running deduplication pass (${cards.length} cards)...`);

  if (cards.length <= DEDUP_WINDOW_SIZE) {
    // Small deck: single pass
    const removals = await getDedupRemovals(ai, cards);
    if (removals.size === 0) {
      console.log('Dedup: no duplicates found');
      return cards;
    }
    const deduped = cards.filter((_, i) => !removals.has(i));
    console.log(`Dedup: removed ${removals.size} duplicates (${cards.length} → ${deduped.length})`);
    return deduped;
  }

  // Large deck: sliding window
  const indicesToRemove = new Set<number>();

  for (let windowStart = 0; windowStart < cards.length; windowStart += DEDUP_WINDOW_SIZE - DEDUP_WINDOW_OVERLAP) {
    const windowEnd = Math.min(windowStart + DEDUP_WINDOW_SIZE, cards.length);
    const windowCards = cards.slice(windowStart, windowEnd);

    console.log(`  Dedup window ${windowStart}–${windowEnd - 1} (${windowCards.length} cards)...`);

    const windowRemovals = await getDedupRemovals(ai, windowCards);
    for (const localIdx of windowRemovals) {
      indicesToRemove.add(windowStart + localIdx);
    }

    if (windowEnd >= cards.length) break;
  }

  if (indicesToRemove.size === 0) {
    console.log('Dedup: no duplicates found');
    return cards;
  }

  const deduped = cards.filter((_, i) => !indicesToRemove.has(i));
  console.log(`Dedup: removed ${indicesToRemove.size} duplicates (${cards.length} → ${deduped.length})`);
  return deduped;
}

async function getDedupRemovals(ai: GoogleGenAI, cards: any[]): Promise<Set<number>> {
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
    if (!responseText) return new Set();

    const clean = responseText.replace(/```json|```/g, '').trim();
    return new Set<number>(JSON.parse(clean));
  } catch (err) {
    console.warn('Dedup window failed (non-fatal):', err);
    return new Set();
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