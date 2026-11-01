---
name: writeup-schrijver
description: Stijlgids voor het schrijven van offensive-security writeups op Said's blog. Definieert schrijfstijl, taalgebruik, structuur, diagrammen, screenshots en code-snippets.
user_invocable: true
---

# Writeup-schrijver stijlgids

Gebruik deze gids bij het schrijven of herschrijven van writeups in `src/content/writeups/`.

## Bestandsstructuur

### Frontmatter (verplicht)

```yaml
---
title: 'Nederlands: korte actieve titel'
title_en: 'English: short active title'
description: Nederlandse samenvatting, 1-2 zinnen, vertelt het verhaal
description_en: English summary, 1-2 sentences, tells the story
date: YYYY-MM-DD
category:
  - Web Security | Active Directory | ...
tags:
  - relevante-tags-in-kebab-case
readingTime: XX min
pinned: false
draft: false
---
```

### Taalstructuur

De writeup bevat **twee volledige versies** in hetzelfde bestand: Nederlands en Engels. Gebruik `data-lang-block` divs:

```html
<div data-lang-block="nl">
  <!-- Volledige NL writeup -->
</div>

<div data-lang-block="en">
  <!-- Volledige EN writeup -->
</div>
```

Beide versies zijn zelfstandig, niet vertalingen woord-voor-woord.

### SVG-pijlmarkers

Definieer deze eenmalig bovenaan het bestand, voor de `data-lang-block` divs:

```html
<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
<marker id="aha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--accent)"/></marker>
</defs>
</svg>
```

- `#ah` = pijl in `currentColor` (standaard tekst)
- `#aha` = pijl in accent-kleur

## Schrijfstijl

### Toon

- **Eerste persoon, vertellend.** Alsof je een collega uitlegt wat je gedaan hebt. "Ik deed X", "dan zie je Y".
- **Verhalend, niet academisch.** Geen "de aanvaller kan...", maar "ik probeer...", "dat lukt niet, dus...".
- **Uitleggen alsof de lezer meekijkt.** Niet alleen wat, maar ook waarom en hoe je erbij komt.
- Elke tool, term en techniek die je voor het eerst noemt: **leg 'm uit**. Kort, in dezelfde zin of alinea.
- Verwijs naar eerdere writeups als context gedeeld wordt: `[link tekst](/writeups/slug/)`.

### Taalgebruik

- **Geen em dashes (—).** Gebruik komma's, punten, dubbelepunten of woorden als "zoals", "want", "dus".
- **Simpele woorden.** Geen "venijn", "nettoresultaat", "neutraliseren", "transparant", "cruciaal". Gebruik "probleem", "resultaat", "uitschakelen", "gewoon", "belangrijk".
- Vermijd een te formele of academische toon. Schrijf zoals je praat.
- Technische termen in het Engels mogen gewoon Engels blijven (`symlink`, `reverse shell`, `mode 120000`).
- Gebruik **bold** voor eerste introductie van een belangrijk concept.
- Gebruik `code` voor commando's, functies, variabelen, paden, waarden.
- Gebruik *italic* voor nadruk, niet voor termen.

### Sectie-opbouw

Elke writeup volgt deze globale structuur met genummerde secties (`## 00 ·`, `## 01 ·`, etc.):

1. **Disclaimer** (blockquote met lab/autorisatie-waarschuwing)
2. **TL;DR** (blockquote, 3-4 zinnen, het hele verhaal in het kort)
3. **Inleidende alinea** (wat dit verhaal behandelt en waarom het interessant is)
4. **Context/enumeratie** (hoe je de target vindt, poortscans, fingerprinting)
5. **Technische achtergrond** (protocol/concept uitleg die de lezer nodig heeft)
6. **De bug/kwetsbaarheid** (code review, waar het misgaat en waarom)
7. **De aanval concreet** (hoe je het misbruikt, stap voor stap)
8. **Exploitatie uitvoeren** (tools draaien, output laten zien, screenshots)
9. **Blue team** (waar deze aanval gestopt had kunnen worden)
10. **De les** (kernlessen, genummerde lijst, kort en krachtig)

Niet elke writeup heeft alle secties. Voeg secties toe of verwijder ze op basis van het verhaal.

## Diagrammen (inline SVG)

### Wanneer

Gebruik een diagram wanneer een flow, keten of relatie sneller te begrijpen is dan tekst. Niet voor simpele opsommingen.

### Technische regels

- **Inline SVG**, geen externe bestanden.
- `viewBox` van `0 0 720 xxx` (720 breed, hoogte variabel).
- `style="width:100%;height:auto"` op de svg.
- `font-family:var(--font-mono,monospace);font-size:12px` op de svg.
- Wrap in `<figure style="margin:26px 0">`.
- Geef elke SVG een unieke `<title id="...">` en bijbehorend `aria-labelledby`.
- **Aparte id's voor NL en EN** versies van hetzelfde diagram (bijv. `relayx-nl` en `relayx-en`).

### Kleuren (CSS variabelen, nooit hardcoded)

| Gebruik | Variabele |
|---------|-----------|
| Achtergrond van normale blokken | `var(--surface-2)` |
| Rand van normale blokken | `var(--border)` |
| Achtergrond van gemarkeerde blokken | `var(--accent-weak)` |
| Rand/tekst van gemarkeerde blokken | `var(--accent)` |
| Gedempte tekst | `var(--muted)` |
| Standaard tekst | `currentColor` |

### Layout-patronen

- **Rechthoeken**: `<rect>` met `rx="6"` voor afgeronde hoeken.
- **Tekst gecentreerd** in blokken via `text-anchor="middle"`.
- **Pijlen** met `marker-end="url(#ah)"` of `url(#aha)` voor accent.
- **Gemarkeerd blok** (het eindresultaat, de kern): accent-kleuren.
- **Tekst in blokken**: titel (font-weight 700), subtekst (font-size 11), context (font-size 10, fill:var(--muted)).

### Veelgemaakte fouten vermijden

- **Tekst die uit het blok steekt.** Controleer altijd of de tekst past binnen de `width` van de `<rect>`. Bij monospace font is een karakter ~7.2px bij 12px, ~6.5px bij 11px. Tel de karakters en vergelijk met de breedte.
- **Geen emoji's in diagrammen.**
- **Pijlen aanpassen** als je blokken verplaatst of vergroot.

## Screenshots

### Wanneer

- Terminal-output die te lang of te complex is voor een codeblok.
- Browser-views van webapps.
- Bewijs van succesvolle exploitatie.
- Elk visueel moment dat het verhaal sterker maakt.

### Hoe

- Sla screenshots op in `public/media/writeups/` met een prefix per writeup (`nr-` voor NTLM relay, `gogs-` voor Gogs, etc.).
- Gebruik kebab-case bestandsnamen: `nr-responder-capture.png`, `gogs-03-poc-execution.png`.
- Markdown syntax: `![Alt tekst die beschrijft wat je ziet](/media/writeups/bestandsnaam.png)`.
- Voor screenshots die te klein renderen bij hun native resolutie, gebruik HTML: `<img src="/media/writeups/bestandsnaam.png" alt="..." style="width:100%" />`.
- Zet een italic caption onder elke screenshot: `_Beschrijving van wat de lezer ziet._`.
- **Gebruik altijd hoge-resolutie screenshots.** Een klein plaatje met `width:100%` ziet er slecht uit.

### Codeblokken vs screenshots

- Gebruik codeblokken voor commando's die de lezer zou willen kopieren.
- Gebruik screenshots voor terminal-output die bewijs toont (hashes, succesmeldingen, shells).
- Als een codeblok meer dan ~8 regels output toont, overweeg een screenshot.

## Code-snippets in de writeup

### Wanneer

Wanneer de writeup een exploit-script bespreekt, laat de relevante code zien en leg elke stap uit.

### Hoe

- Toon alleen het relevante stuk, niet de hele functie als dat niet nodig is.
- Gebruik `python`, `bash`, `go`, `ini` als taal-hint in het codeblok.
- **Na elk codeblok**: een alinea die uitlegt wat de code doet en waarom. Niet wat elke regel doet, maar wat de stap bereikt en waarom die nodig is in de aanvalsketen.
- Groepeer gerelateerde regels in hetzelfde blok, splits op logische stappen.

## Italic captions

Gebruik italic regels (`_tekst_`) als toelichting:
- Onder elk diagram: vat samen wat het diagram toont.
- Onder elke screenshot: beschrijf wat de lezer ziet.
- Niet na codeblokken (daar gebruik je gewone alinea's).

## Blue team sectie

- Genummerde of bullet-list van concrete maatregelen.
- Elke maatregel: **bold naam**, dan uitleg waarom het deze aanval stopt.
- Gericht op deze specifieke aanvalsketen, niet op generiek beveiligingsadvies.

## Lessen sectie

- Genummerde lijst, 3-5 punten.
- Elke les: **bold stelling**, dan 1-2 zinnen uitleg.
- Breder dan deze ene aanval: wat neem je mee naar de volgende?
