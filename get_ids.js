const URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const KEY = 'sb_publishable_xRkLpc7cvht6D3UugO4TIQ_DKYZm1_d';

async function getUserId(email, password) {
   const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
         apikey: KEY,
         'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
   });
   const data = await res.json();
   if(data.user) {
       console.log(`INSERT INTO users (id, name, email, role, status, workspace_id) VALUES ('${data.user.id}', 'User', '${email}', '${email.includes('sales')?'lead':'acct'}', 'active', 'WS-DEFAULT');`);
   } else {
       console.log("Failed to login", email);
   }
}

async function run() {
   await getUserId('sales@connectinfosys.com', 'mtiwari@123');
   await getUserId('Chandan.s@connectinfosys.com', 'Chandan@123');
}
run();
