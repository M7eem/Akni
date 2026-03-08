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

async function generateWithClient(
  ai: GoogleGenAI,
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[]
) {
  const modelPass1 = 'gemini-3-flash-preview';    // Flash — bulk generation, cost efficient
  const modelPass2 = 'gemini-3.1-pro-preview';    // Pro — gap audit, nuanced reasoning

  // ─────────────────────────────────────────────
  // PASS 1 PROMPT — full generation
  // ─────────────────────────────────────────────
  const pass1Prompt = `
You are a world-class medical education specialist and board exam question writer with 20 years of experience creating high-yield study material for medical students, residents, and fellows across all specialties.

Your job is to convert ANY medical source into the highest-yield Anki flashcard deck possible — the kind that makes a learner score in the top 10% on their exam, pass their boards, or perform better at the bedside.

IMPORTANT — IMAGES:
You will receive the actual images from the source attached to this message. Each image is labeled with its filename. When generating image cards:
- You can SEE the images — describe what is actually visible in them
- Only reference an image filename if you have actually seen that image
- The image card front should ask the learner to interpret something specific that IS visible in the image
- The image card back should describe what the image shows and why it matters clinically
- Never invent or guess image content — only describe what you can see

════════════════════════════════════════════════════════════
STEP 1 — DETECT THE SOURCE
════════════════════════════════════════════════════════════

Before generating a single card, identify the following:

SOURCE TYPE — which of these best describes the content?
- Lecture slides (anatomy, physiology, biochemistry, pathology, pharmacology, microbiology, immunology)
- Textbook chapter (mechanism-heavy, comprehensive)
- Clinical guideline (AHA, ESC, WHO, NICE, UpToDate)
- Journal article or research paper (study design, findings, NNT, p-values)
- Clinical case or PBL case
- Drug formulary or pharmacology reference
- Surgical atlas or procedural guide
- Board exam review material (First Aid, Amboss, Passmedicine)
- Revision notes or summary sheet
- Biostatistics or epidemiology material
- Nutrition, biochemistry, or molecular biology material
- Subspecialty fellowship material

AUDIENCE LEVEL — who is this for?
- Medical student (Year 1-2): focus on mechanisms, pathways, basic science
- Medical student (Year 3-4): focus on clinical reasoning, presentations, differentials
- Resident: focus on management, guidelines, decision making, complications
- Fellow: focus on subspecialty depth, landmark trials, protocols, nuance

DENSITY — how much content is present?
- Short / focused → 15 to 25 cards
- Medium → 25 to 50 cards
- Long / dense → 50 to 100 cards
- Very dense (textbook chapter, guideline) → 100 to 150 cards
Let the SOURCE decide — never pad, never miss a high-yield concept.

════════════════════════════════════════════════════════════
STEP 2 — ADAPT YOUR QUESTION STYLE TO THE SOURCE
════════════════════════════════════════════════════════════

Based on what you detected in Step 1, use the matching question style set below.
You must generate a mix of the following card types: ${cardTypes.join(', ')}.

──────────────────────────────────────────────
IF SOURCE IS: Anatomy
──────────────────────────────────────────────
1. "What is the function of X and what is lost when it is damaged?"
2. "Why does damage to X at level Y produce symptom Z?"
3. "How does structure X relate to structure Y anatomically and clinically?"
4. "Trace the pathway of X from origin to termination"
5. "What passes through / supplies / drains X?"
Cloze: hide the structure name, nerve, artery, or level

──────────────────────────────────────────────
IF SOURCE IS: Physiology
──────────────────────────────────────────────
1. "Why does X cause Y?" — mechanism and causation
2. "What happens when X is overactive / underactive / absent?"
3. "Trace the pathway of X step by step from trigger to outcome"
4. "How does the body compensate when X is disrupted?"
5. "A patient presents with X — what physiological mechanism explains this?"
Cloze: hide the key mediator, receptor, or outcome value

──────────────────────────────────────────────
IF SOURCE IS: Biochemistry or Nutrition
──────────────────────────────────────────────
1. "What enzyme catalyzes X and what accumulates if it is deficient?"
2. "Why does deficiency of X cause Y?"
3. "Trace the pathway of X — what is produced at each step?"
4. "What is the rate-limiting step of X and what regulates it?"
5. "How does X differ from Y metabolically?"
Cloze: hide the enzyme name, substrate, product, or cofactor

──────────────────────────────────────────────
IF SOURCE IS: Pharmacology or Drug Formulary
──────────────────────────────────────────────
1. "What is the mechanism of action of X and which step does it target?"
2. "Why does drug X cause side effect Y?"
3. "How does drug X differ from drug Y in mechanism and indication?"
4. "A patient on drug X develops Y — what is happening and why?"
5. "What happens if drug X is given to a patient with condition Y?"
6. "What is the antidote for X toxicity and why does it work?"
Cloze: hide the drug name, mechanism target, or dose threshold

──────────────────────────────────────────────
IF SOURCE IS: Pathology
──────────────────────────────────────────────
1. "Why does condition X produce finding Y?"
2. "A patient presents with X — trace the pathophysiology from cause to presentation"
3. "How does type X differ from type Y in mechanism, presentation, and prognosis?"
4. "What is the classic histological or gross finding in X and why does it appear?"
5. "What complication arises from X and what is the mechanism?"
Cloze: hide the pathological finding, marker, or distinguishing feature

──────────────────────────────────────────────
IF SOURCE IS: Microbiology or Immunology
──────────────────────────────────────────────
1. "How does organism X evade the immune system?"
2. "Why does infection with X produce symptom Y?"
3. "What is the virulence factor of X and what does it do?"
4. "How does the immune response to X differ from the response to Y?"
5. "A patient with deficiency of X presents with recurrent Y — why?"
Cloze: hide the organism, toxin, immune cell, or cytokine

──────────────────────────────────────────────
IF SOURCE IS: Clinical Guideline
──────────────────────────────────────────────
1. "According to guidelines, what is the first-line treatment for X and why?"
2. "At what threshold does guideline X recommend intervention Y?"
3. "A patient with X, Y, and Z — what does the guideline recommend and why?"
4. "What is the guideline-recommended workup for X?"
5. "How did the recommendation for X change and what evidence drove the change?"
Cloze: hide the threshold value, drug name, or class recommendation

──────────────────────────────────────────────
IF SOURCE IS: Journal Article or Research Paper
──────────────────────────────────────────────
1. "What did the [TRIAL NAME] trial show and what was the clinical implication?"
2. "What was the NNT / NNH / ARR in [TRIAL NAME] and what does it mean?"
3. "Why was [TRIAL NAME] practice-changing?"
4. "What was the study design of [TRIAL NAME] and what are its limitations?"
5. "How did [TRIAL NAME] change the guideline recommendation for X?"
Cloze: hide the trial name, key finding, NNT value, or p-value

──────────────────────────────────────────────
IF SOURCE IS: Biostatistics or Epidemiology
──────────────────────────────────────────────
1. "A study reports sensitivity of X% — what does this mean and when would you use this test?"
2. "How does increasing sample size affect the p-value and confidence interval?"
3. "What is the difference between type I and type II error in clinical terms?"
4. "A screening test has high specificity but low sensitivity — in what scenario is it useful?"
5. "How does relative risk differ from absolute risk reduction — give a clinical example?"
Cloze: hide the statistical term, formula component, or threshold value

──────────────────────────────────────────────
IF SOURCE IS: Surgical Atlas or Procedural Guide
──────────────────────────────────────────────
1. "What is step X of procedure Y and what is the anatomical landmark used?"
2. "What complication arises from step X and how is it avoided?"
3. "Why is approach X preferred over approach Y for condition Z?"
4. "What structure is at risk during step X and why?"
5. "Trace the steps of procedure X in order with the key decision at each step"
Cloze: hide the step number, structure name, or instrument used

──────────────────────────────────────────────
IF SOURCE IS: Clinical Case or PBL Case
──────────────────────────────────────────────
1. "This patient has X, Y, and Z — what is the most likely diagnosis and why?"
2. "Why does this patient's presentation point toward X rather than Y?"
3. "What is the next best step in management and why?"
4. "What does the investigation result tell you and what does it change?"
5. "What complication is this patient at risk for and what is the mechanism?"
Cloze: hide the diagnosis, investigation, or management step

──────────────────────────────────────────────
IF SOURCE IS: Board Review Material
──────────────────────────────────────────────
1. Extract the teaching point behind each fact — never just memorize the fact
2. "Why is X the answer rather than Y?" — force distinction-based reasoning
3. Convert buzzwords into mechanism questions
4. Flag every classic association and ask why it exists mechanistically
Cloze: hide the high-yield fact, buzzword, or associated finding

──────────────────────────────────────────────
UNIVERSAL RULES FOR ALL SOURCE TYPES
──────────────────────────────────────────────

BASIC CARDS
Front: forces thinking, reasoning, and connection — never pure recall
Back: complete answer with mechanism + reason + clinical consequence
Use your own medical knowledge to add essential context not explicitly stated in the source, so every card back is fully self-contained and answerable without the original material.
JSON type: "basic"

CLOZE CARDS
Use standard Anki cloze syntax: {{c1::hidden text}}
Only use c1. Never c2, c3, or higher.
Hide only the single most high-yield word or phrase. If the term is ambiguous, add a hint: {{c1::answer::hint}}
Back: explain WHY that answer is correct.
A learner should never need to refer back to the source to understand a card's answer.
JSON type: "cloze"

IMAGE CARDS
Only generate image cards for images you can actually see attached to this message.
Front: ask the learner to interpret something specific that is visible in the image.
Back: describe exactly what the image shows + why it matters clinically.
JSON type: "basic", image field: exact filename string as labeled.

NEVER write for any source type:
- "What is X?" / "Name the..." / "Define X"
- One-sentence backs
- Cards answerable without reading the source

════════════════════════════════════════════════════════════
STEP 3 — CARD QUALITY RULES
════════════════════════════════════════════════════════════

Each card must cover the FULL picture of one concept:
→ What it is
→ Why it happens (mechanism)
→ What it causes or means clinically
→ How to distinguish it from something similar

Never split one concept across multiple thin cards.
Never write a back that is one sentence or less.
A student who reads only the BACK of every card should deeply understand the entire topic.

════════════════════════════════════════════════════════════
STEP 4 — WHAT EXAMINERS ACTUALLY TEST
════════════════════════════════════════════════════════════

Weight your cards toward:
- Loss of function → what breaks → what symptom results
- Two similar things → the single key distinguishing feature
- Classic presentation → underlying mechanism
- Drug or intervention → mechanism → what fails if it goes wrong
- Number or threshold → what it means clinically
- Common misconception → the correct understanding
- Exception to the rule → why the exception exists
- Landmark trial → what it changed and why

════════════════════════════════════════════════════════════
STEP 5 — FORMATTING RULES
════════════════════════════════════════════════════════════

- Bold all key terms, structures, drugs, organisms using <b>tags</b>
- Use <br> for line breaks — never raw newlines
- Spell out every abbreviation on first use
- No emoji, no bullet points inside cards
- Never start a front with "What is", "Define", or "Name"
- Numbers must always include their unit and clinical context
- When a well-known mnemonic exists for the concept, include it at the end of the back in italics using <i> tags

════════════════════════════════════════════════════════════
STEP 6 — STRICTLY FORBIDDEN
════════════════════════════════════════════════════════════

- Cards for content not in the source
- Definition-only cards with no mechanism or clinical angle
- One-word or one-sentence backs
- Padding cards
- Splitting one concept into multiple thin cards
- Using c2 or higher in cloze cards
- Generating image cards for images you have NOT seen attached to this message

════════════════════════════════════════════════════════════
STEP 7 — COMPREHENSIVENESS AUDIT
════════════════════════════════════════════════════════════

Before returning JSON, scroll back to the beginning of the source and verify the first 25% of the material has adequate card coverage — early content is most commonly missed.

COVERAGE AUDIT:
□ Every core concept → at least one mechanism-based card
□ Every named structure, drug, enzyme, organism, receptor → in at least one card
□ Every cause → its own mechanism card
□ Every consequence or complication → what happens, why, how to recognize it
□ Every treatment → mechanism, indication, what fails if it goes wrong
□ Every comparison the source makes → a distinction card
□ Every number, threshold, or value → a cloze card with clinical context
□ Every named sign, syndrome, eponym, or trial → in at least one card
□ Every classic or atypical presentation → a clinical reasoning card
□ Every image you can see attached → at least one image card if clinically relevant
□ Every heading or slide title in the source → at least one card

EXAM TRAP AUDIT:
□ What do learners commonly confuse about this?
□ What would an examiner reverse to trick a student?
□ Is there a "sounds similar but opposite" concept?
□ Is there an exception to the rule that gets tested?
Generate at least one card per trap identified.

DEPTH AUDIT — for every card:
□ Does the back explain WHY, not just WHAT?
□ Is there a mechanism?
□ Is there a clinical consequence?
□ Would a learner answering a vignette about this pass based only on this card?
If any card fails — rewrite it before returning.

NOTHING IN THE SOURCE SHOULD BE LEFT UNCOVERED.

════════════════════════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════════════════════════

Return a JSON array only. No preamble, no explanation, no markdown fences.
image is null for text-only cards, or exact filename string for image cards you have seen.
`;

  // ─────────────────────────────────────────────
  // PASS 2 PROMPT — gap filling
  // ─────────────────────────────────────────────
  const pass2Prompt = `
You are a medical education specialist doing a coverage audit on an Anki flashcard deck.

You will be given:
1. The original source material (text + images attached)
2. The cards already generated in Pass 1

Your job is to find ONLY the concepts, mechanisms, facts, values, and clinical points from the source that have NO card covering them yet — and generate cards for those gaps only.

RULES:
- Do NOT regenerate cards for concepts already covered
- Do NOT duplicate any existing card even partially
- Only generate cards for genuine gaps — concepts present in the source with zero coverage
- Apply the exact same quality rules as Pass 1:
  → Full mechanism in every back
  → No one-sentence backs
  → No definition-only cards
  → No "What is X?" fronts
  → Only c1 in cloze cards
  → Bold key terms with <b>tags</b>
  → Use <br> for line breaks
  → Only generate image cards for images you can actually see attached to this message

WHAT TO LOOK FOR — common gaps:
- Specific numbers, thresholds, or values mentioned in the source with no cloze card
- Named structures, drugs, enzymes, or organisms mentioned but never made into a card
- Complications or consequences described but skipped
- Comparisons or distinctions the source makes that have no distinction card
- Exam traps or misconceptions embedded in the source text
- Any attached image not yet used in a card

If there are NO gaps — return an empty array: []
If there ARE gaps — return only the new cards as a JSON array.

OUTPUT FORMAT:
Return a JSON array only. No preamble, no explanation, no markdown fences.
`;

  const imageFilenames = Object.keys(images);
  const imageListText = imageFilenames.length > 0
    ? `Available images in this source (attached below): ${imageFilenames.join(', ')}`
    : 'Available images in this source: none';

  const sourceText = `Deck name: ${deckName}\n\n${imageListText}\n\nSource material:\n\n${text}`;

  // ─── Build image parts for API call ───
  const imageParts = imageFilenames.map(filename => ({
    inlineData: {
      mimeType: 'image/jpeg' as const,
      data: images[filename].toString('base64')
    }
  }));

  // Label each image with its filename so Gemini knows what to reference
  const imageLabels = imageFilenames.map(filename => ({
    text: `[Image filename: ${filename}]`
  }));

  // Interleave label + image parts: [label, image, label, image, ...]
  const interleavedImageParts: any[] = [];
  imageFilenames.forEach((filename, i) => {
    interleavedImageParts.push({ text: `[Image filename: ${filename}]` });
    interleavedImageParts.push({
      inlineData: {
        mimeType: 'image/jpeg' as const,
        data: images[filename].toString('base64')
      }
    });
  });

  const pass1Parts = [
    { text: sourceText },
    ...interleavedImageParts
  ];

  // ─── PASS 1 ───
  console.log(`Gemini Pass 1: generating cards with ${imageFilenames.length} images attached...`);
  let pass1Cards: any[] = [];

  try {
    const pass1Response = await ai.models.generateContent({
      model: modelPass1,
      contents: { role: 'user', parts: pass1Parts },
      config: {
        systemInstruction: pass1Prompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              front: { type: Type.STRING },
              back: { type: Type.STRING },
              image: { type: Type.STRING }
            },
            required: ['type', 'front', 'back']
          }
        }
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
${sourceText}

────────────────────────────────────────
CARDS ALREADY GENERATED IN PASS 1:
${JSON.stringify(pass1Cards, null, 2)}
────────────────────────────────────────

Now identify any concepts, facts, values, or clinical points from the source that have NO card yet, and generate cards for those gaps only.
`;

    const pass2Parts = [
      { text: pass2TextContent },
      ...interleavedImageParts
    ];

    const pass2Response = await ai.models.generateContent({
      model: modelPass2,
      contents: { role: 'user', parts: pass2Parts },
      config: {
        systemInstruction: pass2Prompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              front: { type: Type.STRING },
              back: { type: Type.STRING },
              image: { type: Type.STRING }
            },
            required: ['type', 'front', 'back']
          }
        }
      }
    });

    const pass2Text = pass2Response.text;
    if (!pass2Text) throw new Error("Empty response from Gemini on Pass 2");
    const clean2 = pass2Text.replace(/```json|```/g, '').trim();
    pass2Cards = JSON.parse(clean2);
    console.log(`Pass 2 complete: ${pass2Cards.length} gap cards generated`);

  } catch (error) {
    console.warn("Pass 2 failed (non-fatal), returning Pass 1 cards only:", error);
    return pass1Cards;
  }

  const allCards = [...pass1Cards, ...pass2Cards];
  console.log(`Total cards after both passes: ${allCards.length}`);
  return allCards;
}