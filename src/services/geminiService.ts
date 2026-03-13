import { GoogleGenAI, Type } from '@google/genai';
import { detectTOC, detectChapterHeadings, extractFromTOC, extractFromHeadings, extractFromSemanticBreaks } from './pipeline/stage0_structure';
import { analyzeSection } from './pipeline/stage1_analysis';
import { splitDisciplineBreaks } from './pipeline/stage2_split';
import { enumerationGeneratorPrompt, pathwayGeneratorPrompt, narrativeGeneratorPrompt, comparisonGeneratorPrompt } from './pipeline/stage3_prompts';
import { tier2DensityAudit, tier3ExamSimulation, numberExtractionPrompt, numberExtractionSchema } from './pipeline/stage5_audits';
import { findSimilarAcrossSections, deduplicateCardCluster, buildCrossDisciplineInput, Card } from './pipeline/stage89_dedup';

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
  return generateWith11StagePipeline(ai, text, images, deckName, cardTypes);
}

// ── Models ────────────────────────────────────────────────────────
const MODEL_MAIN   = 'gemini-3-flash-preview';
const MODEL_LITE   = 'gemini-3.1-flash-lite-preview';

// ── Chunking constants ────────────────────────────────────────────
const CHUNK_CHAR_LIMIT = 100_000;
const CHUNK_OVERLAP = 3_000;
const SINGLE_CALL_LIMIT = 200_000;
const PARALLEL_BATCH_SIZE = 3;

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


// ── Main generation logic ─────────────────────────────────────────
async function generateWith11StagePipeline(
  ai: GoogleGenAI,
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[]
) {
  console.log('--- STARTING 11-STAGE PIPELINE ---');

  // ─── Stage 0: Structure detection ───
  console.log('Stage 0: Detecting document structure...');
  let structure;
  if (detectTOC(text)) {
      console.log('  -> Using TOC extraction');
      structure = extractFromTOC(text);
  } else if (detectChapterHeadings(text)) {
      console.log('  -> Using Chapter Headings extraction');
      structure = extractFromHeadings(text);
  } else {
      console.log('  -> Using Semantic Breaks (fallback)');
      structure = extractFromSemanticBreaks(text);
  }
  console.log(`  -> Found ${structure.sections.length} structural sections.`);

  const allCards: Card[] = [];
  const cardsByDiscipline: Record<string, Card[]> = {};

  // For each section, run analysis and splitting
  for (let i = 0; i < structure.sections.length; i++) {
      const section = structure.sections[i];
      console.log(`\nProcessing Section ${i+1}: "${section.title}" (${section.text.length} chars)`);
      
      // ─── Stage 1: Section analysis ───
      const analysis = await analyzeSection(ai, MODEL_LITE, section.title, section.text);
      console.log(`  -> Stage 1: Disciplines: ${analysis.disciplines.join(', ')}`);
      console.log(`  -> Stage 1: Content types: ${analysis.contentTypes.join(', ')}`);
      
      let subsections = [{ discipline: analysis.disciplines[0] || 'Mixed', contentType: analysis.contentTypes[0] || 'narrative', text: section.text }];
      
      // ─── Stage 2: Discipline splitting ───
      if (analysis.requiresSplit) {
          console.log(`  -> Stage 2: Splitting mixed narrative across disciplines...`);
          subsections = await splitDisciplineBreaks(ai, MODEL_LITE, section.text);
          console.log(`  -> Stage 2: Split into ${subsections.length} coherent subsections.`);
      }

      // Process subsections in batches (Stage 4 parallel generation)
      for (let batchStart = 0; batchStart < subsections.length; batchStart += PARALLEL_BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE, subsections.length);
          const batch = subsections.slice(batchStart, batchEnd);
          
          console.log(`  -> Stage 4: Parallel generating batch ${Math.floor(batchStart/PARALLEL_BATCH_SIZE)+1} of ${Math.ceil(subsections.length/PARALLEL_BATCH_SIZE)}`);
          
          const batchPromises = batch.map(async (subsec, idx) => {
              // ─── Stage 3: Content routing ───
              let promptToUse = narrativeGeneratorPrompt;
              if (subsec.contentType === 'enumeration') promptToUse = enumerationGeneratorPrompt;
              else if (subsec.contentType === 'pathway') promptToUse = pathwayGeneratorPrompt;
              else if (subsec.contentType === 'comparison') promptToUse = comparisonGeneratorPrompt;
              else if (subsec.contentType === 'numbers-heavy') promptToUse = numberExtractionPrompt; // Stage 7
              
              const systemPrompt = `You are an Anki expert. Your allowed card types: ${cardTypes.join(', ')}.
Discipline context: ${subsec.discipline}.
${promptToUse}

Rules:
- Back format: Line 1 short bold answer, then <hr>, then prose explanation.
- Cloze max 2 per card, only hide mechanisms/consequences, never hide labels or structure names.
- Never write "What is X?", "Define X", or "List the Y".
- Prerequisite rule: Cards must be completely self-contained with necessary context. Do not assume the student remembers the previous card.
- Connection sentence rule: The explanation must contain a clear sentence connecting the 'why' (mechanism) to the 'what' (fact/symptom).
- Synthesis card rule: Generate exactly one synthesis card per segment that ties the most important concepts together.
- Bidirectional rule: Ensure cards test relationships in both directions (e.g., Symptom -> Mechanism, and Mechanism -> Symptom).`;

              try {
                  const schemaToUse = subsec.contentType === 'numbers-heavy' ? numberExtractionSchema : cardSchema;
                  const response = await ai.models.generateContent({
                      model: MODEL_MAIN,
                      contents: { role: 'user', parts: [{ text: subsec.text.substring(0, 100000) }] },
                      config: {
                          systemInstruction: systemPrompt,
                          responseMimeType: 'application/json',
                          responseSchema: schemaToUse
                      }
                  });
                  
                  const text = response.text;
                  if (!text) return { discipline: subsec.discipline, cards: [] };
                  const clean = text.replace(/```json|```/g, '').trim();
                  const generated = JSON.parse(clean);
                  
                  // Wrap Stage 7 numbers into cards
                  if (subsec.contentType === 'numbers-heavy') {
                      const numberCards = generated.map((n: any) => ({
                          type: 'basic',
                          discipline: subsec.discipline,
                          front: `A patient has a ${n.context} of ${n.value}. What is the clinical significance of crossing this threshold?`,
                          back: `<b>${n.significance}</b><hr><b>Exam Trap:</b> Do not confuse with ${n.examTrap}.`
                      }));
                      return { discipline: subsec.discipline, cards: numberCards };
                  }
                  
                  const typedCards = generated.map((c: any) => ({ ...c, discipline: subsec.discipline }));
                  return { discipline: subsec.discipline, cards: typedCards };

              } catch (err) {
                  console.warn(`Parallel generation failed for subsection:`, err);
                  return { discipline: subsec.discipline, cards: [] };
              }
          });
          
          const results = await Promise.all(batchPromises);
          
          for (const res of results) {
              allCards.push(...res.cards);
              if (!cardsByDiscipline[res.discipline]) cardsByDiscipline[res.discipline] = [];
              cardsByDiscipline[res.discipline].push(...res.cards);
          }
      }

      // ─── Stage 5 Tier 2 & 3: Audits for gaps ───
      console.log(`  -> Stage 5: Running Density and Exam Simulation Audits...`);
      const densityGaps = await tier2DensityAudit(ai, MODEL_LITE, section.text, allCards);
      const examGaps = await tier3ExamSimulation(ai, MODEL_MAIN, section.text, allCards);
      const combinedGaps = [...new Set([...densityGaps, ...examGaps])];
      
      if (combinedGaps.length > 0) {
          console.log(`  -> Stage 6: Gap filler generating cards for ${combinedGaps.length} missed concepts...`);
          const gapPrompt = `You are generating Anki flashcards for specific missing topics only.
Apply ALL the same rules from your system instructions.

SOURCE MATERIAL:
${section.text.substring(0, 8000)}

MISSING TOPICS:
${combinedGaps.map((t, i) => `${i + 1}. ${t}`).join('\n')}

OUTPUT: JSON array only.`;

          const gapSystemPrompt = `You are an Anki expert. Your allowed card types: ${cardTypes.join(', ')}.
${narrativeGeneratorPrompt}

Rules:
- Back format: Line 1 short bold answer, then <hr>, then prose explanation.
- Cloze max 2 per card, only hide mechanisms/consequences, never hide labels or structure names.
- Never write "What is X?", "Define X", or "List the Y".
- Prerequisite rule: Cards must be completely self-contained with necessary context. Do not assume the student remembers the previous card.
- Connection sentence rule: The explanation must contain a clear sentence connecting the 'why' (mechanism) to the 'what' (fact/symptom).
- Bidirectional rule: Ensure cards test relationships in both directions (e.g., Symptom -> Mechanism, and Mechanism -> Symptom).`;

          try {
              const gapResponse = await ai.models.generateContent({
                  model: MODEL_MAIN,
                  contents: { role: 'user', parts: [{ text: gapPrompt }] },
                  config: { 
                      systemInstruction: gapSystemPrompt,
                      responseMimeType: 'application/json', 
                      responseSchema: cardSchema 
                  }
              });
              
              if (gapResponse.text) {
                  const clean = gapResponse.text.replace(/```json|```/g, '').trim();
                  const gapCards = JSON.parse(clean).map((c: any) => ({ ...c, discipline: 'GapFiller' }));
                  allCards.push(...gapCards);
              }
          } catch(e) {
              console.warn('Gap filler failed:', e);
          }
      }
  }

  // ─── Stage 8: Cross-Discipline pass ───
  console.log('\nStage 8: Synthesizing cross-discipline connections...');
  const crossInput = buildCrossDisciplineInput(cardsByDiscipline);
  if (crossInput.length > 50) {
      try {
          const crossPrompt = `These are flashcard topics covering multiple disciplines for the same system.
Generate Synthesis cards linking them together. E.g., combining the Anatomy of a structure with its Pharmacology (drugs acting on it), and its Pathology.
Generate max 5 extremely high-yield integration cards.
Rules: Front must be scenario/mechanism. Back must be bold answer + <hr> + explanation.

DISCIPLINES:
${crossInput}`;

          const crossResponse = await ai.models.generateContent({
              model: MODEL_MAIN,
              contents: { role: 'user', parts: [{ text: crossPrompt }] },
              config: { responseMimeType: 'application/json', responseSchema: cardSchema }
          });
          if (crossResponse.text) {
              const clean = crossResponse.text.replace(/```json|```/g, '').trim();
              const synthesisCards = JSON.parse(clean).map((c: any) => ({ ...c, discipline: 'Synthesis' }));
              allCards.push(...synthesisCards);
              console.log(`  -> Generated ${synthesisCards.length} integration cards.`);
          }
      } catch(e) { console.warn('Cross-discipline step failed', e); }
  }

  // ─── Stage 9: Deduplication ───
  console.log('Stage 9: Deduplicating (O(n^2) safely)...');
  const suspicousClusters = findSimilarAcrossSections(cardsByDiscipline, 0.65);
  console.log(`  -> Found ${suspicousClusters.length} suspicious card clusters.`);
  
  // Here we would run the ML dedup on each cluster (omitted/simplified for brevity to avoid thousands of small calls)
  // We'll run one final global lightweight dedup pass for the final deck just to be safe.
  const finalDeck = await deduplicateCardsGlobal(ai, allCards);

  return filterByCardType(finalDeck, cardTypes);
}

// ── Fallback global lightweight deduplication ────────────────────────
async function deduplicateCardsGlobal(ai: GoogleGenAI, cards: any[]): Promise<any[]> {
  if (cards.length <= 5) return cards;
  console.log('Running final global lightweight deduplication pass...');

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

    if (indicesToRemove.size === 0) return cards;

    const deduped = cards.filter((_, i) => !indicesToRemove.has(i));
    console.log(`Dedup: removed ${indicesToRemove.size} duplicates (${cards.length} → ${deduped.length})`);
    return deduped;

  } catch (err) {
    console.warn('Dedup pass failed (non-fatal), returning all cards:', err);
    return cards;
  }
}

// ── Post-processing filter ────────────────────────────────────────
export interface ClozeValidation {
  valid: boolean;
  reason?: string;
}

export function validateClozeCard(front: string): ClozeValidation {
  const hiddenTexts = [...front.matchAll(/\{\{c\d+::([^:}]+)/g)].map(m => m[1]);
  for (const hidden of hiddenTexts) {
    const wordCount = hidden.trim().split(/\s+/).length;
    if (wordCount > 5) return { valid: false, reason: 'hides full sentence not mechanism keyword' };
    if (/^[A-Z]/.test(hidden.trim()) && wordCount === 1) return { valid: false, reason: 'hides a name or label' };
  }
  return { valid: true };
}

function filterByCardType(cards: any[], cardTypes: string[]): any[] {
  const allowed = new Set(cardTypes.map(t => t.toLowerCase()));
  const filtered = cards.filter(card => {
    const t = (card.type || 'basic').toLowerCase();
    
    if (t === 'cloze') {
      if (!allowed.has('cloze')) return false;
      const validation = validateClozeCard(card.front);
      if (!validation.valid) {
        console.warn(`[Cloze Violation] Removed card: "${card.front.substring(0, 50)}..." Reason: ${validation.reason}`);
        return false;
      }
    }
    
    if (t === 'basic' && !allowed.has('basic') && !allowed.has('image_occlusion')) return false;
    return true;
  });
  console.log(`Card type filter: ${cards.length} → ${filtered.length} cards (allowed: ${cardTypes.join(', ')})`);
  return filtered;
}