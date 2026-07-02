# T4: path conversion CodeLens + module location lookup (issue #41 rebuild).
# projectVersePath for this project: /vuke@fortnite.com/VerseAutoImports
#
# Case A (direct Content child, implicit folder module):
#   Gadgets.Tools -> /vuke@fortnite.com/VerseAutoImports/Gadgets/Tools
# Case B (ambiguous folder module): Combat/Weapons exists under BOTH
#   Systems/ and Features/. Conversion must detect both locations and ask
#   (or apply behavior.ambiguousImports mapping), never silently pick one.
# Case C (explicit module declarations in files): Economy := module with
#   nested Shop := module is declared in Systems/economy_a.verse AND
#   Features/economy_b.verse. This exercises the declaration cache lookup and
#   the module-definition regex across multiple files (issue #43 lastIndex
#   fix). Expect both locations detected.
#
# Steps: hover each import line, use the conversion CodeLens, then run the
# bulk "convert all" command. Also run "Rebuild Project Path Cache" first and
# compare behavior with cache.enabled true vs false.

using { Gadgets.Tools }
using { Combat.Weapons }
using { Economy.Shop }

t4_consumer := class:
    Tag:string = "t4"
