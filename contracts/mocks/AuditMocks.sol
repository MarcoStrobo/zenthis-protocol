// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IHtlcEth {
    function newSwap(address recipient, bytes32 hashlock, uint256 timelock) external payable returns (bytes32);
}

interface IHtlcWithdraw {
    function withdrawPendingRefund(address payable to) external;
}

/// @dev TEST/AUDIT ONLY. ERC-20 that burns 10% of every transfer (fee-on-transfer).
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("FeeOnTransfer", "FOT") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 10;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @dev TEST/AUDIT ONLY. Contract wallet that opens a swap but cannot receive ETH.
contract RejectingInitiator {
    function start(IHtlcEth htlc, address recipient, bytes32 hashlock, uint256 timelock)
        external
        payable
        returns (bytes32)
    {
        return htlc.newSwap{value: msg.value}(recipient, hashlock, timelock);
    }

    function withdraw(IHtlcWithdraw htlc, address payable to) external {
        htlc.withdrawPendingRefund(to);
    }

    receive() external payable {
        revert("no ETH");
    }
}

/// @dev TEST/AUDIT ONLY. Forces ETH into any contract via selfdestruct.
contract ForceSend {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}
