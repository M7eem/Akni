import { GoogleGenAI, Type } from '@google/genai';

export interface SplitPoint {
    discipline: string;
    contentType: string;
    startPhrase: string; // first 50 chars
    endPhrase: string;   // first 50 chars of NEXT subsection (or empty for last)
}

const splitSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            discipline: { type: Type.STRING },
            contentType: { type: Type.STRING },
            startPhrase: { type: Type.STRING },
            endPhrase: { type: Type.STRING }
        },
        required: ['discipline', 'contentType', 'startPhrase', 'endPhrase'] as const
    }
};

const splitPrompt = `This text covers multiple medical disciplines mixed together.
Split it into coherent subsections, one per discipline.

Instead of returning the full text (which is expensive and truncates), return specific phrases that mark the start and end of each subsection.

Rules:
- Each subsection must contain only one discipline's content
- Split at natural boundaries (paragraph breaks, headings)
- If content is truly inseparable (e.g., a sentence mixing anatomy and physiology), assign it to the dominant discipline.
- NO OVERLAPS, NO GAPS: the endPhrase of section N must perfectly match the startPhrase of section N+1.
- startPhrase: Copy the EXACT first 5-8 words (up to 50 chars) of the subsection.
- endPhrase: Copy the EXACT first 5-8 words (up to 50 chars) of the NEXT subsection.
- For the VERY LAST subsection, set endPhrase to "EOF".

Return JSON array of SplitPoints only.`;

export async function splitDisciplineBreaks(
    ai: GoogleGenAI, 
    model: string, 
    text: string
): Promise<{ discipline: string; contentType: string; text: string }[]> {
    
    // We only send the first ~15k to the model at once to avoid overflow, 
    // but a dense section requiring a split shouldn't be much larger than that anyway.
    const cappedInput = text.substring(0, 15000);
    
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { role: 'user', parts: [{ text: cappedInput }] },
            config: {
                systemInstruction: splitPrompt,
                responseMimeType: 'application/json',
                responseSchema: splitSchema
            }
        });

        const responseText = response.text;
        if (!responseText) throw new Error("Empty split response");
        
        const clean = responseText.replace(/```json|```/g, '').trim();
        const splits: SplitPoint[] = JSON.parse(clean);
        
        return applySplits(text, splits);
        
    } catch (err) {
        console.warn(`Discipline split failed, returning whole text:`, err);
        return [{ discipline: 'Mixed', contentType: 'narrative', text }];
    }
}

function applySplits(originalText: string, splits: SplitPoint[]) {
    const results: { discipline: string; contentType: string; text: string }[] = [];
    
    let currentIndex = 0;
    
    for (let i = 0; i < splits.length; i++) {
        const split = splits[i];
        
        // Find where the start phrase begins (should be near currentIndex)
        // We use a small search window to avoid matching common words later in the text
        const safeStartPhrase = split.startPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
        const searchRegex = new RegExp(`^\\s*${safeStartPhrase}`, 'im');
        
        const textToSearch = originalText.substring(currentIndex);
        const match = searchRegex.exec(textToSearch);
        
        let actualStart = match ? currentIndex + match.index : currentIndex;
        
        // Find where it ends
        let actualEnd = originalText.length;
        if (split.endPhrase && split.endPhrase !== "EOF") {
            const safeEndPhrase = split.endPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
            const endRegex = new RegExp(`^\\s*${safeEndPhrase}`, 'im');
            // Ensure we only search AFTER the start
            const endMatch = endRegex.exec(originalText.substring(actualStart + split.startPhrase.length));
            if (endMatch) {
                actualEnd = actualStart + split.startPhrase.length + endMatch.index;
            }
        }
        
        const subsectionText = originalText.substring(actualStart, actualEnd).trim();
        
        if (subsectionText.length > 50) {
            results.push({
                discipline: split.discipline || 'General',
                contentType: split.contentType || 'narrative',
                text: subsectionText
            });
        }
        
        currentIndex = actualEnd;
    }
    
    // Fallback: if slicing completely failed and we got nothing
    if (results.length === 0) {
        return [{ discipline: 'Mixed', contentType: 'narrative', text: originalText }];
    }
    
    return results;
}
