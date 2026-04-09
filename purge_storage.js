const SUPABASE_URL = "https://lgmggbnaoyoapxqsfgzv.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbWdnYm5hb3lvYXB4cXNmZ3p2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjU1MzE0MiwiZXhwIjoyMDg4MTI5MTQyfQ.SAPAT4OpGOAGmj2cTGHiprG--Lapj5bx5GezGF1PUy4";

async function deleteAndRecreateBucket(id, isPublic = true) {
    console.log(`Physically deleting bucket: ${id}`);
    
    // 1. Delete Bucket (this should clear physical storage)
    const delRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${id}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (delRes.ok) {
        console.log(`Successfully deleted bucket ${id}`);
    } else {
        const err = await delRes.text();
        console.error(`Failed to delete bucket ${id}: ${err}`);
        // If it failed because it's not empty, we are still stuck, but API delete usually handles it with service key
    }

    // 2. Recreate Bucket
    console.log(`Recreating bucket: ${id}`);
    const createRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: id,
            name: id,
            public: isPublic
        })
    });

    if (createRes.ok) {
        console.log(`Successfully recreated bucket ${id}`);
    } else {
        console.error(`Failed to recreate bucket ${id}: ${await createRes.text()}`);
    }
}

async function run() {
    await deleteAndRecreateBucket('screenshots', true);
    await deleteAndRecreateBucket('avatars', true);
    console.log("Physical purge via bucket recreation complete.");
}

run();
