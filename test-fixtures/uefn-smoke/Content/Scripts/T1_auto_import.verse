# T1: auto-import from single-option compiler suggestions.
#
# Setup: general.autoImport ON (default). This file ships with no imports.
# Expected: within the debounce window the extension adds, exactly once each:
#   using { /Fortnite.com/Devices }      (creative_device, button_device)
#   using { /Fortnite.com/Characters }   (fort_character)
#   using { /Verse.org/Simulation }      (player, and the editable attribute)
# Devices and Simulation must be added once (dedup), not once per identifier.
#
# Verified against 41.10: vector3 is NOT usable here because the live compiler
# reports it as multi-option (/Verse.org/SpatialMath and
# /UnrealEngine.com/Temporary/SpatialMath) -- that scenario belongs to T2.

t1_device := class(creative_device):
    @editable
    TestButton:button_device = button_device{}

    var TrackedPlayers:[]player = array{}
    var MaybeCharacter:?fort_character = false
