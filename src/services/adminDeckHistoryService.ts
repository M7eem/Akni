import { getAdminDb } from '../authMiddleware';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const getUserRef = (uid: string) => getAdminDb().collection('users').doc(uid);

const ensureUserDoc = async (uid: string, email?: string) => {
  const userRef = getUserRef(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    if (email) {
      try {
        await userRef.set({
          email,
          isAdmin: false,
          decksUsedThisMonth: 0,
          createdAt: FieldValue.serverTimestamp(),
          periodStart: FieldValue.serverTimestamp()
        });
        return await userRef.get(); // Return the new doc
      } catch (e) {
        console.warn(`Failed to auto-create profile for ${uid}:`, e);
      }
    }
    return userDoc; // Return non-existent doc if no email or fail
  }
  return userDoc;
};

export const checkUsage = async (uid: string, email?: string) => {
  const userDoc = await ensureUserDoc(uid, email);

  if (!userDoc.exists) {
    return true;
  }

  const data = userDoc.data();
  if (!data) return true;

  if (data.isAdmin === true) {
    return true;
  }

  const now = new Date();
  
  // Check period reset
  let periodStart = now;
  if (data.periodStart) {
    // Admin SDK Timestamp has toDate()
    if (typeof data.periodStart.toDate === 'function') {
      periodStart = data.periodStart.toDate();
    } else if (data.periodStart instanceof Date) { // Should not happen in Admin SDK but safe
      periodStart = data.periodStart;
    }
  }

  if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
    return true; // Will be reset on increment
  }

  if ((data.decksUsedThisMonth || 0) >= 10) {
    throw new Error('LIMIT_REACHED');
  }

  return true;
};

export const checkAndIncrementUsage = async (uid: string, email?: string) => {
  const userDoc = await ensureUserDoc(uid, email);
  const userRef = getUserRef(uid);

  if (!userDoc.exists) {
    // Fallback create if ensureUserDoc didn't run (e.g. race condition or error)
    await userRef.set({
      email: email || '',
      isAdmin: false,
      decksUsedThisMonth: 1,
      createdAt: FieldValue.serverTimestamp(),
      periodStart: FieldValue.serverTimestamp()
    });
    return 1;
  }

  const data = userDoc.data();
  if (!data) return 1; // Should not happen if exists is true

  if (data.isAdmin === true) {
    return 0;
  }

  const now = new Date();
  let periodStart = now;
  if (data.periodStart) {
    if (typeof data.periodStart.toDate === 'function') {
      periodStart = data.periodStart.toDate();
    } else if (data.periodStart instanceof Date) {
      periodStart = data.periodStart;
    }
  }

  // Reset if new month
  if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
    await userRef.update({
      decksUsedThisMonth: 1,
      periodStart: FieldValue.serverTimestamp()
    });
    return 1;
  }

  if ((data.decksUsedThisMonth || 0) >= 10) {
    throw new Error('LIMIT_REACHED');
  }

  const newCount = (data.decksUsedThisMonth || 0) + 1;
  await userRef.update({
    decksUsedThisMonth: newCount
  });

  return newCount;
};
