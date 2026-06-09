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
///       ◾ Bonus pool = total ZTS reserved for airdrops + bonuses (capped FCFS)
///       ◾ Refund if soft cap not reached
///       ◾ Liquidity + treasury split on finalize
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
    bool public failed;   // true if soft cap not met & refund issued

    uint256 public totalRaised;
    uint256 public totalClaimed;       // ZTS claimed (purchased + bonuses)
    uint256 public totalBonusClaimed;  // ZTS claimed as bonuses only
    uint256 public totalReferralQualified; // total qualified referrals tracked

    /// @dev contribution[user] = total ETH contributed
    mapping(address => uint256) public contribution;
    /// @dev claimed[user] = whether user has claimed ZTS
    mapping(address => bool) public claimed;

    /// @dev referrerOf[user] = who referred them (address(0) = none)
    mapping(address => address) public referrerOf;
    /// @dev qualifiedReferrals[referrer] = count of referees that met min contribution
    mapping(address => uint256) public qualifiedReferrals;

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
    event UnusedTokensWithdrawn(uint256 amount);

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
        if (address(_token) == address(0) || _liquidityWallet == address(0) || _treasuryWallet == address(0))
            revert Presale_ZeroAddress();

        // Validate bonus tiers are ascending
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

    // ── Contribute ──────────────────────────────────────────────────────────
    function contribute(address _referrer) external payable
        nonReentrant whenNotPaused duringPresale
    {
        _contribute(msg.sender, _referrer);
    }

    /// @notice receive() fallback — contribution without referrer, internal path.
    receive() external payable nonReentrant whenNotPaused duringPresale {
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

        // ── Track qualified referrals (≥ min contribution) ──────────────
        address referrer = referrerOf[_user];
        if (referrer != address(0) && msg.value >= config.referralMinContribution) {
            if (!_refereeAlreadyCounted[_user]) {
                _refereeAlreadyCounted[_user] = true;
                qualifiedReferrals[referrer] += 1;
                totalReferralQualified += 1;
            }
        }

        emit Contributed(_user, msg.value, referrer);
    }

    /// @dev Prevents double-counting qualified referrals for multi-contribution users
    mapping(address => bool) private _refereeAlreadyCounted;

    // ── Finalize ────────────────────────────────────────────────────────────
    function finalize() external onlyOwner onlyWhenFinalized {
        if (finalized) revert("Already finalized");
        if (totalRaised < config.softCap) revert Presale_SoftCapNotMet();

        finalized = true;

        uint256 liquidityEth = (totalRaised * config.liquidityPct) / 10000;
        uint256 treasuryEth  = totalRaised - liquidityEth;

        // Transfer liquidity (ETH + matching ZTS)
        uint256 liquidityZts = (liquidityEth * config.rate) / 1e18;
        config.token.safeTransfer(config.liquidityWallet, liquidityZts);
        payable(config.liquidityWallet).transfer(liquidityEth);

        // Transfer treasury (ETH)
        payable(config.treasuryWallet).transfer(treasuryEth);

        emit Finalized(totalRaised, liquidityEth, treasuryEth);
    }

    // ── Claim ───────────────────────────────────────────────────────────────
    function claim() external nonReentrant {
        if (!finalized) {
            if (block.timestamp <= config.endTime) revert Presale_NotEnded();
            revert Presale_SoftCapNotMet();
        }
        if (claimed[msg.sender]) revert Presale_AlreadyClaimed();
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();

        claimed[msg.sender] = true;

        uint256 ztsPurchased = (contribution[msg.sender] * config.rate) / 1e18;
        (uint256 flatBonus, uint256 tierBonus) = _computeBonus(msg.sender);
        uint256 totalBonus = flatBonus + tierBonus;

        // Cap bonus to remaining bonus pool
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        if (totalBonus > remaining) {
            totalBonus = remaining;
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

    // ── Refund ──────────────────────────────────────────────────────────────
    /// @notice Refund a user if soft cap was not reached (owner initiates).
    function refund(address _user) external onlyOwner onlyWhenFinalized {
        if (finalized) revert Presale_SoftCapMet();
        if (contribution[_user] == 0) revert Presale_NothingToClaim();
        _refund(_user);
    }

    /// @notice Convenience for users to refund themselves.
    function refundMe() external onlyWhenFinalized {
        if (finalized) revert Presale_SoftCapMet();
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();
        _refund(msg.sender);
    }

    function _refund(address _user) internal {
        uint256 amt = contribution[_user];
        contribution[_user] = 0;
        failed = true;
        payable(_user).transfer(amt);
        emit Refunded(_user, amt);
    }

    // ── Admin ───────────────────────────────────────────────────────────────
    function withdrawUnusedTokens() external onlyOwner {
        if (!finalized) revert Presale_NotEnded();

        uint256 balance = config.token.balanceOf(address(this));
        if (balance == 0) revert Presale_NothingToClaim();

        config.token.safeTransfer(owner(), balance);
        emit UnusedTokensWithdrawn(balance);
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
        (uint256 flatBonus, uint256 tierBonus) = _computeBonus(_user);
        uint256 total = flatBonus + tierBonus;
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        return total > remaining ? remaining : total;
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
    function getRequiredZts() external view returns (uint256) {
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
