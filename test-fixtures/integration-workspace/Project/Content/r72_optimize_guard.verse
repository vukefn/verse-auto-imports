# Regression #69/#70 (PR #72), Optimize path: ambiguous one-of lists,
# many-types lists, and 'set' hints in the current diagnostics must not be
# bulk-added by Optimize Imports.

using { /Verse.org/Simulation }

r72_optimize_probe := class:
    var MaybeThing:?thing = false
