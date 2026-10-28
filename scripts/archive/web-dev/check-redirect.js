const { execSync } = require('child_process');
try {
  const r = execSync('curl.exe -s -o /dev/null -w "%{http_code} %{redirect_url}" "https://zenthisprotocol.xyz/?t=1"').toString();
  console.log('Response:', r);
} catch(e) {
  console.log('Error:', e.message);
}
