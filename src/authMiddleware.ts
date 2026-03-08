import { cert, initializeApp, getApp, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { Request, Response, NextFunction } from 'express';

let firebaseApp: App | null = null;
let adminDb: Firestore | null = null;

function getFirebaseAdmin(): App {
  if (!firebaseApp) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase Admin environment variables are missing');
    }

    let formattedKey = privateKey;
    formattedKey = formattedKey.replace(/^["']|["']$/g, '');
    if (!formattedKey.includes('\n')) {
      formattedKey = formattedKey.replace(/\\n/g, '\n');
    }

    try {
      firebaseApp = getApp();
    } catch {
      firebaseApp = initializeApp({
        credential: cert({ projectId, clientEmail, privateKey: formattedKey }),
      });
    }

    console.log('Firebase Admin initialized successfully');
  }
  return firebaseApp;
}

export function getAdminDb(): Firestore {
  if (!adminDb) {
    const app = getFirebaseAdmin();
    adminDb = getFirestore(app);
    adminDb.settings({ preferRest: true }); // fixes gRPC NOT_FOUND on Railway
    console.log('Firebase Admin Firestore initialized');
  }
  return adminDb;
}

function isAdminUid(uid: string): boolean {
  const adminUids = process.env.ADMIN_UIDS ?? '';
  if (!adminUids) return false;
  return adminUids.split(',').map(u => u.trim()).includes(uid);
}

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
  isAdmin?: boolean;
}

async function verifyTokenAndSetUser(req: AuthenticatedRequest): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.split('Bearer ')[1];

  try {
    const app = getFirebaseAdmin();
    const decodedToken = await getAuth(app).verifyIdToken(token);
    req.user = decodedToken;
    req.isAdmin = isAdminUid(decodedToken.uid);
    console.log(`User ${decodedToken.uid} — isAdmin: ${req.isAdmin}`);
    return true;
  } catch (error: any) {
    console.error('Token verification failed:', error.code, error.message);
    return false;
  }
}

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  await verifyTokenAndSetUser(req);
  next();
};

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