import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, signInWithPopup, signOut as firebaseSignOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';

interface UsageData {
  used: number;
  limit: number;
  resetsOn: Date;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  usage: UsageData | null;
  setUsage: React.Dispatch<React.SetStateAction<UsageData | null>>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.error("Error setting persistence:", error);
    });

    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
      setLoading(false);
      
      if (user) {
        // Fetch usage in background
        (async () => {
          try {
            const userRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userRef);
            
            const now = new Date();
            let resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            let used = 0;
            let limit = 10;

            if (userDoc.exists()) {
              const data = userDoc.data();
              if (data.isAdmin === true) {
                limit = 9999;
              }
              used = data.decksUsedThisMonth || 0;
            }
            setUsage({ used, limit, resetsOn });
          } catch (error) {
            console.error("Error fetching usage in AuthContext:", error);
            // Set default on error
            const now = new Date();
            setUsage({ used: 0, limit: 10, resetsOn: new Date(now.getFullYear(), now.getMonth() + 1, 1) });
          }
        })();
      } else {
        setUsage(null);
      }
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      const userRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userRef);
      
      if (!docSnap.exists()) {
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          isAdmin: false,
          decksUsedThisMonth: 0,
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
          periodStart: serverTimestamp()
        });
        // Update local usage state for new user
        const now = new Date();
        setUsage({ used: 0, limit: 10, resetsOn: new Date(now.getFullYear(), now.getMonth() + 1, 1) });
      } else {
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          lastLogin: serverTimestamp()
        }, { merge: true });
        // Usage will be fetched by onAuthStateChanged or is already there
      }
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      setUsage(null);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  const getIdToken = async () => {
    if (user) {
      return await user.getIdToken();
    }
    return null;
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#07090f' }} />;

  return (
    <AuthContext.Provider value={{ user, loading, usage, setUsage, signInWithGoogle, signOut, getIdToken }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
