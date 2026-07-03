# Regression #68 (PR #73): an indented `using:` pair must survive an
# auto-import with its path intact; the #68 failure shape was a lost path
# plus an orphaned line.

using:
    /Fortnite.com/Playspaces

r73_indented := class:
    var MaybeButton:?button_device = false
