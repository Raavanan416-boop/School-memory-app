/**
 * Firebase Setup Script for Class Memories
 * ==========================================
 * This script creates 37 users in Firebase Auth + Firestore.
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://console.firebase.google.com
 * 2. Create a new project called "class-memories"
 * 3. Enable Authentication → Email/Password sign-in
 * 4. Enable Firestore Database (start in test mode)
 * 5. Enable Storage
 * 6. Copy your Firebase config into js/firebase-config.js
 * 7. Install Firebase Admin SDK: npm install firebase-admin
 * 8. Download your service account key from Firebase Console
 *    (Project Settings → Service Accounts → Generate New Private Key)
 * 9. Save the key as "serviceAccountKey.json" in this folder
 * 10. Run: node setup/seed-users.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

// 37 Class Members
const USERS = [
  { roll: '611301', name: 'Aarav Sharma', nickname: 'Aarav', dob: '2006-03-15' },
  { roll: '611302', name: 'Aditi Verma', nickname: 'Adi', dob: '2006-07-22' },
  { roll: '611303', name: 'Akash Patel', nickname: 'AK', dob: '2006-01-10' },
  { roll: '611304', name: 'Ananya Singh', nickname: 'Anu', dob: '2006-09-05' },
  { roll: '611305', name: 'Arjun Nair', nickname: 'Arj', dob: '2006-11-18' },
  { roll: '611306', name: 'Bhavya Gupta', nickname: 'Bhavi', dob: '2006-04-30' },
  { roll: '611307', name: 'Chetan Kumar', nickname: 'Chetu', dob: '2006-02-14' },
  { roll: '611308', name: 'Deepika Reddy', nickname: 'Deepu', dob: '2006-06-08' },
  { roll: '611309', name: 'Devesh Mishra', nickname: 'Dev', dob: '2006-12-25' },
  { roll: '611310', name: 'Divya Iyer', nickname: 'Divu', dob: '2006-08-17' },
  { roll: '611311', name: 'Esha Joshi', nickname: 'Eshu', dob: '2006-05-03' },
  { roll: '611312', name: 'Farhan Ali', nickname: 'Fari', dob: '2006-10-11' },
  { roll: '611313', name: 'Gauri Deshmukh', nickname: 'Gauri', dob: '2006-03-28' },
  { roll: '611314', name: 'Harsh Agarwal', nickname: 'Harry', dob: '2006-07-09' },
  { roll: '611315', name: 'Ishaan Kapoor', nickname: 'Ishu', dob: '2006-01-22' },
  { roll: '611316', name: 'Jaya Menon', nickname: 'Jay', dob: '2006-09-14' },
  { roll: '611317', name: 'Karthik Rajan', nickname: 'Karthi', dob: '2006-11-30' },
  { roll: '611318', name: 'Kavya Pillai', nickname: 'Kavi', dob: '2006-04-07' },
  { roll: '611319', name: 'Laksh Dubey', nickname: 'Lucky', dob: '2006-02-19' },
  { roll: '611320', name: 'Meera Bhat', nickname: 'Meeru', dob: '2006-06-25' },
  { roll: '611321', name: 'Naveen Rao', nickname: 'Navu', dob: '2006-12-12' },
  { roll: '611322', name: 'Neha Pandey', nickname: 'Nehu', dob: '2006-08-04' },
  { roll: '611323', name: 'Om Tiwari', nickname: 'Omi', dob: '2006-05-16' },
  { roll: '611324', name: 'Pooja Saxena', nickname: 'PJ', dob: '2006-10-28' },
  { roll: '611325', name: 'Pranav Jain', nickname: 'Pran', dob: '2006-03-09' },
  { roll: '611326', name: 'Riya Chauhan', nickname: 'Riyu', dob: '2006-07-31' },
  { roll: '611327', name: 'Rohan Malhotra', nickname: 'Ro', dob: '2006-01-05' },
  { roll: '611328', name: 'Sakshi Kulkarni', nickname: 'Saku', dob: '2006-09-21' },
  { roll: '611329', name: 'Sahil Banerjee', nickname: 'Sahi', dob: '2006-11-07' },
  { roll: '611330', name: 'Tanya Thakur', nickname: 'Tanu', dob: '2006-04-18' },
  { roll: '611331', name: 'Uday Shetty', nickname: 'Uds', dob: '2006-02-26' },
  { roll: '611332', name: 'Varun Mahajan', nickname: 'Varu', dob: '2006-06-13' },
  { roll: '611333', name: 'Vidya Hegde', nickname: 'Vids', dob: '2006-12-01' },
  { roll: '611334', name: 'Yash Gokhale', nickname: 'Yashu', dob: '2006-08-23' },
  { roll: '611335', name: 'Zara Khan', nickname: 'Zar', dob: '2006-05-29' },
  { roll: '611336', name: 'Aditya Rathore', nickname: 'Adit', dob: '2006-10-15' },
  { roll: '611337', name: 'Shreya Nambiar', nickname: 'Shree', dob: '2006-03-02' }
];

async function seedUsers() {
  console.log('🚀 Starting user seeding...\n');

  for (const u of USERS) {
    const email = `${u.roll}@school.com`;
    const password = u.roll; // Default password = roll number

    try {
      // Create Firebase Auth user
      let userRecord;
      try {
        userRecord = await auth.getUserByEmail(email);
        console.log(`⏭  User ${email} already exists, updating Firestore...`);
      } catch {
        userRecord = await auth.createUser({
          email,
          password,
          displayName: u.name,
          disabled: false
        });
        console.log(`✅ Created auth user: ${email}`);
      }

      // Create Firestore user document
      await db.collection('users').doc(userRecord.uid).set({
        email,
        rollNumber: u.roll,
        fullName: u.name,
        nickname: u.nickname,
        dateOfBirth: u.dob,
        joinedYear: '2018',
        endYear: '2024',
        bio: '',
        themeColor: '',
        profilePic: '',
        coverImage: '',
        online: false,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        slamBook: {
          favoriteMemory: '',
          firstImpression: '',
          funniestMoment: '',
          bestFriend: ''
        },
        badges: ['alumni']
      }, { merge: true });

      console.log(`   📝 Firestore doc created for ${u.name}`);
    } catch (err) {
      console.error(`❌ Error with ${u.name}:`, err.message);
    }
  }

  console.log('\n🎉 Seeding complete! 37 users ready.');
  console.log('\n📋 Login credentials:');
  console.log('   Email: [rollNumber]@school.com');
  console.log('   Password: [rollNumber]');
  console.log('   Example: 611301@school.com / 611301');
  process.exit(0);
}

seedUsers();
