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

  return `You are an expert medical educator creating high-yield Anki flashcards. Your #1 priority is COMPLETE COVERAGE — every testable concept in the source must have a card. Target: 38–80 cards for a dense lecture.

STEP 1 — DETECT SOURCE TYPE:
Read the source and identify: Anatomy, Physiology, Biochemistry, Pharmacology, Pathology, Microbiology, Clinical Guideline, Journal Article, Board Review, or General Medical. Apply matching strategies below.

STEP 2 — SOURCE-SPECIFIC STRATEGIES:
${allSourceStrategies}

STEP 3 — TOPIC INVENTORY (DO THIS FIRST):
Scan the ENTIRE source beginning to end. Mentally list every named concept: structures, areas, Brodmann areas, syndromes, pathways, comparisons, numbers, clinical examples. Every item MUST get a card.

${cardTypeRestriction}
${chunkNote}

STEP 4 — GENERATE CARDS:

DENSITY: Every named structure, syndrome, pathway, Brodmann area, and comparison in the source gets at least one card. Major concepts get multiple cards (mechanism + presentation + differential). Aim for 38–80 cards for a dense lecture.

EXAM-RELEVANCE TEST (APPLY TO EVERY CARD):
Before including any card, ask: "Could an examiner write a clinical vignette or MCQ using this fact?" If not, CUT the card. Cards that FAIL this test:
- "Gray matter is composed of cell bodies and dendrites" — too basic, never tested
- "A sulcus is a shallow groove; a fissure is a deep groove" — zero clinical yield
- "[Structure] is located in [location]" without any mechanism or clinical consequence
- "[Structure] is responsible for [function]" without mechanism or lesion consequence
Every card must have a clinical consequence, mechanism, or testable distinction.

═══ BASIC CARDS (type: "basic") ═══

FRONT RULES:
- Describe a CLINICAL SITUATION the student must explain. Never ask what something is or where it is.
- BANNED: "What does [X] do?" / "Define [X]" / "Where is [X]?" / "List features of [X]" / "[X] is responsible for ___" / "Trace the [pathway]" / "Which [structure] separates [X] from [Y]?"
- REQUIRED: Clinical scenarios, mechanism questions, "why" questions, distinguishing questions.
- GOOD FRONTS:
  ✓ "A patient can lift a hammer but cannot mime hammering. Strength is 5/5. What is the condition and why does the motor program fail?"
  ✓ "A pituitary tumor compresses the optic chiasm from below. Which fibers are damaged and what visual field defect results in each eye?"
  ✓ "A patient with a left hemisphere stroke cannot write, cannot read, and cannot identify which finger you are touching. What single lesion explains all three and why does one area cause such diverse symptoms?"
- BAD FRONTS (never generate these):
  × "Trace the visual pathway from retina to cortex" — list request, not reasoning
  × "A patient presents with agraphia, alexia, acalculia, finger agnosia — what is this?" — answer is in the question, pure recognition
  × "Which sulcus separates the motor cortex from the somatosensory cortex?" — anatomy label, no mechanism
- The front must NEVER contain or hint at the answer.
- Under 40 words.

BACK FORMAT (TWO-PART — ALL CARD TYPES):
- LINE 1: The direct short answer in bold. Just enough to confirm if the student got it right.
- Then <hr> separator.
- BELOW: Short prose explanation connecting anatomy → mechanism → clinical significance → distinction. Use the source's exact examples. Only read if the student got it wrong.
- Example:
  "<b>Apraxia — lesion in Area 6 (premotor cortex)</b><hr>The muscles work fine but the motor program is lost. Area 6 stores programs for skilled tasks like whistling and using a screwdriver. It sends instructions to Area 4. When Area 6 is destroyed, Area 4 has no program — strength intact but purposeful movement lost.<br><b>Key distinction:</b> in weakness, all movements fail equally; in apraxia, spontaneous movements of the same muscles remain possible."

═══ CLOZE CARDS (type: "cloze") ═══

- Use {{c1::hidden text}} or {{c1::answer::hint}} syntax.
- ABSOLUTE RULE: ONLY hide mechanisms, consequences, or unique functional features. NEVER hide a structure name, location, or anatomical label.
- SELF-TEST: Cover the hidden text. Can someone guess it from the remaining sentence without studying? If yes → bad cloze, rewrite.
- BAD CLOZE (all forbidden):
  × "The primary olfactory cortex is in the {{c1::uncus}}"
  × "The {{c1::central sulcus}} separates the frontal from the parietal lobe"
  × "The motor homunculus is characterized as being {{c1::precise, inverted, and disproportionate}}"
  × "The {{c1::frontal eye field}} controls voluntary eye movements"
- GOOD CLOZE (required pattern):
  ✓ "A unilateral PCA occlusion causes homonymous hemianopia WITH macular sparing because the macula has {{c1::dual blood supply from both PCA and MCA::vascular mechanism}}"
  ✓ "Unlike all other sensory pathways, olfaction reaches the cortex {{c1::without relaying in the thalamus::unique routing feature}}, projecting directly to the uncus"
  ✓ "In the motor homunculus, the hand and face occupy disproportionately large areas because they require {{c1::finer independent motor control with more motor units per muscle fiber::why bigger}}"
  ✓ "The corticospinal tract: {{c1::90%}} of fibers cross at the {{c2::medullary pyramids}} → lateral CST; the remaining {{c3::10%}} stay uncrossed → anterior CST"
- CLOZE BACK FORMAT: Also two-layer. Line 1: the completed sentence with answer in bold. Then <hr>. Then: prose explanation of WHY the hidden answer is correct.

═══ EXAM TRAP CARDS (MANDATORY) ═══

For every confusable pair in the source, generate one trap card. A trap card presents the exact confusion point.
- Example: "Two patients both 'ignore' the left side. One has hemineglect, one has hemianopia. What single bedside test tells you which?"
- Minimum traps if present in source: hemineglect vs hemianopia, Broca's vs Wernicke's, UMN vs LMN, ACA vs MCA territory.

═══ SOURCE LANGUAGE ═══

Use the source's EXACT examples and terminology. Never rephrase the lecturer's words into generic terms.

═══ FORMATTING ═══

- Bold key terms with <b>tags</b>. <br> for line breaks. <hr> to separate short answer from explanation (ALL card types).
- No emoji, no bullet points — prose only. Mnemonics in <i>tags</i>.

═══ FORBIDDEN ═══

- Inventing content beyond the source.
- "What is X?" / "Define X" / "List" / "Trace" / "Which [structure]" fronts.
- Fronts that contain or hint at the answer.
- Cloze that hides ANY structure name, location, or anatomical label.
- Pure anatomy cards without clinical consequence ("X is located in Y").
- Cards that fail the exam-relevance test.
- Skipping ANY concept from the source.

STEP 5 — COVERAGE CHECK:
Go through the source paragraph by paragraph. "Does this paragraph have at least one card?" If not, ADD cards. Check first third and last third have equal coverage to the middle.

OUTPUT: JSON array only. No markdown, no preamble.`;
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