# GenLayer Intelligent Contract

## What it does

`contracts/witnessweave_contract.py` is WitnessWeave's single production
Intelligent Contract. It owns:

- **Escrow custody** — GEN bounty rewards (`create_bounty`) and optional
  witness bonds (`submit_testimony`) are locked via payable writes, reading
  only `gl.message.value`, never a caller-supplied amount.
- **Evaluation** — `evaluate_bounty` fetches every piece of evidence
  witnesses referenced (web pages via `gl.nondet.web.render`, images via
  `gl.nondet.web.get` + `gl.nondet.exec_prompt(images=...)`), reasons over
  corroboration/contradiction, and reaches validator consensus via
  `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` — the validator
  independently re-fetches evidence and re-judges from scratch, then checks
  numeric-tolerance agreement (not JSON-shape validity) before accepting the
  leader's result.
- **Settlement** — `settle` is fully deterministic and pays out per the
  verdict already recorded, using a zero-ledger-then-transfer ordering on
  every exit path.
- **Recovery** — `claim_timeout_refund` and `claim_bond_refund` guarantee
  funds are never locked forever, even if evaluation is never triggered or
  never reaches consensus.

Full design rationale is in the file's own header comment and in
[`MEMORY.md`](../MEMORY.md).

## Verifying the contract locally before deploying

```bash
python3 -c "import ast; ast.parse(open('contracts/witnessweave_contract.py').read())"
genvm-lint check contracts/witnessweave_contract.py --json
```

Both were run during development and pass clean (`lint.ok: true`,
`validate.ok: true`, contract class `WitnessWeave`, 13 public methods: 8
write, 5 view).

## Deploying to GenLayer Studio / StudioNet

1. Open [GenLayer Studio](https://studio.genlayer.com) and connect the
   wallet you want to own the contract with (this becomes `self.owner`).
2. Fund that wallet with GEN on StudioNet (Studio has a faucet for this).
3. Create a new contract, paste in the full contents of
   `contracts/witnessweave_contract.py`.
4. Deploy. The constructor (`__init__`) takes no parameters.
5. Once deployed, confirm you can read state:
   ```
   get_contract_info()
   ```
   should return JSON with your address as `owner`, `current_time` (a real unix timestamp),
   `total_bounties: 0`.
6. Copy the deployed **contract address**.

## Handing the address back

Set it in both:

- `apps/web/.env.local` → `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS=0x...`
- `apps/api/.env` → `GENLAYER_CONTRACT_ADDRESS=0x...`

Until this is set, the frontend shows an explicit "Intelligent Contract
isn't deployed yet" state on the create-bounty and submit-testimony forms
rather than pretending escrow works — per the project's "no fake
functionality" rule, nothing claims to move GEN until the real contract
address is wired in.

**The assistant does not deploy this contract or invent an address** — per
this project's working agreement, you deploy it yourself through GenLayer
Studio and provide the address back.
