import { GoogleGenAI, Type } from '@google/genai';

// Simple Jaccard similarity implementation
function calculateJaccardSimilarity(text1: string, text2: string): number {
    const setA = new Set(text1.toLowerCase().split(/\s+/));
    const setB = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    if (union.size === 0) return 0;
    return intersection.size / union.size;
}

// Helper to shuffle and sample an array
function sampleArray<T>(arr: T[], size: number): T[] {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.max(0, size));
}

export interface Card {
    front: string;
    back: string;
    type?: string;
    discipline?: string;
}

// ── Stage 9: Find similar cards across sections using Jaccard ──
export function findSimilarAcrossSections(
    cardsBySectionCategory: Record<string, Card[]>, 
    threshold: number = 0.6
): { groupA: string, groupB: string, cards: Card[] }[] {
    const sections = Object.keys(cardsBySectionCategory);
    if (sections.length < 2) return [];

    const suspiciousClusters: { groupA: string, groupB: string, cards: Card[] }[] = [];
    
    // To avoid O(n^2) explosion with huge decks, sample max 200 per section
    const sampledDeck: Record<string, Card[]> = {};
    for (const sec of sections) {
        sampledDeck[sec] = cardsBySectionCategory[sec].length > 200 
            ? sampleArray(cardsBySectionCategory[sec], 200) 
            : cardsBySectionCategory[sec];
    }

    // Compare each section against every other section
    for (let i = 0; i < sections.length; i++) {
        for (let j = i + 1; j < sections.length; j++) {
            const secA = sections[i];
            const secB = sections[j];
            
            for (const cardA of sampledDeck[secA]) {
                for (const cardB of sampledDeck[secB]) {
                    const cleanA = (cardA.front || '').replace(/<[^>]+>/g, '');
                    const cleanB = (cardB.front || '').replace(/<[^>]+>/g, '');
                    
                    if (!cleanA || !cleanB) continue;

                    const sim = calculateJaccardSimilarity(cleanA, cleanB);
                    if (sim >= threshold) {
                        suspiciousClusters.push({
                            groupA: secA,
                            groupB: secB,
                            cards: [cardA, cardB]
                        });
                    }
                }
            }
        }
    }
    
    return suspiciousClusters;
}

// ── Stage 8: Build Cross-Discipline Input String ──
export function buildCrossDisciplineInput(cardsByDiscipline: Record<string, Card[]>): string {
    return Object.entries(cardsByDiscipline)
        .map(([discipline, cards]) => {
            // Only send top 30 fronts per discipline — the most representative
            const fronts = cards
                .slice(0, 30)
                .map(c => `- ${(c.front || '').replace(/<[^>]+>/g, '').substring(0, 80)}`)
                .join('\n');
            return `${discipline}:\n${fronts}`;
        })
        .join('\n\n---\n\n');
}

// ── AI-Powered Deduplication (retains best card) ──
export async function deduplicateCardCluster(
    ai: GoogleGenAI, 
    model: string, 
    cards: Card[]
): Promise<Card[]> {
    if (cards.length <= 1) return cards;

    const frontList = cards.map((c, i) => `[${i}] ${c.front?.replace(/<[^>]+>/g, '').substring(0, 100)}`).join('\n');

    const dedupPrompt = `You are deduplicating Anki flashcards. Below is a numbered list of card fronts.
Identify cards that are near-duplicates (testing the same concept with very similar wording).
For each group of duplicates, keep only the BEST one (most specific, best worded, most clinical).

Return a JSON array of the INDEX NUMBERS to REMOVE (the worse duplicates). If no duplicates, return [].

Card fronts:
${frontList}`;

    try {
        const response = await ai.models.generateContent({
            model: model,
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

        return cards.filter((_, i) => !indicesToRemove.has(i));
    } catch (err) {
        console.warn('Dedup pass failed (non-fatal), returning all cards:', err);
        return cards;
    }
}
