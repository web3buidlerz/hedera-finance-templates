# hedera-finance-templates

scaffold-hbar templates for the Hedera docs **Solutions → Finance Workflows** pages.
Each docs page is paired with one template that runs on testnet.

## Install a template

Each template lives on its own `templates/<name>` branch (create-scaffold-hbar only accepts `owner/repo#ref`, no subdirectories):

```bash
npx create-scaffold-hbar@latest --template web3buidlerz/hedera-finance-templates#templates/<name>
```

| Template | Docs page | Status |
|---|---|---|
| `dvp-settlement` | Settle a trade delivery-versus-payment in one atomic transfer | spike verified on testnet |
| `ats-bond` | Issue a tokenised bond with Asset Tokenization Studio | spike verified on testnet |
| `bond-coupons` | Pay bond coupons automatically with the Hedera Schedule Service | planned |
| `permissioned-security` | Issue a permissioned security token and run a court-order freeze | planned |
| `hcs-audit-trail` | Publish a tamper-evident audit trail and regulator feed with HCS | planned |

## This branch

`main` holds this index and `spikes/`: throwaway proofs that de-risk a template before it is built.
Template code never lands on `main`.

- `spikes/dvp` — proves atomic DvP with a scheduled two-leg `TransferTransaction`, including a no-KYC buyer where neither leg moves.
- `spikes/ats-bond` — issues a bond through the Asset Tokenization Studio v8 testnet factory with a plain operator key over JSON-RPC (the ATS SDK has no private-key signer), resolving the bond configuration's latest version first (version 0 reverts with `VersionZero`), grants the issuer `ROLE_ISSUER` and `ROLE_CONTROL_LIST` at deployment, turns the control list into an allowlist, issues to a listed investor and shows an unlisted one refused with `AccountIsBlocked`.
