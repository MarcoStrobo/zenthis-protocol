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
///       ◾ Refund if soft cap not reached — owner marksFailed(), users call refundMe()
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
    bool public failed;

    uint256 public totalRaised;
    uint256 public totalClaimed;
    uint256 public totalBonusClaimed;
    uint256 public totalReferralQualified;
    bool public funded;

    uint256 public claimDeadline; // 0 until owner sets it post-finalize

    mapping(address => uint256) public contribution;
    mapping(address => bool) public claimed;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public qualifiedReferrals;

    /// @dev Snapshot of total bonus ZTS per user, computed at contribution time
    mapping(address => uint256) private _pendingBonus;
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
    event ClaimDeadlineSet(uint256 deadline);

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
    error Presale_ClaimDeadlineNotSet();
    error Presale_ClaimsStillOpen();
    error Presale_AlreadyFinalized();
    error Presale_AlreadyFailed();
    error Presale_NotFinalizedOrFailed();

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
        uint256 _flatAirdrop,
        uint256 _bonusTier1Eth,
        uint256 _bonusTier1Reward,
        uint256 _bonusTier2Eth,
        uint256 _bonusTier2Reward,
        uint256 _bonusTier3Eth,
        uint256 _bonusTier3Reward,
        uint256 _bonusTier4Eth,
        uint256 _bonusTier4Reward,
        uint256 _referralMinContribution
    ) Ownable(msg.sender) {
        if (address(_token) == address(0) || _liquidityWallet == address(0) || _treasuryWallet == address(0))
            revert Presale_ZeroAddress();
        if (_startTime >= _endTime) revert Presale_InvalidTimes();
        if (_endTime <= block.timestamp) revert Presale_EndInPast();
        if (_rate == 0) revert Presale_InvalidRate();
        if (_softCap > _hardCap) revert Presale_InvalidCaps();
        if (_minBuy > _maxBuy) revert Presale_InvalidLimits();
        if (_liquidityPct > 10000) revert Presale_InvalidPct();
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
    /// @notice Owner deposits the required ZTS. One-time; prevents C-01.
    function depositTokens() external onlyOwner {
        if (funded) revert Presale_AlreadyFunded();
        uint256 required = getRequiredZts();
        uint256 current = config.token.balanceOf(address(this));
        if (current >= required) {
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

    /// @notice receive() fallback — contribution without referrer.
    receive() external payable nonReentrant whenNotPaused duringPresale onlyWhenFunded {
        _contribute(msg.sender, address(0));
    }

    function _contribute(address _user, address _referrer) internal {
        if (msg.value < config.minBuy) revert Presale_BelowMinBuy();
        if (contribution[_user] + msg.value > config.maxBuy) revert Presale_AboveMaxBuy();
        if (totalRaised + msg.value > config.hardCap) revert Presale_AboveHardCap();

        if (_referrer != address(0) && referrerOf[_user] == address(0)) {
            if (_referrer == _user) revert Presale_SelfReferral();
            referrerOf[_user] = _referrer;
        }

        contribution[_user] += msg.value;
        totalRaised += msg.value;

        // Snapshot bonus at contribution time (FIX H-03)
        _pendingBonus[_user] = _computeBonusTotal(_user);

        // Qualified referrals: check accumulated contribution (FIX M-01)
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
    function finalize() external onlyOwner onlyWhenFinalized {
        if (finalized) revert Presale_AlreadyFinalized();
        if (totalRaised < config.softCap) revert Presale_SoftCapNotMet();

        finalized = true;

        uint256 liquidityEth = (totalRaised * config.liquidityPct) / 10000;
        uint256 treasuryEth  = totalRaised - liquidityEth;

        // Transfer ZTS + ETH for liquidity (FIX M-02: call instead of transfer)
        uint256 liquidityZts = (liquidityEth * config.rate) / 1e18;
        config.token.safeTransfer(config.liquidityWallet, liquidityZts);

        (bool okLiq, ) = payable(config.liquidityWallet).call{value: liquidityEth}("");
        if (!okLiq) revert Presale_TransferFailed();

        (bool okTreasury, ) = payable(config.treasuryWallet).call{value: treasuryEth}("");
        if (!okTreasury) revert Presale_TransferFailed();

        emit Finalized(totalRaised, liquidityEth, treasuryEth);
    }

    // ── Set claim deadline ─────────────────────────────────────────────────
    /// @notice After finalize, owner sets a deadline after which withdrawUnusedTokens works.
    ///         N-H-01: prevents owner from draining unclaimed ZTS immediately.
    function setClaimDeadline(uint256 _deadline) external onlyOwner {
        if (!finalized) revert Presale_NotEnded();
        if (_deadline <= block.timestamp) revert Presale_EndInPast();
        claimDeadline = _deadline;
        emit ClaimDeadlineSet(_deadline);
    }

    // ── Claim ───────────────────────────────────────────────────────────────
    function claim() external nonReentrant {
        if (failed) revert Presale_SoftCapNotMet();    // FIX H-02
        if (!finalized) {
            if (block.timestamp <= config.endTime) revert Presale_NotEnded();
            revert Presale_SoftCapNotMet();
        }
        if (claimed[msg.sender]) revert Presale_AlreadyClaimed();
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();

        claimed[msg.sender] = true;

        uint256 ztsPurchased = (contribution[msg.sender] * config.rate) / 1e18;
        uint256 totalBonus = _pendingBonus[msg.sender]; // FIX H-03: snapshot

        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        if (totalBonus > remaining) totalBonus = remaining;

        // Scale event fields proportionally if pool-capped
        (uint256 flatBonus, uint256 tierBonus) = _computeBonus(msg.sender);
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

    // ── Bonus helpers ───────────────────────────────────────────────────────
    function _computeBonus(address _user) internal view returns (uint256 flatBonus, uint256 tierBonus) {
        uint256 contrib = contribution[_user];
        if (contrib < config.minBuy) return (0, 0);
        flatBonus = config.flatAirdrop;
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

    function _computeBonusTotal(address _user) internal view returns (uint256) {
        (uint256 flat, uint256 tier) = _computeBonus(_user);
        return flat + tier;
    }

    // ── Refund ──────────────────────────────────────────────────────────────
    /// @notice Users refund themselves only after owner has called markFailed().
    ///         FIX N-H-02: does NOT set failed=true — refundMe is not a race.
    function refundMe() external onlyWhenFinalized nonReentrant {
        if (finalized) revert Presale_SoftCapMet();
        if (!failed) revert Presale_NotFailed();
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();
        _refund(msg.sender);
    }

    /// @notice Owner marks the presale as failed (only after end, soft cap not met).
    ///         After this, any user can call refundMe() to get ETH back.
    function markFailed() external onlyOwner onlyWhenFinalized {
        if (finalized) revert Presale_SoftCapMet();
        if (failed) revert Presale_AlreadyFailed();
        if (totalRaised >= config.softCap) revert Presale_SoftCapMet();
        failed = true;
        emit PresaleMarkedFailed();
    }

    /// @notice Owner can mass-refund users after presale marked as failed.
    ///         FIX N-M-03: nonReentrant added.
    function rescueUnclaimedEth(address[] calldata _users) external onlyOwner nonReentrant {
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
        (bool ok, ) = payable(_user).call{value: amt}("");
        if (!ok) revert Presale_TransferFailed();
        emit Refunded(_user, amt);
    }

    // ── Admin ───────────────────────────────────────────────────────────────
    /// @notice Withdraw remaining ZTS after claim deadline or if presale failed.
    ///         FIX N-H-01: claimDeadline gate prevents draining unclaimed tokens.
    function withdrawUnusedTokens() external onlyOwner {
        if (!finalized && !failed) revert Presale_NotFinalizedOrFailed();

        if (finalized) {
            if (claimDeadline == 0) revert Presale_ClaimDeadlineNotSet();
            if (block.timestamp < claimDeadline) revert Presale_ClaimsStillOpen();
        }

        uint256 balance = config.token.balanceOf(address(this));
        if (balance == 0) revert Presale_NothingToClaim();

        config.token.safeTransfer(owner(), balance);
        emit UnusedTokensWithdrawn(owner(), balance);
    }

    /// @notice Update wallets before finalize/fail (FIX I-03).
    function setLiquidityWallet(address _newWallet) external onlyOwner {
        if (finalized || failed) revert Presale_AlreadyFinalized();
        if (_newWallet == address(0)) revert Presale_ZeroAddress();
        config.liquidityWallet = _newWallet;
        emit WalletUpdated("liquidity", _newWallet);
    }

    function setTreasuryWallet(address _newWallet) external onlyOwner {
        if (finalized || failed) revert Presale_AlreadyFinalized();
        if (_newWallet == address(0)) revert Presale_ZeroAddress();
        config.treasuryWallet = _newWallet;
        emit WalletUpdated("treasury", _newWallet);
    }

    function pause()  external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Views ───────────────────────────────────────────────────────────────
    function getZtsAmount(address _user) external view returns (uint256) {
        return (contribution[_user] * config.rate) / 1e18;
    }

    /// @notice Uses snapshot _pendingBonus (consistent with claim())
    function getTotalBonus(address _user) external view returns (uint256) {
        uint256 snapshotted = _pendingBonus[_user];
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        return snapshotted > remaining ? remaining : snapshotted;
    }

    function getFlatBonus(address _user) external view returns (uint256) {
        (uint256 flatBonus, ) = _computeBonus(_user);
        return flatBonus;
    }

    function getTierBonus(address _user) external view returns (uint256) {
        (, uint256 tierBonus) = _computeBonus(_user);
        return tierBonus;
    }

    /// @notice Uses snapshot _pendingBonus — consistent with claim() (FIX N-M-02)
    function getClaimableAmount(address _user) external view returns (uint256) {
        if (claimed[_user] || !finalized || failed) return 0;
        uint256 totalBonus = _pendingBonus[_user];
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        if (totalBonus > remaining) totalBonus = remaining;
        return (contribution[_user] * config.rate) / 1e18 + totalBonus;
    }

    function getLiquidityZtsAmount() external view returns (uint256) {
        uint256 liquidityEth = (totalRaised * config.liquidityPct) / 10000;
        return (liquidityEth * config.rate) / 1e18;
    }

    function getRequiredZts() public view returns (uint256) {
        uint256 maxContribZts = (config.hardCap * config.rate) / 1e18;
        uint256 liqEth = (config.hardCap * config.liquidityPct) / 10000;
        uint256 liqZts = (liqEth * config.rate) / 1e18;
        return maxContribZts + config.bonusPoolSize + liqZts;
    }

    function getRemainingBonusPool() external view returns (uint256) {
        return config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
    }

    function hasReferrer(address _user) external view returns (bool) {
        return referrerOf[_user] != address(0);
    }

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
