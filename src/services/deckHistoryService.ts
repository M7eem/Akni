import { doc, getDoc, setDoc, updateDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

const getUserRef = (uid: string) => doc(db, 'users', uid);

const ensureUserDoc = async (uid: string, email?: string) => {
  const userRef = getUserRef(uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    if (email) {
      try {
        await setDoc(userRef, {
          email,
          isAdmin: false,
          decksUsedThisMonth: 0,
          createdAt: serverTimestamp(),
          periodStart: serverTimestamp()
        });
        return await getDoc(userRef); // Return the new doc
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

  if (!userDoc.exists()) {
    // Should not happen if email was provided, but if it does, allow access (fail open)
    return true;
  }

  const data = userDoc.data();

  if (data.isAdmin === true) {
    return true;
  }

  const now = new Date();
  
  // Check period reset
  let periodStart = now;
  if (data.periodStart) {
    if (typeof data.periodStart.toDate === 'function') {
      periodStart = data.periodStart.toDate();
    } else if (data.periodStart instanceof Date) {
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

  if (!userDoc.exists()) {
    // If we couldn't create it (e.g. no email), try to create with minimal info or fail open?
    // User said "if it doesn't exist create it".
    // If we are here, ensureUserDoc failed to create it (maybe no email).
    // Let's try to create it again with defaults if we can, or just return 1.
    if (email) {
       // Should have been created by ensureUserDoc.
    }
    // Fallback create if ensureUserDoc didn't run (e.g. race condition or error)
    await setDoc(userRef, {
      email: email || '',
      isAdmin: false,
      decksUsedThisMonth: 1,
      createdAt: serverTimestamp(),
      periodStart: serverTimestamp()
    });
    return 1;
  }

  const data = userDoc.data();

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
    await updateDoc(userRef, {
      decksUsedThisMonth: 1,
      periodStart: serverTimestamp()
    });
    return 1;
  }

  if ((data.decksUsedThisMonth || 0) >= 10) {
    throw new Error('LIMIT_REACHED');
  }

  const newCount = (data.decksUsedThisMonth || 0) + 1;
  await updateDoc(userRef, {
    decksUsedThisMonth: newCount
  });

  return newCount;
};

export const getUsage = async (uid: string) => {
  try {
    const userRef = getUserRef(uid);
    const userDoc = await getDoc(userRef);
    
    const now = new Date();
    let resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    if (!userDoc.exists()) {
      return { used: 0, limit: 10, resetsOn };
    }

    const data = userDoc.data();

    if (data.isAdmin === true) {
      return { used: 0, limit: 9999, resetsOn };
    }
    
    let periodStart = now;
    if (data.periodStart) {
      if (typeof data.periodStart.toDate === 'function') {
        periodStart = data.periodStart.toDate();
      } else if (data.periodStart instanceof Date) {
        periodStart = data.periodStart;
      }
    }

    if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
      return { used: 0, limit: 10, resetsOn };
    }

    return { used: data.decksUsedThisMonth || 0, limit: 10, resetsOn };
  } catch (error) {
    console.error("Error fetching usage:", error);
    const now = new Date();
    const resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { used: 0, limit: 10, resetsOn };
  }
};
