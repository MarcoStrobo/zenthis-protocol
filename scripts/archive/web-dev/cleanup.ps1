param([string]$Path)
$c = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)

# Use simple substring replacements, avoiding CSS strings

# PinkSale
$c = $c.Replace('The IDO is launching on <strong>PinkSale</strong>. Whitelist', 'The IDO will be hosted directly on the Zenthis website. Whitelist')
$c = $c.Replace(' &nbsp;|&nbsp; IDO $0.10 via PinkSale', '')
$c = $c.Replace('<div class="ido-strip-item">' + [char]13 + [char]10 + '          <span class="ido-strip-label">Launchpad</span>' + [char]13 + [char]10 + '          <span class="ido-strip-value">PinkSale</span>' + [char]13 + [char]10 + '        </div>' + [char]13 + [char]10, '')
$c = $c.Replace('<li>ZENTHIS IDO on <strong>PinkSale</strong> — whitelist priority, then public — <strong>date TBA</strong></li>' + [char]13 + [char]10, '')
$c = $c.Replace('<li><strong>20%</strong> — Public Sale (PinkSale IDO)', '<li><strong>25%</strong> — Public Sale (IDO)')
$c = $c.Replace('<a href="https://pinksale.finance" target="_blank" rel="noopener" style="color:var(--primary)">PinkSale</a>. Wallets registered on the whitelist at zenthisprotocol.xyz receive guaranteed priority allocation before the public pool opens. Once the whitelist round closes, any remaining tokens enter the public pool on a first-come, first-served basis.', 'hosted directly on the Zenthis website. Wallets registered on the whitelist at zenthisprotocol.xyz receive guaranteed priority allocation before the public pool opens. Once the whitelist round closes, any remaining tokens enter the public pool on a first-come, first-served basis.')

# Burn
$c = $c.Replace('<small>Staking, burn & governance</small>', '<small>Staking & governance</small>')
$c = $c.Replace('Three mechanisms that create organic demand and progressive deflation' + [char]13 + [char]10 + '        as protocol volume grows.', 'Two core mechanisms that create organic demand' + [char]13 + [char]10 + '        as protocol volume grows.')
$c = $c.Replace('<div class="token-card featured">' + [char]13 + [char]10 + '          <div class="featured-badge">Deflationary</div>' + [char]13 + [char]10 + '          <div class="token-card-icon fire">?</div>' + [char]13 + [char]10 + '          <h3>Dynamic Burn</h3>' + [char]13 + [char]10 + '          <p>' + [char]13 + [char]10 + '            A portion of fees is used to buy back and burn ZENTHIS on the' + [char]13 + [char]10 + '            open market. Circulating supply <strong>shrinks with usage</strong>.' + [char]13 + [char]10 + '            Estimated annual reduction of <strong>2-5%</strong>.' + [char]13 + [char]10 + '          </p>' + [char]13 + [char]10 + '          <div class="token-metric">' + [char]13 + [char]10 + '            <span class="metric-label">Estimated reduction / year</span>' + [char]13 + [char]10 + '            <span class="metric-val">2-5%</span>' + [char]13 + [char]10 + '          </div>' + [char]13 + [char]10 + '        </div>' + [char]13 + [char]10, '')
$c = $c.Replace('Hard-capped total supply. Zero inflation from year 1. Deflationary burn' + [char]13 + [char]10 + '        activated from the very first swap.', 'Hard-capped total supply. Zero inflation from year 1.')

$emission = '<div class="emission-timeline">' + [char]13 + [char]10 + '        <h3>Projected emission &amp; burn</h3>' + [char]13 + [char]10 + '        <div class="timeline-bars">' + [char]13 + [char]10 + '          <div class="tbar-group">' + [char]13 + [char]10 + '            <div class="tbar-label">Year 0 (TGE)</div>' + [char]13 + [char]10 + '            <div class="tbar-track">' + [char]13 + [char]10 + '              <div class="tbar-fill circulating" style="width:13%"></div>' + [char]13 + [char]10 + '            </div>' + [char]13 + [char]10 + '            <div class="tbar-val">~13M circulating</div>' + [char]13 + [char]10 + '          </div>' + [char]13 + [char]10 + '          <div class="tbar-group">' + [char]13 + [char]10 + '            <div class="tbar-label">Year 1</div>' + [char]13 + [char]10 + '            <div class="tbar-track">' + [char]13 + [char]10 + '              <div class="tbar-fill circulating" style="width:45%"></div>' + [char]13 + [char]10 + '            </div>' + [char]13 + [char]10 + '            <div class="tbar-val">~45M circulating 0% inflation</div>' + [char]13 + [char]10 + '          </div>' + [char]13 + [char]10 + '          <div class="tbar-group">' + [char]13 + [char]10 + '            <div class="tbar-label">Year 2</div>' + [char]13 + [char]10 + '            <div class="tbar-track">' + [char]13 + [char]10 + '              <div class="tbar-fill circulating" style="width:70%"></div>' + [char]13 + [char]10 + '              <div class="tbar-fill burned" style="width:3%"></div>' + [char]13 + [char]10 + '            </div>' + [char]13 + [char]10 + '            <div class="tbar-val">~70M ~3% cumulative burn</div>' + [char]13 + [char]10 + '          </div>' + [char]13 + [char]10 + '          <div class="tbar-group">' + [char]13 + [char]10 + '            <div class="tbar-label">Year 4</div>' + [char]13 + [char]10 + '            <div class="tbar-track">' + [char]13 + [char]10 + '              <div class="tbar-fill circulating" style="width:82%"></div>' + [char]13 + [char]10 + '              <div class="tbar-fill burned" style="width:10%"></div>' + [char]13 + [char]10 + '            </div>' + [char]13 + [char]10 + '            <div class="tbar-val">~82M ~10% cumulative burn</div>' + [char]13 + [char]10 + '          </div>' + [char]13 + [char]10 + '        </div>' + [char]13 + [char]10 + '        <div class="tbar-legend">' + [char]13 + [char]10 + '          <span><span class="tbar-dot circulating"></span> Circulating</span>' + [char]13 + [char]10 + '          <span><span class="tbar-dot burned"></span> Burned</span>' + [char]13 + [char]10 + '        </div>' + [char]13 + [char]10 + '      </div>' + [char]13 + [char]10
$c = $c.Replace($emission, '')

$c = $c.Replace('<li><strong>Dynamic Burn:</strong> A portion of fees is used to buy back and burn ZENTHIS from the open market - reducing circulating supply by an estimated 2-5% annually as volume grows.</li>' + [char]13 + [char]10, '')
$c = $c.Replace('<br/>Burn: estimated 2-5% annual reduction in circulating supply as swap volume grows.', '')

# Immunefi
$c = $c.Replace('<div class="audit-card" style="opacity:.5">' + [char]13 + [char]10 + '              <div class="audit-logo tob" style="background:rgba(255,255,255,.04);color:var(--text-dim)">Immunefi Bug Bounty</div>' + [char]13 + [char]10 + '              <div class="audit-info">' + [char]13 + [char]10 + '                <span class="audit-result" style="background:rgba(255,255,255,.05);color:var(--text-dim);border-color:var(--border2)">At launch</span>' + [char]13 + [char]10 + '                <span class="audit-date">Community white-hat program</span>' + [char]13 + [char]10 + '              </div>' + [char]13 + [char]10 + '            </div>' + [char]13 + [char]10, '')

$c = $c.Replace('<a href="https://immunefi.com" target="_blank" rel="noopener">Bug Bounty</a>' + [char]13 + [char]10, '')

# Multisig 9/12
$c = $c.Replace('<div class="security-item">' + [char]13 + [char]10 + '            <div class="sec-icon">?</div>' + [char]13 + [char]10 + '            <div>' + [char]13 + [char]10 + '              <h4>9/12 Multisig for upgrades</h4>' + [char]13 + [char]10 + '              <p>No single actor can unilaterally upgrade contracts. Transitions to full on-chain governance via ZENTHIS token post-IDO.</p>' + [char]13 + [char]10 + '            </div>' + [char]13 + [char]10 + '          </div>' + [char]13 + [char]10, '')

# Insurance
$c = $c.Replace('<div class="security-item">' + [char]13 + [char]10 + '            <div class="sec-icon">?</div>' + [char]13 + [char]10 + '            <div>' + [char]13 + [char]10 + '              <h4>Insurance fund</h4>' + [char]13 + [char]10 + '              <p>5% of all protocol fees feed an insurance fund to cover any extraordinary or unforeseen loss events for LPs.</p>' + [char]13 + [char]10 + '            </div>' + [char]13 + [char]10 + '          </div>' + [char]13 + [char]10, '')

# Security text
$c = $c.Replace('All 3 core contracts verified on Etherscan Sepolia', 'ZenthisToken + ZenthisPresale verified on Base mainnet')

# Market cap
$c = $c.Replace('$1.5M', '~$1.3M')
$c = $c.Replace('15M (15%)', '~13M (13%)')

# Seed in FAQ tokenomics should be 10% not 15%
$c = $c.Replace('<li><strong>15%</strong> — Seed Round', '<li><strong>10%</strong> — Seed Round')

[System.IO.File]::WriteAllText($Path, $c, [System.Text.Encoding]::UTF8)
Write-Host "SAVED"
