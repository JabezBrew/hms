# Baseline inventory item preservation

Normal baseline provisioning supplies missing default inventory items. A
canonical item already present in the facility keeps its reviewed identity,
code, category, name, physical unit, item type, controlled classification and
active state. A legitimate governed code rename remains valid on later deploys.

When the canonical local ID is absent, provisioning inserts the default without
overwriting any existing ID or code. A conflicting identity returns
`baseline_inventory_item_review_required` rather than rewriting a primary key or
allowing downstream default references to follow a different item. This requires
explicit operator review; provisioning does not invent a stock conversion or
controlled-register opening balance.

The isolated repository regression invokes the public `provision_baseline`
entrypoint. It preserves customized canonical items and their exact stock and
controlled-register evidence, preserves an actual governed code correction, and
refuses a noncanonical code collision without rewriting the retained item. All
three cases have a reproduced failing baseline before their repair.

This repair covers the seeded inventory-item conflict behavior. Baseline still
runs other seed steps independently and may publish them before an item
conflict is found. Existing category, location and supplier update behavior
continues. Explicit synthetic performance/demo seeding remains a
separate trusted operator/test path; it is not a generic clinical stock writer
and is not made universally nondestructive by this change.
