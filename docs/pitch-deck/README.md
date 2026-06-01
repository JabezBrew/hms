# docs/pitch-deck

Status: product/business artifact
Owner: Product/Business
Last reviewed: 2026-06-01
Scope: HMS pitch deck source and generated presentation artifacts.

## File Map

| File | Owns |
| --- | --- |
| `generate_deck.py` | script used to generate the deck artifact. |
| `HMS_Pitch_Deck.pptx` | generated PowerPoint deck. |
| `index.html` | generated/previewable deck artifact. |

## Invariants

- Do not put PHI, real patient names, MRNs, or facility secrets in pitch
  materials.
- Product claims should not overstate unfinished clinical, billing, or deploy
  capabilities.
