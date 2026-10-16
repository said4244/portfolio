---
title: "Dante Pro Lab: voet aan de grond en pivoten tussen subnets"
description: "De volledige keten van de Dante Pro Lab: enumeratie, exploitatie, privilege escalation en hoe je je beweegt naar netwerken die je niet eens direct kunt zien."
date: 2026-09-28
category: ["HackTheBox"]
tags: ["htb", "pivoting", "nmap", "metasploit", "recon", "privesc"]
difficulty: "pro-lab"
readingTime: "18 min"
pinned: true
draft: false
---

Dante is een multi-host netwerk waar je begint met één machine aan de rand en langzaam naar binnen werkt. Het leuke (en leerzame) is dat je al snel netwerken tegenkomt die je niet direct kunt bereiken. Pivoting wordt dan geen trucje, maar noodzaak.

## De grote lijn

Enumeratie eerst, altijd. De meeste voortgang in Dante komt niet van exploits maar van grondig kijken: open poorten, services, versies, en vooral configuratiefouten en hergebruikte credentials.

## Pivoten in gewone taal

Een pivot betekent: je gebruikt een machine die je al beheerst als tussenstation om bij een netwerk te komen dat alleen díe machine kan zien. In deze writeup leg ik stap voor stap uit hoe dat werkt, zonder voorkennis te veronderstellen.

> **◆ Nog in bewerking.** De volledige keten verschijnt hier binnenkort, host voor host.
