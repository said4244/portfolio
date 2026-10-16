---
title: MySQL UDF privilege escalation
description: Van een MySQL-account met root-rechten naar command execution via lib_mysqludf_sys.dll, met een eerlijke uitleg van wat die DLL is en waarom MySQL hem uitvoert.
date: 2026-10-12
category:
  - Privilege Escalation
  - HackTheBox
tags:
  - privesc
  - htb
  - mysql
  - sql
  - windows
  - powershell
difficulty: medium
readingTime: 14 min
pinned: true
draft: false
---

> **⚠ Lab & autorisatie.** Alles hieronder is uitgevoerd in een geïsoleerde oefenomgeving (HackTheBox-stijl) die ik mag aanvallen. Dezelfde technieken toepassen op systemen zonder uitdrukkelijke, schriftelijke toestemming is strafbaar. Ik schrijf dit bewust ook vanuit verdedigingsperspectief: de detectie- en preventiesectie onderaan is net zo belangrijk als de aanval zelf.

> **◆ TL;DR.** MySQL kan functies laden uit externe libraries (UDF's). Draait de databaseservice met hoge rechten en heb je (a) een account met `FILE`-privilege en (b) schrijftoegang tot de plugin-map, dan kun je een kant-en-klare library naar die map schrijven, er een functie uit registreren, en commando's uitvoeren als het service-account. Dat is vaak `SYSTEM`.

Dit is een van die aanvallen die magisch lijkt tot je 'm één keer uit elkaar hebt getrokken. Je zit in een MySQL-shell, je typt één SELECT, en plots voer je commando's uit op het onderliggende besturingssysteem. Hoe kan een databaseprogramma dat überhaupt? Het antwoord is een legitieme feature die net iets te ver is doorgetrokken. Laten we het van de grond af opbouwen, zodat het aan het eind niet als een truc voelt maar als iets dat je zelf had kunnen bedenken.

## 00 · Het scenario: wat we al hebben

Stel: tijdens enumeratie van een Windows-machine vond ik losse MySQL-credentials in een config-bestand van een webapplicatie. Ze blijken te horen bij het `root`-account van MySQL (de databasebeheerder, niet de OS-gebruiker). Ik kan inloggen, maar ik zit "gevangen" in de database. Mijn doel: uitbreken naar het besturingssysteem.

Drie dingen moeten kloppen voordat deze aanval werkt. We checken ze zo meteen stuk voor stuk:

- Het MySQL-account heeft het `FILE`-privilege (mag bestanden lezen/schrijven op de server).
- We kennen de **plugin-map**: de map waaruit MySQL libraries laadt.
- De MySQL-service draait met rechten die hoger liggen dan die wij nu hebben (op Windows vaak `NT AUTHORITY\SYSTEM`).

## 01 · Wat is een UDF?

UDF staat voor **User-Defined Function**. MySQL komt met ingebouwde functies zoals `NOW()`, `CONCAT()` en `UPPER()`. Maar het laat ontwikkelaars ook eigen functies toevoegen, geschreven in C/C++ en gecompileerd tot een gedeelde library: een `.dll` op Windows, een `.so` op Linux.

Dat is een normale, bedoelde feature. Wil een bedrijf een hele snelle, custom berekening in de database? Dan schrijven ze die in C, compileren ze een library, zetten die in de plugin-map, en registreren ze de functie met `CREATE FUNCTION`. Vanaf dat moment roep je hem aan als elke andere SQL-functie.

Het gat: MySQL dwingt niet af dat die library "veilige" dingen doet. Een UDF is gewone native code en mag alles wat het service-account mag, inclusief een programma starten. En er bestaat al een kant-en-klare library die precies dat als functie aanbiedt.
![UDF-bestand, hoe openen of converteren? | FileDesc.com](/media/writeups/udf-400.png)

## 02 · Wat is lib_mysqludf_sys?

`lib_mysqludf_sys` is een publiek bekende UDF-library die een handvol functies exporteert waarmee je het onderliggende systeem aanraakt. De twee die ertoe doen:

- `sys_exec(cmd)` voert een OS-commando uit en geeft de exit-code terug (geen output).
- `sys_eval(cmd)` voert een commando uit en geeft de **uitvoer** als string terug. Dit is degene die je wil, want je ziet het resultaat direct in je query.

Onder de motorkap is dit niet spannend: de functie neemt jouw string en geeft hem door aan de C-standaardbibliotheek, effectief een `system()`/`popen()`-aanroep. Het "magische" is puur dat die aanroep plaatsvindt binnen het MySQL-proces, dus met de rechten van dat proces.

### Hoe exporteert een DLL zo'n functie eigenlijk?

Een UDF moet een vaste vorm aanhouden die de MySQL-engine verwacht. Voor een functie `sys_eval` bevat de DLL meestal drie geëxporteerde symbolen: `sys_eval_init()` (valideert argumenten bij registratie), `sys_eval()` (de eigenlijke functie, aangeroepen per rij) en `sys_eval_deinit()` (opruimen achteraf). Bij `CREATE FUNCTION ... SONAME 'lib_mysqludf_sys.dll'` laadt MySQL de DLL in zijn eigen procesgeheugen en koppelt het de SQL-naam aan het geëxporteerde symbool. Vanaf dat moment is "SQL" en "native code uitvoeren" voor de engine hetzelfde ding. Dát is de kern van de hele aanval.

## 03 · Rechten bevestigen

Ingelogd in MySQL controleer ik mijn uitgangspositie. Nooit stappen overslaan: als één hiervan faalt, stopt de keten en weet je meteen waar.

```sql
-- Wie ben ik binnen MySQL?
SELECT current_user();            -- verwacht: root@localhost

-- Welk OS/architectuur? bepaalt welke DLL ik nodig heb (x64 vs x86)
SELECT @@version_compile_os, @@version_compile_machine;

-- Waar laadt MySQL libraries vandaan?
SELECT @@plugin_dir;              -- bv. C:\ProgramData\MySQL\...\plugin\

-- Heb ik het FILE-privilege? Zoek naar FILE of ALL PRIVILEGES
SHOW GRANTS;
```

Twee dingen moeten hieruit komen: ik heb `FILE` (of `ALL PRIVILEGES`), en ik weet het exacte pad van `@@plugin_dir`. De architectuur bepaalt of ik de 64-bit of 32-bit variant van de DLL nodig heb; de verkeerde laadt simpelweg niet.

> **◆ Waarom FILE zo gevaarlijk is.** Het `FILE`-privilege lijkt onschuldig ("mag bestanden lezen en schrijven"). Maar schrijven naar de juiste map betekent code neerzetten die het serverproces vervolgens zelf uitvoert. Eén op het oog saaie permissie is hier de hele sleutel.

## 04 · De library op zijn plek krijgen

De DLL moet in `@@plugin_dir` belanden. Er zijn twee veelgebruikte routes, afhankelijk van wat de machine toestaat.

**Route A: schrijven vanuit MySQL zelf.** Met `FILE`-privilege kan MySQL binaire inhoud naar schijf schrijven met `SELECT ... INTO DUMPFILE`. De library wordt dan als hex-blob in de query meegegeven en op de bestemming weggeschreven. `DUMPFILE` (niet `OUTFILE`) is belangrijk: die bewaart de bytes exact, zonder dat MySQL er regeleindes doorheen gooit die een binary zouden breken.

```sql
-- 0x4D5A... is de volledige DLL als hex. Hier ingekort.
SELECT 0x4D5A90000300...
INTO DUMPFILE 'C:/ProgramData/MySQL/.../plugin/lib_mysqludf_sys.dll';
```

**Route B: gewoon uploaden.** Heb ik al een andere voet aan de grond (bijvoorbeeld een beperkte webshell of SMB-schrijftoegang) naar die map, dan zet ik het bestand daar direct neer. De library zelf is open source en voor-gecompileerd beschikbaar. Welke route ook: het eindresultaat is hetzelfde, het bestand staat in de plugin-map.

## 05 · De functie registreren en vuren

Nu de library op zijn plek staat, koppel ik de SQL-naam aan het symbool in de DLL, en test ik meteen read-only of het werkt:

```sql
-- Koppel SQL-functie aan het symbool in de DLL
CREATE FUNCTION sys_eval RETURNS STRING
  SONAME 'lib_mysqludf_sys.dll';

-- Bewijs van uitvoering (read-only, identificeert het service-account)
SELECT sys_eval('whoami');
-- -> nt authority\system   (jackpot: de service draait als SYSTEM)
```

Die `whoami` is het hele spel. Komt daar `nt authority\system` uit, dan voer ik dus commando's uit als de meest geprivilegieerde account op de machine, puur omdat de databaseservice daaronder draaide. Vanaf hier is het "gewoon" nog een betrouwbare shell opzetten.

> **◆ De laatste stap, bewust kort.** Met `sys_eval()` als command-primitive is de volgende logische stap een stabiele reverse shell terug naar mijn listener. De concrete payload hangt af van wat op de target beschikbaar is (PowerShell, een neergezette binary, een download-cradle). Ik laat de kant-en-klare payload hier weg; het punt van deze writeup is _waaróm_ de privesc werkt, niet het leveren van een copy-paste wapen.

## 06 · Blue team: detectie & preventie

Dit is het deel dat deze aanval nuttig maakt in plaats van alleen stoer. Elke stap in de keten heeft een verdediging die 'm breekt:

- **Least privilege op de service.** Draai MySQL niet als `SYSTEM` maar onder een dedicated low-priv service-account. Dan is een shell via deze route ineens veel minder waard.
- **secure_file_priv.** Zet `secure_file_priv` op een lege of ongevaarlijke map. Dat blokkeert `INTO DUMPFILE` naar de plugin-map, Route A valt weg.
- **FILE-privilege intrekken.** Applicatie-accounts hebben `FILE` vrijwel nooit nodig. Geen `FILE` betekent geen schrijven naar schijf vanuit SQL.
- **Monitor de plugin-map.** Een nieuw `.dll`-bestand in `plugin_dir` is bijna nooit legitiem op productie. File-integrity monitoring zet hier een alarm op.
- **EDR op child-processen.** `mysqld.exe` die ineens `cmd.exe` of `powershell.exe` start is een klassiek rood vlaggetje. Juist die proces-ouder/kind-relatie detecteren.
- **Wachtwoordhygiëne.** De hele keten begon met platte credentials in een config-bestand. Secrets horen niet leesbaar op schijf; gebruik een secrets-store en roteer.

## 07 · Samengevat

MySQL mag functies laden uit native libraries. Die libraries draaien binnen het serverproces, dus met de rechten van dat proces. Heb je een account dat bestanden mag schrijven én je weet waar MySQL libraries laadt, dan schrijf je een library die een command-shell aanbiedt, registreert die als functie, en voert commando's uit als het service-account. Geen exploit van een bug, maar misbruik van een legitieme feature plus te ruime rechten. Dat is bijna altijd het échte verhaal achter privilege escalation.

**Referenties:** MySQL Reference Manual (Adding a Loadable Function), HackTricks (MySQL UDF privilege escalation), de documentatie van lib_mysqludf_sys, en MITRE ATT&CK T1505 / T1068.
