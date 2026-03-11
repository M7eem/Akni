import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../lib/firebase';

export interface DeckRecord {
  id?: string;
  deckName: string;
  cardCount: number;
  fileName: string;
  downloadUrl?: string;
  storagePath?: string;
  createdAt: any;
}

export const saveDeckHistory = async (uid: string, deckData: Omit<DeckRecord, 'createdAt' | 'id'>, fileBlob?: Blob) => {
  try {
    const deckId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    let downloadUrl = deckData.downloadUrl;
    let storagePath = '';

    if (fileBlob) {
      storagePath = `users/${uid}/decks/${deckId}_${deckData.fileName}`;
      const storageRef = ref(storage, storagePath);
      const metadata = {
        contentDisposition: `attachment; filename="${deckData.fileName}"`,
        contentType: 'application/octet-stream'
      };
      await uploadBytes(storageRef, fileBlob, metadata);
      downloadUrl = await getDownloadURL(storageRef);
    }

    const deckRef = doc(db, 'users', uid, 'decks', deckId);
    await setDoc(deckRef, {
      ...deckData,
      downloadUrl,
      storagePath,
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

export const deleteDeckHistory = async (uid: string, deckId: string, storagePath?: string) => {
  try {
    if (storagePath) {
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef).catch(err => console.warn("Could not delete storage file:", err));
    }
    const deckRef = doc(db, 'users', uid, 'decks', deckId);
    await deleteDoc(deckRef);
  } catch (error) {
    console.error("Error deleting deck history:", error);
    throw error;
  }
};
