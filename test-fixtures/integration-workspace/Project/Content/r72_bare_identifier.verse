# Regression #70 (PR #72): a "Did you mean any of:" list echoing a local
# definition (bare identifier) must never become `using { item }`. The one
# importable candidate left is unambiguous and gets imported.

r72_inventory := class:
    var MaybeItem:?item = false
