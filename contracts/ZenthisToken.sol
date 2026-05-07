// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ZenthisToken
 * @notice ZENTHIS ERC-20 with staking, pro-rata ETH fee distribution,
 *         ERC20Votes (governance), ERC20Permit, and burn.
 *
 * Fee model (Synthetix-style accumulator):
 *   rewardPerTokenStored  — cumulative ETH per staked token (scaled 1e18)
 *   userRewardPerTokenPaid[user]  — snapshot at last update
 *   rewards[user]  — pending claimable ETH
 *
 *   earned(user) = stakedBalance[user]
 *                  * (rewardPerTokenStored - userRewardPerTokenPaid[user])
 *                  / 1e18
 *                  + rewards[user]
 */
contract ZenthisToken is ERC20Votes, ERC20Permit, Ownable, ReentrancyGuard {

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;

    // ── Staking state ─────────────────────────────────────────────────────────
    uint256 public totalStaked;
    mapping(address => uint256) public stakedBalance;

    // ── Fee-distribution state (Synthetix accumulator) ────────────────────────
    uint256 public rewardPerTokenStored;                        // scaled × 1e18
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // ── Events ────────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event FeesDeposited(uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address treasury)
        ERC20("Zenthis", "ZENTHIS")
        ERC20Permit("Zenthis")
        Ownable(msg.sender)
    {
        require(treasury != address(0), "ZENTHIS: invalid treasury");
        _mint(treasury, MAX_SUPPLY);
    }

    // ── Internal: update accumulator for a user ───────────────────────────────
    modifier updateReward(address account) {
        rewardPerTokenStored = _rewardPerToken();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function _rewardPerToken() internal view returns (uint256) {
        // If nothing is staked, accumulator stays flat
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored;   // accumulator only moves on depositFees
    }

    // ── Public view: claimable ETH ────────────────────────────────────────────
    function earned(address account) public view returns (uint256) {
        return
            (stakedBalance[account] *
                (rewardPerTokenStored - userRewardPerTokenPaid[account])) /
            1e18 +
            rewards[account];
    }

    // ── Staking ───────────────────────────────────────────────────────────────

    /**
     * @notice Stake ZENTHIS tokens to earn pro-rata ETH fees.
     *         Caller must `approve` this contract first.
     */
    function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "ZENTHIS: cannot stake 0");
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
        _transfer(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Withdraw previously staked tokens.
     */
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(stakedBalance[msg.sender] >= amount, "ZENTHIS: insufficient stake");
        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        _transfer(address(this), msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ── Fee distribution ──────────────────────────────────────────────────────

    /**
     * @notice Owner deposits ETH fees collected from the protocol.
     *         Distributes pro-rata to all current stakers via the accumulator.
     */
    function depositFees() external payable onlyOwner {
        require(msg.value > 0, "ZENTHIS: zero fees");
        if (totalStaked > 0) {
            rewardPerTokenStored += (msg.value * 1e18) / totalStaked;
        }
        emit FeesDeposited(msg.value);
    }

    /**
     * @notice Claim accumulated ETH rewards.
     */
    function claimRewards() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "ZENTHIS: no rewards to claim");
        rewards[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: reward}("");
        require(ok, "ZENTHIS: ETH transfer failed");
        emit RewardClaimed(msg.sender, reward);
    }

    // ── Burn ──────────────────────────────────────────────────────────────────

    /**
     * @notice Burn caller's own tokens (deflationary mechanism).
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ── ERC20 overrides (required by ERC20Votes) ──────────────────────────────

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner_)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner_);
    }

    // ── Receive / fallback ────────────────────────────────────────────────────
    receive() external payable {
        // Accept ETH (e.g. from claimRewards failure recovery — not used normally)
    }
}
