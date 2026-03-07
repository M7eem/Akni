import { doc, getDoc, setDoc, updateDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export const checkUsage = async (uid: string, email?: string) => {
  const profileRef = doc(db, 'users', uid, 'profile', 'data');
  const profileDoc = await getDoc(profileRef);

  if (!profileDoc.exists() && email) {
    try {
      await setDoc(profileRef, {
        email,
        isAdmin: false,
        decksUsedThisMonth: 0,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.warn(`Failed to auto-create profile for ${uid}:`, e);
    }
  }

  if (profileDoc.exists() && profileDoc.data()?.isAdmin === true) {
    return true; // skip all limit checks, unlimited access
  }

  const usageRef = doc(db, 'users', uid, 'usage', 'current');
  const usageDoc = await getDoc(usageRef);
  const now = new Date();
  
  if (!usageDoc.exists()) {
    return true;
  }

  const data = usageDoc.data();
  const periodStart = data.periodStart.toDate();
  
  if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
    return true;
  }

  if (data.decksUsedThisMonth >= 10) {
    throw new Error('LIMIT_REACHED');
  }

  return true;
};

export const checkAndIncrementUsage = async (uid: string, email?: string) => {
  const profileRef = doc(db, 'users', uid, 'profile', 'data');
  const profileDoc = await getDoc(profileRef);

  if (!profileDoc.exists() && email) {
    try {
      await setDoc(profileRef, {
        email,
        isAdmin: false,
        decksUsedThisMonth: 0,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.warn(`Failed to auto-create profile for ${uid}:`, e);
    }
  }

  if (profileDoc.exists() && profileDoc.data()?.isAdmin === true) {
    return 0; // skip all limit checks, unlimited access
  }

  const usageRef = doc(db, 'users', uid, 'usage', 'current');
  const usageDoc = await getDoc(usageRef);
  const now = new Date();
  
  if (!usageDoc.exists()) {
    await setDoc(usageRef, {
      decksUsedThisMonth: 1,
      periodStart: Timestamp.fromDate(now)
    });
    return 1;
  }

  const data = usageDoc.data();
  const periodStart = data.periodStart.toDate();
  
  if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
    await setDoc(usageRef, {
      decksUsedThisMonth: 1,
      periodStart: Timestamp.fromDate(now)
    });
    return 1;
  }

  if (data.decksUsedThisMonth >= 10) {
    throw new Error('LIMIT_REACHED');
  }

  const newCount = data.decksUsedThisMonth + 1;
  await updateDoc(usageRef, {
    decksUsedThisMonth: newCount
  });

  return newCount;
};

export const getUsage = async (uid: string) => {
  try {
    const profileDoc = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
    if (profileDoc.exists() && profileDoc.data().isAdmin === true) {
      const now = new Date();
      const resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { used: 0, limit: 9999, resetsOn }; // Unlimited for UI
    }

    const usageRef = doc(db, 'users', uid, 'usage', 'current');
    const usageDoc = await getDoc(usageRef);
    const now = new Date();
    
    let resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    if (!usageDoc.exists()) {
      return { used: 0, limit: 10, resetsOn };
    }

    const data = usageDoc.data();
    
    // Safety check for periodStart
    let periodStart = now;
    if (data.periodStart && typeof data.periodStart.toDate === 'function') {
      periodStart = data.periodStart.toDate();
    } else if (data.periodStart instanceof Date) {
      periodStart = data.periodStart;
    }

    if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
      return { used: 0, limit: 10, resetsOn };
    }

    return { used: data.decksUsedThisMonth || 0, limit: 10, resetsOn };
  } catch (error) {
    console.error("Error fetching usage:", error);
    // Return a safe default on error
    const now = new Date();
    const resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { used: 0, limit: 10, resetsOn };
  }
};
