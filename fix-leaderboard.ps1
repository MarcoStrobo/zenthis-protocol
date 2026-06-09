$c = [System.IO.File]::ReadAllText("C:\Users\Suko\Documents\Solvx\web\airdrop.html", [System.Text.Encoding]::UTF8)

$old = 'window.loadLeaderboard = async function() {
  try {
    const q = query(collection(db, ''waitlist''), where(''refCount'', ''>'', 0), limit(50));
    const snap = await getDocs(q);
    const users = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.refCount && data.refCount > 0) {
        let handle = data.twitter || data.email || d.id;
        if (handle.startsWith(''@@'')) handle = ''@'' + handle.slice(2);
        else if (!handle.startsWith(''@'')) handle = ''@'' + handle;
        users.push({ handle: handle.slice(0, 22), count: data.refCount || 0, email: (data.email || '''').toLowerCase() });
      }
    });
    users.sort((a, b) => b.count - a.count);
    const top = users.slice(0, 20);'

$new = 'window.loadLeaderboard = async function() {
  try {
    // Count real referrals by grouping referredBy field
    const allSnap = await getDocs(collection(db, ''waitlist''));
    const refCounts = {};
    const userInfo = {};

    allSnap.forEach(d => {
      const data = d.data();
      // Index user by their refCode
      const refCode = data.refCode || '''';
      const twitter = data.twitter || data.email || d.id;
      const handle = twitter.startsWith(''@'') ? twitter.slice(0, 22) : ''@'' + twitter.slice(0, 20);
      if (refCode) userInfo[refCode] = { handle, email: (data.email || '''').toLowerCase() };
      // Count referrals who used this user''s code
      const refBy = data.referredBy || null;
      if (refBy) refCounts[refBy] = (refCounts[refBy] || 0) + 1;
    });

    const users = Object.entries(refCounts)
      .filter(([code]) => userInfo[code])
      .map(([code, count]) => ({ handle: userInfo[code].handle, count, email: userInfo[code].email }));
    users.sort((a, b) => b.count - a.count);
    const top = users.slice(0, 20);'

$c = $c.Replace($old, $new)
[System.IO.File]::WriteAllText("C:\Users\Suko\Documents\Solvx\web\airdrop.html", $c, [System.Text.Encoding]::UTF8)

# Verify
$has = $c.Contains("refCounts")
Write-Output "Fixed: refCounts=$has"
