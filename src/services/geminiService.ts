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
  const modelPreDetect = 'gemini-3.1-flash-lite-preview';
  const modelPass1 = 'gemini-3-flash-preview';    // Flash — bulk generation, cost efficient
  const modelPass2 = 'gemini-3.1-pro-preview';    // Pro — gap audit, nuanced reasoning

  // Build the strict card type restriction block dynamically
  const allowedTypesText = cardTypes.join(', ');
  const noBasicRule = !cardTypes.includes('basic') ? '- Do NOT generate any "basic" type cards. Zero. None.' : '';
  const noClozeRule = !cardTypes.includes('cloze') ? '- Do NOT generate any "cloze" type cards. Zero. None.' : '';

  const cardTypeRestriction = `ALLOWED CARD TYPES: ${allowedTypesText}. STRICTLY FORBIDDEN to generate any other type.\n${noBasicRule}\n${noClozeRule}`;

  console.log('Gemini Pre-detect: analyzing source...');
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

  const pass1Prompt = `Act as an expert medical educator creating high-yield Anki flashcards.

CONTEXT:
Source Type: ${detectedSourceType}
Audience: ${detectedAudience}
Density: Scale card count to content (15-25 for short, 100-150 for dense). Never pad, never miss high-yield concepts.

${cardTypeRestriction}
${specificInstructions}

CARD RULES:
- BASIC CARDS: Front forces reasoning (never pure recall, "What is X?", or "Define X"). Back gives complete answer + mechanism + clinical consequence. Add essential context not in source so back is self-contained. JSON type: "basic".
- CLOZE CARDS: Use {{c1::hidden text}} or {{c1::answer::hint}}. Hide only the highest-yield word/phrase. Back explains WHY it's correct. The cloze stem must NOT contain the definition of the hidden word. If the stem explains what the answer is, rewrite it as a clinical scenario instead. BAD: '...results in {{c1::apraxia}}, defined as inability to perform learned motor sequences' GOOD: 'Patient mimes using scissors incorrectly despite normal strength. Area 6 damage → {{c1::apraxia}}'. JSON type: "cloze".
- EXTRA FIELD: Include 1+ if they exist: Mnemonic (if well-known), ⭐ (if classic board vignette), or Contrast ("vs [similar concept] — [single key difference]"). If none, leave as "". No special styling (no bold/colors/font sizes), padding, or generic statements.
- Each card covers ONE full concept (what, why/mechanism, clinical meaning, distinctions). Never split concepts.
- Weight toward application, higher-order thinking, mechanisms, distinctions, clinical consequences, exam traps, and exceptions.

FORMATTING:
- Fronts < 40 words.
- Bold key terms with <b>tags</b>.
- Use <br> for line breaks (no raw newlines).
- Spell out abbreviations first use.
- No emoji, no bullet points inside cards.
- Numbers need units and clinical context.

FORBIDDEN:
- Content not in source.
- Definition-only or one-sentence backs.
- Padding or splitting concepts.

AUDIT BEFORE OUTPUT:
Ensure 100% coverage, especially the first 25% of the source. Include every core concept, named structure/drug/organism, cause, complication, treatment, comparison, threshold, eponym, and presentation. Cover common confusions and exceptions.

OUTPUT: JSON array only. No preamble/markdown.`;

  const pass2Prompt = `Act as a medical educator auditing an Anki deck.
Find concepts, mechanisms, facts, values, and clinical points from the source with NO existing card. Generate cards ONLY for these gaps.

ALLOWED CARD TYPES: ${allowedTypesText}.

RULES:
- Do NOT duplicate or regenerate covered concepts.
- Apply Pass 1 rules: Full mechanism in back, no 1-sentence backs, no definition-only, fronts < 40 words, cloze stem must be clinical scenario (not definition), populate 'extra' field, <b> for key terms, <br> for line breaks.
- Look for missing: numbers/thresholds, named structures/drugs/organisms, complications, comparisons, exam traps, and early source content.

If NO gaps, return [].
OUTPUT: JSON array only. No preamble/markdown.`;

  const sourceText = `Deck name: ${deckName}\n\nSource material:\n\n${text}`;

  const pass1Parts = [
    { text: sourceText }
  ];

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

  // ─── PASS 1 ───
  console.log(`Gemini Pass 1: generating cards...`);
  let pass1Cards: any[] = [];

  try {
    const pass1Response = await ai.models.generateContent({
      model: modelPass1,
      contents: { role: 'user', parts: pass1Parts },
      config: {
        systemInstruction: pass1Prompt,
        responseMimeType: 'application/json',
        responseSchema: cardSchema
      }
    });

    const pass1Text = pass1Response.text;
    if (!pass1Text) throw new Error("Empty response from Gemini on Pass 1");
    const clean1 = pass1Text.replace(/```json|```/g, '').trim();
    pass1Cards = JSON.parse(clean1);
    console.log(`Pass 1 complete: ${pass1Cards.length} cards generated`);

  } catch (error) {
    console.error("Pass 1 error:", error);
    throw error;
  }

  // ─── PASS 2 ───
  console.log('Gemini Pass 2: gap filling...');
  let pass2Cards: any[] = [];

  try {
    const pass2TextContent = `
SOURCE:
${sourceText}

PASS 1 CARDS:
${JSON.stringify(pass1Cards, null, 2)}

Identify any concepts, facts, values, or clinical points from the source that have NO card yet, and generate cards for those gaps only.`;

    const pass2Parts = [
      { text: pass2TextContent }
    ];

    const pass2Response = await ai.models.generateContent({
      model: modelPass2,
      contents: { role: 'user', parts: pass2Parts },
      config: {
        systemInstruction: pass2Prompt,
        responseMimeType: 'application/json',
        responseSchema: cardSchema
      }
    });

    const pass2Text = pass2Response.text;
    if (!pass2Text) throw new Error("Empty response from Gemini on Pass 2");
    const clean2 = pass2Text.replace(/```json|```/g, '').trim();
    pass2Cards = JSON.parse(clean2);
    console.log(`Pass 2 complete: ${pass2Cards.length} gap cards generated`);

  } catch (error) {
    console.warn("Pass 2 failed (non-fatal), returning Pass 1 cards only:", error);
    return filterByCardType(pass1Cards, cardTypes);
  }

  const allCards = [...pass1Cards, ...pass2Cards];
  return filterByCardType(allCards, cardTypes);
}

// ─── Post-processing filter — enforces card types regardless of model behavior ───
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