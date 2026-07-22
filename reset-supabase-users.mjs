import https from 'https';

const SUPABASE_URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbXFwZ3VzcGJna2FwZmR2bHpxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE3NjUxMCwiZXhwIjoyMDk5NzUyNTEwfQ.v2KFOxEnLb55T2X8rXrBULx9NInQaBmIqtwivPbomv0';

function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...extraHeaders
      }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (!data) return resolve({});
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`HTTP ${res.statusCode} on ${path}: ${JSON.stringify(parsed)}`));
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode} on ${path}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const newUsers = [
  { email: 'prakhar.s@connectinfosys.com', role: 'admin', pass: 'admin123', name: 'Prakhar S' },
  { email: 'prateek.s@connectinfosys.com', role: 'admin', pass: 'admin123', name: 'Prateek S' },
  { email: 'tender@ipnetbroadband.com', role: 'tender', pass: 'rakhi123', name: 'Rakhi' },
  { email: 'tamanna@ipnetbroadband.com', role: 'acct', pass: 'tamanna@123', name: 'Tamanna' },
  { email: 'priyanka.s@connectinfosys.com', role: 'acct', pass: 'priyanka@123', name: 'Priyanka S' },
  { email: 'bharat.b@connectinfosys.com', role: 'acct', pass: 'bharat@123', name: 'Bharat B' },
  { email: 'vanshikavk2005@gmail.com', role: 'tech', pass: 'vanshikavk2005', name: 'Vanshika' },
  { email: 'ummat@connectinfosys.com', role: 'tech', pass: 'ummat', name: 'Ummat' },
  { email: 'rahul.m@connectinfosys.com', role: 'lead', pass: 'Airconnect@2026', name: 'Rahul M' },
  { email: 'abhishek.t@connectinfosys.com', role: 'lead', pass: 'Airconnect@2026', name: 'Abhishek T' }
];

async function main() {
  console.log('Fetching existing users from Supabase Auth...');
  try {
    const listRes = await request('GET', '/auth/v1/admin/users');
    const existingUsers = listRes.users || [];
    
    console.log(`Found ${existingUsers.length} existing users. Deleting them...`);
    for (const u of existingUsers) {
      try {
        await request('DELETE', `/auth/v1/admin/users/${u.id}`);
        console.log(`  Deleted ${u.email}`);
      } catch(e) {
        console.error(`  Failed to delete ${u.email}:`, e.message);
      }
    }
  } catch(e) {
    console.error('Error fetching users:', e.message);
  }

  // Also delete from public.users table just in case they aren't cascaded
  console.log('Clearing public.users table...');
  try {
    await request('DELETE', '/rest/v1/users?id=not.is.null');
  } catch(e) {
    console.log('Note: could not clear public.users (maybe empty or restricted):', e.message);
  }

  console.log('\nCreating new users...');
  for (const u of newUsers) {
    try {
      const res = await request('POST', '/auth/v1/admin/users', {
        email: u.email,
        password: u.pass,
        email_confirm: true,
        user_metadata: { name: u.name, role: u.role, department: u.role }
      });
      console.log(`  OK Created ${u.email} (${u.role}) -> ID: ${res.id}`);
      
      // Upsert into public.users
      const now = new Date().toISOString();
      await request('POST', '/rest/v1/users', [{
        id: res.id,
        name: u.name,
        email: u.email,
        role: u.role,
        department: u.role,
        status: 'active',
        created_at: now,
        updated_at: now
      }], { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      
    } catch(e) {
      console.error(`  Failed to create ${u.email}:`, e.message);
    }
  }
  console.log('\nDone!');
}

main().catch(console.error);
