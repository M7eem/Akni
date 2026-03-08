import React, { useState, useEffect } from "react";
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  updateProfile,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

const googleProvider = new GoogleAuthProvider();

type Mode = "signin" | "signup" | "forgot";

export default function AuthPage() {
  const { user, signInWithGoogle, setUsage } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError(friendlyError(e.code));
      setLoading(false);
    }
  };

  const handleEmailPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError("");
    setSuccess("");

    if (mode === "forgot") {
      if (!email) {
        setError("Please enter your email address.");
        return;
      }
      setLoading(true);
      try {
        await sendPasswordResetEmail(auth, email);
        setSuccess("Password reset email sent! Check your inbox.");
        setMode("signin");
      } catch (e: any) {
        setError(friendlyError(e.code));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name) {
          await updateProfile(cred.user, { displayName: name });
          await cred.user.reload();
        }
        
        // Create user document in Firestore
        const userRef = doc(db, 'users', cred.user.uid);
        const docSnap = await getDoc(userRef);
        
        if (!docSnap.exists()) {
          await setDoc(userRef, {
            email: cred.user.email,
            displayName: name || cred.user.displayName,
            isAdmin: false,
            decksUsedThisMonth: 0,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
            periodStart: serverTimestamp()
          });
          // Update local usage state for new user
          const now = new Date();
          setUsage({ used: 0, limit: 10, resetsOn: new Date(now.getFullYear(), now.getMonth() + 1, 1) });
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      navigate("/");
    } catch (e: any) {
      setError(friendlyError(e.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="orb orb1"></div>
      <div className="orb orb2"></div>

      <div className="absolute top-8 left-8 z-50">
        <a href="/" className="flex items-center gap-2 text-sm font-medium text-[#8899aa] hover:text-[#eef6ff] transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back to home
        </a>
      </div>

      <section className="hero" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '2rem 1rem' }}>
        <div className="deck-card" style={{ maxWidth: '420px', width: '100%', margin: '0' }}>
          <div className="fade-in">
            <div className="deck-card-title text-center mb-2">
              {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create account" : "Reset Password"}
            </div>
            <div className="deck-card-sub text-center mb-8">
              {mode === "signin"
                ? "Sign in to access your decks"
                : mode === "signup"
                ? "Start generating Anki decks in seconds"
                : "Enter your email to receive a reset link"}
            </div>

            {mode !== "forgot" && (
              <>
                <button
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-full bg-[#7dd3fc] text-[#07090f] font-semibold hover:opacity-90 transition-opacity shadow-[0_0_15px_rgba(125,211,252,0.2)] mb-6"
                  onClick={handleGoogle}
                  disabled={loading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Sign in with Google
                </button>

                <div className="flex items-center gap-3 mb-6">
                  <div className="flex-1 h-px bg-[rgba(255,255,255,0.1)]"></div>
                  <span className="text-xs text-[#8899aa] uppercase tracking-wider font-medium">or</span>
                  <div className="flex-1 h-px bg-[rgba(255,255,255,0.1)]"></div>
                </div>
              </>
            )}

            <form onSubmit={handleEmailPassword} className="flex flex-col gap-4">
              {mode === "signup" && (
                <div className="field mb-0">
                  <input
                    type="text"
                    placeholder="Full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={loading}
                  />
                </div>
              )}

              <div className="field mb-0">
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>

              {mode !== "forgot" && (
                <div className="field mb-0">
                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              )}

              {mode === "signin" && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }}
                    className="text-xs text-[#8899aa] hover:text-[#7dd3fc] transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
                  {error}
                </div>
              )}

              {success && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-200 text-sm">
                  {success}
                </div>
              )}

              <button
                type="submit"
                className="gen-btn mt-2"
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="animate-spin" size={18} /> Please wait...</>
                ) : mode === "signin" ? (
                  "Sign in"
                ) : mode === "signup" ? (
                  "Create account"
                ) : (
                  "Send Reset Link"
                )}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-[#8899aa]">
              {mode === "signin" ? (
                <>
                  No account?{" "}
                  <button
                    onClick={() => {
                      setMode("signup");
                      setError("");
                      setSuccess("");
                    }}
                    className="text-[#7dd3fc] hover:underline font-medium"
                  >
                    Sign up
                  </button>
                </>
              ) : mode === "signup" ? (
                <>
                  Already have an account?{" "}
                  <button
                    onClick={() => {
                      setMode("signin");
                      setError("");
                      setSuccess("");
                    }}
                    className="text-[#7dd3fc] hover:underline font-medium"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setMode("signin");
                    setError("");
                    setSuccess("");
                  }}
                  className="text-[#7dd3fc] hover:underline font-medium"
                >
                  Back to Sign in
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function friendlyError(code: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-not-found":
    case "auth/invalid-credential":
      return "Invalid email or password.";
    case "auth/wrong-password":
      return "Incorrect password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/popup-closed-by-user":
      return "Sign-in popup was closed. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
