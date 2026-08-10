const URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const KEY = 'sb_publishable_xRkLpc7cvht6D3UugO4TIQ_DKYZm1_d';

async function createUser(email, password, name, role) {
   const res = await fetch(`${URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
         apikey: KEY,
         'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
   });
   const data = await res.json();
   if(data.error || data.msg) {
       console.log("Auth Error for", email, data);
       // If email already registered, it might not return session. We could try logging in.
       if (data.msg && data.msg.includes("already registered")) {
           console.log("Attempting login to get token instead...");
           const loginRes = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
               method: 'POST',
               headers: { apikey: KEY, 'Content-Type': 'application/json' },
               body: JSON.stringify({ email, password })
           });
           const loginData = await loginRes.json();
           if (loginData.session) {
               console.log("Logged in:", email, "- skipping db insert just in case");
           }
       }
       return;
   }
   
   console.log("User signed up:", email);
   const uid = data.user ? data.user.id : data.id;
   const token = data.session ? data.session.access_token : KEY;
   
   const insRes = await fetch(`${URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
         apikey: KEY,
         Authorization: `Bearer ${token}`,
         'Content-Type': 'application/json',
         Prefer: 'return=representation'
      },
      body: JSON.stringify({
         id: uid,
         name: name,
         email: email,
         role: role,
         status: 'active'
      })
   });
   
   const insText = await insRes.text();
   console.log("DB Insert for", email, insText);
}

async function run() {
   await createUser('sales@connectinfosys.com', 'mtiwari@123', 'M Tiwari', 'lead');
   await createUser('Chandan.s@connectinfosys.com', 'Chandan@123', 'Chandan S', 'acct');
}

run();
