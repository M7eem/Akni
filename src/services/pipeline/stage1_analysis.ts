import { GoogleGenAI, Type } from '@google/genai';

export interface AnalyzedSection {
    title: string;
    text: string;
    disciplines: string[];
    contentTypes: string[];
    coherenceScore: number;
    requiresSplit: boolean;
}

export const sectionAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    disciplines: { type: Type.ARRAY, items: { type: Type.STRING } },
    contentTypes: { type: Type.ARRAY, items: { type: Type.STRING } },
    coherenceScore: { type: Type.NUMBER },
    requiresSplit: { type: Type.BOOLEAN }
  },
  required: ['disciplines', 'contentTypes', 'coherenceScore', 'requiresSplit'] as const
};

export const sectionAnalysisPrompt = `Analyze this medical text section and return:

1. disciplines: which medical disciplines does it cover?
   Choose from: Anatomy, Physiology, Pharmacology, Biochemistry, Pathology, Microbiology, Immunology, Embryology, Clinical Medicine, Radiology, Surgery, Epidemiology, Biostatistics

2. contentTypes: what types of content does it contain?
   Choose from: narrative, enumeration, pathway, comparison, numbers-heavy
   - narrative: explanatory prose about mechanisms and concepts
   - enumeration: lists of items (organisms, drugs, enzymes) each with facts
   - pathway: sequential steps (metabolic, neural, coagulation)
   - comparison: explicit X vs Y comparisons
   - numbers-heavy: many thresholds, statistics, diagnostic values

3. coherenceScore: float 0.0–1.0
   1.0 = single topic, one discipline
   0.5 = 2–3 topics, mixed disciplines  
   0.0 = many unrelated topics

4. requiresSplit: true if coherenceScore < 0.7 AND disciplines.length > 1

Return JSON only.`;

export async function analyzeSection(
    ai: GoogleGenAI, 
    model: string, 
    title: string, 
    text: string
): Promise<AnalyzedSection> {
    const input = `TITLE: ${title}\n\nCONTENT (first 8000 chars):\n${text.substring(0, 8000)}`;
    
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { role: 'user', parts: [{ text: input }] },
            config: {
                systemInstruction: sectionAnalysisPrompt,
                responseMimeType: 'application/json',
                responseSchema: sectionAnalysisSchema
            }
        });

        const responseText = response.text;
        if (!responseText) throw new Error("Empty analysis response");
        
        const clean = responseText.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        
        return {
            title,
            text,
            disciplines: parsed.disciplines || [],
            contentTypes: parsed.contentTypes || [],
            coherenceScore: parsed.coherenceScore || 1.0,
            requiresSplit: parsed.requiresSplit || false
        };
        
    } catch (err) {
        console.warn(`Failed to analyze section "${title}", using fallback:`, err);
        return {
            title,
            text,
            disciplines: ['General Medicine'],
            contentTypes: ['narrative'],
            coherenceScore: 1.0,
            requiresSplit: false
        };
    }
}
