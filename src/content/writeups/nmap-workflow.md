---
title: "Enumereren alsof je het meent: mijn Nmap-workflow van scratch"
description: "De meeste boxes vallen op enumeratie, niet op exploits. Mijn vaste volgorde van scans, en waarom elke flag erin zit."
date: 2026-09-01
category: ["Web"]
tags: ["web", "recon", "nmap", "bash"]
difficulty: "instap"
readingTime: "9 min"
---

De meeste machines vallen niet op een of andere spannende exploit, maar op iets wat je had kunnen vinden met betere enumeratie. Daarom begin ik altijd hetzelfde.

## Mijn vaste volgorde

Eerst een snelle poortscan om te zien wat er leeft, dan een gerichte scan met service- en versiedetectie op de open poorten. Pas daarna ga ik per service de diepte in.

> **◆ Nog in bewerking.** Het volledige script en de uitleg per flag verschijnen hier binnenkort.
