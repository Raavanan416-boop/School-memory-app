/**
 * Create Admin Account for Class Memories
 * Run: node setup/create-admin.js
 * 
 * This creates the hidden admin account:
 * Email: Raavanan@admin.com
 * Password: Raavanan@2025
 */
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

async function createAdmin() {
  const email = 'Raavanan@admin.com';
  const password = 'Raavanan@2025';

  console.log('🔒 Creating hidden Admin account...\n');

  try {
    // Check if already exists
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log('⚠️  Admin account already exists. Updating role...');
    } catch (e) {
      // Create new
      userRecord = await auth.createUser({
        email,
        password,
        displayName: 'Raavanan'
      });
      console.log('✅ Admin Firebase Auth account created');
    }

    // Set Firestore document with admin role
    await db.collection('users').doc(userRecord.uid).set({
      fullName: 'Raavanan',
      email: email,
      profilePic: '',
      nickname: '',
      bio: '',
      dateOfBirth: '',
      rollNumber: '',
      joinedYear: '',
      endYear: '',
      themeColor: '',
      online: false,
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      savedPosts: [],
      slamBook: {},
      role: 'admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log('✅ Admin Firestore document created with role: admin');
    console.log('\n🎉 Admin setup complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${password}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🔒 This account is invisible to normal users.');
    console.log('   Login from the same normal login screen.');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createAdmin();
