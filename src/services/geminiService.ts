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

// ─── Concurrency limiter (prevents 429 rate limit errors) ───
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;

  const next = () => {
    if (queue.length === 0 || active >= concurrency) return;
    active++;
    const fn = queue.shift()!;
    fn();
  };

  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

// ─── Chunk text with overlap ───
function chunkText(text: string, chunkSize = 5500, overlapRatio = 0.15): string[] {
  const overlap = Math.floor(chunkSize * overlapRatio);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

const sourceTypeInstructions: Record<string, string> = {
  "Anatomy": `
──────────────────────────────────────────────
IF SOURCE IS: Anatomy
──────────────────────────────────────────────
1. "What is the function of X and what is lost when it is damaged?"
2. "Why does damage to X at level Y produce symptom Z?"
3. "How does structure X relate to structure Y anatomically and clinically?"
4. "Trace the pathway of X from origin to termination"
5. "What passes through / supplies / drains X?"
Cloze: hide the structure name, nerve, artery, or level`,
  "Physiology": `
──────────────────────────────────────────────
IF SOURCE IS: Physiology
──────────────────────────────────────────────
1. "Why does X cause Y?" — mechanism and causation
2. "What happens when X is overactive / underactive / absent?"
3. "Trace the pathway of X step by step from trigger to outcome"
4. "How does the body compensate when X is disrupted?"
5. "A patient presents with X — what physiological mechanism explains this?"
Cloze: hide the key mediator, receptor, or outcome value`,
  "Biochemistry or Nutrition": `
──────────────────────────────────────────────
IF SOURCE IS: Biochemistry or Nutrition
──────────────────────────────────────────────
1. "What enzyme catalyzes X and what accumulates if it is deficient?"
2. "Why does deficiency of X cause Y?"
3. "Trace the pathway of X — what is produced at each step?"
4. "What is the rate-limiting step of X and what regulates it?"
5. "How does X differ from Y metabolically?"
Cloze: hide the enzyme name, substrate, product, or cofactor`,
  "Pharmacology or Drug Formulary": `
──────────────────────────────────────────────
IF SOURCE IS: Pharmacology or Drug Formulary
──────────────────────────────────────────────
1. "What is the mechanism of action of X and which step does it target?"
2. "Why does drug X cause side effect Y?"
3. "How does drug X differ from drug Y in mechanism and indication?"
4. "A patient on drug X develops Y — what is happening and why?"
5. "What happens if drug X is given to a patient with condition Y?"
6. "What is the antidote for X toxicity and why does it work?"
Cloze: hide the drug name, mechanism target, or dose threshold`,
  "Pathology": `
──────────────────────────────────────────────
IF SOURCE IS: Pathology
──────────────────────────────────────────────
1. "Why does condition X produce finding Y?"
2. "A patient presents with X — trace the pathophysiology from cause to presentation"
3. "How does type X differ from type Y in mechanism, presentation, and prognosis?"
4. "What is the classic histological or gross finding in X and why does it appear?"
5. "What complication arises from X and what is the mechanism?"
Cloze: hide the pathological finding, marker, or distinguishing feature`,
  "Microbiology or Immunology": `
──────────────────────────────────────────────
IF SOURCE IS: Microbiology or Immunology
──────────────────────────────────────────────
1. "How does organism X evade the immune system?"
2. "Why does infection with X produce symptom Y?"
3. "What is the virulence factor of X and what does it do?"
4. "How does the immune response to X differ from the response to Y?"
5. "A patient with deficiency of X presents with recurrent Y — why?"
Cloze: hide the organism, toxin, immune cell, or cytokine`,
  "Clinical Guideline": `
──────────────────────────────────────────────
IF SOURCE IS: Clinical Guideline
──────────────────────────────────────────────
1. "According to guidelines, what is the first-line treatment for X and why?"
2. "At what threshold does guideline X recommend intervention Y?"
3. "A patient with X, Y, and Z — what does the guideline recommend and why?"
4. "What is the guideline-recommended workup for X?"
5. "How did the recommendation for X change and what evidence drove the change?"
Cloze: hide the threshold value, drug name, or class recommendation`,
  "Journal Article or Research Paper": `
──────────────────────────────────────────────
IF SOURCE IS: Journal Article or Research Paper
──────────────────────────────────────────────
1. "What did the [TRIAL NAME] trial show and what was the clinical implication?"
2. "What was the NNT / NNH / ARR in [TRIAL NAME] and what does it mean?"
3. "Why was [TRIAL NAME] practice-changing?"
4. "What was the study design of [TRIAL NAME] and what are its limitations?"
5. "How did [TRIAL NAME] change the guideline recommendation for X?"
Cloze: hide the trial name, key finding, NNT value, or p-value`,
  "Biostatistics or Epidemiology": `
──────────────────────────────────────────────
IF SOURCE IS: Biostatistics or Epidemiology
──────────────────────────────────────────────
1. "A study reports sensitivity of X% — what does this mean and when would you use this test?"
2. "How does increasing sample size affect the p-value and confidence interval?"
3. "What is the difference between type I and type II error in clinical terms?"
4. "A screening test has high specificity but low sensitivity — in what scenario is it useful?"
5. "How does relative risk differ from absolute risk reduction — give a clinical example?"
Cloze: hide the statistical term, formula component, or threshold value`,
  "Radiology or Imaging": `
──────────────────────────────────────────────
IF SOURCE IS: Radiology or Imaging
──────────────────────────────────────────────
1. "What is the pathognomonic imaging finding in X and why does it appear?"
2. "How does X appear on CT vs MRI vs X-ray and why does each modality show it differently?"
3. "How do you distinguish X from Y on imaging — what is the single key differentiating feature?"
4. "What does contrast enhancement / lack of enhancement in X indicate and why?"
5. "A scan shows finding X — what is the most likely diagnosis and what is the mechanism?"
Cloze: hide the imaging finding, modality, or distinguishing feature`,
  "Surgical Atlas or Procedural Guide": `
──────────────────────────────────────────────
IF SOURCE IS: Surgical Atlas or Procedural Guide
──────────────────────────────────────────────
1. "What is step X of procedure Y and what is the anatomical landmark used?"
2. "What complication arises from step X and how is it avoided?"
3. "Why is approach X preferred over approach Y for condition Z?"
4. "What structure is at risk during step X and why?"
5. "Trace the steps of procedure X in order with the key decision at each step"
Cloze: hide the step number, structure name, or instrument used`,
  "Clinical Case or PBL Case": `
──────────────────────────────────────────────
IF SOURCE IS: Clinical Case or PBL Case
──────────────────────────────────────────────
1. "This patient has X, Y, and Z — what is the most likely diagnosis and why?"
2. "Why does this patient's presentation point toward X rather than Y?"
3. "What is the next best step in management and why?"
4. "What does the investigation result tell you and what does it change?"
5. "What complication is this patient at risk for and what is the mechanism?"
Cloze: hide the diagnosis, investigation, or management step`,
  "Board Review Material": `
──────────────────────────────────────────────
IF SOURCE IS: Board Review Material
──────────────────────────────────────────────
1. Extract the teaching point behind each fact — never just memorize the fact
2. "Why is X the answer rather than Y?" — force distinction-based reasoning
3. Convert buzzwords into mechanism questions
4. Flag every classic association and ask why it exists mechanistically
Cloze: hide the high-yield fact, buzzword, or associated finding`,
  "General Medical": `
──────────────────────────────────────────────
IF SOURCE IS: General Medical
──────────────────────────────────────────────
1. Focus on mechanism and clinical consequence.
2. "Why does X happen?"
3. "What is the next best step?"
Cloze: hide the key clinical finding or mechanism.`
};

async function generateWithClient(
  ai: GoogleGenAI,
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[]
) {
  const modelPreDetect = 'gemini-3-flash-preview';  // Flash: pre-detect
  const modelExtract   = 'gemini-3-flash-preview';  // Flash: chunk extraction
  const modelMerge     = 'gemini-3-flash-preview';  // Flash: merge & deduplicate
  const modelGenerate  = 'gemini-3.1-pro-preview';  // Pro: card generation
  const modelAudit     = 'gemini-3.1-pro-preview';  // Pro: gap audit

  const allowedTypesText = cardTypes.join(', ');
  const noBasicRule = !cardTypes.includes('basic') ? '- Do NOT generate any "basic" type cards. Zero. None.' : '';
  const noClozeRule = !cardTypes.includes('cloze') ? '- Do NOT generate any "cloze" type cards. Zero. None.' : '';
  const cardTypeRestriction = `ALLOWED CARD TYPES: ${allowedTypesText}. STRICTLY FORBIDDEN to generate any other type.\n${noBasicRule}\n${noClozeRule}`;

  // ─── PRE-DETECT ───
  console.log('Pre-detect: analyzing source type and audience...');
  let detectedSourceType = "General Medical";
  let detectedAudience = "General";

  try {
    const preDetectPrompt = `
Analyze the following medical text and determine its primary source type and target audience level.
Return a JSON object with two keys:
1. "sourceType": Must be exactly one of: "Anatomy", "Physiology", "Biochemistry or Nutrition", "Pharmacology or Drug Formulary", "Pathology", "Microbiology or Immunology", "Clinical Guideline", "Journal Article or Research Paper", "Biostatistics or Epidemiology", "Radiology or Imaging", "Surgical Atlas or Procedural Guide", "Clinical Case or PBL Case", "Board Review Material", or "General Medical".
2. "audienceLevel": Must be exactly one of: "Medical student (Year 1-2)", "Medical student (Year 3-4)", "Resident", "Fellow", or "General".
`;
    const preDetectSchema = {
      type: Type.OBJECT,
      properties: {
        sourceType: { type: Type.STRING },
        audienceLevel: { type: Type.STRING }
      },
      required: ['sourceType', 'audienceLevel']
    };

    const preDetectResponse = await ai.models.generateContent({
      model: modelPreDetect,
      contents: { role: 'user', parts: [{ text: text.substring(0, 15000) }] },
      config: {
        systemInstruction: preDetectPrompt,
        responseMimeType: 'application/json',
        responseSchema: preDetectSchema
      }
    });

    const preDetectText = preDetectResponse.text;
    if (preDetectText) {
      const parsed = JSON.parse(preDetectText.replace(/```json|```/g, '').trim());
      if (parsed.sourceType) detectedSourceType = parsed.sourceType;
      if (parsed.audienceLevel) detectedAudience = parsed.audienceLevel;
    }
    console.log(`Pre-detect complete: ${detectedSourceType} for ${detectedAudience}`);
  } catch (error) {
    console.warn("Pre-detect failed, defaulting to General Medical:", error);
  }

  const specificInstructions = sourceTypeInstructions[detectedSourceType] || sourceTypeInstructions["General Medical"];

  // ─── STEP 1: CHUNK & EXTRACT (parallel, rate-limited) ───
  console.log('Step 1: Chunking and extracting facts in parallel...');

  const chunks = chunkText(text, 5500, 0.15);
  console.log(`Split into ${chunks.length} chunk(s)`);

  const limit = pLimit(5);

  const extractionPrompt = `You are a medical knowledge extractor. Read this chunk of medical source material and extract every high-yield fact, mechanism, clinical point, threshold value, named entity (drug/organism/structure), complication, treatment, comparison, and exception.

Output a dense bullet-point list. Each bullet must be self-contained and specific. Include:
- Mechanisms (why something happens, step by step)
- Numbers and thresholds with units and clinical context
- Cause → effect relationships
- Named structures, drugs, organisms, enzymes, receptors
- Clinical consequences and complications
- Comparisons and distinctions between similar concepts
- Exceptions and exam traps
- Eponyms and classic associations

Rules:
- One fact per bullet point
- Be exhaustive — a missed fact here means a missing flashcard later
- Do NOT write prose or full paragraphs
- Do NOT generate flashcards or JSON
- Do NOT summarize or compress — capture every detail`;

  const chunkExtractions = await Promise.all(
    chunks.map((chunk, i) =>
      limit(async () => {
        console.log(`  Extracting chunk ${i + 1}/${chunks.length}...`);
        try {
          const response = await ai.models.generateContent({
            model: modelExtract,
            contents: { role: 'user', parts: [{ text: chunk }] },
            config: { systemInstruction: extractionPrompt }
          });
          return response.text || '';
        } catch (err) {
          console.warn(`  Chunk ${i + 1} extraction failed:`, err);
          return '';
        }
      })
    )
  );

  const rawMasterOutline = chunkExtractions.filter(Boolean).join('\n\n');
  const rawBulletCount = rawMasterOutline.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•')).length;
  console.log(`Step 1 complete: ${rawBulletCount} raw bullet points extracted`);

  // ─── STEP 2: MERGE & DEDUPLICATE ───
  console.log('Step 2: Merging and deduplicating into Master Outline...');

  const mergePrompt = `You are a medical knowledge organizer. You have a large collection of bullet points extracted from overlapping chunks of a medical source. There are duplicates and fragmented facts about the same concept spread across bullets due to chunking overlap.

Your task:
1. Remove exact and near-exact duplicate bullets.
2. Merge related bullets about the same concept into one comprehensive bullet — e.g. if Drug X appears across 3 bullets covering mechanism, side effects, and contraindications, merge them into one rich bullet covering all three.
3. Preserve every unique fact, number, threshold, named entity, and clinical point. Do NOT summarize, compress, or drop any detail.
4. Group related concepts together for logical flow.
5. Output the result as a clean, deduplicated, well-organized bullet-point Master Outline.

Do NOT generate flashcards. Output only the organized bullet list.`;

  let masterOutline = rawMasterOutline;

  try {
    const mergeResponse = await ai.models.generateContent({
      model: modelMerge,
      contents: { role: 'user', parts: [{ text: rawMasterOutline }] },
      config: { systemInstruction: mergePrompt }
    });
    masterOutline = mergeResponse.text || rawMasterOutline;
    const mergedLineCount = masterOutline.split('\n').filter(Boolean).length;
    console.log(`Step 2 complete: Master Outline has ${mergedLineCount} lines`);
  } catch (error) {
    console.warn('Step 2 merge failed, using raw outline:', error);
  }

  // ─── STEP 3: CARD GENERATION ───
  console.log('Step 3: Generating Anki flashcards from Master Outline...');

  const cardSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        type:  { type: Type.STRING },
        front: { type: Type.STRING },
        back:  { type: Type.STRING },
        extra: { type: Type.STRING }
      },
      required: ['type', 'front', 'back', 'extra']
    }
  };

  const generatePrompt = `Act as an expert medical educator creating high-yield Anki flashcards.

CONTEXT:
Source Type: ${detectedSourceType}
Audience: ${detectedAudience}
Deck: ${deckName}
Density: Scale card count to content (15-25 for short outlines, 150-400 for dense ones). Never pad, never miss a bullet.

${cardTypeRestriction}
${specificInstructions}

CARD RULES:
- BASIC CARDS: Front forces reasoning (never pure recall, never "What is X?" or "Define X"). Back gives complete answer + mechanism + clinical consequence. Add essential context so the back is fully self-contained without the source. JSON type: "basic".
- CLOZE CARDS: Use {{c1::hidden text}} or {{c1::answer::hint}}. Hide only the highest-yield word or phrase. Back explains WHY it is correct. The cloze stem must NOT define the hidden word — rewrite as a clinical scenario instead. BAD: '...results in {{c1::apraxia}}, defined as inability to perform learned motor sequences'. GOOD: 'Patient mimes using scissors incorrectly despite normal strength — Area 6 damage → {{c1::apraxia}}'. JSON type: "cloze".
- EXTRA FIELD: Include any of: Mnemonic (if well-known), ⭐ (if classic board vignette), Contrast ("vs [similar concept] — [single key difference]"). If none apply, leave as "". No bold, colors, or font styling. No generic filler statements.
- Each card covers ONE complete concept (what, why/mechanism, clinical meaning, distinctions). Never split a concept across cards.
- Weight toward: mechanisms, clinical application, higher-order reasoning, distinctions, consequences, exam traps, exceptions.

FORMATTING:
- Fronts < 40 words.
- Bold key terms with <b>tags</b>.
- Use <br> for line breaks (never raw newlines inside fields).
- Spell out abbreviations on first use.
- No emoji, no bullet points inside card fields.
- All numbers must include units and clinical context.

FORBIDDEN:
- Inventing content not present in the Master Outline.
- Definition-only or one-sentence backs.
- Padding or splitting concepts across cards.

COVERAGE REQUIREMENT:
Every bullet in the Master Outline must produce at least one card. Go through the outline top to bottom and ensure complete coverage before outputting.

OUTPUT: JSON array only. No preamble, no markdown, no explanation.`;

  // Split generation into batches if outline is large (dense 100-page sources)
  const OUTLINE_SPLIT_THRESHOLD = 8000; // characters
  let allGeneratedCards: any[] = [];

  const outlineParts = masterOutline.length > OUTLINE_SPLIT_THRESHOLD
    ? [
        masterOutline.slice(0, Math.floor(masterOutline.length / 2)),
        masterOutline.slice(Math.floor(masterOutline.length / 2))
      ]
    : [masterOutline];

  if (outlineParts.length > 1) {
    console.log(`  Outline is large (${masterOutline.length} chars) — splitting generation into ${outlineParts.length} batches`);
  }

  for (let i = 0; i < outlineParts.length; i++) {
    const part = outlineParts[i];
    console.log(`  Generating cards from outline part ${i + 1}/${outlineParts.length}...`);

    try {
      const generateResponse = await ai.models.generateContent({
        model: modelGenerate,
        contents: {
          role: 'user',
          parts: [{ text: `Master Outline (Deck: ${deckName}, Part ${i + 1}/${outlineParts.length}):\n\n${part}` }]
        },
        config: {
          systemInstruction: generatePrompt,
          responseMimeType: 'application/json',
          responseSchema: cardSchema
        }
      });

      const genText = generateResponse.text;
      if (!genText) throw new Error(`Empty response on generation part ${i + 1}`);
      const clean = genText.replace(/```json|```/g, '').trim();
      const partCards = JSON.parse(clean);
      allGeneratedCards = [...allGeneratedCards, ...partCards];
      console.log(`  Part ${i + 1} complete: ${partCards.length} cards`);
    } catch (error) {
      console.error(`  Generation part ${i + 1} failed:`, error);
      if (i === 0) throw error; // fatal only if first part fails
    }
  }

  console.log(`Step 3 complete: ${allGeneratedCards.length} cards generated`);

  // ─── STEP 4: GAP AUDIT ───
  console.log('Step 4: Auditing for missed concepts...');

  const auditPrompt = `Act as a medical educator auditing an Anki deck for coverage gaps.

You will receive:
1. A Master Outline of concentrated medical facts (the source of truth)
2. A deck of already generated Anki cards

Your task: Identify every concept, fact, mechanism, threshold, named entity, complication, comparison, or clinical point in the Master Outline that has NO adequate card in the existing deck. Generate cards ONLY for these gaps.

${cardTypeRestriction}

RULES:
- Do NOT duplicate or regenerate concepts already covered.
- Apply all card rules: full mechanism in back, no one-sentence backs, no definition-only cards, fronts < 40 words, cloze stems must be clinical scenarios not definitions, populate extra field where applicable, <b> for key terms, <br> for line breaks.
- Look especially for: numbers and thresholds, named structures/drugs/organisms, complications, comparisons, exam traps, and any bullets that produced zero cards.

If there are NO gaps, return [].
OUTPUT: JSON array only. No preamble, no markdown.`;

  let auditCards: any[] = [];

  try {
    const auditInput = `MASTER OUTLINE:\n${masterOutline}\n\nEXISTING CARDS:\n${JSON.stringify(allGeneratedCards, null, 2)}`;

    const auditResponse = await ai.models.generateContent({
      model: modelAudit,
      contents: { role: 'user', parts: [{ text: auditInput }] },
      config: {
        systemInstruction: auditPrompt,
        responseMimeType: 'application/json',
        responseSchema: cardSchema
      }
    });

    const auditText = auditResponse.text;
    if (!auditText) throw new Error("Empty response on gap audit");
    const cleanAudit = auditText.replace(/```json|```/g, '').trim();
    auditCards = JSON.parse(cleanAudit);
    console.log(`Step 4 complete: ${auditCards.length} gap cards added`);
  } catch (error) {
    console.warn('Step 4 gap audit failed (non-fatal), returning generation cards only:', error);
  }

  const allCards = [...allGeneratedCards, ...auditCards];
  console.log(`Pipeline complete: ${allCards.length} total cards before type filter`);
  return filterByCardType(allCards, cardTypes);
}

// ─── Post-processing filter — hard enforces allowed card types ───
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