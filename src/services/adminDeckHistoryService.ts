import { getAdminDb } from '../authMiddleware';
import { FieldValue } from 'firebase-admin/firestore';

const getUserRef = (uid: string) => getAdminDb().collection('users').doc(uid);

const ensureUserDoc = async (uid: string, email?: string) => {
  const userRef = getUserRef(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    // Create doc even without email — uid is enough to track usage
    try {
      await userRef.set({
        email: email || '',
        displayName: '',
        isAdmin: false,
        decksUsedThisMonth: 0,
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: FieldValue.serverTimestamp(),
        periodStart: FieldValue.serverTimestamp()
      });
      console.log(`Auto-created Firestore doc for user: ${uid}`);
      return await userRef.get();
    } catch (e) {
      console.warn(`Failed to auto-create profile for ${uid}:`, e);
      return userDoc; // Return non-existent doc — caller handles gracefully
    }
  }

  return userDoc;
};

export const checkUsage = async (uid: string, email?: string) => {
  const userDoc = await ensureUserDoc(uid, email);

  // If doc still doesn't exist (creation failed), allow through
  if (!userDoc.exists) {
    console.warn(`No user doc for ${uid} — allowing generation`);
    return true;
  }

  const data = userDoc.data();
  if (!data) return true;

  if (data.isAdmin === true) return true;

  const now = new Date();

  let periodStart = now;
  if (data.periodStart) {
    periodStart = typeof data.periodStart.toDate === 'function'
      ? data.periodStart.toDate()
      : data.periodStart instanceof Date ? data.periodStart : now;
  }

  // New month — reset will happen on increment, allow through
  if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
    return true;
  }

  const limit = data.isAdmin === true ? 9999 : (data.limit || 3);

  if ((data.decksUsedThisMonth || 0) >= limit) {
    throw new Error('LIMIT_REACHED');
  }

  return true;
};

export const saveDeckHistory = async (uid: string, deckData: any) => {
  try {
    const userRef = getUserRef(uid);
    const decksRef = userRef.collection('decks');
    await decksRef.add({
      ...deckData,
      createdAt: FieldValue.serverTimestamp()
    });
    console.log(`Saved deck history for user: ${uid}`);
  } catch (error) {
    console.error(`Error saving deck history for user ${uid}:`, error);
  }
};

export const checkAndIncrementUsage = async (uid: string, email?: string): Promise<number> => {
  const userRef = getUserRef(uid);
  const userDoc = await ensureUserDoc(uid, email);

  if (!userDoc.exists) {
    // Last resort — create minimal doc with count of 1
    await userRef.set({
      email: email || '',
      displayName: '',
      isAdmin: false,
      decksUsedThisMonth: 1,
      createdAt: FieldValue.serverTimestamp(),
      lastLogin: FieldValue.serverTimestamp(),
      periodStart: FieldValue.serverTimestamp()
    });
    console.log(`Created doc with count=1 for user: ${uid}`);
    return 1;
  }

  const data = userDoc.data()!;

  if (data.isAdmin === true) return 0; // Admins: don't count

  const now = new Date();
  let periodStart = now;
  if (data.periodStart) {
    periodStart = typeof data.periodStart.toDate === 'function'
      ? data.periodStart.toDate()
      : data.periodStart instanceof Date ? data.periodStart : now;
  }

  // New month — reset counter
  if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
    await userRef.update({
      decksUsedThisMonth: 1,
      periodStart: FieldValue.serverTimestamp(),
      lastLogin: FieldValue.serverTimestamp()
    });
    return 1;
  }

  const limit = data.isAdmin === true ? 9999 : (data.limit || 3);

  if ((data.decksUsedThisMonth || 0) >= limit) {
    throw new Error('LIMIT_REACHED');
  }

  const newCount = (data.decksUsedThisMonth || 0) + 1;
  await userRef.update({
    decksUsedThisMonth: newCount,
    lastLogin: FieldValue.serverTimestamp()
  });

  console.log(`Usage incremented for ${uid}: ${newCount}/10`);
  return newCount;
};