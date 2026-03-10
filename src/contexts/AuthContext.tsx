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
  signInWithGoogle: () => Promise<any>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const navigate = useNavigate();
  const isSigningInRef = React.useRef(false);

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.error("Error setting persistence:", error);
    });

    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      console.log("Auth state changed:", firebaseUser?.email);
      setUser(firebaseUser);
      setLoading(false);

      if (firebaseUser) {
        // Run in background — create doc if missing, then fetch usage
        (async () => {
          try {
            const userRef = doc(db, 'users', firebaseUser.uid);
            const userDoc = await getDoc(userRef);

            const now = new Date();
            const resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);

            if (!userDoc.exists()) {
              // First time this user has signed in — create their document
              await setDoc(userRef, {
                email: firebaseUser.email,
                displayName: firebaseUser.displayName || '',
                isAdmin: false,
                decksUsedThisMonth: 0,
                createdAt: serverTimestamp(),
                lastLogin: serverTimestamp(),
                periodStart: serverTimestamp()
              });
              console.log(`Created Firestore doc for new user: ${firebaseUser.uid}`);
              setUsage({ used: 0, limit: 10, resetsOn });
            } else {
              // Existing user — update lastLogin and read usage
              await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });

              const data = userDoc.data();
              const limit = data.isAdmin === true ? 9999 : 10;
              const used = data.decksUsedThisMonth || 0;
              setUsage({ used, limit, resetsOn });
            }
          } catch (error) {
            console.error("Error in onAuthStateChanged Firestore sync:", error);
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

  // signInWithGoogle no longer creates the doc — onAuthStateChanged handles all users
  const signInWithGoogle = async () => {
    if (isSigningInRef.current) return;
    isSigningInRef.current = true;
    console.log("Starting Google sign in...");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      console.log("Sign in result:", result);
      console.log("User:", result?.user?.email);
      return result;
    } catch (error: any) {
      console.log("Sign in error code:", error.code);
      console.log("Sign in error message:", error.message);
      if (error.code !== 'auth/cancelled-popup-request' && 
          error.code !== 'auth/popup-closed-by-user') {
        console.error("Error signing in with Google", error);
        throw error;
      }
    } finally {
      isSigningInRef.current = false;
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