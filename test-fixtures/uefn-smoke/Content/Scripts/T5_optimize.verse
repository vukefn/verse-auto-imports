# T5: Optimize Imports command (issue #42 atomic rewrite) plus the 0.6.3 and
# 0.6.4 local-scope regressions.
#
# This file deliberately contains: a duplicate import, imports scattered
# mid-file, a missing import (vector3), a local-scope using inside a function
# body, and an indented-style using block at the bottom.
#
# Run "Verse: Optimize Imports" with general.autoImport ON, then again on a
# reset copy with it OFF. Expected in both cases, as ONE atomic edit:
#   - all module imports consolidated at the top, deduplicated
#   - using { /Verse.org/SpatialMath } ADDED (from the vector3 diagnostic)
#   - the indented "using:" block absorbed into the top block
#   - the local-scope "using { Helper }" inside Describe() left untouched
#   - no code between the scattered imports deleted
#   - success toast only if the above actually happened

using { /Verse.org/Simulation }

t5_helper := class:
    GetLabel<public>():string = "t5"

using { /Fortnite.com/Devices }
using { /Verse.org/Simulation }

t5_device := class(creative_device):
    var Position:vector3 = vector3{}

    Describe(Helper:t5_helper):string =
        using { Helper }
        GetLabel()

using:
    /Fortnite.com/Playspaces
