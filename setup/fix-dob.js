/**
 * Fix Date of Birth for all users
 * Run: node setup/fix-dob.js
 */
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

// All 37 users with their DOBs
const USERS = [
 { roll: '611301', name: 'Aboorva', dob: '2008-01-21' },//1
  { roll: '611302', name: 'Arshini', dob: '2008-06-21' },//2
  { roll: '611303', name: 'Bruntha', dob: '2006-01-10' },//3change date of birth
  { roll: '611304', name: 'Dhansiri', dob: '2008-01-13' },//4
  { roll: '611305', name: 'Deepika', dob: '2006-11-18' },//5
  { roll: '611306', name: 'Hemamalini', dob: '2007-11-12' },//6
  { roll: '611307', name: 'Jothika', dob: '2006-02-14' },//7
  { roll: '611308', name: 'Kaviya', dob: '2008-07-06' },//8
  { roll: '611309', name: 'Magitha', dob: '2007-11-04' },//9
  { roll: '611310', name: 'Rani', dob: '2008-08-25' },//10
  { roll: '611311', name: 'Sneha', dob: '2008-05-30' },//11
  { roll: '611312', name: 'Susmitha', dob: '2008-11-11' },//12
  { roll: '611313', name: 'Swetha', dob: '2007-11-21' },//13
  { roll: '611314', name: 'Thirisha', dob: '2008-06-26' },//14
  { roll: '611315', name: 'Vijayalakshmi', dob: '2008-01-22' },//15change date of birth
  { roll: '611316', name: 'Boss', dob: '2007-04-27' },//16
  { roll: '611317', name: 'Kaviraj', dob: '2007-06-16' },//17
  { roll: '611318', name: 'Manikandan', dob: '2007-09-09' },//18
  { roll: '611319', name: 'Thenarasu', dob: '2008-06-16' },//19
  { roll: '611320', name: 'Thirumali', dob: '2008-07-01' },//20
  { roll: '611321', name: 'Vishva', dob: '2007-11-25' },//21
  { roll: '611322', name: 'yohannan', dob: '2008-05-03' },//22
  { roll: '611323', name: 'Anitha', dob: '2008-04-14' },//23
  { roll: '611324', name: 'Anupriya', dob: '2008-10-28' },//24change date of birth
  { roll: '611325', name: 'Naveena', dob: '2008-05-16' },//25
  { roll: '611326', name: 'Pavitra',dob: '2008-02-12' },//26
  { roll: '611327', name: 'Sanmathi',dob: '2006-01-05' },//27change date of birth
  { roll: '611328', name: 'Sharmitha',dob: '2008-12-06' },//28
  { roll: '611329', name: 'Kamalesh',dob: '2008-07-29' },//29
  { roll: '611330', name: 'Mohandass', dob: '2007-12-29' },//30
  { roll: '611331', name: 'Mounish', dob: '2007-12-30' },//31
  { roll: '611332', name: 'Prasanth', dob: '2009-02-12' },//32
  { roll: '611333', name: 'Nisanth', dob: '2008-09-26' },//33
  { roll: '611334', name: 'Siddharth', dob: '2008-12-15' },//34
  { roll: '611335', name: 'Srithirumalai', dob: '2008-01-03' },//35
  { roll: '611336', name: 'Suveenkumar',dob: '2008-06-24' },//36
  { roll: '611337', name: '', dob: '2008-06-24' }//37
];

async function fixDOB() {
  console.log('🔧 Fixing Date of Birth for all users...\n');

  for (const u of USERS) {
    const email = `${u.roll}@school.com`;
    try {
      const userRecord = await auth.getUserByEmail(email);
      await db.collection('users').doc(userRecord.uid).update({
        dateOfBirth: u.dob
      });
      console.log(`✅ ${u.name} → DOB set to ${u.dob}`);
    } catch (err) {
      console.error(`❌ ${u.name}: ${err.message}`);
    }
  }

  console.log('\n🎉 All DOBs updated!');
  process.exit(0);
}

fixDOB();
