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
| `ats-bond` | Issue a tokenised bond with Asset Tokenization Studio | planned |
| `bond-coupons` | Pay bond coupons automatically with the Hedera Schedule Service | planned |
| `permissioned-security` | Issue a permissioned security token and run a court-order freeze | planned |
| `hcs-audit-trail` | Publish a tamper-evident audit trail and regulator feed with HCS | planned |

## This branch

`main` holds this index and `spikes/`: throwaway proofs that de-risk a template before it is built.
Template code never lands on `main`.

- `spikes/dvp` — proves atomic DvP with a scheduled two-leg `TransferTransaction`, including a no-KYC buyer where neither leg moves.
