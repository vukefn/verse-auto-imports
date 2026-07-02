# T1: auto-import from single-option compiler suggestions.
#
# Setup: general.autoImport ON (default). This file ships with no imports.
# Expected: within the debounce window (default 3s) the extension adds:
#   using { /Fortnite.com/Devices }      (creative_device, button_device)
#   using { /Verse.org/SpatialMath }     (vector3)
#   using { /Verse.org/Simulation }      (player)
# Devices must be added once (dedup), not once per identifier.

t1_device := class(creative_device):
    @editable
    TestButton:button_device = button_device{}

    var Position:vector3 = vector3{}
    var TrackedPlayers:[]player = array{}
