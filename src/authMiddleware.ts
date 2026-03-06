import * as admin from 'firebase-admin';
import { Request, Response, NextFunction } from 'express';

let firebaseApp: admin.app.App | null = null;

function getFirebaseAdmin() {
  if (!firebaseApp) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      console.error('Missing Firebase env vars:', {
        hasProjectId: !!projectId,
        hasClientEmail: !!clientEmail,
        hasPrivateKey: !!privateKey,
      });
      throw new Error('Firebase Admin environment variables are missing');
    }

    // Robustly handle private key formatting
    // Railway and other platforms encode newlines differently
    let formattedKey = privateKey;

    // Strip surrounding quotes if present
    formattedKey = formattedKey.replace(/^["']|["']$/g, '');

    // If the key doesn't have real newlines, replace escaped \n
    if (!formattedKey.includes('\n')) {
      formattedKey = formattedKey.replace(/\\n/g, '\n');
    }

    console.log('Firebase Admin init — key preview:', formattedKey.substring(0, 27) + '...');

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: formattedKey,
      }),
    });

    console.log('Firebase Admin initialized successfully');
  }
  return firebaseApp;
}

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
  isAdmin?: boolean;
}

async function verifyTokenAndSetUser(req: AuthenticatedRequest): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.split('Bearer ')[1];

  try {
    const app = getFirebaseAdmin();
    const decodedToken = await app.auth().verifyIdToken(token);
    req.user = decodedToken;

    // Check isAdmin in Firestore
    try {
      const profileDoc = await app
        .firestore()
        .collection('users')
        .doc(decodedToken.uid)
        .collection('profile')
        .doc('data')
        .get();
      req.isAdmin = profileDoc.exists && profileDoc.data()?.isAdmin === true;
      console.log(`User ${decodedToken.uid} — isAdmin: ${req.isAdmin}`);
    } catch (firestoreError) {
      console.error('Firestore isAdmin check failed:', firestoreError);
      req.isAdmin = false;
    }

    return true;
  } catch (error: any) {
    console.error('Token verification failed:', error.code, error.message);
    return false;
  }
}

// Use on routes where auth is optional (guest + logged-in both allowed)
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  await verifyTokenAndSetUser(req);
  next();
};

// Use on routes that require a valid token
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const verified = await verifyTokenAndSetUser(req);
  if (!verified) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  next();
};