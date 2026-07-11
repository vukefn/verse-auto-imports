# Regression #69 (PR #72): assignment hints ("Did you mean to write 'set ...'")
# are never import problems and must not trigger any insert.

r72_set_probe := class:
    var Count:int = 0
    Bump():void = set Count = 1
