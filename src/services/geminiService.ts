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

// ── Source-type instruction bank ──────────────────────────────────
const sourceTypeInstructions: Record<string, string> = {
  "Anatomy": `
ANATOMY CARD STRATEGIES:
1. "What is the function of X and what is lost when it is damaged?"
2. "Why does damage to X at level Y produce symptom Z?"
3. "How does structure X relate to structure Y anatomically and clinically?"
4. "Trace the pathway of X from origin to termination"
5. "What passes through / supplies / drains X?"
Cloze: hide the structure name, nerve, artery, or level`,
  "Physiology": `
PHYSIOLOGY CARD STRATEGIES:
1. "Why does X cause Y?" — mechanism and causation
2. "What happens when X is overactive / underactive / absent?"
3. "Trace the pathway of X step by step from trigger to outcome"
4. "How does the body compensate when X is disrupted?"
5. "A patient presents with X — what physiological mechanism explains this?"
Cloze: hide the key mediator, receptor, or outcome value`,
  "Biochemistry or Nutrition": `
BIOCHEMISTRY/NUTRITION CARD STRATEGIES:
1. "What enzyme catalyzes X and what accumulates if it is deficient?"
2. "Why does deficiency of X cause Y?"
3. "Trace the pathway of X — what is produced at each step?"
4. "What is the rate-limiting step of X and what regulates it?"
5. "How does X differ from Y metabolically?"
Cloze: hide the enzyme name, substrate, product, or cofactor`,
  "Pharmacology or Drug Formulary": `
PHARMACOLOGY CARD STRATEGIES:
1. "What is the mechanism of action of X and which step does it target?"
2. "Why does drug X cause side effect Y?"
3. "How does drug X differ from drug Y in mechanism and indication?"
4. "A patient on drug X develops Y — what is happening and why?"
5. "What happens if drug X is given to a patient with condition Y?"
6. "What is the antidote for X toxicity and why does it work?"
Cloze: hide the drug name, mechanism target, or dose threshold`,
  "Pathology": `
PATHOLOGY CARD STRATEGIES:
1. "Why does condition X produce finding Y?"
2. "A patient presents with X — trace the pathophysiology from cause to presentation"
3. "How does type X differ from type Y in mechanism, presentation, and prognosis?"
4. "What is the classic histological or gross finding in X and why does it appear?"
5. "What complication arises from X and what is the mechanism?"
Cloze: hide the pathological finding, marker, or distinguishing feature`,
  "Microbiology or Immunology": `
MICROBIOLOGY/IMMUNOLOGY CARD STRATEGIES:
1. "How does organism X evade the immune system?"
2. "Why does infection with X produce symptom Y?"
3. "What is the virulence factor of X and what does it do?"
4. "How does the immune response to X differ from the response to Y?"
5. "A patient with deficiency of X presents with recurrent Y — why?"
Cloze: hide the organism, toxin, immune cell, or cytokine`,
  "Clinical Guideline": `
CLINICAL GUIDELINE CARD STRATEGIES:
1. "According to guidelines, what is the first-line treatment for X and why?"
2. "At what threshold does guideline X recommend intervention Y?"
3. "A patient with X, Y, and Z — what does the guideline recommend and why?"
4. "What is the guideline-recommended workup for X?"
5. "How did the recommendation for X change and what evidence drove the change?"
Cloze: hide the threshold value, drug name, or class recommendation`,
  "Journal Article or Research Paper": `
JOURNAL ARTICLE CARD STRATEGIES:
1. "What did the [TRIAL NAME] trial show and what was the clinical implication?"
2. "What was the NNT / NNH / ARR in [TRIAL NAME] and what does it mean?"
3. "Why was [TRIAL NAME] practice-changing?"
4. "What was the study design of [TRIAL NAME] and what are its limitations?"
5. "How did [TRIAL NAME] change the guideline recommendation for X?"
Cloze: hide the trial name, key finding, NNT value, or p-value`,
  "Biostatistics or Epidemiology": `
BIOSTATISTICS/EPIDEMIOLOGY CARD STRATEGIES:
1. "A study reports sensitivity of X% — what does this mean and when would you use this test?"
2. "How does increasing sample size affect the p-value and confidence interval?"
3. "What is the difference between type I and type II error in clinical terms?"
4. "A screening test has high specificity but low sensitivity — in what scenario is it useful?"
5. "How does relative risk differ from absolute risk reduction — give a clinical example?"
Cloze: hide the statistical term, formula component, or threshold value`,
  "Radiology or Imaging": `
RADIOLOGY/IMAGING CARD STRATEGIES:
1. "What is the pathognomonic imaging finding in X and why does it appear?"
2. "How does X appear on CT vs MRI vs X-ray and why does each modality show it differently?"
3. "How do you distinguish X from Y on imaging — what is the single key differentiating feature?"
4. "What does contrast enhancement / lack of enhancement in X indicate and why?"
5. "A scan shows finding X — what is the most likely diagnosis and what is the mechanism?"
Cloze: hide the imaging finding, modality, or distinguishing feature`,
  "Surgical Atlas or Procedural Guide": `
SURGICAL/PROCEDURAL CARD STRATEGIES:
1. "What is step X of procedure Y and what is the anatomical landmark used?"
2. "What complication arises from step X and how is it avoided?"
3. "Why is approach X preferred over approach Y for condition Z?"
4. "What structure is at risk during step X and why?"
5. "Trace the steps of procedure X in order with the key decision at each step"
Cloze: hide the step number, structure name, or instrument used`,
  "Clinical Case or PBL Case": `
CLINICAL CASE CARD STRATEGIES:
1. "This patient has X, Y, and Z — what is the most likely diagnosis and why?"
2. "Why does this patient's presentation point toward X rather than Y?"
3. "What is the next best step in management and why?"
4. "What does the investigation result tell you and what does it change?"
5. "What complication is this patient at risk for and what is the mechanism?"
Cloze: hide the diagnosis, investigation, or management step`,
  "Board Review Material": `
BOARD REVIEW CARD STRATEGIES:
1. Extract the teaching point behind each fact — never just memorize the fact
2. "Why is X the answer rather than Y?" — force distinction-based reasoning
3. Convert buzzwords into mechanism questions
4. Flag every classic association and ask why it exists mechanistically
Cloze: hide the high-yield fact, buzzword, or associated finding`,
  "General Medical": `
GENERAL MEDICAL CARD STRATEGIES:
1. Focus on mechanism and clinical consequence.
2. "Why does X happen?"
3. "What is the next best step?"
Cloze: hide the key clinical finding or mechanism.`
};

// ── Chunking constants ────────────────────────────────────────────
const CHUNK_CHAR_LIMIT = 100_000;  // ~25,000 tokens per chunk (flash handles up to 1M context)
const CHUNK_OVERLAP = 3_000;    // overlap between chunks
const SINGLE_CALL_LIMIT = 200_000; // below this, no chunking needed
const CHUNK_BATCH_SIZE = 3;        // concurrent API calls per batch

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

// ── Smart text splitter ───────────────────────────────────────────
function splitTextIntoChunks(text: string): string[] {
  if (text.length <= SINGLE_CALL_LIMIT) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHAR_LIMIT, text.length);

    // If not the last chunk, try to break at a paragraph or section boundary
    if (end < text.length) {
      // Look for a paragraph break (\n\n) near the end
      const searchStart = Math.max(end - 3000, start);
      const searchRegion = text.substring(searchStart, end);

      // Prefer section headers (===, ---, ##), then double newlines
      const sectionBreak = searchRegion.lastIndexOf('\n===');
      const hrBreak = searchRegion.lastIndexOf('\n---');
      const headerBreak = searchRegion.lastIndexOf('\n##');
      const paraBreak = searchRegion.lastIndexOf('\n\n');

      const bestBreak = Math.max(sectionBreak, hrBreak, headerBreak, paraBreak);

      if (bestBreak > 0) {
        end = searchStart + bestBreak + 1; // +1 to include the newline
      }
    }

    chunks.push(text.substring(start, end));

    // Next chunk starts with overlap so context isn't lost at boundaries
    if (end >= text.length) break;
    const nextStart = end - CHUNK_OVERLAP;
    start = nextStart > start ? nextStart : end;
  }

  console.log(`Text split into ${chunks.length} chunks (total ${text.length} chars)`);
  return chunks;
}

// ── Build the system prompt ───────────────────────────────────────
function buildSystemPrompt(cardTypes: string[], chunkContext?: { chunkIndex: number; totalChunks: number; coveredTopics: string[] }): string {
  const allowedTypesText = cardTypes.join(', ');
  const noBasicRule = !cardTypes.includes('basic') ? '- Do NOT generate any "basic" type cards. Zero. None.\n' : '';
  const noClozeRule = !cardTypes.includes('cloze') ? '- Do NOT generate any "cloze" type cards. Zero. None.\n' : '';
  const cardTypeRestriction = `ALLOWED CARD TYPES: ${allowedTypesText}. STRICTLY FORBIDDEN to generate any other type.\n${noBasicRule}${noClozeRule}`;

  const chunkNote = chunkContext
    ? `\nYou are processing chunk ${chunkContext.chunkIndex + 1} of ${chunkContext.totalChunks} of a large document.
${chunkContext.coveredTopics.length > 0 ? `Topics already covered by previous chunks (DO NOT re-cover these):\n${chunkContext.coveredTopics.map(t => `- ${t}`).join('\n')}\n` : ''}`
    : '';

  // All source-type instructions are provided so the model can self-select
  const allSourceStrategies = Object.entries(sourceTypeInstructions)
    .map(([key, val]) => `### ${key}\n${val}`)
    .join('\n\n');

  return `You are an expert medical educator creating high-yield Anki flashcards.

STEP 1 — DETECT SOURCE TYPE:
Read the source material and identify which ONE of these categories best fits:
Anatomy, Physiology, Biochemistry or Nutrition, Pharmacology or Drug Formulary, Pathology, Microbiology or Immunology, Clinical Guideline, Journal Article or Research Paper, Biostatistics or Epidemiology, Radiology or Imaging, Surgical Atlas or Procedural Guide, Clinical Case or PBL Case, Board Review Material, General Medical.

Then apply the matching card strategies below.

STEP 2 — APPLY SOURCE-SPECIFIC STRATEGIES:

${allSourceStrategies}

STEP 3 — GENERATE CARDS:

${cardTypeRestriction}
${chunkNote}

CARD DENSITY: Scale to content density. Target ~3–5 cards per page of dense material (e.g., a 20-page lecture = 60–100 cards). For lighter material, ~2–3 per page. UNDER-GENERATING IS THE WORST POSSIBLE OUTCOME. It is better to produce 20 extra cards than to miss 1 important topic.

STEP 3a — TOPIC EXTRACTION (DO THIS FIRST):
Before generating any cards, scan the ENTIRE source from beginning to end and list every distinct topic, concept, structure, pathway, condition, drug, organism, and clinical point mentioned. Then generate cards for ALL of them. Do NOT skip any section of the source — the beginning, middle, and end must all have equal coverage.

STEP 3b — GENERATE CARDS:

BASIC CARDS (type: "basic"):
- Front MUST test active recall — the student must retrieve the answer from memory, not recognize it from clues in the question.
- ANTI-LEAKAGE RULE: The front must NEVER contain the answer, a synonym of the answer, or enough context to guess without knowing the material. If someone who hasn't studied could guess correctly, the card is too easy.
- Frame fronts as clinical scenarios, mechanism questions, or "why" questions. Examples:
  - "A patient presents with [symptoms]. What is the underlying mechanism?" (not "What does X cause?")
  - "Why does damage to [area] produce [symptom] but spare [other function]?" (not "What does [area] do?")
  - "How would you distinguish [condition A] from [condition B] on exam?" (not "What is condition A?")
- Front must be under 40 words.
- Back MUST include ALL of: (a) direct answer, (b) underlying mechanism or reasoning, (c) clinical consequence or significance, (d) key distinction from similar concepts when relevant.
- Back must be self-contained — a student should understand it without seeing the source.

CLOZE CARDS (type: "cloze"):
- Use {{c1::hidden text}} or {{c1::answer::hint}} syntax.
- Hide ONLY the highest-yield word or phrase per deletion — the part the student MUST actively recall.
- Use multiple cloze deletions (c1, c2) in one card when testing related facts from the same sentence.
- Back explains WHY the hidden answer is correct.
- The surrounding context must NOT make the cloze trivially obvious.

EXAM-READINESS RULES:
- The goal is: a student who masters this deck can answer ANY exam question on this material.
- For each major concept, create cards from multiple angles: mechanism, clinical presentation, diagnosis, differential, complication, exception.
- Include "exam trap" cards — common mistakes or easily confused pairs that examiners love to test.
- Include "clinical vignette" cards — present a scenario and ask for the most likely diagnosis, mechanism, or next step.
- Each card = ONE atomic concept, but the back is comprehensive.
- Cover: mechanisms, comparisons, numbers with units and context, pathways, clinical correlations, classic presentations, exam traps, exceptions, complications.

FORMATTING RULES:
- Bold key terms with <b>tags</b>.
- Use <br> for line breaks (no raw newlines in card content).
- Spell out abbreviations on first use.
- No emoji, no bullet points inside cards.
- Mnemonics in <i>tags</i> at the end of the back.

FORBIDDEN:
- Content invented beyond the source.
- Definition-only or single-sentence backs.
- "What is X?" / "Define X" / "List the features of X" fronts.
- Fronts that contain or paraphrase the answer (answer leakage).
- Padding or splitting one concept across multiple cards.
- SKIPPING ANY SECTION OR TOPIC FROM THE SOURCE. Every paragraph must have at least one card.

STEP 4 — SELF-AUDIT (CRITICAL — ZERO TOLERANCE FOR GAPS):
Before finalizing output, go back through the source PARAGRAPH BY PARAGRAPH and check:
□ Does every paragraph/section have at least one card? If not, ADD cards now.
□ Every named structure, area, gyrus, sulcus, nucleus, tract — does it have a card?
□ Every named drug, organism, enzyme, pathway, receptor — covered?
□ Every numeric value (percentages, thresholds, dosages, statistics) — covered?
□ Every comparison or differential (X vs Y) — addressed?
□ Every clinical consequence, complication, and lesion effect — included?
□ Every exception, contraindication, or exam trap — captured?
□ Is the first 25% of the source equally covered as the rest? (Models tend to skip the beginning)
□ Is the last 25% of the source equally covered? (Models tend to truncate at the end)
If ANY gap is found, you MUST add cards for it. Do NOT finalize with missing topics.

OUTPUT: JSON array only. No markdown fences, no preamble, no commentary.`;
}

// ── Main generation logic ─────────────────────────────────────────
async function generateWithClient(
  ai: GoogleGenAI,
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[]
) {
  const model = 'gemini-3-flash-preview';
  const sourceText = `Deck name: ${deckName}\n\nSource material:\n\n${text}`;
  const chunks = splitTextIntoChunks(sourceText);
  const isChunked = chunks.length > 1;

  console.log(`Generation mode: ${isChunked ? `chunked (${chunks.length} chunks)` : 'single-call'}`);

  let allCards: any[] = [];
  const coveredTopics: string[] = [];

  if (!isChunked) {
    // ─── Single-call mode ───
    console.log('Generating cards (single call)...');
    const systemPrompt = buildSystemPrompt(cardTypes);

    const response = await ai.models.generateContent({
      model,
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
    console.log(`Single-call complete: ${allCards.length} cards generated`);

  } else {
    // ─── Chunked mode ───
    for (let batchStart = 0; batchStart < chunks.length; batchStart += CHUNK_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + CHUNK_BATCH_SIZE, chunks.length);
      const batch = chunks.slice(batchStart, batchEnd);

      console.log(`Processing chunk batch ${Math.floor(batchStart / CHUNK_BATCH_SIZE) + 1}/${Math.ceil(chunks.length / CHUNK_BATCH_SIZE)} (chunks ${batchStart + 1}–${batchEnd})...`);

      const batchPromises = batch.map((chunk, i) => {
        const chunkIndex = batchStart + i;
        const systemPrompt = buildSystemPrompt(cardTypes, {
          chunkIndex,
          totalChunks: chunks.length,
          coveredTopics: [...coveredTopics]
        });

        return ai.models.generateContent({
          model,
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
        // Extract topic summaries (first 60 chars of front) for dedup context
        for (const card of cards) {
          if (card.front) {
            coveredTopics.push(card.front.substring(0, 80).replace(/<[^>]+>/g, ''));
          }
        }
      }
    }

    console.log(`All chunks processed: ${allCards.length} total cards before dedup`);

    // ─── Deduplication pass ───
    allCards = await deduplicateCards(ai, allCards);
  }

  return filterByCardType(allCards, cardTypes);
}

// ── Lightweight deduplication ─────────────────────────────────────
async function deduplicateCards(ai: GoogleGenAI, cards: any[]): Promise<any[]> {
  if (cards.length <= 5) return cards;

  console.log('Running deduplication pass...');

  // Build a compact list of fronts for the model to judge
  const frontList = cards.map((c, i) => `[${i}] ${c.front?.replace(/<[^>]+>/g, '').substring(0, 100)}`).join('\n');

  const dedupPrompt = `You are deduplicating Anki flashcards. Below is a numbered list of card fronts.
Identify cards that are near-duplicates (testing the same concept with very similar wording).
For each group of duplicates, keep only the BEST one (most specific, best worded).

Return a JSON array of the INDEX NUMBERS to REMOVE (the worse duplicates). If no duplicates, return [].

Card fronts:
${frontList}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
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

// ── Post-processing filter — enforces card types regardless of model behavior ──
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