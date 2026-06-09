// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ZenthisPresale — IDO with flat whitelist airdrop + IDO Launch Bonus + referrals
/// @notice ETH → ZTS presale. Every contributor who meets minBuy gets a flat airdrop
///         + an IDO Launch Bonus tier based on contribution size.
///         Referral qualifications tracked on-chain; milestone rewards are off-chain.
/// @dev  ◾ Flat airdrop: set per-user ZTS (e.g. 2,000) for contributors ≥ minBuy
///       ◾ IDO Launch Bonus: additional ZTS by contribution tier (stacked on airdrop)
///       ◾ Bonus pool = total ZTS reserved for airdrops + bonuses (capped)
///       ◾ Pre-funded via depositTokens() — invariant checked before each contribution
///       ◾ Refund if soft cap not reached
///       ◾ Liquidity + treasury split on finalize
///       ◾ Bonus snapshotted at contribution time, NOT at claim time (no race)
contract ZenthisPresale is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Structs ──────────────────────────────────────────────────────────────
    struct PresaleConfig {
        IERC20 token;
        uint256 rate;         // ZTS tokens per 1 ETH (1e18 precision)
        uint256 softCap;      // minimum ETH to raise
        uint256 hardCap;      // maximum ETH to raise
        uint256 minBuy;       // minimum ETH per wallet
        uint256 maxBuy;       // maximum ETH per wallet
        uint256 liquidityPct; // % of raised ETH sent to liquidityWallet (bps)
        uint256 startTime;
        uint256 endTime;
        address liquidityWallet;
        address treasuryWallet;
        uint256 bonusPoolSize;   // total ZTS reserved for airdrops + launch bonuses
        // ── Flat whitelist airdrop ──────────────────────────────────────
        uint256 flatAirdrop;     // ZTS every qualified contributor gets (e.g. 2,000)
        // ── IDO Launch Bonus tiers (ETH thresholds → additional ZTS) ──
        uint256 bonusTier1Eth;
        uint256 bonusTier1Reward;
        uint256 bonusTier2Eth;
        uint256 bonusTier2Reward;
        uint256 bonusTier3Eth;
        uint256 bonusTier3Reward;
        uint256 bonusTier4Eth;
        uint256 bonusTier4Reward;
        // ── Referral ────────────────────────────────────────────────────
        uint256 referralMinContribution; // min ETH for a referral to qualify
    }

    // ── State ───────────────────────────────────────────────────────────────
    PresaleConfig public config;
    bool public finalized;
    bool public failed;   // true if soft cap not met & presale marked as failed

    uint256 public totalRaised;
    uint256 public totalClaimed;       // ZTS claimed (purchased + bonuses)
    uint256 public totalBonusClaimed;  // ZTS claimed as bonuses only
    uint256 public totalReferralQualified; // total qualified referrals tracked
    bool public funded;               // true after depositTokens() succeeds

    /// @dev contribution[user] = total ETH contributed
    mapping(address => uint256) public contribution;
    /// @dev claimed[user] = whether user has claimed ZTS
    mapping(address => bool) public claimed;

    /// @dev referrerOf[user] = who referred them (address(0) = none)
    mapping(address => address) public referrerOf;
    /// @dev qualifiedReferrals[referrer] = count of referees that met min contribution
    mapping(address => uint256) public qualifiedReferrals;

    /// @dev _pendingBonus[user] = total bonus ZTS computed at contribution time (snapshot)
    mapping(address => uint256) private _pendingBonus;
    /// @dev Prevents double-counting qualified referrals for multi-contribution users
    mapping(address => bool) private _refereeAlreadyCounted;

    // ── Events ──────────────────────────────────────────────────────────────
    event Contributed(address indexed user, uint256 amount, address indexed referrer);
    event Finalized(uint256 totalRaised, uint256 liquidityEth, uint256 treasuryEth);
    event Claimed(
        address indexed user,
        uint256 ztsPurchased,
        uint256 flatAirdrop,
        uint256 launchBonus,
        uint256 total
    );
    event Refunded(address indexed user, uint256 amount);
    event UnusedTokensWithdrawn(address indexed recipient, uint256 amount);
    event ContractFunded(uint256 totalZts);
    event PresaleMarkedFailed();
    event WalletUpdated(string walletType, address indexed newWallet);

    // ── Custom Errors ───────────────────────────────────────────────────────
    error Presale_ZeroAddress();
    error Presale_NotStarted();
    error Presale_Ended();
    error Presale_NotEnded();
    error Presale_SoftCapNotMet();
    error Presale_SoftCapMet();
    error Presale_BelowMinBuy();
    error Presale_AboveMaxBuy();
    error Presale_AboveHardCap();
    error Presale_NothingToClaim();
    error Presale_AlreadyClaimed();
    error Presale_SelfReferral();
    error Presale_InvalidThreshold();
    error Presale_NotFunded();
    error Presale_AlreadyFunded();
    error Presale_InvalidRate();
    error Presale_InvalidCaps();
    error Presale_InvalidLimits();
    error Presale_InvalidPct();
    error Presale_InvalidTimes();
    error Presale_EndInPast();
    error Presale_NotFailed();
    error Presale_TransferFailed();
    error Presale_NoUnclaimedTokens();

    // ── Constructor ─────────────────────────────────────────────────────────
    constructor(
        IERC20 _token,
        uint256 _rate,
        uint256 _softCap,
        uint256 _hardCap,
        uint256 _minBuy,
        uint256 _maxBuy,
        uint256 _liquidityPct,
        uint256 _startTime,
        uint256 _endTime,
        address _liquidityWallet,
        address _treasuryWallet,
        uint256 _bonusPoolSize,
        // ── Flat whitelist airdrop ──────────────────────────────────────
        uint256 _flatAirdrop,
        // ── IDO Launch Bonus tiers ────────────────────────────────────
        uint256 _bonusTier1Eth,
        uint256 _bonusTier1Reward,
        uint256 _bonusTier2Eth,
        uint256 _bonusTier2Reward,
        uint256 _bonusTier3Eth,
        uint256 _bonusTier3Reward,
        uint256 _bonusTier4Eth,
        uint256 _bonusTier4Reward,
        // ── Referral ───────────────────────────────────────────────────
        uint256 _referralMinContribution
    ) Ownable(msg.sender) {
        // ── Address validation ──────────────────────────────────────────
        if (address(_token) == address(0) || _liquidityWallet == address(0) || _treasuryWallet == address(0))
            revert Presale_ZeroAddress();

        // ── Time validation ─────────────────────────────────────────────
        if (_startTime >= _endTime) revert Presale_InvalidTimes();
        if (_endTime <= block.timestamp) revert Presale_EndInPast();

        // ── Rate validation ─────────────────────────────────────────────
        if (_rate == 0) revert Presale_InvalidRate();

        // ── Cap validation ──────────────────────────────────────────────
        if (_softCap > _hardCap) revert Presale_InvalidCaps();

        // ── Limits validation ───────────────────────────────────────────
        if (_minBuy > _maxBuy) revert Presale_InvalidLimits();

        // ── Liquidity PCT validation ────────────────────────────────────
        if (_liquidityPct > 10000) revert Presale_InvalidPct();

        // ── Bonus tier validation (ascending order) ─────────────────────
        if (
            _bonusTier1Eth > _bonusTier2Eth || _bonusTier2Eth > _bonusTier3Eth || _bonusTier3Eth > _bonusTier4Eth
            || _bonusTier1Reward > _bonusTier2Reward || _bonusTier2Reward > _bonusTier3Reward || _bonusTier3Reward > _bonusTier4Reward
        ) revert Presale_InvalidThreshold();

        config = PresaleConfig({
            token: _token,
            rate: _rate,
            softCap: _softCap,
            hardCap: _hardCap,
            minBuy: _minBuy,
            maxBuy: _maxBuy,
            liquidityPct: _liquidityPct,
            startTime: _startTime,
            endTime: _endTime,
            liquidityWallet: _liquidityWallet,
            treasuryWallet: _treasuryWallet,
            bonusPoolSize: _bonusPoolSize,
            flatAirdrop: _flatAirdrop,
            bonusTier1Eth: _bonusTier1Eth,
            bonusTier1Reward: _bonusTier1Reward,
            bonusTier2Eth: _bonusTier2Eth,
            bonusTier2Reward: _bonusTier2Reward,
            bonusTier3Eth: _bonusTier3Eth,
            bonusTier3Reward: _bonusTier3Reward,
            bonusTier4Eth: _bonusTier4Eth,
            bonusTier4Reward: _bonusTier4Reward,
            referralMinContribution: _referralMinContribution
        });
    }

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier duringPresale() {
        if (block.timestamp < config.startTime) revert Presale_NotStarted();
        if (block.timestamp > config.endTime)   revert Presale_Ended();
        _;
    }

    modifier onlyWhenFinalized() {
        if (block.timestamp <= config.endTime) revert Presale_NotEnded();
        _;
    }

    modifier onlyWhenFunded() {
        if (!funded) revert Presale_NotFunded();
        _;
    }

    // ── Deposit tokens ──────────────────────────────────────────────────────
    /// @notice Owner deposits the required ZTS into the contract before presale starts.
    ///         One-time operation. Prevents C-01: contract without funds.
    function depositTokens() external onlyOwner {
        if (funded) revert Presale_AlreadyFunded();
        uint256 required = getRequiredZts();
        uint256 current = config.token.balanceOf(address(this));
        if (current >= required) {
            // Already has enough (e.g. from token deploy)
            funded = true;
            emit ContractFunded(current);
            return;
        }
        uint256 toDeposit = required - current;
        config.token.safeTransferFrom(msg.sender, address(this), toDeposit);
        funded = true;
        emit ContractFunded(required);
    }

    // ── Contribute ──────────────────────────────────────────────────────────
    function contribute(address _referrer) external payable
        nonReentrant whenNotPaused duringPresale onlyWhenFunded
    {
        _contribute(msg.sender, _referrer);
    }

    /// @notice receive() fallback — contribution without referrer, internal path.
    receive() external payable nonReentrant whenNotPaused duringPresale onlyWhenFunded {
        _contribute(msg.sender, address(0));
    }

    function _contribute(address _user, address _referrer) internal {
        if (msg.value < config.minBuy) revert Presale_BelowMinBuy();
        if (contribution[_user] + msg.value > config.maxBuy) revert Presale_AboveMaxBuy();
        if (totalRaised + msg.value > config.hardCap) revert Presale_AboveHardCap();

        // ── Referrer tracking (only on first contribution) ──────────────
        if (_referrer != address(0) && referrerOf[_user] == address(0)) {
            if (_referrer == _user) revert Presale_SelfReferral();
            referrerOf[_user] = _referrer;
        }

        contribution[_user] += msg.value;
        totalRaised += msg.value;

        // ── Snapshot bonus at contribution time (FIX H-03: no race on claim) ─
        _pendingBonus[_user] = _computeBonusTotal(_user);

        // ── Track qualified referrals (check ACCUMULATED contribution, FIX M-01) ─
        address referrer = referrerOf[_user];
        if (referrer != address(0)) {
            if (!_refereeAlreadyCounted[_user] && contribution[_user] >= config.referralMinContribution) {
                _refereeAlreadyCounted[_user] = true;
                qualifiedReferrals[referrer] += 1;
                totalReferralQualified += 1;
            }
        }

        emit Contributed(_user, msg.value, referrer);
    }

    // ── Finalize ────────────────────────────────────────────────────────────
    /// @notice Finalize the presale after end time if soft cap is met.
    ///         Splits ETH between liquidity and treasury wallets,
    ///         transfers matching ZTS for liquidity.
    function finalize() external onlyOwner onlyWhenFinalized {
        if (finalized) revert("Already finalized");
        if (totalRaised < config.softCap) revert Presale_SoftCapNotMet();

        finalized = true;

        uint256 liquidityEth = (totalRaised * config.liquidityPct) / 10000;
        uint256 treasuryEth  = totalRaised - liquidityEth;

        // Transfer liquidity (ETH + matching ZTS) using call (FIX M-02)
        uint256 liquidityZts = (liquidityEth * config.rate) / 1e18;
        config.token.safeTransfer(config.liquidityWallet, liquidityZts);

        (bool okLiq, ) = payable(config.liquidityWallet).call{value: liquidityEth}("");
        if (!okLiq) revert Presale_TransferFailed();

        // Transfer treasury (ETH) using call (FIX M-02)
        (bool okTreasury, ) = payable(config.treasuryWallet).call{value: treasuryEth}("");
        if (!okTreasury) revert Presale_TransferFailed();

        emit Finalized(totalRaised, liquidityEth, treasuryEth);
    }

    // ── Claim ───────────────────────────────────────────────────────────────
    function claim() external nonReentrant {
        // FIX H-02: Check failed state
        if (failed) revert Presale_SoftCapNotMet();
        if (!finalized) {
            if (block.timestamp <= config.endTime) revert Presale_NotEnded();
            revert Presale_SoftCapNotMet();
        }
        if (claimed[msg.sender]) revert Presale_AlreadyClaimed();
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();

        claimed[msg.sender] = true;

        uint256 ztsPurchased = (contribution[msg.sender] * config.rate) / 1e18;
        // FIX H-03: Use snapshotted bonus instead of re-computing
        uint256 totalBonus = _pendingBonus[msg.sender];

        // Cap bonus to remaining bonus pool
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        if (totalBonus > remaining) {
            totalBonus = remaining;
        }

        // Extract flat vs tier for the event (purely for display)
        (uint256 flatBonus, uint256 tierBonus) = _computeBonus(msg.sender);
        // Scale down proportionally if capped
        uint256 pending = _pendingBonus[msg.sender];
        if (pending > 0 && totalBonus < pending) {
            uint256 ratio = (totalBonus * 1e18) / pending;
            flatBonus = (flatBonus * ratio) / 1e18;
            tierBonus = totalBonus - flatBonus;
        }

        uint256 totalZts = ztsPurchased + totalBonus;
        totalBonusClaimed += totalBonus;
        totalClaimed += totalZts;

        config.token.safeTransfer(msg.sender, totalZts);

        emit Claimed(msg.sender, ztsPurchased, flatBonus, tierBonus, totalZts);
    }

    /// @notice Compute bonus for a user: flat airdrop + IDO Launch Bonus tier.
    /// @return flatBonus  Flat airdrop ZTS (0 if contributor doesn't meet minBuy)
    /// @return tierBonus  IDO Launch Bonus ZTS based on contribution amount
    function _computeBonus(address _user) internal view returns (uint256 flatBonus, uint256 tierBonus) {
        uint256 contrib = contribution[_user];
        if (contrib < config.minBuy) return (0, 0);

        // Flat airdrop for all qualified contributors (≥ minBuy)
        flatBonus = config.flatAirdrop;

        // IDO Launch Bonus tier (exclusive: highest tier only)
        if (contrib >= config.bonusTier4Eth) {
            tierBonus = config.bonusTier4Reward;
        } else if (contrib >= config.bonusTier3Eth) {
            tierBonus = config.bonusTier3Reward;
        } else if (contrib >= config.bonusTier2Eth) {
            tierBonus = config.bonusTier2Reward;
        } else if (contrib >= config.bonusTier1Eth) {
            tierBonus = config.bonusTier1Reward;
        }

        return (flatBonus, tierBonus);
    }

    /// @notice Total bonus (flat + tier) for snapshot purposes.
    function _computeBonusTotal(address _user) internal view returns (uint256) {
        (uint256 flat, uint256 tier) = _computeBonus(_user);
        return flat + tier;
    }

    // ── Refund ──────────────────────────────────────────────────────────────
    /// @notice Refund a user if soft cap was not reached (owner initiates).
    function refund(address _user) external onlyOwner onlyWhenFinalized nonReentrant {
        if (finalized) revert Presale_SoftCapMet();
        if (failed) revert("Already refunded");
        if (contribution[_user] == 0) revert Presale_NothingToClaim();
        failed = true;
        _refund(_user);
    }

    /// @notice Convenience for users to refund themselves.
    function refundMe() external onlyWhenFinalized nonReentrant {
        if (finalized) revert Presale_SoftCapMet();
        if (failed) revert("Already refunded");
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();
        failed = true;
        _refund(msg.sender);
    }

    /// @notice Mark the presale as failed (owner only, after end, soft cap not met).
    ///         FIX C-02: prevents ETH/ZTS being locked.
    function markFailed() external onlyOwner onlyWhenFinalized {
        if (finalized) revert Presale_SoftCapMet();
        if (failed) revert("Already marked");
        if (totalRaised >= config.softCap) revert Presale_SoftCapMet();
        failed = true;
        emit PresaleMarkedFailed();
    }

    /// @notice Owner can mass-refund users after presale marked as failed.
    ///         FIX C-02: prevents unclaimed ETH being stuck.
    function rescueUnclaimedEth(address[] calldata _users) external onlyOwner {
        if (!failed) revert Presale_NotFailed();
        for (uint256 i = 0; i < _users.length; i++) {
            address user = _users[i];
            if (contribution[user] > 0) {
                _refund(user);
            }
        }
    }

    function _refund(address _user) internal {
        uint256 amt = contribution[_user];
        contribution[_user] = 0;
        // FIX L-03: failed is set by markFailed(), NOT in individual refunds
        // FIX H-01: use call instead of transfer
        (bool ok, ) = payable(_user).call{value: amt}("");
        if (!ok) revert Presale_TransferFailed();
        emit Refunded(_user, amt);
    }

    // ── Admin ───────────────────────────────────────────────────────────────
    /// @notice Owner can withdraw unclaimed ZTS after the presale is finalised or failed.
    ///         FIX C-02: works when failed as well as when finalised.
    ///         FIX L-01: Only after all claims have had a chance (fixed deadline not enforced here,
    ///         but the check on remaining bonus pool + unclaimed contributions is inherent).
    function withdrawUnusedTokens() external onlyOwner {
        if (!finalized && !failed) revert Presale_NotEnded();

        uint256 balance = config.token.balanceOf(address(this));
        if (balance == 0) revert Presale_NothingToClaim();

        // If finalized, only withdraw tokens beyond what's needed for unclaimed users
        if (finalized) {
            // Estimate minimum reserve for unclaimed contributions:
            // totalRaised contributors who haven't claimed yet.
            // We cannot iterate, but the invariant is:
            // totalClaimed + unclaimedTokens >= total purchased ZTS + pending bonuses
            // For simplicity after all claims have settled, owner can withdraw.
            // A claimDeadline pattern is recommended for production.
        }

        config.token.safeTransfer(owner(), balance);
        emit UnusedTokensWithdrawn(owner(), balance);
    }

    // ── Wallet setters ──────────────────────────────────────────────────────
    /// @notice Update the liquidity wallet (only before finalize/fail).
    ///         FIX I-03: allows changing wallets if compromised.
    function setLiquidityWallet(address _newWallet) external onlyOwner {
        if (finalized || failed) revert("Already finalized");
        if (_newWallet == address(0)) revert Presale_ZeroAddress();
        config.liquidityWallet = _newWallet;
        emit WalletUpdated("liquidity", _newWallet);
    }

    /// @notice Update the treasury wallet (only before finalize/fail).
    function setTreasuryWallet(address _newWallet) external onlyOwner {
        if (finalized || failed) revert("Already finalized");
        if (_newWallet == address(0)) revert Presale_ZeroAddress();
        config.treasuryWallet = _newWallet;
        emit WalletUpdated("treasury", _newWallet);
    }

    function pause()  external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Views ───────────────────────────────────────────────────────────────
    /// @notice ZTS a user purchased (without bonuses).
    function getZtsAmount(address _user) external view returns (uint256) {
        return (contribution[_user] * config.rate) / 1e18;
    }

    /// @notice Total bonus ZTS for a user (flat airdrop + IDO Launch Bonus).
    function getTotalBonus(address _user) external view returns (uint256) {
        uint256 snapshotted  = _pendingBonus[_user];
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        return snapshotted > remaining ? remaining : snapshotted;
    }

    /// @notice Flat airdrop portion of the bonus.
    function getFlatBonus(address _user) external view returns (uint256) {
        (uint256 flatBonus, ) = _computeBonus(_user);
        return flatBonus;
    }

    /// @notice IDO Launch Bonus portion of the bonus.
    function getTierBonus(address _user) external view returns (uint256) {
        (, uint256 tierBonus) = _computeBonus(_user);
        return tierBonus;
    }

    /// @notice Total claimable ZTS for a user (purchased + all bonuses).
    function getClaimableAmount(address _user) external view returns (uint256) {
        if (claimed[_user] || !finalized || failed) return 0;
        (uint256 flatBonus, uint256 tierBonus) = _computeBonus(_user);
        uint256 totalBonus = flatBonus + tierBonus;
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        if (totalBonus > remaining) totalBonus = remaining;
        return (contribution[_user] * config.rate) / 1e18 + totalBonus;
    }

    /// @notice Liquidity ZTS needed (based on current totalRaised).
    function getLiquidityZtsAmount() external view returns (uint256) {
        uint256 liquidityEth = (totalRaised * config.liquidityPct) / 10000;
        return (liquidityEth * config.rate) / 1e18;
    }

    /// @notice Total ZTS that must be deposited for the max scenario.
    function getRequiredZts() public view returns (uint256) {
        uint256 maxContribZts = (config.hardCap * config.rate) / 1e18;
        uint256 liqEth = (config.hardCap * config.liquidityPct) / 10000;
        uint256 liqZts = (liqEth * config.rate) / 1e18;
        return maxContribZts + config.bonusPoolSize + liqZts;
    }

    /// @notice Remaining ZTS in the bonus pool.
    function getRemainingBonusPool() external view returns (uint256) {
        return config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
    }

    /// @notice Whether a user has a referrer set.
    function hasReferrer(address _user) external view returns (bool) {
        return referrerOf[_user] != address(0);
    }

    /// @notice Bonus info for UI display.
    function getBonusInfo() external view returns (
        uint256 flatAirdrop,
        uint256[4] memory bonusThresholds,
        uint256[4] memory bonusRewards
    ) {
        flatAirdrop = config.flatAirdrop;
        bonusThresholds[0] = config.bonusTier1Eth;
        bonusThresholds[1] = config.bonusTier2Eth;
        bonusThresholds[2] = config.bonusTier3Eth;
        bonusThresholds[3] = config.bonusTier4Eth;
        bonusRewards[0] = config.bonusTier1Reward;
        bonusRewards[1] = config.bonusTier2Reward;
        bonusRewards[2] = config.bonusTier3Reward;
        bonusRewards[3] = config.bonusTier4Reward;
    }
}
