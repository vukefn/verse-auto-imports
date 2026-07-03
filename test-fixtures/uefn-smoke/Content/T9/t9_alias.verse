# T9 case F: the import(...) module alias expression (book 16_modules,
# "Module Aliases with import"). Uncomment to test whether live UEFN accepts
# it; record the verbatim outcome. If it compiles, also add
# `using { /Verse.org/SpatialMath }` below it and confirm the extension does
# not behave differently in this file (issue #71).

# T9Math := import(/Verse.org/SpatialMath)
# T9AliasProbe():vector3 = T9Math.vector3{X := 0.0, Y := 0.0, Z := 0.0}

t9_alias_placeholder:int = 0
