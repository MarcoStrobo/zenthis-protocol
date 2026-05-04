// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ZENTHIS Token
/// @notice ERC-20 token for the Zenthis Protocol. Fixed supply, deflationary burn.
/// @dev Total supply: 100,000,000 ZENTHIS. No minting after deployment.
contract ZENTHIS is ERC20, Ownable {

    /// @notice Hard cap — no additional tokens can ever be minted.
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;

    /// @notice Cumulative amount of tokens permanently burned.
    uint256 public totalBurned;

    // ─── Events ──────────────────────────────────────────────────────────────

    event TokensBurned(address indexed from, uint256 amount);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param initialOwner Address that receives the full supply and owns the contract.
    constructor(address initialOwner)
        ERC20("Zenthis", "ZENTHIS")
        Ownable(initialOwner)
    {
        _mint(initialOwner, MAX_SUPPLY);
    }

    // ─── Burn ────────────────────────────────────────────────────────────────

    /// @notice Burn tokens from the caller's balance.
    /// @param amount Number of tokens to burn (in wei, 18 decimals).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        totalBurned += amount;
        emit TokensBurned(msg.sender, amount);
    }

    /// @notice Burn tokens from an approved address.
    /// @param account Address to burn tokens from.
    /// @param amount  Number of tokens to burn.
    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
        totalBurned += amount;
        emit TokensBurned(account, amount);
    }
}
