import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export const checkUsage = async (uid: string) => {
  const profileDoc = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
  if (profileDoc.exists() && profileDoc.data().isAdmin === true) {
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

export const checkAndIncrementUsage = async (uid: string) => {
  const profileDoc = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
  if (profileDoc.exists() && profileDoc.data().isAdmin === true) {
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
  const periodStart = data.periodStart.toDate();
  
  if (periodStart.getMonth() !== now.getMonth() || periodStart.getFullYear() !== now.getFullYear()) {
    return { used: 0, limit: 10, resetsOn };
  }

  return { used: data.decksUsedThisMonth, limit: 10, resetsOn };
};
