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

interface IHtlcReenter {
    function redeem(bytes32 swapId, bytes32 preimage) external;
    function refund(bytes32 swapId) external;
    function withdrawPendingRefund(address payable to) external;
}

/// @dev TEST/AUDIT ONLY. Contract that tries to re-enter the HTLC from its receive() and records
///      the revert data of every attempt. Used to prove the reentrancy guards are active.
contract ReentrantActor {
    IHtlcReenter public htlc;
    bytes32 public targetId;
    bytes32 public preimage;
    bool public reject; // when true, receive() reverts (to force a deferred refund)
    bool public attempted;
    bool public redeemOk;
    bool public refundOk;
    bool public withdrawOk;
    bytes public redeemReason;
    bytes public refundReason;
    bytes public withdrawReason;

    function arm(IHtlcReenter h, bytes32 id, bytes32 pre, bool rejectFirst) external {
        htlc = h;
        targetId = id;
        preimage = pre;
        reject = rejectFirst;
        attempted = false;
    }

    function setReject(bool r) external {
        reject = r;
    }

    function start(IHtlcEth h, address recipient, bytes32 hashlock, uint256 timelock)
        external
        payable
        returns (bytes32)
    {
        return h.newSwap{value: msg.value}(recipient, hashlock, timelock);
    }

    function pull(IHtlcReenter h) external {
        h.withdrawPendingRefund(payable(address(this)));
    }

    receive() external payable {
        if (reject) revert("rejected");
        if (attempted || address(htlc) == address(0)) return;
        attempted = true;
        try htlc.redeem(targetId, preimage) {
            redeemOk = true;
        } catch (bytes memory r) {
            redeemReason = r;
        }
        try htlc.refund(targetId) {
            refundOk = true;
        } catch (bytes memory r) {
            refundReason = r;
        }
        try htlc.withdrawPendingRefund(payable(address(this))) {
            withdrawOk = true;
        } catch (bytes memory r) {
            withdrawReason = r;
        }
    }
}
