# Playbook T2: ambiguous multi-option diagnostics with the default quickfix
# strategy must not auto-import anything; every candidate must surface as a
# quick fix instead.

t2_widget := class:
    var MaybeThing:?thing = false
    var MaybeCombat:?combat_probe = false
