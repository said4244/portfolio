---
title: "Kerberoasting uitgelegd voor wie nog nooit AD heeft aangeraakt"
description: "Wat een service-account is, waarom Kerberos kraakbare tickets uitdeelt, en hoe dat stap voor stap werkt."
date: 2026-09-19
category: ["Active Directory"]
tags: ["ad", "credentials", "windows"]
difficulty: "medium"
readingTime: "13 min"
---

Kerberoasting klinkt eng, maar het idee is simpel zodra je begrijpt wat een service-account en een ticket zijn. Dat bouwen we hier rustig op.

## Wat is een service-account?

In Active Directory draaien sommige diensten onder een eigen account. Aan zo'n account kan een "Service Principal Name" hangen, en dat is precies wat Kerberoasting misbruikt.

## Waarom je tickets offline kunt kraken

Kerberos deelt een ticket uit dat versleuteld is met het wachtwoord-hash van het service-account. Elke domeingebruiker mag zo'n ticket opvragen. Je neemt het mee naar huis en probeert het wachtwoord offline te raden, zonder ook maar één keer in te loggen.

> **◆ Nog in bewerking.** De volledige stap-voor-stap uitleg verschijnt hier binnenkort.
