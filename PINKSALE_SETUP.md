# ZENTHIS — Guía de configuración PinkSale IDO

> TGE: **15 de junio de 2026** | Hardcap: **$2,500,000** | Precio IDO: **$0.10 / ZENTHIS**

---

## Prerequisitos antes de entrar a PinkSale

- [ ] Contratos desplegados en mainnet (`npm run deploy:mainnet`)
- [ ] Dirección de ZENTHIS token guardada (del archivo `deployments/mainnet.json`)
- [ ] 25,000,000 ZENTHIS en el wallet IDO (`WALLET_IDO`)
- [ ] Wallet con ETH suficiente para gas (~0.05 ETH)
- [ ] Cuenta en PinkSale verificada (KYC si lo requieren)

---

## PASO 1 — Aprobar tokens para PinkSale

Antes de crear la presale, el wallet IDO debe aprobar a PinkSale para gastar los tokens.

En Etherscan → ZENTHIS contract → Write → `approve`:
```
spender : <PinkSale Presale Router — Ethereum mainnet>
amount  : 25000000000000000000000000   (25M con 18 decimales)
```

O vía script:
```js
await token.approve(PINKSALE_ROUTER, ethers.parseEther("25000000"));
```

> La dirección del router de PinkSale en Ethereum mainnet:
> `0x...(consultar docs.pinksale.finance/ethereum)`

---

## PASO 2 — Crear la Presale en PinkSale

Ve a **pinksale.finance → Create → Standard Presale (ERC-20)**

### 2.1 Token Information

| Campo | Valor |
|---|---|
| Token Address | `<tu dirección ZENTHIS de mainnet.json>` |
| Token Name | Zenthis |
| Token Symbol | ZENTHIS |
| Token Decimals | 18 |

### 2.2 Presale Rate & Caps

| Campo | Valor | Notas |
|---|---|---|
| **Presale Rate** | `10` | 10 ZENTHIS por 1 USDC (= $0.10/token) |
| **Whitelist** | Disabled (o Enable si tienes whitelist) | |
| **Softcap** | `500000` USDC | $500,000 mínimo para finalizar |
| **Hardcap** | `2500000` USDC | $2,500,000 máximo |
| **Min Buy** | `100` USDC | Mínimo por wallet |
| **Max Buy** | `10000` USDC | Máximo por wallet |
| **Currency** | USDC | Más estable que ETH para presales |

> Si PinkSale no soporta USDC como currency en Ethereum, usar ETH:
> - Presale Rate: `30000` ZENTHIS / ETH (asumiendo ETH = $3,000)
> - Softcap: `167` ETH ≈ $500K
> - Hardcap: `834` ETH ≈ $2.5M

### 2.3 Liquidez & Uniswap

| Campo | Valor | Notas |
|---|---|---|
| **Listing On** | Uniswap V2 | |
| **Liquidity %** | `70` % | 70% de lo recaudado va a liquidez |
| **Listing Rate** | `8` | 8 ZENTHIS / USDC ($0.125/token, 25% premium post-IDO) |
| **Liquidity Lock** | `365` días | 12 meses mínimo recomendado |

> Con $2.5M recaudados y 70% a liquidez:
> - $1,750,000 USDC + tokens equivalentes → pool Uniswap V2
> - LP tokens bloqueados 12 meses automáticamente por PinkSale

### 2.4 Fechas

| Campo | Valor |
|---|---|
| **Presale Start** | 2026-05-15 00:00 UTC (1 mes antes del TGE) |
| **Presale End** | 2026-06-10 00:00 UTC (5 días antes del TGE) |
| **Liquidity Unlock** | 2027-06-15 00:00 UTC (1 año después del TGE) |

### 2.5 Información del Proyecto (para el listing)

| Campo | Valor |
|---|---|
| **Website** | https://zenthisprotocol.xyz |
| **Whitepaper** | https://zenthisprotocol.xyz/whitepaper.html |
| **Logo URL** | (URL pública de `zenthis_logo_profile_*.png`) |
| **Description** | Cross-chain atomic settlement protocol. Fixed supply 100M ZENTHIS. Governance, staking, and deflationary burn. |

---

## PASO 3 — Revisar y publicar

1. PinkSale mostrará un resumen — **revisar todos los valores antes de confirmar**
2. Confirmar la transacción desde el wallet IDO
3. PinkSale transferirá los tokens al contrato de presale automáticamente

---

## PASO 4 — Compartir el enlace

Una vez publicada, PinkSale genera una URL tipo:
```
https://pinksale.finance/ethereum/launchpad/0x<presale_contract>
```

Añadir este enlace en:
- [ ] `index.html` → sección IDO / CTA principal
- [ ] `airdrop.html` → banner de IDO
- [ ] Telegram bot → mensaje de anuncio
- [ ] Twitter/X, Discord

---

## PASO 5 — Cierre del IDO (automático)

Cuando la presale termina o se alcanza el hardcap, PinkSale ejecuta automáticamente:

1. **Finalize presale** → cualquier participante puede llamarlo tras el fin
2. **Añade liquidez a Uniswap V2** → crea el par ZENTHIS/USDC
3. **Bloquea LP tokens** → en el contrato de PinkSale Lock durante 12 meses
4. **Distribuye ZENTHIS** → a cada comprador directamente
5. **Devuelve el 30% restante** → al wallet del proyecto (para el tesoro)

> Si no se alcanza el softcap, los compradores pueden reclamar su reembolso directamente desde PinkSale.

---

## Cálculo de tokens para la presale

```
Hardcap:          $2,500,000 USDC
Precio IDO:       $0.10 / ZENTHIS
Tokens vendidos:  25,000,000 ZENTHIS

Distribución de fondos recaudados (hardcap):
  70% → Uniswap liquidez   = $1,750,000 USDC
  30% → Proyecto/tesoro    = $750,000 USDC

Liquidez en Uniswap:
  $1,750,000 USDC + ~14,000,000 ZENTHIS (al listing rate $0.125)
  → precio inicial post-IDO: $0.125 (25% premium)
```

---

## Checklist final antes de abrir la presale

- [ ] Contrato ZENTHIS verificado en Etherscan
- [ ] Contrato ZenthisVesting verificado en Etherscan
- [ ] 25M ZENTHIS en wallet IDO confirmados
- [ ] Aprobación de PinkSale router firmada
- [ ] Presale configurada y publicada en PinkSale
- [ ] URL de presale añadida a la web
- [ ] Anuncio publicado en redes sociales
- [ ] Bot de Telegram actualizado con la URL de presale

---

*Generado automáticamente — verificar siempre los valores con la documentación oficial de PinkSale antes del deploy.*
