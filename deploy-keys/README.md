# Program keypairs

These two files are the keypairs that determine the **program addresses** of the programs in
this repository:

| File | Program | Address |
| --- | --- | --- |
| `commit_once-keypair.json` | `programs/commit-once` | `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` |
| `demo_counter-keypair.json` | `programs/demo-counter` | `EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5` |

They are **committed on purpose**, and the reason is worth stating because committing a
keypair normally deserves suspicion.

## Why they are committed

A Solana program's address is derived from its keypair, and `declare_id!` is compiled *into*
the program. A program deployed at an address other than its `declare_id!` refuses to run.
So the keypair is not an optional secret — it is the input that produces the program's
identity, and without it:

* `scripts/build.sh` cannot place a keypair in Anchor's deploy directory, so `anchor build`
  generates a *new* one, producing a program whose ID does not match `declare_id!`. The
  build fails with a program-ID mismatch, or worse, silently produces an unusable artifact.
* `verify.sh` cannot check that `declare_id!` matches the keypair, because there is no
  keypair to check against.

Committing them is what makes `git clone && bash verify.sh` work. Without them the
repository is not reproducible by anyone but its author, which defeats the point of
open-sourcing it.

## Why it is safe here

The keypair that determines an address is **not** the upgrade authority. These are two
separate keys:

* the **program keypair** (this file) decides *where* the program lives;
* the **upgrade authority** decides *who may replace its code*.

The upgrade authority for the deployed devnet programs is a local keypair that is **not** in
this repository. So anyone holding these files can deploy *new* code at these addresses on a
cluster where nothing is deployed yet, but they cannot modify the programs that are already
live on devnet.

## What this means for mainnet

**Do not reuse these keypairs for a mainnet deployment.** Generate fresh ones:

```bash
solana-keygen new --no-bip39-passphrase -o deploy-keys/commit_once-keypair.json
solana-keygen new --no-bip39-passphrase -o deploy-keys/demo_counter-keypair.json
# then update declare_id! in both programs, and Anchor.toml, to the new addresses:
anchor keys sync      # or edit them by hand and verify
bash scripts/build.sh
```

The reason is a real supply-chain risk, not a formality. If the mainnet address is derived
from a **publicly known** keypair, anyone can deploy arbitrary code to that exact address on
mainnet before you do. Users and integrators who trust the address — which is the entire
basis of an on-chain integration — would then be interacting with an attacker's program.
Committing devnet keys is fine because nothing of value is at those addresses; committing
mainnet program keys is not.

The safe pattern is therefore: public keypairs for public test networks, secret keypairs for
mainnet, with `declare_id!` updated to match whichever set is in use.

## If these files are missing

`verify.sh` and `scripts/build.sh` both report the absence explicitly rather than failing
with a confusing downstream error. To restore a working build you must supply keypairs and
update the recorded IDs — see [`../RELEASE_RUNBOOK.md`](../RELEASE_RUNBOOK.md).
