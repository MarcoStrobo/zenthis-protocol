// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ZenthisPresale — IDO with flat whitelist airdrop + IDO Launch Bonus + referrals
/// @notice ETH → ZTS presale. Every contributor who meets minBuy gets a flat airdrop
///         + an IDO Launch Bonus tier based on contribution size.
///         Referral qualifications tracked on-chain; milestone rewards are off-chain.
///
/// @dev  ═════════════════════════════════════════════════════════════════════
///       DESIGN NOTES
///       ═════════════════════════════════════════════════════════════════════
///
///       ◾ Flat airdrop: set per-user ZTS (e.g. 2,000) for contributors ≥ minBuy
///       ◾ IDO Launch Bonus: additional ZTS by contribution tier (stacked on airdrop)
///       ◾ Bonus pool = total ZTS reserved for airdrops + bonuses (capped)
///       ◾ Pre-funded via depositTokens() — invariant checked before each contribution
///       ◾ Refund if soft cap not reached — owner marksFailed(), users call refundMe()
///       ◾ Liquidity + treasury split on finalize (2-step: request → timelock → execute)
///       ◾ Bonus snapshotted at contribution time, NOT at claim time (no race)
///       ◾ Claim deadline = endTime + 90 days, set automatically on finalize
///       ◾ liquidityWallet → debe ser un multisig (Gnosis Safe 2/2 mínimo)
///
///       ═════════════════════════════════════════════════════════════════════
///       LIQUIDITY ON FINALIZE
///       ═════════════════════════════════════════════════════════════════════
///
///       ZP-01: finalize() NO integra un DEX directamente. Envía ETH + ZTS de
///       liquidez a config.liquidityWallet. Para garantías on-chain:
///         1) liquidityWallet DEBE ser un multisig (Gnosis Safe)
///         2) finalize() requiere un timelock de FINALIZE_DELAY segundos desde
///            requestFinalize(), dando visibilidad a los inversores.
///       Después del claim deadline, el equipo puede añadir liquidez manualmente
///       al DEX de su elección usando los fondos de liquidityWallet + los ZTS
///       retirados vía withdrawUnusedTokens().
///
///       ═════════════════════════════════════════════════════════════════════
///       TOKEN ACCOUNTING — getRequiredZts()
///       ═════════════════════════════════════════════════════════════════════
///
///       ZP-02 (doble contabilización — FALSO POSITIVO): la fórmula suma TRES
///       pools de ZTS independientes:
///
///         pool A = maxContribZts = hardCap × rate       → lo que RECIBEN compradores
///         pool B = liqZts        = liqEth × rate         → LP match (adicional)
///         pool C = bonusPoolSize                         → bonus pool
///
///       Relación: finalize() transfiere B a liquidityWallet + liqEth (ETH).
///       Los compradores reclaman A del balance remanente. A y B no se solapan.
///
///       Ejemplo con hardCap=100ETH, rate=30k ZTS/ETH, liqPct=60%:
///         A = 3,000,000 ZTS para 100 ETH comprados
///         B = 1,800,000 ZTS + 60 ETH (LP match)
///         C = 1,500,000 ZTS (bonus)
///         Total = 6,300,000 ZTS — cada ZTS con destino único.
///
contract ZenthisPresale is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Constants ───────────────────────────────────────────────────────────
    /// @notice Timelock entre requestFinalize() y finalize() — ZP-01
    uint256 public constant FINALIZE_DELAY = 48 hours;

    /// @notice Ventana de reclamación tras finalize (endTime + CLAIM_WINDOW)
    uint256 public constant CLAIM_WINDOW = 90 * 24 * 60 * 60; // 90 days

    /// @notice Máximo de direcciones por llamada rescueUnclaimedEth() — ZP-09
    uint256 public constant MAX_RESCUE_BATCH = 200;

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
        uint256 bonusPoolSize;
        uint256 flatAirdrop;
        uint256 bonusTier1Eth;
        uint256 bonusTier1Reward;
        uint256 bonusTier2Eth;
        uint256 bonusTier2Reward;
        uint256 bonusTier3Eth;
        uint256 bonusTier3Reward;
        uint256 bonusTier4Eth;
        uint256 bonusTier4Reward;
        uint256 referralMinContribution;
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

    /// @dev Fecha tras la cual finalize() puede ejecutarse (set en requestFinalize)
    uint256 public finalizeReadyAt;

    /// @dev claimDeadline = endTime + CLAIM_WINDOW, set on finalize
    uint256 public claimDeadline;

    mapping(address => uint256) public contribution;
    mapping(address => bool) public claimed;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public qualifiedReferrals;

    /// @dev V4-L-02: eliminado _rescueProcessed — contribution[user] == 0 es guard suficiente

    /// @dev Snapshot: total bonus ZTS per user (flat + tier), computed at contribution
    mapping(address => uint256) private _pendingBonus;
    /// @dev Snapshot: flat portion, stored separately to avoid recompute in claim()
    mapping(address => uint256) private _pendingFlatBonus;
    mapping(address => bool) private _refereeAlreadyCounted;

    // ── Events ──────────────────────────────────────────────────────────────
    event Contributed(address indexed user, uint256 amount, address indexed referrer);
    event FinalizeRequested(uint256 readyAt);
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
    event WalletUpdated(string walletType, address indexed oldWallet, address indexed newWallet); // ZP-11
    event RefundSkipped(address indexed user);
    event ClaimDeadlineSet(uint256 deadline); // ZP-08: movido aquí

    // ── Custom Errors ───────────────────────────────────────────────────────
    error Presale_ZeroAddress();
    error Presale_ClaimDeadlineNotSet();  // ZP-15
    error Presale_ClaimWindowActive();    // ZP-15
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
    error Presale_AlreadyFinalized();
    error Presale_AlreadyFailed();
    error Presale_NotFinalizedOrFailed();
    error Presale_InvalidMinBuy();             // ZP-06
    error Presale_BatchTooLarge();             // ZP-09
    error Presale_AlreadyRequested();
    error Presale_TimelockPending();
    error Presale_InsufficientBalance();       // ZP-05
    error Presale_RenounceDisabled();          // V5-M-01

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
        // ── Addresses ────────────────────────────────────────────────
        if (address(_token) == address(0) || _liquidityWallet == address(0) || _treasuryWallet == address(0))
            revert Presale_ZeroAddress();

        // ── Timing — ZP-07 ───────────────────────────────────────────
        if (_startTime < block.timestamp) revert Presale_InvalidTimes();
        if (_startTime >= _endTime)        revert Presale_InvalidTimes();

        // ── Rates & Caps ─────────────────────────────────────────────
        if (_rate == 0)                    revert Presale_InvalidRate();
        if (_softCap > _hardCap)           revert Presale_InvalidCaps();
        if (_minBuy == 0)                  revert Presale_InvalidMinBuy(); // ZP-06
        if (_minBuy > _maxBuy)             revert Presale_InvalidLimits();
        if (_liquidityPct > 10000)         revert Presale_InvalidPct();

        // ── Bonus tiers ──────────────────────────────────────────────
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

    modifier onlyWhenEnded() {
        if (block.timestamp <= config.endTime) revert Presale_NotEnded();
        _;
    }

    modifier onlyWhenFunded() {
        if (!funded) revert Presale_NotFunded();
        _;
    }

    // ── Deposit tokens ──────────────────────────────────────────────────────
    /// @notice Depositar ZTS en el contrato. Puede llamarse en cualquier momento antes de
    ///         la primera contribución (funded = one-way).
    /// @dev V5-L-02: no se añadió restricción temporal — funded es one-way y contribuir
    ///      sin funding no es posible (onlyWhenFunded). El owner es quien controla.
    function depositTokens() external onlyOwner {
        if (funded) revert Presale_AlreadyFunded();
        uint256 required = getRequiredZts();
        uint256 current = config.token.balanceOf(address(this));
        if (current >= required) {
            funded = true;
            emit ContractFunded(required);
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

        // Snapshot bonus at contribution time (no race)
        (uint256 flatBonus, uint256 tierBonus) = _computeBonus(_user);
        _pendingFlatBonus[_user] = flatBonus;
        _pendingBonus[_user] = flatBonus + tierBonus;

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

    // ── Finalize (2-step with timelock — ZP-01) ────────────────────────────
    /// @notice Paso 1: solicitar finalización. Inicia un timelock de FINALIZE_DELAY.
    ///         Los inversores tienen visibilidad de finalizeReadyAt y pueden verificar
    ///         las direcciones de liquidityWallet y treasuryWallet durante el delay.
    /// @notice V4-L-03: defensa en profundidad contra failed
    function requestFinalize() external onlyOwner onlyWhenEnded {
        if (finalized)   revert Presale_AlreadyFinalized();
        if (failed)      revert Presale_AlreadyFailed();
        if (totalRaised < config.softCap) revert Presale_SoftCapNotMet();
        if (finalizeReadyAt != 0) revert Presale_AlreadyRequested();
        finalizeReadyAt = block.timestamp + FINALIZE_DELAY;
        emit FinalizeRequested(finalizeReadyAt);
    }

    /// @notice Paso 2: ejecutar finalización (solo tras timelock).
    ///         Transfiere ETH + ZTS de liquidez a liquidityWallet.
    ///         Incluye assert de balance suficiente (ZP-05).
    ///
    /// @dev ZP-14: softCap ya validado en requestFinalize() y totalRaised
    ///      es monotónico (solo crece), por lo que la validación duplicada
    ///      de softCap es código muerto y se ha eliminado.
    function finalize() external onlyOwner onlyWhenEnded {
        if (finalized)    revert Presale_AlreadyFinalized();

        // ── Timelock check — ZP-01 ────────────────────────────────────
        if (finalizeReadyAt == 0 || block.timestamp < finalizeReadyAt)
            revert Presale_TimelockPending();

        finalized = true;
        finalizeReadyAt = 0; // V6-L-02: limpia estado para herramientas de monitoreo
        claimDeadline = config.endTime + CLAIM_WINDOW;
        emit ClaimDeadlineSet(claimDeadline);

        uint256 liquidityEth = (totalRaised * config.liquidityPct) / 10000;
        uint256 treasuryEth  = totalRaised - liquidityEth;
        uint256 liquidityZts = (liquidityEth * config.rate) / 1e18;

        // ZP-05: verifica balance suficiente antes de transferir
        uint256 remainingZts = config.token.balanceOf(address(this));
        if (remainingZts < liquidityZts) revert Presale_InsufficientBalance();

        config.token.safeTransfer(config.liquidityWallet, liquidityZts);
        (bool okLiq, ) = payable(config.liquidityWallet).call{value: liquidityEth}("");
        if (!okLiq) revert Presale_TransferFailed();

        (bool okTreasury, ) = payable(config.treasuryWallet).call{value: treasuryEth}("");
        if (!okTreasury) revert Presale_TransferFailed();

        emit Finalized(totalRaised, liquidityEth, treasuryEth);
    }

    // ── Claim ───────────────────────────────────────────────────────────────
    function claim() external nonReentrant {
        if (failed) revert Presale_SoftCapNotMet();
        if (!finalized) {
            if (block.timestamp <= config.endTime) revert Presale_NotEnded();
            revert Presale_SoftCapNotMet();
        }
        if (claimed[msg.sender]) revert Presale_AlreadyClaimed();
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();

        claimed[msg.sender] = true;

        uint256 ztsPurchased = (contribution[msg.sender] * config.rate) / 1e18;
        uint256 totalBonus = _pendingBonus[msg.sender];
        uint256 flatBonus  = _pendingFlatBonus[msg.sender];

        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        uint256 tierBonus = totalBonus > flatBonus ? totalBonus - flatBonus : 0;

        // V4-M-01: evitar doble truncación — tierBonus absorbe el residuo
        if (totalBonus > remaining) {
            uint256 ratio = (remaining * 1e18) / totalBonus;
            flatBonus  = (flatBonus * ratio) / 1e18;
            tierBonus  = remaining - flatBonus;
            totalBonus = remaining;
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

    // ── Refund ──────────────────────────────────────────────────────────────
    function refundMe() external onlyWhenEnded nonReentrant {
        if (finalized) revert Presale_SoftCapMet();
        if (!failed) revert Presale_NotFailed();
        if (contribution[msg.sender] == 0) revert Presale_NothingToClaim();
        _refund(msg.sender);
    }

    /// @notice ZP-13: resetea finalizeReadyAt por si había un timelock pendiente
    function markFailed() external onlyOwner onlyWhenEnded {
        if (finalized) revert Presale_SoftCapMet();
        if (failed) revert Presale_AlreadyFailed();
        if (totalRaised >= config.softCap) revert Presale_SoftCapMet();
        failed = true;
        finalizeReadyAt = 0; // ZP-13
        emit PresaleMarkedFailed();
    }

    /// @notice Rescue masivo con skip-on-failure + límite de batch (ZP-03 + ZP-09).
    /// @dev V4-L-02: contribution[user] == 0 es guard suficiente, _rescueProcessed eliminado.
    /// @dev V5-L-01: el array _users NO debe contener direcciones duplicadas. Si una dirección
    ///      aparece dos veces y el primer intento falla, se reintentará inmediatamente con el
    ///      mismo resultado (gas desperdiciado). Si el primero tiene éxito, el segundo se salta.
    function rescueUnclaimedEth(address[] calldata _users) external onlyOwner nonReentrant {
        if (!failed) revert Presale_NotFailed();
        if (_users.length > MAX_RESCUE_BATCH) revert Presale_BatchTooLarge(); // ZP-09

        for (uint256 i = 0; i < _users.length; i++) {
            address user = _users[i];
            if (contribution[user] == 0) continue;

            uint256 amt = contribution[user];
            contribution[user] = 0;

            (bool ok, ) = payable(user).call{value: amt}("");
            if (ok) {
                emit Refunded(user, amt);
            } else {
                // Restore para reintento vía refundMe()
                contribution[user] = amt;
                emit RefundSkipped(user);
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
    /// @notice Retirar ZTS no usados tras finalize (post-claim window) o failed.
    /// @dev V4-L-01: misma ventana CLAIM_WINDOW en modo failed para mantener transparencia.
    /// @dev V6-I-03: depositTokens() no tiene restricción temporal (el owner decidió mantenerla flexible).
    function withdrawUnusedTokens() external onlyOwner {
        if (!finalized && !failed) revert Presale_NotFinalizedOrFailed();

        if (finalized) {
            if (claimDeadline == 0) revert Presale_ClaimDeadlineNotSet();   // ZP-15
            if (block.timestamp < claimDeadline) revert Presale_ClaimWindowActive(); // ZP-15
        } else {
            if (block.timestamp < config.endTime + CLAIM_WINDOW) revert Presale_ClaimWindowActive();
        }

        uint256 balance = config.token.balanceOf(address(this));
        if (balance == 0) revert Presale_NothingToClaim();
        config.token.safeTransfer(owner(), balance);
        emit UnusedTokensWithdrawn(owner(), balance);
    }

    /// @notice Cambiar wallet de liquidez.
    /// @dev ZP-12: bloqueado durante timelock salvo si finalize() falló tras expirar el timelock
    ///      (V5-L-03: stuck recovery — ambas wallets son cambiables si la transferencia ETH
    ///       revirtió, ya que Solidity revierte todo el estado de finalize()).
    /// @dev V6-L-03: errores semánticos separados por estado.
    function setLiquidityWallet(address _newWallet) external onlyOwner {
        if (_isStuck()) {
            // V5-L-03: finalize() falló tras timelock — permitir cambio para recuperación
        } else if (finalized) {
            revert Presale_AlreadyFinalized();
        } else if (failed) {
            revert Presale_AlreadyFailed();
        } else if (finalizeReadyAt != 0) {
            revert Presale_TimelockPending();
        }
        if (_newWallet == address(0)) revert Presale_ZeroAddress();
        emit WalletUpdated("liquidity", config.liquidityWallet, _newWallet); // ZP-11
        config.liquidityWallet = _newWallet;
    }

    /// @notice ZP-12: bloqueado durante timelock, salvo stuck recovery.
    /// @dev V5-L-03: misma lógica que setLiquidityWallet.
    /// @dev V6-L-03: errores semánticos separados por estado.
    function setTreasuryWallet(address _newWallet) external onlyOwner {
        if (_isStuck()) {
            // V5-L-03: finalize() falló tras timelock
        } else if (finalized) {
            revert Presale_AlreadyFinalized();
        } else if (failed) {
            revert Presale_AlreadyFailed();
        } else if (finalizeReadyAt != 0) {
            revert Presale_TimelockPending();
        }
        if (_newWallet == address(0)) revert Presale_ZeroAddress();
        emit WalletUpdated("treasury", config.treasuryWallet, _newWallet); // ZP-11
        config.treasuryWallet = _newWallet;
    }

    /// @dev Helper: ¿estamos en stuck recovery? (timelock expiró pero finalize() no completó)
    ///      V5-L-03: esto ocurre si la transferencia ETH en finalize() revierte —
    ///      Solidity revierte toda la transacción, pero la wallet que falló puede
    ///      cambiarse para reintentar.
    function _isStuck() internal view returns (bool) {
        return finalizeReadyAt != 0 && block.timestamp >= finalizeReadyAt && !finalized;
    }

    /// @notice V4-I-03: deshabilitar renuncia de ownership en contrato de IDO
    /// @dev V5-M-01: error dedicado, semanticamente correcto
    function renounceOwnership() public override onlyOwner {
        revert Presale_RenounceDisabled();
    }

    function pause()  external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Views ───────────────────────────────────────────────────────────────
    function getZtsAmount(address _user) external view returns (uint256) {
        return (contribution[_user] * config.rate) / 1e18;
    }

    function getTotalBonus(address _user) external view returns (uint256) {
        uint256 snapshotted = _pendingBonus[_user];
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        return snapshotted > remaining ? remaining : snapshotted;
    }

    /// @dev V5-I-03: usa snapshot en lugar de recomputar, consistente con claim()
    function getFlatBonus(address _user) external view returns (uint256) {
        return _pendingFlatBonus[_user];
    }

    /// @dev V6-M-01: guardia contra underflow (defensivo, el invariante siempre mantiene _pendingBonus >= _pendingFlatBonus)
    function getTierBonus(address _user) external view returns (uint256) {
        uint256 total  = _pendingBonus[_user];
        uint256 flat   = _pendingFlatBonus[_user];
        return total > flat ? total - flat : 0;
    }

    function getClaimableAmount(address _user) external view returns (uint256) {
        if (claimed[_user] || !finalized || failed) return 0;
        uint256 totalBonus = _pendingBonus[_user];
        uint256 remaining = config.bonusPoolSize > totalBonusClaimed
            ? config.bonusPoolSize - totalBonusClaimed
            : 0;
        if (totalBonus > remaining) totalBonus = remaining;
        return (contribution[_user] * config.rate) / 1e18 + totalBonus;
    }

    /// @notice ZTS de liquidez basado en totalRaised real
    function getLiquidityZtsAmount() external view returns (uint256) {
        uint256 liquidityEth = (totalRaised * config.liquidityPct) / 10000;
        return (liquidityEth * config.rate) / 1e18;
    }

    /// @notice ZTS necesarios para financiar el contrato en escenario hardCap.
    ///         ═══════════════════════════════════════════════════════════
    ///         Ver diseño en docstring del contrato — NO es doble conteo.
    ///         ═══════════════════════════════════════════════════════════
    ///         Pool A: maxContribZts = hardCap × rate
    ///                 → ZTS que los compradores reclaman (transfieren a sus wallets)
    ///         Pool B: liqZts = (hardCap × liqPct / 10000) × rate
    ///                 → ZTS enviados a liquidityWallet para LP match
    ///         Pool C: bonusPoolSize → ZTS para airdrop flat + launch bonuses
    ///
    ///         Estos tres pools son ADITIVOS. Los compradores no se quedan
    ///         sin sus ZTS por la transferencia a liquidez.
    function getRequiredZts() public view returns (uint256) {
        uint256 maxContribZts = (config.hardCap * config.rate) / 1e18;
        uint256 liqEth = (config.hardCap * config.liquidityPct) / 10000;
        uint256 liqZts = (liqEth * config.rate) / 1e18;
        return maxContribZts + config.bonusPoolSize + liqZts;
    }

    /// @notice Cobertura máxima teórica del bonus pool — ZP-04
    ///         Si bonusPoolSize < maxTheoreticalBonus, algunos usuarios recibirán
    ///         bonus escalados en claim(). Esto es intencional (pool limitado).
    function getMaxTheoreticalBonus() external view returns (uint256) {
        // Asume que hardCap se llena completamente con contribuidores de tier 4
        uint256 maxContributors = config.hardCap / config.minBuy;
        uint256 perUserMaxBonus = config.flatAirdrop + config.bonusTier4Reward;
        return maxContributors * perUserMaxBonus;
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
