# Lavagna iPad (Web App) — v2

### Fix rispetto alla versione precedente
- **Gomma**: ora cancella “dipingendo” con il **colore dello sfondo** (molto più affidabile su canvas opaco).
- **Scrittura più facile**: usa **coalesced events** + rendering in **requestAnimationFrame**.
- **Inizio tratto**: disegna un **puntino** immediato, così non “perdi” l’attacco del segno.
- **Undo/Redo**: snapshot preso **prima** di modificare, quindi torna davvero allo stato precedente.

## Uso
Apri `index.html` in Safari e (consigliato) aggiungila alla Home.
