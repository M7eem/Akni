import { GoogleGenAI, Type } from '@google/genai';

export function scoreConceptDensity(paragraph: string): number {
    let score = 0;
    
    // Named medical concepts (two+ capitalized words e.g. "Primary Motor Cortex")
    score += (paragraph.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || []).length * 2;
    
    // Numbers with medical units
    score += (paragraph.match(/\d+\s*(%|mg|mmHg|mEq|mL|L|g|kg|μg|IU|units)/g) || []).length * 3;
    
    // Comparison language
    score += (paragraph.match(/\b(however|unlike|whereas|compared|contrast|versus|vs\.)/gi) || []).length * 2;
    
    // Clinical trigger words
    score += (paragraph.match(/\b(patient|presents|lesion|damage|deficiency|syndrome|disease|disorder)/gi) || []).length;
    
    // Mechanism language
    score += (paragraph.match(/\b(because|therefore|results in|leads to|causes|due to|mechanism)/gi) || []).length;
    
    return score;
}

export async function tier2DensityAudit(
    ai: GoogleGenAI,
    model: string,
    sectionText: string,
    existingCards: any[]
): Promise<string[]> {
    // 1. Score paragraphs
    const paragraphs = sectionText.split(/\n\s*\n/).map(p => p.trim());
    const scoredParagraphs = paragraphs
      .map(p => ({ text: p, score: scoreConceptDensity(p) }))
      .filter(p => p.score > 3) // Only high-density paragraphs
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Top 20 highest-density
      
    if (scoredParagraphs.length === 0) return [];

    // 2. Prepare payload
    const densityAuditPrompt = `These are the highest concept-density paragraphs from a medical text.
Each contains multiple testable facts.

Below are existing card fronts.

For each paragraph, identify specific facts that have no card.
Be precise: not "paragraph 3 is missing coverage" but 
"the specific fact that [X causes Y in condition Z] has no card."

PARAGRAPHS:
${scoredParagraphs.map((p, i) => `[${i}] ${p.text}`).join('\n\n')}

EXISTING CARDS:
${existingCards.map(c => `- ${c.front}`).join('\n')}

Return ONLY a JSON array of missing fact strings. If no gaps, return [].`;

    try {
        const auditResponse = await ai.models.generateContent({
            model: model,
            contents: { role: 'user', parts: [{ text: densityAuditPrompt }] },
            config: {
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });

        const auditText = auditResponse.text;
        if (!auditText) return [];
        const clean = auditText.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);

    } catch (err) {
        console.warn('Tier 2 Density Audit failed:', err);
        return [];
    }
}

// ── Stage 5 Tier 3: Exam Simulation Audit ───────────────────────
export async function tier3ExamSimulation(
    ai: GoogleGenAI,
    model: string,
    sectionText: string,
    existingCards: any[]
): Promise<string[]> {
    const examSimulationPrompt = `
You are a medical examiner who has just read this section.
You will write 10 exam questions — then check if students 
who studied the existing cards could answer them.

STEP 1 — WRITE 10 EXAM QUESTIONS:
Write questions WITHOUT looking at the cards.
These should be the questions YOU would write for this topic.
Mix: mechanism, clinical scenario, comparison, exception questions.

STEP 2 — CHECK COVERAGE:
For each question, can a student answer it from the existing cards?
- Yes → covered
- No → what specific knowledge is missing?

STEP 3 — RETURN GAPS:
Return only the missing knowledge as specific card topics.
Not "question 4 is not covered" but "the specific concept that 
[X mechanism produces Y finding] has no card."

SECTION TEXT:
${sectionText.substring(0, 8000)}

EXISTING CARD FRONTS:
${existingCards.map(c => `- ${c.front}`).join('\n')}

Return ONLY a JSON array of missing topic strings. If no gaps, return [].`;

    try {
        const auditResponse = await ai.models.generateContent({
            model: model,
            contents: { role: 'user', parts: [{ text: examSimulationPrompt }] },
            config: {
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });

        const auditText = auditResponse.text;
        if (!auditText) return [];
        const clean = auditText.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);

    } catch (err) {
        console.warn('Tier 3 Exam Audit failed:', err);
        return [];
    }
}

// ── Stage 7: Number Extraction ────────────────────────────────────
export const numberExtractionSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            value: { type: Type.STRING },
            context: { type: Type.STRING },
            significance: { type: Type.STRING },
            examTrap: { type: Type.STRING }
        },
        required: ['value', 'context', 'significance', 'examTrap'] as const
    }
};

export const numberExtractionPrompt = `
Extract every number, threshold, percentage, ratio, and statistic 
from this medical text.

For each return:
- value: the number with units (e.g. "135-145 mEq/L", "50%")
- context: what it refers to (e.g. "normal serum sodium", "mortality rate")
- significance: what changes clinically above/below this value or why it matters
- examTrap: what number do students commonly confuse this with?

Return JSON array of objects only.`;
