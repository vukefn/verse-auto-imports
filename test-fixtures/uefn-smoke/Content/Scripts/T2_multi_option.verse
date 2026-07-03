# T2: multi-option handling. t2_shared_thing exists in BOTH the T2A and T2B
# modules, so the compiler cannot suggest a single import.
#
# Expected (multiOptionStrategy = default "quickFix"): no auto-import fires;
# the quick fix menu on the error offers one import action per candidate
# (T2A and T2B). Record the exact compiler error text in the playbook -- this
# validates our multi-option extractor patterns against live 41.10 messages.

t2_consumer := class:
    var Thing:?t2_shared_thing = false
