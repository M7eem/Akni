import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface DeckRecord {
  id?: string;
  deckName: string;
  cardCount: number;
  fileName: string;
  downloadUrl?: string;
  createdAt: any;
}

export const saveDeckHistory = async (uid: string, deckData: Omit<DeckRecord, 'createdAt' | 'id'>) => {
  try {
    const deckId = Date.now().toString();
    const deckRef = doc(db, 'users', uid, 'decks', deckId);
    await setDoc(deckRef, {
      ...deckData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Error saving deck history:", error);
  }
};

export const getDeckHistory = async (uid: string): Promise<DeckRecord[]> => {
  try {
    const decksRef = collection(db, 'users', uid, 'decks');
    const q = query(decksRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as DeckRecord[];
  } catch (error) {
    console.error("Error fetching deck history:", error);
    return [];
  }
};
