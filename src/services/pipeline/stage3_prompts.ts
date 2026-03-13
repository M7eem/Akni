export const enumerationGeneratorPrompt = `You are generating Anki flashcards from a list of named medical items.

STEP 1 — BUILD THE INVENTORY:
Before writing any cards, extract every named item and list 
every distinct fact stated about it in the source.

Format your inventory as:
ITEM: [name]
- Fact 1: [mechanism/feature/consequence]
- Fact 2: [mechanism/feature/consequence]
...

STEP 2 — VERIFY COMPLETENESS:
Every item in the inventory must appear. Every fact under each 
item must get a card. This is non-negotiable.
A list of 40 organisms with 4 facts each = minimum 160 cards.

STEP 3 — GENERATE CARDS:
For each item × fact, generate one card:
- Front: clinical scenario or distinguishing question requiring THIS specific fact about THIS item. Never ask "What are the features of X?"
- Back: bold answer + <hr> + short mechanism/explanation

FORBIDDEN:
- One card covering multiple unrelated facts about one item
- Generic fronts like "What are the features of X?"
- Skipping any item or any fact from the inventory

OUTPUT: JSON array only.`;

export const pathwayGeneratorPrompt = `You are generating Anki flashcards from a medical pathway.

STEP 1 — MAP THE PATHWAY:
Trace every step:
[substrate] → [enzyme/process] → [product] → [enzyme/process] → ...

For each step note:
- The enzyme or mechanism
- What accumulates if this step is blocked
- Any associated deficiency disease
- Any associated clinical presentation

STEP 2 — GENERATE CARDS AT FOUR LEVELS:

Level 1 — Individual steps:
"If enzyme X is deficient, what accumulates and what is the 
clinical presentation?"

Level 2 — Step transitions:
"Why does [substrate] require [enzyme] to become [product] — 
what is the chemical/biological necessity?"

Level 3 — Deficiency diseases:
"A patient presents with [clinical findings]. Which enzyme is 
deficient and what is accumulating?"

Level 4 — Synthesis:
ONE card requiring the student to trace the entire pathway 
from substrate to final product, naming every key mechanism.

OUTPUT: JSON array only.`;

export const narrativeGeneratorPrompt = `You are an expert medical educator creating high-yield Anki flashcards from narrative text.

STEP 1 — INVENTORY:
Scan the content and mentally list every named concept, structure, syndrome, comparison, and mechanism. Every item gets a card.

STEP 2 — QUESTIONS:
- Required Fronts: clinical scenarios, mechanism questions ("why does X cause Y?").
- Banned Fronts: "What does X do", "Where is X", pure definitions.

STEP 3 — BACK FORMAT:
- Line 1: short bold answer
- Line 2: <hr>
- Line 3: prose explanation connecting concept → mechanism → clinical significance.

OUTPUT: JSON array only.`;

export const comparisonGeneratorPrompt = `You are generating Anki flashcards focused on clinical comparisons.

For every pair of confusable concepts in the text:
1. Generate cards that test the DISTINGUISHING FEATURE between them.
2. Formats: "A patient has X symptom. Another has Y. Both share Z. What test/finding tells you which is which?"
3. Never use generic "Compare X and Y" fronts. Frame them as clinical differentials.

OUTPUT: JSON array only.`;
