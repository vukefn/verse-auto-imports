# Playbook T5: Optimize Imports port. Deliberately contains a duplicate
# import, imports scattered mid-file, a local-scope using inside a function
# body, and an indented-style using pair at the bottom. A missing import
# (injected diagnostic) must be added in the same rewrite, and the local-scope
# using must survive untouched.

using { /Verse.org/Simulation }

t5_helper := class:
    GetLabel<public>():string = "t5"

using { /Fortnite.com/Devices }
using { /Verse.org/Simulation }

t5_device := class:
    Describe(Helper:t5_helper):string =
        using { Helper }
        Helper.GetLabel()

using:
    /Fortnite.com/Playspaces
