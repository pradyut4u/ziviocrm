const URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const KEY = 'sb_publishable_xRkLpc7cvht6D3UugO4TIQ_DKYZm1_d';

async function check() {
   const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sales@connectinfosys.com', password: 'mtiwari@123' })
   });
   const data = await res.json();
   console.log("Login result:", data);
}
check();
