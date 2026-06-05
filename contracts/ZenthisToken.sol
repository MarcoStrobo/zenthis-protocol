// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Zenthis Token (native asset of the SolvX ecosystem)
/// @notice 100 % minted at genesis; no minting afterwards
contract ZenthisToken is ERC20, ERC20Permit, ERC20Votes, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 1e18;   // 100,000,000 ZENTHIS

    // ── Staking ────────────────────────────────────────────────────────────────
    uint256 public totalStaked;
    uint256 public rewardPerTokenStored;
    uint256 public totalFeesDeposited;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public userRewardPerTokenPaid;

    // ── Events ─────────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event FeesDeposited(uint256 amount);

    // ── Errors ─────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStakedBalance();

    // ── Constructor ────────────────────────────────────────────────────────────
    /// @param treasury One-time recipient of the entire genesis supply
    constructor(address treasury)
        ERC20("Zenthis", "ZTS")
        ERC20Permit("Zenthis")
        Ownable(msg.sender)
    {
        if (treasury == address(0)) revert ZeroAddress();
        _mint(treasury, MAX_SUPPLY);
    }

    // ── Overrides ──────────────────────────────────────────────────────────────
    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner_)
        public view override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner_);
    }

    /// @notice Returns the voting power of an account, including staked tokens.
    /// @dev ERC20Votes normally only counts the token balance of the account.
    ///      Since staked tokens are held by this contract, they would otherwise
    ///      be excluded from voting. This override sums them back in.
    function getVotes(address account) public view override returns (uint256) {
        return super.getVotes(account) + stakedBalance[account];
    }

    // ── Staking internals ──────────────────────────────────────────────────────

    /// @notice Read the current reward-per-stored-token accumulator.
    /// @dev Unlike the Synthetix pattern, rewards are discrete (deposit-triggered),
    ///      so this simply returns the stored value without time-weighted math.
    function rewardPerToken() external view returns (uint256) {
        return rewardPerTokenStored;
    }

    /// @notice Compute the total earned rewards (claimed + pending) for an account.
    function earned(address account) public view returns (uint256) {
        uint256 userStaked = stakedBalance[account];
        if (userStaked == 0) return rewards[account];
        uint256 delta = rewardPerTokenStored - userRewardPerTokenPaid[account];
        return rewards[account] + (userStaked * delta) / 1e18;
    }

    /// @notice Update reward state for an account before state mutation.
    /// @dev Avoids dead SLOAD: reads rewardPerTokenStored directly instead of
    ///      routing through a wrapper function that returns the same value.
    modifier updateReward(address account) {
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ── Staking actions ────────────────────────────────────────────────────────

    /// @notice Stake ZTS tokens to earn protocol-fee rewards and governance voting power.
    /// @dev Overrides ERC20Votes.getVotes to include staked tokens in the staker's voting power.
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        totalStaked += amount;
        stakedBalance[msg.sender] += amount;
        _transfer(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake ZTS tokens
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (stakedBalance[msg.sender] < amount) revert InsufficientStakedBalance();
        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;
        _transfer(address(this), msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim accumulated ETH rewards
    function claimRewards() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward == 0) revert ZeroAmount();
        rewards[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: reward}("");
        require(ok, "ZENTHIS: claim transfer failed");
        emit RewardClaimed(msg.sender, reward);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    /// @notice Distribute protocol fees (ETH) to stakers. Called by owner.
    function depositFees() external payable onlyOwner {
        if (msg.value == 0) revert ZeroAmount();
        if (totalStaked > 0) {
            rewardPerTokenStored += (msg.value * 1e18) / totalStaked;
        }
        totalFeesDeposited += msg.value;
        emit FeesDeposited(msg.value);
    }

    // ── Burn ────────────────────────────────────────────────────────────────────

    /// @notice Burn own tokens
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ── Receive ─────────────────────────────────────────────────────────────────
    receive() external payable {
        // Accept ETH for protocol fee distribution
    }

    /// @notice Owner-only: withdraw ETH mistakenly sent to this contract.
    /// @dev Only ETH exceeding total deposited fees is withdrawable.
    ///      Staker rewards are protected — they always take priority over stuck ETH.
    function withdrawStuckETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > totalFeesDeposited, "ZENTHIS: no stuck ETH");
        uint256 amount = balance - totalFeesDeposited;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ZENTHIS: ETH withdrawal failed");
    }
}
