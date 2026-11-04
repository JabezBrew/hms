# BoardUI Table pilot

This is an adapted copy of the public official BoardUI Table component, not a
theme-only imitation. Upstream registry: https://www.boardui.com/r/table.json;
documentation: https://www.boardui.com/components/table and
https://www.boardui.com/installation. Retrieved 2026-11-03. The original TSX
source SHA256 is `f960c50c679e3473328fb7e1c9c35f746a65c73011248c827274c1433a482419`.
BoardUI distributes this free component as copyable source. No SPDX license
identifier or license notice was included in the registry component; no
additional license is asserted here. React Aria Components is Apache-2.0.

The original root composition and direct collection exports are retained.
Adaptations: JavaScript instead of TypeScript; explicit React18 `forwardRef`;
existing HMS `cn` for fixed layout classes; a uniquely scoped scroll container
with a local positioning context for absolute accessible descendants;
only the upstream Table CSS section mapped to existing HMS semantic colors,
DM Sans, 14/20 and compact13/18 metrics. The header/body selectors distinguish
row headers. There are no global resets, composite typography utilities, new
fonts, forced animation or theme/framework changes. The component forwards its
ref to the actual table, never to the scroll container.

The supplier pilot explicitly disables selection and offers no local sorting,
filtering or pagination. Its server cursor/search and exact detail controls own
those workflows. Row IDs remain opaque domain IDs; lean directory values stay
separate from private contacts and exact current details. Other app tables and
Radix dialog primitives are unchanged. The exact official registry snapshots and
controlled build-size comparison are retained in local release evidence. The
scoped positioning context retains horizontal scrolling and prevents the hidden
Actions label from using an ancestor outside the scroll container as its
containing block. No global overflow mask or content removal is used.

[Checkpoint 26B verification](../../../../../docs/v2/2026-11-04-checkpoint-26b-verification.md)
records actual full frontend checks and separately bounded keyboard, narrow
viewport and visual evidence. Doctor is maintainability feedback, not security
or accessibility certification.
Actual keyboard/action navigation, cancel/finish focus, 320/375px contained
scrolling/action reachability and finite light/dark visual checks pass. The
verification retains the exact scope; it is not whole-app certification.
