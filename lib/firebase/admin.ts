import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let app: App;
let adminDb: Firestore;

function getAdminApp(): App {
  if (!app) {
    const existing = getApps();
    if (existing.length > 0) {
      app = existing[0];
    } else {
      app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
          clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
          // Vercel speichert \n als literal — replace stellt echte Zeilenumbrüche wieder her
          privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
  }
  return app;
}

export function getAdminDb(): Firestore {
  if (!adminDb) {
    adminDb = getFirestore(getAdminApp());
    // REST statt gRPC: der gRPC-Verbindungsaufbau hängt beim ERSTEN Firestore-
    // Aufruf je Prozess/Instanz gern zehner­sekundenlang (Coldstart / bestimmte
    // Netze/IPv6), bevor er durchkommt — das war die Ursache für ~30 s „lookup"
    // im Scanner. REST (HTTP/1.1) verbindet sofort. `settings()` muss VOR der
    // ersten Nutzung laufen; try/catch für HMR-Reuse (Instanz evtl. schon genutzt).
    try {
      adminDb.settings({ preferRest: true });
    } catch { /* bereits initialisiert/genutzt — ignorieren */ }
  }
  return adminDb;
}
