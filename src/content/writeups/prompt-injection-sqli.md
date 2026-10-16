---
title: "Prompt injection naar SQL injection: als een LLM-agent de handen van de aanvaller wordt"
description: "Een onderzoeksproject over het beveiligen van LLM ReAct-agents, en waarom klassieke cybersecurity-problemen gewoon terugkomen in een nieuw jasje."
date: 2026-10-05
category: ["AI Security", "Web"]
tags: ["ai", "web", "sql", "python"]
difficulty: "hard"
readingTime: "11 min"
---

Dit is de brug tussen mijn twee werelden. Een LLM-agent die tools mag aanroepen en een database mag bevragen is handig, maar het maakt 'm ook gevaarlijk.

## Het kernidee

Prompt injection duwt een agent met database-toegang richting kwaadaardige input, wat leidt tot SQL injection en het lekken van data die nooit zichtbaar had mogen zijn.

## Waarom dit geen nieuw probleem is

De meeste problemen zijn klassieke cybersecurity: untrusted input, zwakke validatie, onveilige SQL-queries en te veel tool-toegang. De oplossing was geen enkele fix, maar veiliger tool-ontwerp, geparametriseerde queries, input-filtering, least privilege en betere logging.

> **◆ Nog in bewerking.** De volledige analyse verschijnt hier binnenkort.
