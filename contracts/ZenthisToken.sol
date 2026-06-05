// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


/// @title Zenthis Token (native asset of the SolvX ecosystem)
/// @notice 100% minted at genesis; no minting afterwards.
/// @dev    Inherits ERC20Permit (gasless approvals) and ERC20Votes (on-chain governance).
///         Staking uses a modified Synthetix rewards model where fees are deposited by the
///         owner and distributed pro-rata to all current stakers. Staked tokens preserve
///         their voting power in the OZ checkpoint system, so both getVotes() and
///         getPastVotes() reflect full governance weight.
contract ZenthisToken is ERC20, ERC20Permit, ERC20Votes, Ownable, ReentrancyGuard {
    /// @notice Maximum supply minted at genesis.
    uint256 public constant MAX_SUPPLY      = 100_000_000 * 1e18;   // 100,000,000 ZTS
    /// @notice Fixed-point precision for reward calculations (1e18).
    uint256 public constant REWARD_PRECISION = 1e18;

    // ── Staking ────────────────────────────────────────────────────────────────
    /// @notice Total amount of ZTS currently staked.
    uint256 public totalStaked;
    /// @notice Global accumulator of fee reward per staked token (scaled by REWARD_PRECISION).
    uint256 public rewardPerTokenStored;
    /// @notice Total ETH fees ever deposited (used to protect staker rewards in withdrawStuckETH).
    uint256 public totalFeesDeposited;

    /// @notice Amount of ZTS staked by each account.
    mapping(address => uint256) public stakedBalance;
    /// @notice Cached reward amount for each account (last checkpoint).
    mapping(address => uint256) public rewards;
    /// @notice Snapshot of rewardPerTokenStored at the time of the user's last action.
    mapping(address => uint256) public userRewardPerTokenPaid;

    // ── Events ─────────────────────────────────────────────────────────────────
    /// @notice Emitted when `user` stakes `amount` ZTS.
    event Staked(address indexed user, uint256 amount);
    /// @notice Emitted when `user` unstakes `amount` ZTS.
    event Unstaked(address indexed user, uint256 amount);
    /// @notice Emitted when `user` claims `amount` of ETH rewards.
    event RewardClaimed(address indexed user, uint256 amount);
    /// @notice Emitted when the owner deposits `amount` ETH as fees (rewardPerToken updated to `rewardPerToken`).
    event FeesDeposited(uint256 amount, uint256 rewardPerToken);
    /// @notice Emitted when the owner withdraws `amount` of stuck ETH.
    event StuckETHWithdrawn(address indexed to, uint256 amount);

    // ── Errors ─────────────────────────────────────────────────────────────────
    /// @notice Thrown when an address parameter is zero.
    error ZeroAddress();
    /// @notice Thrown when a required amount is zero.
    error ZeroAmount();
    /// @notice Thrown when attempting to unstake more than the user's staked balance.
    error InsufficientStakedBalance();
    /// @notice Thrown when an ETH transfer fails.
    error TransferFailed();
    /// @notice Thrown when there is no stuck ETH to withdraw (balance ≤ totalFeesDeposited).
    error NoStuckETH();
    /// @notice Thrown when depositing fees while there are zero stakers.
    error NoStakers();
    /// @notice Thrown when trying to rescue the staking token (ZTS) itself.
    error CannotRescueStakingToken();

    // ── Constructor ────────────────────────────────────────────────────────────
    /// @notice Mint the entire MAX_SUPPLY to the treasury address.
    /// @param treasury One-time recipient of the genesis supply. Reverts on zero address.
    constructor(address treasury)
        ERC20("Zenthis", "ZTS")
        ERC20Permit("Zenthis")
        Ownable(msg.sender)
    {
        if (treasury == address(0)) revert ZeroAddress();
        _mint(treasury, MAX_SUPPLY);
    }

    // ── Overrides ──────────────────────────────────────────────────────────────
    /// @inheritdoc ERC20Votes
    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    /// @inheritdoc ERC20Permit
    function nonces(address owner_)
        public view override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner_);
    }

    /// @notice Staked tokens count toward both getVotes and getPastVotes through
    ///         direct checkpoint manipulation in stake()/unstake() — no override needed.

    // ── Staking internals ──────────────────────────────────────────────────────

    /// @notice Read the current reward-per-stored-token accumulator.
    /// @dev Unlike the Synthetix pattern, rewards are discrete (deposit-triggered),
    ///      so this simply returns the stored value without time-weighted math.
    /// @return The current rewardPerTokenStored value.
    function rewardPerToken() external view returns (uint256) {
        return rewardPerTokenStored;
    }

    /// @notice Compute the total earned rewards (claimed + pending) for an account.
    /// @param account The address to query.
    /// @return The total reward amount, including already claimed and currently claimable.
    function earned(address account) public view returns (uint256) {
        uint256 userStaked = stakedBalance[account];
        if (userStaked == 0) return rewards[account];
        uint256 delta = rewardPerTokenStored - userRewardPerTokenPaid[account];
        return rewards[account] + (userStaked * delta) / REWARD_PRECISION;
    }

    /// @notice Update reward state for an account before state mutation.
    /// @dev Avoids dead SLOAD: reads rewardPerTokenStored directly instead of
    ///      routing through a wrapper function that returns the same value.
    /// @param account The address whose reward state is updated (skipped if zero).
    modifier updateReward(address account) {
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ── Staking actions ────────────────────────────────────────────────────────

    /// @notice Stake ZTS tokens to earn protocol-fee rewards and governance voting power.
    /// @dev Preserves voting power for staked tokens through OZ's native checkpoint system,
    ///      so both getVotes() and getPastVotes() reflect staked amounts without override.
    /// @param amount Quantity of ZTS tokens to stake. Must be > 0.
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        totalStaked += amount;
        stakedBalance[msg.sender] += amount;
        _transfer(msg.sender, address(this), amount);
        // Restore voting power: _transferVotingUnits (called inside _transfer/_update)
        // subtracts amount from the user's delegate. We add it back so staked tokens
        // are counted in the delegate's checkpoint, fixing both getVotes and getPastVotes.
        _transferVotingUnits(address(this), msg.sender, amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake ZTS tokens, returning them to the caller's wallet.
    /// @dev Voting power is decreased in lockstep with the token transfer (see stake()).
    /// @param amount Quantity of ZTS tokens to unstake. Must not exceed the caller's staked balance.
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (stakedBalance[msg.sender] < amount) revert InsufficientStakedBalance();
        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;
        _transfer(address(this), msg.sender, amount);
        // Remove the voting power that was restored on stake. The parent _transferVotingUnits
        // adds amount to the user's delegate, so we subtract it back for net zero change.
        _transferVotingUnits(msg.sender, address(this), amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim accumulated ETH rewards from protocol fees.
    /// @dev Transfers the entire pending reward to msg.sender. Reverts if reward is zero.
    function claimRewards() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward == 0) revert ZeroAmount();
        rewards[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: reward}("");
        if (!ok) revert TransferFailed();
        emit RewardClaimed(msg.sender, reward);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    /// @notice Distribute protocol fees (ETH) to stakers.
    /// @dev Reverts if there are no stakers to prevent ETH from being permanently locked
    ///      in the contract without a distribution mechanism.
    function depositFees() external payable onlyOwner {
        if (msg.value == 0) revert ZeroAmount();
        if (totalStaked == 0) revert NoStakers();
        rewardPerTokenStored += (msg.value * REWARD_PRECISION) / totalStaked;
        totalFeesDeposited += msg.value;
        emit FeesDeposited(msg.value, rewardPerTokenStored);
    }

    // ── Burn ────────────────────────────────────────────────────────────────────

    /// @notice Permanently remove ZTS tokens from circulation.
    /// @dev Reverts on zero amount to avoid wasting gas on no-op burns.
    /// @param amount Quantity of tokens to burn. Must be > 0.
    function burn(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount);
    }

    // ── Receive ─────────────────────────────────────────────────────────────────
    /// @notice Direct ETH sends are always rejected.
    /// @dev ETH must go through depositFees() to be tracked in totalFeesDeposited.
    ///      Untracked ETH would be considered "stuck" and could be withdrawn by the owner,
    ///      but this would break the invariant that balance ≥ totalFeesDeposited.
    receive() external payable {
        revert ZeroAmount();
    }

    // ── Rescue ──────────────────────────────────────────────────────────────────

    /// @notice Recover non-ZTS ERC-20 tokens accidentally sent to this contract.
    /// @dev ZTS itself cannot be rescued (guarded by CannotRescueStakingToken).
    /// @param tokenAddr The address of the ERC-20 token to recover.
    /// @param to        The recipient of the recovered tokens.
    function rescueERC20(IERC20 tokenAddr, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (address(tokenAddr) == address(this)) revert CannotRescueStakingToken();
        uint256 balance = tokenAddr.balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();
        if (!tokenAddr.transfer(to, balance)) revert TransferFailed();
    }

    /// @notice Withdraw ETH that entered the contract outside depositFees().
    /// @dev Only withdraws the excess over totalFeesDeposited so staker rewards are
    ///      never compromised. Reverts if there is no excess (NoStuckETH).
    function withdrawStuckETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance <= totalFeesDeposited) revert NoStuckETH();
        uint256 amount = balance - totalFeesDeposited;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit StuckETHWithdrawn(msg.sender, amount);
    }
}
